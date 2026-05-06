import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import ffmpeg from "fluent-ffmpeg";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { TaskRunner } from "./_lib/runner.js";

ffmpeg.setFfmpegPath(ffmpegPath);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const THUMB_DURATION = 3;
const THUMB_EXTENSION = ".jpg";
const DEFAULT_CHUNK_SIZE = 2;
const SILENT_AUDIO_PATH = path.join(__dirname, "_lib", "silence.mp3");

function probeVideo(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        return reject(new Error(`Cannot read video metadata: ${err.message}`));
      }
      const videoStream = metadata.streams.find((s) => s.codec_type === "video");
      const audioStream = metadata.streams.find((s) => s.codec_type === "audio");

      if (!videoStream) {
        return reject(new Error("No video stream found in sample file."));
      }

      resolve({
        width: videoStream.width,
        height: videoStream.height,
        frame_rate: videoStream.r_frame_rate,
        pix_fmt: videoStream.pix_fmt,
        audio_codec: audioStream ? audioStream.codec_name : "aac",
        sample_rate: audioStream ? audioStream.sample_rate : "44100",
        audio_channels: audioStream ? audioStream.channels : 2,
        audio_bitrate: audioStream ? audioStream.bit_rate : "128k",
      });
    });
  });
}

function createVideoFromThumb(thumbPath, metadata, tempDir, runner) {
  return new Promise((resolve, reject) => {
    const tempVideoPath = path.resolve(tempDir, `temp_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);
    const videoFilter = `scale=${metadata.width}:${metadata.height}:force_original_aspect_ratio=decrease,pad=${metadata.width}:${metadata.height}:-1:-1:color=black`;

    const audioBitrate =
      typeof metadata.audio_bitrate === "number"
        ? `${Math.round(metadata.audio_bitrate / 1000)}k`
        : metadata.audio_bitrate || "128k";

    runner.log("info", `Creating temp video from thumb: codec=${metadata.audio_codec}, sr=${metadata.sample_rate}, ch=${metadata.audio_channels}, br=${audioBitrate}`);

    ffmpeg()
      .input(thumbPath)
      .loop(THUMB_DURATION)
      .input(SILENT_AUDIO_PATH)
      .inputOptions([`-t ${THUMB_DURATION}`])
      .videoCodec("libx264")
      .videoFilters(videoFilter)
      .audioCodec(metadata.audio_codec)
      .audioFrequency(metadata.sample_rate)
      .audioChannels(metadata.audio_channels)
      .audioBitrate(audioBitrate)
      .outputOptions([
        `-pix_fmt ${metadata.pix_fmt}`,
        `-r ${metadata.frame_rate}`,
        `-map 0:v:0`,
        `-map 1:a:0`,
      ])
      .on("end", () => {
        runner.log("info", `Temp thumb video created: ${path.basename(tempVideoPath)}`);
        resolve(tempVideoPath);
      })
      .on("error", (err) => {
        runner.log("error", `Error creating temp thumb video: ${err.message}`);
        reject(new Error(`[FFmpeg error] ${err.message}`));
      })
      .save(tempVideoPath);
  });
}

async function processFolder(folderName, chunkSize, config, runner) {
  const { thumbsDir, doneDir, output: outputDir, tempDir } = config;

  runner.log("info", `Processing folder: "${folderName}"`);

  const videoFolderPath = path.join(doneDir, folderName);
  const thumbFolderPath = path.join(thumbsDir, folderName);
  const outputFolderPath = path.join(outputDir, folderName);
  const outputs = [];
  const errors = [];

  await fs.mkdir(outputFolderPath, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });

  const videoFiles = (await fs.readdir(videoFolderPath))
    .map((f) => f.trim())
    .filter(
      (file) =>
        !file.startsWith(".") &&
        (file.endsWith(".mp4") || file.endsWith(".mov"))
    )
    .sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );

  if (videoFiles.length === 0) {
    runner.log("info", `No videos found in folder "${folderName}".`);
    return { outputs, errors };
  }

  runner.log("info", `Found ${videoFiles.length} video(s).`);

  let sourceVideoMetadata;
  try {
    runner.log("info", `Probing sample video: ${videoFiles[0]}`);
    sourceVideoMetadata = await probeVideo(path.join(videoFolderPath, videoFiles[0]));
    runner.log("info", `Sample metadata: ${sourceVideoMetadata.width}x${sourceVideoMetadata.height}, ${sourceVideoMetadata.frame_rate} fps`);
  } catch (error) {
    runner.log("error", `Cannot probe sample video: ${error.message}`);
    errors.push({ folder: folderName, message: error.message });
    return { outputs, errors };
  }

  // Check silence.mp3 exists
  try {
    await fs.access(SILENT_AUDIO_PATH);
    runner.log("info", "silence.mp3 found.");
  } catch {
    runner.log("warn", "silence.mp3 not found, attempting to create temporary silence.");
    await new Promise((resolve, reject) => {
      const audioBitrate =
        typeof sourceVideoMetadata.audio_bitrate === "number"
          ? `${Math.round(sourceVideoMetadata.audio_bitrate / 1000)}k`
          : sourceVideoMetadata.audio_bitrate || "128k";

      ffmpeg()
        .addInput(
          `anullsrc=r=${sourceVideoMetadata.sample_rate}:cl=${
            sourceVideoMetadata.audio_channels === 1 ? "mono" : "stereo"
          }`
        )
        .inputOptions(["-f lavfi"])
        .duration(10)
        .audioCodec(sourceVideoMetadata.audio_codec)
        .audioBitrate(audioBitrate)
        .on("end", () => resolve())
        .on("error", (err) => reject(new Error(`Cannot create silence.mp3: ${err.message}`)))
        .save(SILENT_AUDIO_PATH);
    });
  }

  for (let i = 0; i < videoFiles.length; i += chunkSize) {
    runner.checkAborted();
    const chunk = videoFiles.slice(i, i + chunkSize);
    if (chunk.length < 2) {
      runner.log("info", `Single-video group: copying "${chunk[0]}" directly to output.`);
      const srcPath = path.join(videoFolderPath, chunk[0]);
      const destPath = path.join(outputFolderPath, chunk[0]);
      try {
        await fs.copyFile(srcPath, destPath);
        outputs.push(destPath);
      } catch (err) {
        errors.push({ file: chunk[0], message: err.message });
      }
      continue;
    }

    const outputFileName = chunk[0];
    const outputFilePath = path.join(outputFolderPath, outputFileName);
    runner.log("info", `Processing chunk starting with "${chunk[0]}" -> ${outputFileName}`);

    const concatListPath = path.join(tempDir, `list_${folderName}_${i}.txt`);
    let concatFileContent = "";
    const tempVideoFilesToClean = [];

    for (let j = 0; j < chunk.length; j++) {
      concatFileContent += `file '${path.resolve(videoFolderPath, chunk[j])}'\n`;

      if (j < chunk.length - 1) {
        const nextVideoName = chunk[j + 1];
        const thumbName =
          nextVideoName.replace(path.extname(nextVideoName), "") + THUMB_EXTENSION;
        // First look in thumbsDir directly, then thumbFolderPath
        const thumbPathDirect = path.resolve(thumbsDir, thumbName);
        const thumbPathSub = path.resolve(thumbFolderPath, thumbName);

        let resolvedThumbPath = null;
        try {
          await fs.access(thumbPathSub);
          resolvedThumbPath = thumbPathSub;
        } catch {
          try {
            await fs.access(thumbPathDirect);
            resolvedThumbPath = thumbPathDirect;
          } catch {
            // no thumb found
          }
        }

        if (resolvedThumbPath) {
          runner.log("info", `Preparing thumb: ${thumbName}`);
          try {
            const tempVideoPath = await createVideoFromThumb(
              resolvedThumbPath,
              sourceVideoMetadata,
              tempDir,
              runner
            );
            concatFileContent += `file '${tempVideoPath}'\n`;
            tempVideoFilesToClean.push(tempVideoPath);
          } catch (error) {
            runner.log("error", `Cannot process thumbnail "${thumbName}": ${error.message}`);
          }
        } else {
          runner.log("warn", `Thumbnail not found: "${thumbName}" — proceeding without it.`);
        }
      }
    }

    if (concatFileContent.trim().split("\n").length > 1) {
      await fs.writeFile(concatListPath, concatFileContent);

      try {
        await runner.spawnFfmpeg(
          ["-y", "-f", "concat", "-safe", "0", "-i", concatListPath, "-c", "copy", outputFilePath],
          {}
        );
        runner.log("info", `Concat complete: ${outputFilePath}`);
        outputs.push(outputFilePath);
      } catch (err) {
        if (err.name === "AbortError") throw err;
        runner.log("error", `Concat failed: ${err.message}`);
        errors.push({ file: outputFileName, message: err.message });
      }

      runner.log("info", "Cleaning up temp files...");
      for (const file of tempVideoFilesToClean) {
        try { await fs.unlink(file); } catch (e) {
          runner.log("warn", `Error deleting temp file "${file}": ${e.message}`);
        }
      }
      try { await fs.unlink(concatListPath); } catch (e) {
        runner.log("warn", `Error deleting concat list "${concatListPath}": ${e.message}`);
      }
    } else {
      runner.log("info", "Not enough video/thumb to concat for this group. Skipping.");
    }

    runner.setProgress(((i + chunkSize) / videoFiles.length) * 100, `Folder ${folderName}`);
  }

  return { outputs, errors };
}

export async function runConcat(config) {
  const runner = new TaskRunner(config);
  runner.checkAborted();

  const {
    thumbsDir,
    doneDir,
    output,
    tempDir = path.join(os.tmpdir(), "vidmaster-concat"),
    chunkSize = DEFAULT_CHUNK_SIZE,
    folderName,
  } = config;

  const resolvedConfig = { thumbsDir, doneDir, output, tempDir };

  await fs.mkdir(output, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });

  const allOutputs = [];
  const allErrors = [];

  try {
    if (folderName) {
      // Manual mode
      runner.checkAborted();
      const { outputs, errors } = await processFolder(folderName, chunkSize, resolvedConfig, runner);
      allOutputs.push(...outputs);
      allErrors.push(...errors);
    } else {
      // Auto mode: iterate subdirs of doneDir
      runner.log("info", `Auto mode: processing all subdirs of "${doneDir}"...`);
      const allFolders = await fs.readdir(doneDir, { withFileTypes: true });
      const subDirectories = allFolders
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
        );

      if (subDirectories.length === 0) {
        runner.log("info", `No subdirectories found in "${doneDir}".`);
      }

      for (const f of subDirectories) {
        runner.checkAborted();
        const { outputs, errors } = await processFolder(f, chunkSize, resolvedConfig, runner);
        allOutputs.push(...outputs);
        allErrors.push(...errors);
      }
    }
  } finally {
    // Clean up tempDir
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      runner.log("info", "Temp dir cleaned up.");
    } catch (err) {
      runner.log("warn", `Error cleaning up temp dir: ${err.message}`);
    }
  }

  runner.setProgress(100, "Concat done");
  return { ok: allErrors.length === 0, outputs: allOutputs, errors: allErrors };
}
