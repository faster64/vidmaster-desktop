import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import { ffmpegPath } from "./_lib/ffmpegBin.js";
import { TaskRunner } from "./_lib/runner.js";

ffmpeg.setFfmpegPath(ffmpegPath);

export async function runTrimEnds(config) {
  const runner = new TaskRunner(config);
  const { input, output, trimStart = 0, trimEnd = 0, replace = false } = config;
  runner.checkAborted();

  if (trimStart < 0 || trimEnd < 0) {
    throw new Error("trimStart và trimEnd phải >= 0");
  }
  if (trimStart === 0 && trimEnd === 0) {
    throw new Error("Cần nhập ít nhất 1 trong 2: số giây cắt đầu hoặc cắt cuối");
  }
  if (!fs.existsSync(input)) {
    throw new Error(`Folder input không tồn tại: ${input}`);
  }

  fs.mkdirSync(output, { recursive: true });
  const files = fs.readdirSync(input).filter((n) => /\.mp4$/i.test(n));
  const outputs = [];
  const errors = [];

  const total = files.length;
  for (let i = 0; i < total; i++) {
    runner.checkAborted();
    const file = files[i];
    const fullPath = path.join(input, file);
    const stageOffset = (i / total) * 100;
    const stageWeight = 1 / total;
    const message = `${i + 1}/${total} ${file}`;
    runner.setProgress(stageOffset, message);
    try {
      const duration = await probeDuration(fullPath);
      const newDuration = duration - trimStart - trimEnd;
      if (newDuration <= 0) {
        throw new Error(`Video ${file} (${duration.toFixed(1)}s) quá ngắn để cắt ${trimStart}s đầu + ${trimEnd}s cuối`);
      }
      const outName = `${path.parse(file).name}_trimmed.mp4`;
      const outPath = path.join(output, outName);
      runner.log("info", `${message}: ${duration.toFixed(1)}s → ${newDuration.toFixed(1)}s (cắt đầu ${trimStart}s, cuối ${trimEnd}s)`);

      await runner.spawnFfmpeg(
        [
          "-y",
          "-ss", String(trimStart),
          "-i", fullPath,
          "-t", String(newDuration),
          "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-ar", "44100", "-ac", "2",
          "-movflags", "+faststart",
          outPath,
        ],
        { totalDurationSec: newDuration, stageOffset, stageWeight, message }
      );

      runner.log("info", `Saved: ${outName}`);
      outputs.push(outPath);

      if (replace) {
        fs.unlinkSync(fullPath);
        runner.log("info", `Replaced original: ${file}`);
      }
    } catch (err) {
      if (err.name === "AbortError") throw err;
      errors.push({ file, message: err.message, stack: err.stack });
      runner.log("error", `Trim ${file} failed: ${err.message}`);
    }
    runner.setProgress(((i + 1) / total) * 100, message);
  }

  runner.setProgress(100, "Done");
  return { ok: errors.length === 0, outputs, errors };
}

function probeDuration(file) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, meta) =>
      err ? reject(err) : resolve(meta.format.duration)
    );
  });
}
