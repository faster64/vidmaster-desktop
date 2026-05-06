import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { spawn } from "child_process";
import { AbortError } from "./abortError.js";

const TIME_RE = /time=(\d+):(\d+):(\d+\.\d+)/;

/**
 * Spawn ffmpeg with the given arg array, parse stderr for progress,
 * and resolve with { exitCode, stderr } on success.
 */
export function spawnFfmpeg(args, opts = {}) {
  const { totalDurationSec, onProgress, onLogLine, signal } = opts;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError());

    const child = spawn(ffmpegPath, args, { windowsHide: true });
    const stderrChunks = [];
    let aborted = false;

    const onAbort = () => {
      aborted = true;
      try { child.kill("SIGTERM"); } catch {}
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    child.stderr.on("data", (buf) => {
      const s = buf.toString();
      stderrChunks.push(s);
      onLogLine?.(s);
      if (totalDurationSec && onProgress) {
        const m = TIME_RE.exec(s);
        if (m) {
          const sec = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
          const pct = Math.min(100, (sec / totalDurationSec) * 100);
          onProgress(pct, sec);
        }
      }
    });

    child.on("error", (err) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(err);
    });

    child.on("close", (exitCode) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      if (aborted) return reject(new AbortError());
      if (exitCode !== 0) {
        return reject(new Error(`ffmpeg exited with code ${exitCode}\n${stderrChunks.join("")}`));
      }
      resolve({ exitCode, stderr: stderrChunks.join("") });
    });
  });
}
