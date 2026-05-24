import { ipcMain, app } from "electron";
import log from "electron-log";
import { createUpdater } from "../updater.js";

export function registerUpdaterIpc(getMainWindow, { onProceed }) {
  let updater = null;
  let proceedFired = false;

  function send(event) {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send("updater:event", event);
  }

  ipcMain.handle("updater:check", () => {
    if (!updater) {
      updater = createUpdater({ send, log, isPackaged: app.isPackaged });
    }
    updater.check();
    return true;
  });

  ipcMain.handle("updater:proceed", () => {
    if (proceedFired) return false;
    proceedFired = true;
    try { onProceed(); } catch (err) { log.error(`onProceed failed: ${err.message}`); }
    return true;
  });
}
