import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import { ffmpegPath } from "./_lib/ffmpegBin.js";
import { TaskRunner } from "./_lib/runner.js";

ffmpeg.setFfmpegPath(ffmpegPath);

export async function runCutBg(config) {
  const runner = new TaskRunner(config);
  const { input, output, segmentSeconds = 3600 } = config;
  runner.checkAborted();

  fs.mkdirSync(output, { recursive: true });
  const files = fs.readdirSync(input).filter((n) => /\.(mp4|mov|mkv)$/i.test(n));
  const outputs = [];
  const errors = [];

  for (let i = 0; i < files.length; i++) {
    runner.checkAborted();
    const file = files[i];
    const fullPath = path.join(input, file);
    try {
      const duration = await probeDuration(fullPath);
      const totalSegments = Math.ceil(duration / segmentSeconds);
      runner.log("info", `CutBg ${file}: duration=${duration}s, segments=${totalSegments}`);

      for (let s = 0; s < totalSegments; s++) {
        runner.checkAborted();
        const start = s * segmentSeconds;
        const segDur = Math.min(segmentSeconds, duration - start);
        const baseName = path.basename(file, path.extname(file));
        const outFile = path.join(output, `${baseName}_done${s + 1}.mp4`);
        await runner.spawnFfmpeg(
          ["-y", "-ss", String(start), "-t", String(segDur),
           "-i", fullPath, "-c:v", "copy", "-an", outFile],
          { totalDurationSec: segDur }
        );
        runner.log("info", `Segment saved: ${path.basename(outFile)}`);
        outputs.push(outFile);
      }
    } catch (err) {
      if (err.name === "AbortError") throw err;
      errors.push({ file, message: err.message, stack: err.stack });
      runner.log("error", `CutBg ${file} failed: ${err.message}`);
    }
    runner.setProgress(((i + 1) / files.length) * 100, `CutBg ${file}`);
  }

  runner.setProgress(100, "CutBg done");
  return { ok: errors.length === 0, outputs, errors };
}

function probeDuration(file) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, meta) =>
      err ? reject(err) : resolve(meta.format.duration)
    );
  });
}
