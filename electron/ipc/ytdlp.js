import { ipcMain } from "electron";
import { getStatus, updateBinary } from "../../src/_lib/ytdlp.js";

export function registerYtdlpIpc(getSettings, getQueue) {
  ipcMain.handle("ytdlp:getStatus", async () => {
    const settings = getSettings();
    const targetPath = settings.get("download.ytdlpPath");
    return getStatus(targetPath);
  });

  ipcMain.handle("ytdlp:update", async () => {
    const settings = getSettings();
    const targetPath = settings.get("download.ytdlpPath");
    const queue = getQueue();
    return queue.add({ type: "_ytdlpUpdate", config: { targetPath } });
  });
}

export async function runYtdlpUpdate(config) {
  const { targetPath, signal, onProgress, onLog } = config;
  await updateBinary({ targetPath, signal, onProgress, onLog });
  return { ok: true, outputs: [targetPath], errors: [] };
}
