import { app, BrowserWindow } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import log from "electron-log";
import { registerQueueIpc } from "./ipc/queue.js";
import { registerLogIpc } from "./ipc/log.js";
import { registerSettingsIpc } from "./ipc/settings.js";
import { registerDialogIpc } from "./ipc/dialog.js";
import { registerShellIpc } from "./ipc/shell.js";
import { registerAppIpc } from "./ipc/app.js";
import { detectEncoder } from "./gpuDetect.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow;
const getMainWindow = () => mainWindow;

log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.file.fileName = "main.log";

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 900, minHeight: 600,
    title: "VidMaster",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.webContents.openDevTools({ mode: "right" });
}

app.whenReady().then(async () => {
  const settings = registerSettingsIpc(getMainWindow);
  if (settings.get("ffmpeg.encoder") === "auto") {
    const picked = await detectEncoder();
    settings.set({ "ffmpeg.encoder": picked });
    log.info(`Detected ffmpeg encoder: ${picked}`);
  }
  const queue = registerQueueIpc(getMainWindow);
  registerLogIpc(() => queue);
  registerDialogIpc();
  registerShellIpc(() => log.transports.file.getFile().path);
  registerAppIpc(() => settings);
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
