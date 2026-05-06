import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { throwIfAborted, AbortError } from "./abortError.js";

const RELEASE_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";

export async function getStatus(targetPath) {
  let exists = false;
  let lastModified = null;
  try {
    const st = fs.statSync(targetPath);
    exists = st.isFile();
    lastModified = st.mtime;
  } catch {}

  let version = null;
  if (exists) {
    version = await probeVersion(targetPath).catch(() => null);
  }
  return { exists, path: targetPath, version, lastModified };
}

function probeVersion(binPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, ["--version"], { windowsHide: true });
    let out = "";
    child.stdout.on("data", (b) => { out += b.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(out.trim()) : reject(new Error(`exit ${code}`)));
  });
}

async function downloadTo(targetPath, { signal, onProgress, onLog } = {}) {
  throwIfAborted(signal);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmp = targetPath + ".tmp";
  try { fs.unlinkSync(tmp); } catch {}

  let res;
  try {
    res = await fetch(RELEASE_URL, { signal });
  } catch (err) {
    if (err.name === "AbortError" || signal?.aborted) throw new AbortError();
    throw err;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading yt-dlp`);

  const totalRaw = res.headers.get?.("content-length") ?? res.headers.get("content-length");
  const total = totalRaw ? parseInt(totalRaw, 10) : 0;
  let received = 0;

  const file = fs.createWriteStream(tmp);
  // Suppress errors on file stream after abort/destroy to avoid unhandled exceptions
  file.on("error", () => {});
  const cleanupTmp = () => { try { fs.unlinkSync(tmp); } catch {} };

  try {
    const reader = res.body.getReader();
    while (true) {
      throwIfAborted(signal);

      // Race reader.read() against abort so we don't hang if stream stalls after abort
      let done, value;
      if (signal) {
        const result = await Promise.race([
          reader.read(),
          new Promise((_, reject) =>
            signal.addEventListener("abort", () => reject(new AbortError()), { once: true })
          ),
        ]);
        done = result.done;
        value = result.value;
      } else {
        ({ done, value } = await reader.read());
      }

      if (done) break;
      received += value.byteLength;
      await new Promise((resolve, reject) => {
        file.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()));
      });
      if (onProgress && total > 0) onProgress(Math.min(99, (received / total) * 100));
    }
    await new Promise((r) => file.end(r));
  } catch (err) {
    try { file.destroy(); } catch {}
    cleanupTmp();
    if (err instanceof AbortError || err.name === "AbortError" || signal?.aborted) throw new AbortError();
    throw err;
  }

  if (signal?.aborted) {
    cleanupTmp();
    throw new AbortError();
  }

  fs.renameSync(tmp, targetPath);
  onProgress?.(100);
  onLog?.("info", `yt-dlp.exe saved to ${targetPath}`);
  return targetPath;
}

export async function ensureBinary({ targetPath, signal, onProgress, onLog } = {}) {
  if (fs.existsSync(targetPath)) {
    onProgress?.(100);
    return targetPath;
  }
  return downloadTo(targetPath, { signal, onProgress, onLog });
}

export async function updateBinary({ targetPath, signal, onProgress, onLog } = {}) {
  return downloadTo(targetPath, { signal, onProgress, onLog });
}
