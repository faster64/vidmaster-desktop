import { ipcMain } from "electron";
import { statSync } from "fs";

export function registerFsIpc() {
  ipcMain.handle("fs:exists", (_, p) => {
    if (!p) return { exists: false };
    try {
      const s = statSync(p);
      return { exists: true, isFolder: s.isDirectory(), isFile: s.isFile() };
    } catch {
      return { exists: false };
    }
  });
}
