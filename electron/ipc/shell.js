import { ipcMain, shell } from "electron";

export function registerShellIpc(logFilePathFn) {
  ipcMain.handle("shell:openFolder", (_, p) => shell.openPath(p));
  ipcMain.handle("shell:openLogFile", () => shell.openPath(logFilePathFn()));
  ipcMain.handle("shell:openExternal", (_, url) => {
    if (typeof url !== "string") return false;
    if (!/^https?:\/\//i.test(url)) return false;
    return shell.openExternal(url);
  });
}
