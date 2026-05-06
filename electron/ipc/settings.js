import { ipcMain } from "electron";
import { createSettings } from "../settings.js";

export function registerSettingsIpc(getMainWindow) {
  const settings = createSettings();

  settings.onChange((snapshot) => {
    getMainWindow()?.webContents.send("settings:change", snapshot);
  });

  ipcMain.handle("settings:get", (_, key) => settings.get(key));
  ipcMain.handle("settings:set", (_, patch) => settings.set(patch));

  return settings;
}
