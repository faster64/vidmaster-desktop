import { ipcMain } from "electron";
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import pLimit from "p-limit";
import { ffmpegPath } from "../../src/_lib/ffmpegBin.js";

ffmpeg.setFfmpegPath(ffmpegPath);

function probeDuration(file) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(file, (err, meta) => resolve(err ? 0 : (meta.format?.duration ?? 0)));
  });
}

export function registerFsIpc() {
  ipcMain.handle("fs:exists", (_, p) => {
    if (!p) return { exists: false };
    try {
      const s = fs.statSync(p);
      return { exists: true, isFolder: s.isDirectory(), isFile: s.isFile() };
    } catch { return { exists: false }; }
  });

  ipcMain.handle("fs:listMp4", async (_, folder) => {
    if (!folder || !fs.existsSync(folder)) return [];
    const names = fs.readdirSync(folder).filter((n) => /\.mp4$/i.test(n)).sort();
    const limit = pLimit(4);
    return Promise.all(names.map((name) => limit(async () => {
      const fullPath = path.join(folder, name);
      const st = fs.statSync(fullPath);
      const durationSec = await probeDuration(fullPath);
      return { name, fullPath, sizeBytes: st.size, durationSec };
    })));
  });

  ipcMain.handle("fs:readUrlsFile", (_, p) => {
    if (!p || !fs.existsSync(p)) return [];
    return fs.readFileSync(p, "utf8")
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  });

  ipcMain.handle("fs:readVideoInfos", (_, p) => {
    if (!p || !fs.existsSync(p)) return [];
    return fs.readFileSync(p, "utf8")
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      .map((line) => {
        const [publishedAt, url, viewCount, title, duration] = line.split("\t");
        return { publishedAt, url, viewCount, title, duration };
      });
  });
}
