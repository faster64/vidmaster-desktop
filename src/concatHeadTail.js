import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import { TaskRunner } from "./_lib/runner.js";
import { AbortError } from "./_lib/abortError.js";

ffmpeg.setFfmpegPath(ffmpegPath);

const AUDIO_FREQ = 44100;

export async function runConcatHeadTail(config) {
  const runner = new TaskRunner(config);
  const { folderA, folderB = "", folderC = "", output, signal } = config;
  runner.checkAborted();

  if (!folderA) throw new Error("Cần chọn folder A (video gốc)");
  if (!fs.existsSync(folderA)) throw new Error(`Folder A không tồn tại: ${folderA}`);
  if (!folderB && !folderC) throw new Error("Cần chọn ít nhất 1 trong 2 folder: nối đầu (B) hoặc nối cuối (C)");
  if (folderB && !fs.existsSync(folderB)) throw new Error(`Folder B không tồn tại: ${folderB}`);
  if (folderC && !fs.existsSync(folderC)) throw new Error(`Folder C không tồn tại: ${folderC}`);
  if (!output) throw new Error("Cần chọn folder output");

  const filesA = listMp4(folderA);
  if (filesA.length === 0) throw new Error(`Folder A trống: ${folderA}`);
  const filesB = folderB ? listMp4(folderB) : [];
  const filesC = folderC ? listMp4(folderC) : [];
  if (folderB && filesB.length === 0) throw new Error(`Folder B trống: ${folderB}`);
  if (folderC && filesC.length === 0) throw new Error(`Folder C trống: ${folderC}`);

  fs.mkdirSync(output, { recursive: true });

  const total = filesA.length;
  const outputs = [];
  const errors = [];

  for (let i = 0; i < total; i++) {
    runner.checkAborted();
    const a = filesA[i];
    const b = filesB.length ? filesB[i % filesB.length] : null;
    const c = filesC.length ? filesC[i % filesC.length] : null;
    const stageOffset = (i / total) * 100;
    const stageWeight = 1 / total;
    const aName = path.basename(a);
    const message = `${i + 1}/${total} ${aName}`;
    runner.setProgress(stageOffset, message);

    try {
      const inputs = [b, a, c].filter(Boolean);
      const probes = await Promise.all(inputs.map(probe));
      const totalDur = probes.reduce((sum, p) => sum + p.duration, 0);
      const outPath = path.join(output, aName);

      runner.log("info", `${message} ← ${inputs.map((p) => path.basename(p)).join(" + ")}`);

      const filter = buildConcatFilter(probes);
      const args = ["-y"];
      for (const p of inputs) args.push("-i", p);
      args.push(
        "-filter_complex", filter,
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ar", String(AUDIO_FREQ), "-ac", "2",
        "-movflags", "+faststart",
        outPath,
      );

      await runFfmpeg(args, totalDur, runner, signal, stageOffset, stageWeight, message);
      outputs.push(outPath);
      runner.log("info", `Saved: ${aName}`);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      errors.push({ file: aName, message: err.message, stack: err.stack });
      runner.log("error", `${aName} failed: ${err.message}`);
    }
    runner.setProgress(((i + 1) / total) * 100, message);
  }

  runner.setProgress(100, "Done");
  return { ok: errors.length === 0, outputs, errors };
}

function listMp4(folder) {
  return fs.readdirSync(folder)
    .filter((f) => /\.mp4$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    .map((f) => path.join(folder, f));
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

function buildConcatFilter(probes) {
  // Per-input audio source: real audio if present, otherwise generated silent
  const silentChains = [];
  const concatPairs = probes.map((p, i) => {
    if (p.hasAudio) return `[${i}:v:0][${i}:a:0]`;
    silentChains.push(`anullsrc=channel_layout=stereo:sample_rate=${AUDIO_FREQ},atrim=duration=${p.duration},asetpts=PTS-STARTPTS[silent_${i}]`);
    return `[${i}:v:0][silent_${i}]`;
  }).join("");
  const concat = `${concatPairs}concat=n=${probes.length}:v=1:a=1[v][a]`;
  return silentChains.length ? `${silentChains.join(";")};${concat}` : concat;
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
      runner.onLog?.("debug", s);
      const m = TIME_RE.exec(s);
      if (m && totalDur > 0) {
        const sec = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
        const pct = Math.min(99, (sec / totalDur) * 100);
        runner.setProgress(stageOffset + pct * stageWeight, message);
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
