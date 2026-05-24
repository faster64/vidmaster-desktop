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

  ipcMain.handle("fs:writeTrendUrls", async (_, { workspace, stamp, content }) => {
    if (!workspace) return null;
    const dir = path.join(workspace, "trends", stamp);
    fs.mkdirSync(dir, { recursive: true });
    const urlsFile = path.join(dir, "urls.txt");
    fs.writeFileSync(urlsFile, content, "utf8");
    return { urlsFile, output: dir };
  });

  ipcMain.handle("fs:listImages", (_, folder) => {
    if (!folder || !fs.existsSync(folder)) return [];
    return fs.readdirSync(folder)
      .filter((n) => /\.(jpe?g|png)$/i.test(n))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  });

  ipcMain.handle("fs:readImageDataUrl", (_, fullPath) => {
    if (!fullPath || !fs.existsSync(fullPath)) return null;
    const ext = path.extname(fullPath).toLowerCase();
    let mime;
    if (ext === ".jpg" || ext === ".jpeg") mime = "image/jpeg";
    else if (ext === ".png") mime = "image/png";
    else return null;
    const b64 = fs.readFileSync(fullPath).toString("base64");
    return `data:${mime};base64,${b64}`;
  });
}
