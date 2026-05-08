import { ipcMain } from "electron";
import { createSettings } from "../settings.js";

export function registerSettingsIpc(getMainWindow) {
  const settings = createSettings();

  settings.onChange((snapshot) => {
    getMainWindow()?.webContents.send("settings:change", snapshot);
  });

  ipcMain.handle("settings:get", (_, key) => settings.get(key));
  ipcMain.handle("settings:set", (_, patch) => settings.set(patch));
  ipcMain.handle("settings:resetAll", () => { settings.resetAll(); return true; });

  ipcMain.handle("workspace:list", () => settings.listWorkspaces());
  ipcMain.handle("workspace:getActive", () => settings.getActiveWorkspace());
  ipcMain.handle("workspace:create", (_, { path, identifier }) => settings.createWorkspace({ path, identifier }));
  ipcMain.handle("workspace:setActive", (_, id) => settings.setActiveWorkspace(id));
  ipcMain.handle("workspace:update", (_, { id, patch }) => settings.updateWorkspace(id, patch));
  ipcMain.handle("workspace:remove", (_, id) => settings.removeWorkspace(id));

  return settings;
}
