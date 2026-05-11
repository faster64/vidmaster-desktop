import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import pLimit from "p-limit";
import { TaskRunner } from "./_lib/runner.js";
import { AbortError, throwIfAborted } from "./_lib/abortError.js";
import { ensureBinary } from "./_lib/ytdlp.js";
import { sanitizeFilename } from "./_lib/sanitize.js";

const PCT_RE = /\[download\]\s+([\d.]+)%/;

export async function runDownload(config) {
  const runner = new TaskRunner(config);
  const {
    urlsFile, output, ytdlpPath,
    maxConcurrent = 3,
  } = config;
  const { signal } = config;

  if (!urlsFile) throw new Error("Thiếu file URLs.");
  if (!output) throw new Error("Thiếu folder output.");
  if (!ytdlpPath) throw new Error("Thiếu đường dẫn yt-dlp.");

  runner.checkAborted();
  fs.mkdirSync(output, { recursive: true });

  if (!fs.existsSync(ytdlpPath)) {
    runner.log("info", "Đang tải yt-dlp.exe...");
    await ensureBinary({
      targetPath: ytdlpPath, signal,
      onProgress: (p) => runner.setProgress(p * 0.05, "Tải yt-dlp..."),
    });
  }
  runner.setProgress(5, "");

  const urls = fs.readFileSync(urlsFile, "utf8")
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (urls.length === 0) {
    return { ok: true, outputs: [], errors: [] };
  }

  const archiveFile = path.join(output, "downloaded.txt");
  const inflight = new Map();
  const liveChildren = new Set();
  let completed = 0;
  const total = urls.length;
  const errors = [];

  const refreshProgress = () => {
    const lines = [...inflight.entries()]
      .map(([u, p]) => `  • ${shortUrl(u)} ${p}%`)
      .join("\n");
    const overall = 5 + (completed / total) * 95;
    runner.setProgress(overall, lines ? `Đang tải:\n${lines}` : "");
  };

  const onAbort = () => {
    for (const c of liveChildren) {
      try { c.kill("SIGTERM"); } catch {}
    }
  };
  if (signal) signal.addEventListener("abort", onAbort);

  const limit = pLimit(Math.min(5, Math.max(1, maxConcurrent)));

  try {
    const results = await Promise.allSettled(urls.map((url) => limit(() => downloadOne({
      url, output, ytdlpPath, archiveFile, signal,
      onPercent: (p) => { inflight.set(url, p); refreshProgress(); },
      onLog: (level, line) => runner.onLog?.(level, line),
      registerChild: (c) => liveChildren.add(c),
      unregisterChild: (c) => liveChildren.delete(c),
    }))));

    for (let i = 0; i < results.length; i++) {
      const url = urls[i];
      inflight.delete(url);
      const r = results[i];
      if (r.status === "rejected") {
        if (r.reason?.name === "AbortError") throw r.reason;
        errors.push({ url, message: r.reason?.message ?? String(r.reason), stderrTail: r.reason?.stderrTail });
      }
      completed++;
      refreshProgress();
    }
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
  }

  throwIfAborted(signal);

  const outputs = renameSanitized(output);
  runner.setProgress(100, `Đã tải ${outputs.length}/${total}`);

  return { ok: errors.length === 0, outputs, errors };
}

function downloadOne({ url, output, ytdlpPath, archiveFile, signal, onPercent, onLog, registerChild, unregisterChild }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError());

    const args = [
      "-f", "bestvideo+bestaudio/best",
      "--merge-output-format", "mp4",
      "-o", path.join(output, "%(title)s.%(ext)s"),
      "--write-thumbnail",
      "--convert-thumbnails", "jpg",
      "--no-overwrites",
      "--download-archive", archiveFile,
      url,
    ];

    const child = spawn(ytdlpPath, args, { windowsHide: true });
    registerChild(child);

    const stderrChunks = [];

    const handleLine = (line) => {
      const m = PCT_RE.exec(line);
      if (m) onPercent(parseFloat(m[1]).toFixed(0));
      onLog?.("debug", line);
    };

    let stdoutBuf = "";
    child.stdout.on("data", (b) => {
      stdoutBuf += b.toString();
      let idx;
      while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
        const line = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        handleLine(line);
      }
    });

    let stderrBuf = "";
    child.stderr.on("data", (b) => {
      const s = b.toString();
      stderrBuf += s;
      stderrChunks.push(s);
      let idx;
      while ((idx = stderrBuf.indexOf("\n")) >= 0) {
        const line = stderrBuf.slice(0, idx);
        stderrBuf = stderrBuf.slice(idx + 1);
        handleLine(line);
      }
    });

    child.on("error", (err) => {
      unregisterChild(child);
      reject(err);
    });

    child.on("close", (code) => {
      unregisterChild(child);
      if (signal?.aborted) return reject(new AbortError());
      if (code !== 0) {
        const tail = stderrChunks.join("").split("\n").slice(-20).join("\n");
        const err = new Error(`yt-dlp exit ${code}: ${url}`);
        err.stderrTail = tail;
        return reject(err);
      }
      resolve();
    });
  });
}

function shortUrl(u) {
  const m = /v=([^&]+)/.exec(u);
  return m ? m[1] : u.slice(0, 30);
}

function renameSanitized(folder) {
  const out = [];
  for (const ext of [".mp4", ".jpg"]) {
    const files = fs.readdirSync(folder).filter((n) => n.toLowerCase().endsWith(ext));
    for (const file of files) {
      const base = file.slice(0, file.length - ext.length);
      const safe = sanitizeFilename(base);
      if (safe === base) {
        if (ext === ".mp4") out.push(path.join(folder, file));
        continue;
      }
      const newName = safe + ext;
      const newPath = path.join(folder, newName);
      if (!fs.existsSync(newPath)) {
        fs.renameSync(path.join(folder, file), newPath);
      }
      if (ext === ".mp4") out.push(newPath);
    }
  }
  return out;
}
