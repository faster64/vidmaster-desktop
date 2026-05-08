import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import os from "os";
import { TaskRunner } from "./_lib/runner.js";
import { concatVideos } from "./_lib/concatVideos.js";

ffmpeg.setFfmpegPath(ffmpegPath);

// ================= 0. CONSTANTS =================
const FIXED_FPS = 30;
const FIXED_GOP = FIXED_FPS * 2;
const AUDIO_FREQ = 44100;
const VIDEO_QUALITY = 23;

// ================= helpers =================

const getFilesFromFolder = (folder, fileTypes = [".mp4"]) => {
  return fs
    .readdirSync(folder)
    .filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return fileTypes.includes(ext);
    })
    .sort((a, b) => {
      return a.localeCompare(b, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    })
    .map((file) => path.join(folder, file));
};

// Strict pre-render validator. Throws on any problem so the user fixes content
// before the queue spends minutes/hours rendering with bad colors.
export const validateChromaKeyFile = (chromaKeyFile) => {
  if (!fs.existsSync(chromaKeyFile)) {
    throw new Error(`Không tìm thấy file chromaKey: ${chromaKeyFile}`);
  }
  const content = fs.readFileSync(chromaKeyFile, "utf-8");
  const lines = content.split(/\r?\n/);
  const colors = [];
  const invalid = [];
  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;
    if (/^[0-9A-Fa-f]{6}$/.test(line)) {
      colors.push(line);
    } else {
      invalid.push({ lineNumber: idx + 1, content: line });
    }
  });
  if (invalid.length > 0) {
    const head = invalid.slice(0, 5).map((e) => `dòng ${e.lineNumber}: "${e.content}"`).join("; ");
    const more = invalid.length > 5 ? ` (và ${invalid.length - 5} dòng khác)` : "";
    throw new Error(`File chromaKey.txt có ${invalid.length} dòng không hợp lệ — mỗi dòng cần đúng 6 ký tự hex (0-9A-F), không có dấu # ở đầu, không có ký tự khác: ${head}${more}`);
  }
  if (colors.length === 0) {
    throw new Error(`File chromaKey.txt không có color hợp lệ nào (chỉ có comment và dòng trống): ${chromaKeyFile}`);
  }
  return colors;
};

const HISTORY_FILE = "_rendered.json";

const readHistory = (groupFolder) => {
  const file = path.join(groupFolder, HISTORY_FILE);
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    return Array.isArray(data?.rendered) ? data.rendered : [];
  } catch {
    return [];
  }
};

const writeHistory = (groupFolder, renderedSet) => {
  const file = path.join(groupFolder, HISTORY_FILE);
  const data = { version: 1, rendered: [...renderedSet].sort() };
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
};

const healHistoryFromDisk = (groupFolder, history) => {
  const set = new Set(history);
  if (!fs.existsSync(groupFolder)) return set;
  for (const f of fs.readdirSync(groupFolder)) {
    if (path.extname(f).toLowerCase() === ".mp4") {
      set.add(path.basename(f, path.extname(f)));
    }
  }
  return set;
};

// ================= filter builders =================

const buildComplexFilter = (inputOverlay, overlayFiles, chromaKeyColors, chromaColor, useChromaKey, height, y_offset) => {
  const overlayIndex = overlayFiles.findIndex((file) => file === inputOverlay);
  const videoColor =
    overlayIndex >= 0 && overlayIndex < chromaKeyColors.length
      ? chromaKeyColors[overlayIndex]
      : chromaColor;

  const chromaKeyFilter = useChromaKey
    ? `[1:v]scale=1280:720,colorkey=0x${videoColor}:0.3:0.1,format=yuva420p[overlay_video]`
    : `[1:v]scale=1280:720,crop=1280:${height}:0:${y_offset}[cropped]`;

  const filter = [chromaKeyFilter];

  if (!useChromaKey) {
    filter.push(
      "[cropped]eq=brightness=-1.0:contrast=3.0:gamma=1.2:saturation=0[filtered]"
    );
    filter.push(
      "[filtered]format=yuva420p,colorchannelmixer=aa=0.8[overlay_video]"
    );
  }

  return [
    filter.join(";"),
    "[0:v][overlay_video]overlay=0:H-h[combined_video]",
    "[1:a]volume=1.0[overlay_audio]",
  ];
};

const buildComplexFilterTopTransparent = (opacity) => {
  const filter = [
    `[0:v]scale=1280:720,format=yuva420p,colorchannelmixer=aa=${opacity}[top_video]`,
    "[1:v]scale=1280:720[base_video]",
  ];

  return [
    filter.join(";"),
    "[base_video][top_video]overlay=0:0[combined_video]",
    "[1:a]volume=1.0[overlay_audio]",
  ];
};

const buildComplexFilterKeepColor = (keepColorsList, keepSimilarity, keepColorAndCrop, height, y_offset) => {
  const filters = [];
  const count = keepColorsList.length;

  const totalSplits = count * 2;

  let splitOutputs = "";
  for (let i = 0; i < count; i++) {
    splitOutputs += `[src_${i}_detect][src_${i}_apply]`;
  }

  let baseFilter = "";
  if (keepColorAndCrop) {
    baseFilter = `[1:v]scale=1280:720,crop=1280:${height}:0:${y_offset}`;
  } else {
    baseFilter = `[1:v]scale=1280:720`;
  }

  filters.push(`${baseFilter},split=${totalSplits}${splitOutputs}`);

  const outputs = [];
  keepColorsList.forEach((hexColor, index) => {
    filters.push(
      `[src_${index}_detect]colorkey=0x${hexColor}:${keepSimilarity}:0.1[ck_temp_${index}]`
    );
    filters.push(`[ck_temp_${index}]alphaextract,negate[mask_${index}]`);
    filters.push(
      `[src_${index}_apply][mask_${index}]alphamerge[isolated_${index}]`
    );
    outputs.push(`[isolated_${index}]`);
  });

  let currentStream = outputs[0];
  for (let i = 1; i < outputs.length; i++) {
    const nextStream = outputs[i];
    const outName = `[stack_${i}]`;
    filters.push(`${currentStream}${nextStream}overlay=0:0${outName}`);
    currentStream = outName;
  }

  filters.push(`${currentStream}copy[final_overlay]`);

  return [
    filters.join(";"),
    `[0:v][final_overlay]overlay=0:H-h[combined_video]`,
    "[1:a]volume=1.0[overlay_audio]",
  ];
};

// ================= processVideo =================

const processVideo = (inputOverlay, inputBackground, outputPath, cfg) => {
  const {
    overlayFiles,
    chromaKeyColors,
    useChromaKey,
    chromaColor,
    useKeepColor,
    topTransparent,
    opacity,
    useGPU,
    gpuVideoCodec,
    height,
    y_offset,
    keepColorsList,
    keepSimilarity,
    keepColorAndCrop,
    runner,
  } = cfg;

  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    ffmpeg.ffprobe(inputOverlay, (err, metadata) => {
      if (err) {
        runner.log("error", `Error getting overlay metadata: ${err.message}`);
        return reject(err);
      }

      const duration = metadata.format.duration;
      const overlayHasAudio = (metadata.streams || []).some((s) => s.codec_type === "audio");

      let filterConfig;
      if (useKeepColor) {
        runner.log("info", `Using Keep Colors mode for ${path.basename(outputPath)}`);
        filterConfig = buildComplexFilterKeepColor(keepColorsList, keepSimilarity, keepColorAndCrop, height, y_offset);
      } else if (topTransparent) {
        runner.log("info", `Using top transparent overlay mode for ${path.basename(outputPath)}`);
        filterConfig = buildComplexFilterTopTransparent(opacity);
      } else {
        runner.log("info", `Using Chroma Key mode for ${path.basename(outputPath)}`);
        filterConfig = buildComplexFilter(inputOverlay, overlayFiles, chromaKeyColors, chromaColor, useChromaKey, height, y_offset);
      }

      // Overlay không có audio track → thay [1:a]volume=1.0 bằng anullsrc (silent audio)
      if (!overlayHasAudio) {
        runner.log("info", `Overlay không có audio, dùng silent audio cho ${path.basename(outputPath)}`);
        filterConfig[filterConfig.length - 1] =
          `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_FREQ},atrim=duration=${duration},asetpts=PTS-STARTPTS[overlay_audio]`;
      }

      const command = ffmpeg(inputBackground)
        .inputOptions(["-stream_loop", "-1"])
        .input(inputOverlay)
        .complexFilter(filterConfig)
        .outputOptions("-t", duration)
        .audioCodec("aac")
        .audioFrequency(AUDIO_FREQ)
        .audioChannels(2)
        .map("[combined_video]")
        .map("[overlay_audio]");

      if (useGPU) {
        runner.log("info", `Using GPU (${gpuVideoCodec}) to render ${path.basename(outputPath)}`);
        command
          .videoCodec(gpuVideoCodec)
          .outputOptions([
            "-pix_fmt yuv420p",
            `-r ${FIXED_FPS}`,
            `-g ${FIXED_GOP}`,
            `-keyint_min ${FIXED_GOP}`,
            "-sc_threshold 0",
            "-preset fast",
            `-cq:v ${VIDEO_QUALITY}`,
            "-rc:v vbr",
            "-movflags +faststart",
          ]);
      } else {
        runner.log("info", `Using CPU (ultrafast) to render ${path.basename(outputPath)}`);
        command
          .videoCodec("libx264")
          .outputOptions([
            "-preset ultrafast",
            "-pix_fmt yuv420p",
            `-r ${FIXED_FPS}`,
            `-g ${FIXED_GOP}`,
            `-keyint_min ${FIXED_GOP}`,
            "-sc_threshold 0",
            `-crf ${VIDEO_QUALITY}`,
            "-movflags +faststart",
          ]);
      }

      command
        .on("end", () => {
          const endTime = Date.now();
          runner.log("info", `Video ${path.basename(outputPath)} completed in ${((endTime - startTime) / 1000).toFixed(2)}s`);
          resolve(outputPath);
        })
        .on("error", (error) => {
          runner.log("error", `Error processing video ${path.basename(outputPath)}: ${error.message}`);
          reject(error);
        })
        .save(outputPath);
    });
  });
};

// ================= main export =================

export async function runRender(config) {
  const runner = new TaskRunner(config);
  runner.checkAborted();

  const {
    videosPerFolder,
    inputs,
    output: outputFolder,
    ffmpeg: ffmpegConfig = {},
    chromaKey = {},
    keepColor = {},
    opacity = 0.7,
    topTransparent = false,
    crop = {},
    workspaceFiles = {},
  } = config;

  const overlayFolder = inputs.overlays;
  const backgroundFolder = inputs.backgrounds;
  const headFolderRoot = inputs.headFolder || null;
  const tailFolderRoot = inputs.tailFolder || null;

  const useGPU = ffmpegConfig.useGPU || false;
  const gpuVideoCodec = ffmpegConfig.encoder || "libx264";
  const maxConcurrentProcesses = ffmpegConfig.maxConcurrent || 2;

  // chromaKey config
  const useChromaKey = chromaKey.color != null;
  const chromaColor = chromaKey.color || "D4F9D7";
  const keepSimilarity = chromaKey.similarity || 0.2;

  // keepColor config
  const useKeepColor = keepColor.enabled || false;
  const keepColorsList = keepColor.list || ["FBFF02"];
  const keepColorAndCrop = keepColor.andCrop || false;

  // crop config
  const height = crop.height || 220;
  const y_offset = crop.yOffset || 490;

  // workspace files
  const chromaKeyFile = workspaceFiles.chromaKey || null;

  const outputs = [];
  const errors = [];

  // Validate overlay folder exists
  if (!fs.existsSync(overlayFolder)) {
    throw new Error(`Không tìm thấy folder overlays: ${overlayFolder}`);
  }

  const overlayFiles = getFilesFromFolder(overlayFolder);

  // Validate + read chroma key colors from file (strict; throws if path set but content invalid)
  let chromaKeyColors = [];
  if (chromaKeyFile) {
    chromaKeyColors = validateChromaKeyFile(chromaKeyFile);
    runner.log("info", `Read ${chromaKeyColors.length} chroma key colors from file ${chromaKeyFile}`);
  }

  const startTime = Date.now();

  // 1. Check overlay videos
  const totalOverlays = overlayFiles.length;
  if (totalOverlays === 0) {
    throw new Error(`Folder overlays trống, không có video nào: ${overlayFolder}`);
  }

  // 2. List background subfolders by actual name (sort natural-numeric)
  if (!fs.existsSync(backgroundFolder)) {
    throw new Error(`Không tìm thấy folder backgrounds: ${backgroundFolder}`);
  }
  const backgroundFolderNames = fs.readdirSync(backgroundFolder)
    .filter((f) => fs.lstatSync(path.join(backgroundFolder, f)).isDirectory())
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  const totalVideoBackgrounds = backgroundFolderNames.length;

  // 3. Check background folder count
  if (totalVideoBackgrounds === 0) {
    throw new Error("Folder backgrounds không có subfolder nào");
  }

  // 4. Overview log
  runner.log("info", `Starting with ${totalOverlays} overlay videos and ${totalVideoBackgrounds} background folders. Videos / folder: ${videosPerFolder}.`);

  // 5. Build per-folder state: read history (heal from disk), compute available overlays
  const overlayBaseByName = new Map(
    overlayFiles.map((p) => [path.basename(p, path.extname(p)), p])
  );

  const folderState = backgroundFolderNames.map((folderName) => {
    const groupFolder = path.join(outputFolder, folderName);
    if (!fs.existsSync(groupFolder)) fs.mkdirSync(groupFolder, { recursive: true });
    const histSet = healHistoryFromDisk(groupFolder, readHistory(groupFolder));
    const available = [...overlayBaseByName.keys()].filter((b) => !histSet.has(b));
    return { folderName, groupFolder, histSet, available };
  });

  // 6. Pre-flight: every folder must have enough unrendered overlays
  const exhausted = folderState.filter((s) => s.available.length < videosPerFolder);
  if (exhausted.length > 0) {
    const detail = exhausted
      .map((s) => `${s.folderName} (còn ${s.available.length}/${videosPerFolder})`)
      .join(", ");
    throw new Error(`Folder đã render hết overlay khả dụng: ${detail}. Thêm overlay mới hoặc xoá _rendered.json để render lại.`);
  }

  // 7. Pick algorithm: round-robin across folders, preferring overlays not yet picked this run
  const usedThisRun = new Set();
  const picksByFolder = folderState.map(() => []);
  for (let slot = 0; slot < videosPerFolder; slot++) {
    for (let i = 0; i < folderState.length; i++) {
      const fs_ = folderState[i];
      const taken = picksByFolder[i];
      let chosen = fs_.available.find((b) => !usedThisRun.has(b) && !taken.includes(b));
      if (!chosen) chosen = fs_.available.find((b) => !taken.includes(b));
      if (!chosen) {
        throw new Error(`Folder ${fs_.folderName} hết overlay khả dụng ở slot ${slot + 1}`);
      }
      taken.push(chosen);
      usedThisRun.add(chosen);
    }
  }

  // 8. Total videos to process
  const totalVideosToProcess = totalVideoBackgrounds * videosPerFolder;
  runner.log("info", `Total videos to process: ${totalVideosToProcess} (max concurrent: ${maxConcurrentProcesses})`);

  let processedVideos = 0;
  let errorVideos = 0;

  const videoCfg = {
    overlayFiles,
    chromaKeyColors,
    useChromaKey,
    chromaColor,
    useKeepColor,
    topTransparent,
    opacity,
    useGPU,
    gpuVideoCodec,
    height,
    y_offset,
    keepColorsList,
    keepSimilarity,
    keepColorAndCrop,
    runner,
  };

  // 9. Process each folder
  for (let i = 0; i < folderState.length; i++) {
    runner.checkAborted();

    const { folderName, groupFolder, histSet } = folderState[i];
    const folderPicks = picksByFolder[i];

    // Background files for this folder
    const backgroundsFolderPath = path.join(backgroundFolder, folderName);
    const backgroundFiles = getFilesFromFolder(backgroundsFolderPath);
    const totalBackgroundsForFolder = backgroundFiles.length;
    runner.log("info", `Folder ${folderName} (${i + 1}/${totalVideoBackgrounds}): ${totalBackgroundsForFolder} background videos, picks=${folderPicks.join(", ")}`);

    if (totalBackgroundsForFolder === 0) {
      runner.log("error", `No background files for folder ${folderName}`);
      processedVideos += videosPerFolder;
      errorVideos += videosPerFolder;
      runner.setProgress(Math.round((processedVideos / totalVideosToProcess) * 100), "");
      errors.push({ folder: folderName, message: "No background files" });
      continue;
    }

    // Optional head/tail per channel (sub-folder named like the background folder)
    const headFiles = listChannelClips(headFolderRoot, folderName);
    const tailFiles = listChannelClips(tailFolderRoot, folderName);
    if ((headFolderRoot || tailFolderRoot) && (headFiles.length || tailFiles.length)) {
      runner.log("info", `Channel ${folderName}: head=${headFiles.length} tail=${tailFiles.length}`);
    } else if (headFolderRoot || tailFolderRoot) {
      runner.log("info", `Channel ${folderName}: no head/tail (skip concat for this channel)`);
    }

    const tasks = folderPicks.map((overlayBase, j) => {
      const overlay = overlayBaseByName.get(overlayBase);
      const background = backgroundFiles[Math.floor(Math.random() * totalBackgroundsForFolder)];
      const outputPath = path.join(groupFolder, `${overlayBase}.mp4`);
      const head = headFiles.length ? headFiles[j % headFiles.length] : null;
      const tail = tailFiles.length ? tailFiles[j % tailFiles.length] : null;
      return { overlay, background, outputPath, overlayBase, head, tail };
    });

    // Process in parallel batches; on success add to histSet
    for (let k = 0; k < tasks.length; k += maxConcurrentProcesses) {
      runner.checkAborted();
      const batch = tasks.slice(k, k + maxConcurrentProcesses);
      await Promise.all(batch.map((task) =>
        processVideo(task.overlay, task.background, task.outputPath, videoCfg)
          .then(async (outPath) => {
            await maybeConcatInPlace(outPath, task.head, task.tail, runner, config.signal);
            processedVideos++;
            runner.setProgress(Math.round((processedVideos / totalVideosToProcess) * 100), "");
            outputs.push(outPath);
            histSet.add(task.overlayBase);
          })
          .catch((error) => {
            runner.log("error", `Error processing video: ${error.message}`);
            processedVideos++;
            errorVideos++;
            runner.setProgress(Math.round((processedVideos / totalVideosToProcess) * 100), "");
            errors.push({ file: task.outputPath, message: error.message });
          })
      ));
    }

    // Persist history for this folder (after all picks attempted)
    try {
      writeHistory(groupFolder, histSet);
    } catch (err) {
      runner.log("error", `Failed to write history for ${folderName}: ${err.message}`);
    }
  }

  // 10. Final summary
  const endTime = Date.now();
  const totalTime = ((endTime - startTime) / 1000 / 60).toFixed(2);
  runner.log("info", `Done! Total time: ${totalTime} minutes — ${processedVideos - errorVideos}/${totalVideosToProcess} ok, ${errorVideos} errors`);
  runner.setProgress(100, "Render done");

  return { ok: errors.length === 0, outputs, errors };
}

// ================= head/tail concat helpers =================

function listChannelClips(rootFolder, channelName) {
  if (!rootFolder) return [];
  const channelFolder = path.join(rootFolder, channelName);
  if (!fs.existsSync(channelFolder)) return [];
  return getFilesFromFolder(channelFolder);
}

async function maybeConcatInPlace(renderedPath, headFile, tailFile, runner, signal) {
  if (!headFile && !tailFile) return;
  const inputs = [headFile, renderedPath, tailFile].filter(Boolean);
  if (inputs.length < 2) return;
  const tmpPath = `${renderedPath}.concat.tmp.mp4`;
  const baseName = path.basename(renderedPath);
  try {
    runner.log("info", `Concat ${baseName} ← ${inputs.map((p) => path.basename(p)).join(" + ")}`);
    await concatVideos({ inputs, output: tmpPath, signal, runner, message: `Nối: ${baseName}` });
    fs.rmSync(renderedPath, { force: true });
    fs.renameSync(tmpPath, renderedPath);
    runner.log("info", `Concat done: ${baseName}`);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    if (err.name === "AbortError") throw err;
    runner.log("error", `Concat failed for ${baseName}: ${err.message} (giữ bare render)`);
  }
}
