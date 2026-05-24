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
const HISTORY_FILE = "_rendered.json";

const naturalSort = (a, b) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

function readRenderedHistory(outputFolder) {
  const file = path.join(outputFolder, HISTORY_FILE);
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    return Array.isArray(data?.rendered) ? data.rendered : [];
  } catch {
    return [];
  }
}

function writeRenderedHistory(outputFolder, renderedSet) {
  const file = path.join(outputFolder, HISTORY_FILE);
  const data = { version: 1, rendered: [...renderedSet].sort() };
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}

function healRenderedFromDisk(outputFolder, history) {
  const set = new Set(history);
  if (!fs.existsSync(outputFolder)) return set;
  for (const f of fs.readdirSync(outputFolder)) {
    if (path.extname(f).toLowerCase() === ".mp4") {
      set.add(path.basename(f, path.extname(f)));
    }
  }
  return set;
}

function probeDurationAndAudio(file) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, meta) => {
      if (err) return reject(err);
      const duration = meta?.format?.duration;
      const hasAudio = (meta?.streams || []).some((s) => s.codec_type === "audio");
      if (!Number.isFinite(duration) || duration <= 0) {
        return reject(new Error(`Không đọc được duration: ${file}`));
      }
      resolve({ duration, hasAudio });
    });
  });
}

function buildVideoCodecArgs(useGPU, gpuEncoder) {
  if (useGPU && gpuEncoder && gpuEncoder !== "libx264") {
    return [
      "-c:v", gpuEncoder,
      "-preset", "fast",
      "-pix_fmt", "yuv420p",
      "-r", String(FIXED_FPS),
      "-g", String(FIXED_GOP),
      "-keyint_min", String(FIXED_GOP),
      "-sc_threshold", "0",
      "-cq:v", String(VIDEO_QUALITY),
      "-rc:v", "vbr",
    ];
  }
  return [
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-pix_fmt", "yuv420p",
    "-r", String(FIXED_FPS),
    "-g", String(FIXED_GOP),
    "-keyint_min", String(FIXED_GOP),
    "-sc_threshold", "0",
    "-crf", String(VIDEO_QUALITY),
  ];
}

async function processMp4Pair({
  inputPath, backgroundPath, outputPath,
  cropValue, overlayValue,
  useGPU, gpuEncoder, runner,
}) {
  const { duration } = await probeDurationAndAudio(inputPath);

  const filter =
    `[1:v]scale=${OUTPUT_W}:${OUTPUT_H},crop=${cropValue},` +
    `lutyuv=y='if(gt(val,180),255,0)':u=128:v=128,` +
    `format=yuva420p,colorchannelmixer=aa=1.0[overlay];` +
    `[0:v][overlay]overlay=${overlayValue}:shortest=1[outv]`;

  const args = [
    "-y",
    "-stream_loop", "-1", "-i", backgroundPath,
    "-i", inputPath,
    "-filter_complex", filter,
    "-map", "[outv]",
    "-map", "1:a?",
    ...buildVideoCodecArgs(useGPU, gpuEncoder),
    "-c:a", "aac", "-ar", String(AUDIO_FREQ), "-ac", "2",
    "-shortest",
    "-movflags", "+faststart",
    outputPath,
  ];

  await runner.spawnFfmpeg(args, {
    totalDurationSec: duration,
    message: `Render ${path.basename(outputPath)} (mp4)`,
  });
}

async function processMp3Pair({
  inputPath, backgroundPath, outputPath, runner,
}) {
  const { duration } = await probeDurationAndAudio(inputPath);

  const args = [
    "-y",
    "-i", inputPath,
    "-stream_loop", "-1", "-i", backgroundPath,
    "-t", String(duration),
    "-map", "1:v",
    "-map", "0:a",
    "-c:v", "copy",
    "-c:a", "aac", "-ar", String(AUDIO_FREQ), "-ac", "2", "-b:a", "192k",
    "-movflags", "+faststart",
    outputPath,
  ];

  await runner.spawnFfmpeg(args, {
    totalDurationSec: duration,
    message: `Render ${path.basename(outputPath)} (mp3)`,
  });
}

export async function runElderlyRender(config) {
  const runner = new TaskRunner(config);
  runner.checkAborted();

  const {
    inputFolder, backgroundFolder, output,
    cropValue = "", overlayValue = "",
    ffmpeg: ffmpegConfig = {},
  } = config;

  if (!inputFolder || !fs.existsSync(inputFolder)) {
    throw new Error("Folder input không tồn tại.");
  }
  if (!backgroundFolder || !fs.existsSync(backgroundFolder)) {
    throw new Error("Folder video nền không tồn tại.");
  }
  if (!output) throw new Error("Thiếu folder output.");

  const inputs = fs.readdirSync(inputFolder)
    .filter((n) => /\.(mp3|mp4)$/i.test(n))
    .sort(naturalSort);
  if (inputs.length === 0) {
    throw new Error("Folder input không có file .mp3/.mp4.");
  }

  const backgrounds = fs.readdirSync(backgroundFolder)
    .filter((n) => /\.mp4$/i.test(n))
    .sort(naturalSort);
  if (backgrounds.length === 0) {
    throw new Error("Folder video nền không có file .mp4.");
  }

  const hasMp4Input = inputs.some((n) => /\.mp4$/i.test(n));
  if (hasMp4Input && (!cropValue.trim() || !overlayValue.trim())) {
    throw new Error("Cần cropValue + overlayValue cho file .mp4.");
  }

  fs.mkdirSync(output, { recursive: true });

  const history = healRenderedFromDisk(output, readRenderedHistory(output));
  const todoInputs = inputs.filter((n) =>
    !history.has(path.basename(n, path.extname(n)))
  );

  if (todoInputs.length === 0) {
    runner.log("info", "Tất cả input đã được render trước đó. Xoá _rendered.json hoặc xoá file output để render lại.");
    runner.setProgress(100, "Done (nothing to do)");
    return { ok: true, outputs: [], errors: [] };
  }

  const useGPU = ffmpegConfig.useGPU || false;
  const gpuEncoder = ffmpegConfig.encoder || "libx264";

  runner.log("info",
    `Bắt đầu: ${todoInputs.length}/${inputs.length} input × ${backgrounds.length} background ` +
    `(crop="${cropValue}", overlay="${overlayValue}", ` +
    `${useGPU ? `GPU=${gpuEncoder}` : "CPU=libx264 ultrafast"})`
  );

  const outputs = [];
  const errors = [];

  for (let i = 0; i < todoInputs.length; i++) {
    runner.checkAborted();
    const inputName = todoInputs[i];
    const originalIdx = inputs.indexOf(inputName);
    const bgName = backgrounds[originalIdx % backgrounds.length];
    const inputBase = path.basename(inputName, path.extname(inputName));
    const inputExt = path.extname(inputName).toLowerCase();
    const outputPath = path.join(output, `${inputBase}.mp4`);

    try {
      const common = {
        inputPath: path.join(inputFolder, inputName),
        backgroundPath: path.join(backgroundFolder, bgName),
        outputPath,
        runner,
      };
      if (inputExt === ".mp4") {
        await processMp4Pair({ ...common, cropValue, overlayValue, useGPU, gpuEncoder });
      } else if (inputExt === ".mp3") {
        await processMp3Pair(common);
      } else {
        throw new Error(`Extension không hỗ trợ: ${inputExt}`);
      }
      outputs.push(outputPath);
      history.add(inputBase);
      try {
        writeRenderedHistory(output, history);
      } catch (err) {
        runner.log("warn", `Không ghi được _rendered.json: ${err.message}`);
      }
      runner.log("info", `OK ${inputName} ← ${bgName}`);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      errors.push({ input: inputName, background: bgName, message: err.message });
      runner.log("error", `${inputName} failed: ${err.message}`);
    }

    runner.setProgress(
      ((i + 1) / todoInputs.length) * 100,
      `${i + 1}/${todoInputs.length} ${inputBase}`
    );
  }

  runner.setProgress(100, `Đã ghi ${outputs.length}/${todoInputs.length}`);
  return { ok: errors.length === 0, outputs, errors };
}
