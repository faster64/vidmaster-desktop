import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import { TaskRunner } from "./_lib/runner.js";
import { AbortError, throwIfAborted } from "./_lib/abortError.js";

ffmpeg.setFfmpegPath(ffmpegPath);

export async function runConcat(config) {
  const runner = new TaskRunner(config);
  const { inputs, output } = config;
  const { signal } = config;

  if (!Array.isArray(inputs) || inputs.length < 2) {
    throw new Error("Cần ít nhất 2 video để nối.");
  }
  for (const p of inputs) {
    if (!fs.existsSync(p)) throw new Error(`File không tồn tại: ${p}`);
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });

  runner.checkAborted();
  runner.setProgress(0, "Phân tích input...");

  const probes = await Promise.all(inputs.map((p) => probe(p)));
  const totalDur = probes.reduce((a, b) => a + b.duration, 0);
  const allHaveAudio = probes.every((p) => p.hasAudio);

  const args = ["-y"];
  for (const p of inputs) { args.push("-i", p); }

  let filter;
  if (allHaveAudio) {
    const inp = inputs.map((_, i) => `[${i}:v:0][${i}:a:0]`).join("");
    filter = `${inp}concat=n=${inputs.length}:v=1:a=1[v][a]`;
  } else {
    const inp = inputs.map((_, i) => `[${i}:v:0]`).join("");
    filter = `${inp}concat=n=${inputs.length}:v=1:a=0[v];anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=${totalDur},asetpts=PTS-STARTPTS[a]`;
  }

  args.push(
    "-filter_complex", filter,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "44100", "-ac", "2",
    "-movflags", "+faststart",
    output,
  );

  await runFfmpeg(args, totalDur, runner, signal);
  runner.setProgress(100, "Done");

  return { ok: true, outputs: [output], errors: [] };
}

function probe(file) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, meta) => {
      if (err) return reject(err);
      const duration = meta.format?.duration ?? 0;
      const hasAudio = (meta.streams || []).some((s) => s.codec_type === "audio");
      resolve({ duration, hasAudio });
    });
  });
}

const TIME_RE = /time=(\d+):(\d+):(\d+\.\d+)/;
function runFfmpeg(args, totalDur, runner, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError());
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    const stderr = [];
    let aborted = false;
    const onAbort = () => { aborted = true; try { child.kill("SIGTERM"); } catch {} };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    child.stderr.on("data", (b) => {
      const s = b.toString();
      stderr.push(s);
      runner.onLog?.("debug", s);
      const m = TIME_RE.exec(s);
      if (m && totalDur > 0) {
        const sec = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
        const pct = Math.min(99, (sec / totalDur) * 100);
        runner.setProgress(pct);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      if (aborted) return reject(new AbortError());
      if (code !== 0) return reject(new Error(`FFmpeg exit ${code}\n${stderr.join("").slice(-1000)}`));
      resolve();
    });
  });
}
