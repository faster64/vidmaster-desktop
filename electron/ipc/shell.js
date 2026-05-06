import { ipcMain, shell } from "electron";

export function registerShellIpc(logFilePathFn) {
  ipcMain.handle("shell:openFolder", (_, p) => shell.openPath(p));
  ipcMain.handle("shell:openLogFile", () => shell.openPath(logFilePathFn()));
}
