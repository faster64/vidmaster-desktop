import { ipcMain, dialog, BrowserWindow } from "electron";

export function registerDialogIpc() {
  ipcMain.handle("dialog:pickFolder", async (_, defaultPath) => {
    const win = BrowserWindow.getFocusedWindow();
    const r = await dialog.showOpenDialog(win, {
      properties: ["openDirectory", "createDirectory"],
      defaultPath,
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle("dialog:pickFile", async (_, opts = {}) => {
    const win = BrowserWindow.getFocusedWindow();
    const r = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: opts.filters,
      defaultPath: opts.defaultPath,
    });
    return r.canceled ? null : r.filePaths[0];
  });
}
