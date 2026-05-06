import { app, ipcMain } from "electron";
import { ensureWorkspace } from "../workspace.js";

export function registerAppIpc(getSettings) {
  ipcMain.handle("app:getVersion", () => app.getVersion());
  ipcMain.handle("app:getWorkspace", () => getSettings().get("workspace"));
  ipcMain.handle("app:ensureWorkspace", (_, root) => { ensureWorkspace(root); return true; });
}
