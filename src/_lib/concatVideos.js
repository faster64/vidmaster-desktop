import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import { AbortError } from "./abortError.js";

ffmpeg.setFfmpegPath(ffmpegPath);

const AUDIO_FREQ = 44100;

export function probe(file) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, meta) => {
      if (err) return reject(err);
      const duration = meta.format?.duration ?? 0;
      const hasAudio = (meta.streams || []).some((s) => s.codec_type === "audio");
      resolve({ duration, hasAudio });
    });
  });
}

export function buildConcatFilter(probes) {
  const silentChains = [];
  const concatPairs = probes.map((p, i) => {
    if (p.hasAudio) return `[${i}:v:0][${i}:a:0]`;
    silentChains.push(`anullsrc=channel_layout=stereo:sample_rate=${AUDIO_FREQ},atrim=duration=${p.duration},asetpts=PTS-STARTPTS[silent_${i}]`);
    return `[${i}:v:0][silent_${i}]`;
  }).join("");
  const concat = `${concatPairs}concat=n=${probes.length}:v=1:a=1[v][a]`;
  return silentChains.length ? `${silentChains.join(";")};${concat}` : concat;
}

export async function concatVideos({ inputs, output, signal, runner, stageOffset = 0, stageWeight = 1, message = "" }) {
  if (!inputs || inputs.length < 2) throw new Error("Cần ít nhất 2 input để concat");
  for (const p of inputs) {
    if (!fs.existsSync(p)) throw new Error(`File không tồn tại: ${p}`);
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const probes = await Promise.all(inputs.map(probe));
  const totalDur = probes.reduce((sum, p) => sum + p.duration, 0);
  const filter = buildConcatFilter(probes);
  const args = ["-y"];
  for (const p of inputs) args.push("-i", p);
  args.push(
    "-filter_complex", filter,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", String(AUDIO_FREQ), "-ac", "2",
    "-movflags", "+faststart",
    output,
  );
  await runFfmpeg(args, totalDur, runner, signal, stageOffset, stageWeight, message);
}

const TIME_RE = /time=(\d+):(\d+):(\d+\.\d+)/;
function runFfmpeg(args, totalDur, runner, signal, stageOffset, stageWeight, message) {
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
      runner?.onLog?.("debug", s);
      const m = TIME_RE.exec(s);
      if (m && totalDur > 0) {
        const sec = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
        const pct = Math.min(99, (sec / totalDur) * 100);
        runner?.setProgress?.(stageOffset + pct * stageWeight, message);
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
