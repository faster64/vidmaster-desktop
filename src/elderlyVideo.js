import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import { ffmpegPath } from "./_lib/ffmpegBin.js";
import { TaskRunner } from "./_lib/runner.js";

ffmpeg.setFfmpegPath(ffmpegPath);

const OUTPUT_W = 1280;
const OUTPUT_H = 720;
const FIXED_FPS = 30;
const FIXED_GOP = FIXED_FPS * 2;
const AUDIO_FREQ = 44100;
const VIDEO_QUALITY = 23;
const HISTORY_FILE = "_processed.json";

const BG_VIDEO_EXT = /\.mp4$/i;
const BG_ANY_EXT   = /\.(jpe?g|png|mp4)$/i;

export const ANCHORS = new Set([
  "top-left", "top", "top-right",
  "left", "center", "right",
  "bottom-left", "bottom", "bottom-right",
]);

export function computeOverlayXY(anchor, canvasW, canvasH, w, h, offsetX = 0, offsetY = 0) {
  if (!ANCHORS.has(anchor)) throw new Error(`Anchor không hợp lệ: ${anchor}`);
  const halfX = (canvasW - w) / 2;
  const halfY = (canvasH - h) / 2;
  const right = canvasW - w;
  const bottom = canvasH - h;
  const table = {
    "top-left":     [0,     0],
    "top":          [halfX, 0],
    "top-right":    [right, 0],
    "left":         [0,     halfY],
    "center":       [halfX, halfY],
    "right":        [right, halfY],
    "bottom-left":  [0,     bottom],
    "bottom":       [halfX, bottom],
    "bottom-right": [right, bottom],
  };
  const [bx, by] = table[anchor];
  return [Math.round(bx + offsetX), Math.round(by + offsetY)];
}

const naturalSort = (a, b) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

function readProcessedHistory(outputFolder) {
  const file = path.join(outputFolder, HISTORY_FILE);
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    return Array.isArray(data?.processed) ? data.processed : [];
  } catch {
    return [];
  }
}

function writeProcessedHistory(outputFolder, processedSet) {
  const file = path.join(outputFolder, HISTORY_FILE);
  const data = { version: 1, processed: [...processedSet].sort() };
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}

function healProcessedFromDisk(outputFolder, history) {
  const set = new Set(history);
  if (!fs.existsSync(outputFolder)) return set;
  for (const f of fs.readdirSync(outputFolder)) {
    if (path.extname(f).toLowerCase() === ".mp4") {
      set.add(path.basename(f, path.extname(f)));
    }
  }
  return set;
}

function probeVideo(file) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, meta) => {
      if (err) return reject(err);
      const duration = meta?.format?.duration;
      const hasAudio = (meta?.streams || []).some((s) => s.codec_type === "audio");
      if (!Number.isFinite(duration) || duration <= 0) {
        return reject(new Error(`Không đọc được duration video: ${file}`));
      }
      resolve({ duration, hasAudio });
    });
  });
}

async function processOnePair({
  backgroundPath, videoPath, outputPath,
  anchor, overlayWidth, overlayHeight, offsetX, offsetY,
  useGPU, gpuEncoder, runner,
}) {
  const { duration: overlayDuration, hasAudio } = await probeVideo(videoPath);
  const [x, y] = computeOverlayXY(anchor, OUTPUT_W, OUTPUT_H, overlayWidth, overlayHeight, offsetX, offsetY);

  const bgIsVideo = BG_VIDEO_EXT.test(backgroundPath);
  let targetDuration = overlayDuration;

  const args = ["-y"];
  if (bgIsVideo) {
    const { duration: bgDuration } = await probeVideo(backgroundPath);
    targetDuration = Math.max(bgDuration, overlayDuration);
    args.push("-stream_loop", "-1", "-i", backgroundPath);
    args.push("-stream_loop", "-1", "-i", videoPath);
  } else {
    args.push("-loop", "1", "-framerate", String(FIXED_FPS), "-i", backgroundPath);
    args.push("-i", videoPath);
  }
  if (!hasAudio) {
    args.push("-f", "lavfi", "-i", `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_FREQ}`);
  }

  const filter =
    `[0:v]scale=${OUTPUT_W}:${OUTPUT_H}:force_original_aspect_ratio=increase,crop=${OUTPUT_W}:${OUTPUT_H}[bg];` +
    `[1:v]scale=${overlayWidth}:${overlayHeight}[ov];` +
    `[bg][ov]overlay=${x}:${y}[v]`;
  args.push("-filter_complex", filter);
  args.push("-map", "[v]");
  args.push("-map", hasAudio ? "1:a" : "2:a");
  args.push("-t", String(targetDuration));

  if (useGPU && gpuEncoder && gpuEncoder !== "libx264") {
    args.push(
      "-c:v", gpuEncoder,
      "-preset", "fast",
      "-pix_fmt", "yuv420p",
      "-r", String(FIXED_FPS),
      "-g", String(FIXED_GOP),
      "-keyint_min", String(FIXED_GOP),
      "-sc_threshold", "0",
      "-cq:v", String(VIDEO_QUALITY),
      "-rc:v", "vbr",
    );
  } else {
    args.push(
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-pix_fmt", "yuv420p",
      "-r", String(FIXED_FPS),
      "-g", String(FIXED_GOP),
      "-keyint_min", String(FIXED_GOP),
      "-sc_threshold", "0",
      "-crf", String(VIDEO_QUALITY),
    );
  }
  args.push("-c:a", "aac", "-ar", String(AUDIO_FREQ), "-ac", "2");
  args.push("-movflags", "+faststart");
  args.push(outputPath);

  await runner.spawnFfmpeg(args, {
    totalDurationSec: targetDuration,
    message: `Render ${path.basename(outputPath)}`,
  });
}

export async function runElderlyVideo(config) {
  const runner = new TaskRunner(config);
  runner.checkAborted();

  const {
    inputImages, inputVideos, output,
    anchor = "bottom-left",
    overlayWidth, overlayHeight,
    offsetX = 0, offsetY = 0,
    ffmpeg: ffmpegConfig = {},
  } = config;

  if (!inputImages || !fs.existsSync(inputImages)) {
    throw new Error("Folder ảnh/video nền không tồn tại.");
  }
  if (!inputVideos || !fs.existsSync(inputVideos)) {
    throw new Error("Folder video không tồn tại.");
  }
  if (!output) throw new Error("Thiếu folder output.");
  if (!ANCHORS.has(anchor)) throw new Error(`Anchor không hợp lệ: ${anchor}`);
  if (!Number.isInteger(overlayWidth) || overlayWidth <= 0) {
    throw new Error("overlayWidth phải là số nguyên > 0.");
  }
  if (!Number.isInteger(overlayHeight) || overlayHeight <= 0) {
    throw new Error("overlayHeight phải là số nguyên > 0.");
  }

  const backgrounds = fs.readdirSync(inputImages)
    .filter((n) => BG_ANY_EXT.test(n))
    .sort(naturalSort);
  if (backgrounds.length === 0) {
    throw new Error("Folder nền không có file .jpg/.png/.mp4.");
  }

  const videos = fs.readdirSync(inputVideos)
    .filter((n) => /\.mp4$/i.test(n))
    .sort(naturalSort);
  if (videos.length === 0) {
    throw new Error("Folder video không có file .mp4.");
  }

  fs.mkdirSync(output, { recursive: true });

  const history = healProcessedFromDisk(output, readProcessedHistory(output));
  const todoVideos = videos.filter((v) =>
    !history.has(path.basename(v, path.extname(v)))
  );

  if (todoVideos.length === 0) {
    runner.log("info", "Tất cả video đã được xử lý trước đó. Xoá _processed.json hoặc xoá file output để chạy lại.");
    runner.setProgress(100, "Done (nothing to do)");
    return { ok: true, outputs: [], errors: [] };
  }

  const useGPU = ffmpegConfig.useGPU || false;
  const gpuEncoder = ffmpegConfig.encoder || "libx264";

  runner.log("info",
    `Bắt đầu: ${todoVideos.length}/${videos.length} videos × ${backgrounds.length} nền ` +
    `(anchor=${anchor}, overlay=${overlayWidth}×${overlayHeight}, offset=${offsetX},${offsetY}, ` +
    `${useGPU ? `GPU=${gpuEncoder}` : "CPU=libx264 ultrafast"})`
  );

  const outputs = [];
  const errors = [];

  for (let i = 0; i < todoVideos.length; i++) {
    runner.checkAborted();
    const videoName = todoVideos[i];
    const originalIdx = videos.indexOf(videoName);
    const backgroundName = backgrounds[originalIdx % backgrounds.length];
    const videoBase = path.basename(videoName, path.extname(videoName));
    const outputPath = path.join(output, `${videoBase}.mp4`);

    try {
      await processOnePair({
        backgroundPath: path.join(inputImages, backgroundName),
        videoPath: path.join(inputVideos, videoName),
        outputPath,
        anchor, overlayWidth, overlayHeight, offsetX, offsetY,
        useGPU, gpuEncoder,
        runner,
      });
      outputs.push(outputPath);
      history.add(videoBase);
      try {
        writeProcessedHistory(output, history);
      } catch (err) {
        runner.log("warn", `Không ghi được _processed.json: ${err.message}`);
      }
      runner.log("info", `OK ${videoName} ← ${backgroundName}`);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      errors.push({ video: videoName, background: backgroundName, message: err.message });
      runner.log("error", `${videoName} failed: ${err.message}`);
    }

    runner.setProgress(
      ((i + 1) / todoVideos.length) * 100,
      `${i + 1}/${todoVideos.length} ${videoBase}`
    );
  }

  runner.setProgress(100, `Đã ghi ${outputs.length}/${todoVideos.length}`);
  return { ok: errors.length === 0, outputs, errors };
}
