import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { TaskRunner } from "./_lib/runner.js";

ffmpeg.setFfmpegPath(ffmpegPath);

export async function runTrim(config) {
  const runner = new TaskRunner(config);
  const { input, output, segmentSeconds = 30, replace = false } = config;
  runner.checkAborted();

  fs.mkdirSync(output, { recursive: true });
  const files = fs.readdirSync(input).filter((n) => /\.mp4$/i.test(n));
  const outputs = [];
  const errors = [];

  for (let i = 0; i < files.length; i++) {
    runner.checkAborted();
    const file = files[i];
    const fullPath = path.join(input, file);
    try {
      const duration = await probeDuration(fullPath);
      const segments = Math.ceil(duration / segmentSeconds);
      runner.log("info", `Trimming ${file}: duration=${duration}s, segments=${segments}`);

      for (let s = 0; s < segments; s++) {
        runner.checkAborted();
        const start = s * segmentSeconds;
        const segName = `${path.parse(file).name}_part${s + 1}.mp4`;
        const segPath = path.join(output, segName);
        await runner.spawnFfmpeg(
          ["-y", "-ss", String(start), "-t", String(segmentSeconds),
           "-i", fullPath, "-c", "copy", "-an", segPath],
          { totalDurationSec: segmentSeconds }
        );
        runner.log("info", `Segment saved: ${segName}`);
        outputs.push(segPath);
      }

      if (replace) {
        fs.unlinkSync(fullPath);
        runner.log("info", `Replaced original: ${file}`);
      }
    } catch (err) {
      if (err.name === "AbortError") throw err;
      errors.push({ file, message: err.message, stack: err.stack });
      runner.log("error", `Trim ${file} failed: ${err.message}`);
    }
    runner.setProgress(((i + 1) / files.length) * 100, `Trim ${file}`);
  }

  runner.setProgress(100, "Trim done");
  return { ok: errors.length === 0, outputs, errors };
}

function probeDuration(file) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, meta) =>
      err ? reject(err) : resolve(meta.format.duration)
    );
  });
}
