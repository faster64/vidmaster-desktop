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
import { registerFsIpc } from "./ipc/fs.js";
import { registerYtdlpIpc } from "./ipc/ytdlp.js";
import { registerUpdaterIpc } from "./ipc/updater.js";
import { detectEncoder } from "./gpuDetect.js";
import { existsSync } from "fs";
import { updateBinary } from "../src/_lib/ytdlp.js";
import { ensureWorkspace } from "./workspace.js";
import { sendTelegram, workspaceName } from "./telegram.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow;
const getMainWindow = () => mainWindow;

log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.file.fileName = "main.log";
// Pipe console.* through electron-log so logs land in main.log and the
// DevTools "Console" tab when --remote-debugging is on.
Object.assign(console, log.functions);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 900, minHeight: 600,
    title: "VidMaster",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const isF12 = input.key === "F12";
    const isCtrlShiftI = input.control && input.shift && input.key.toLowerCase() === "i";
    if (isF12 || isCtrlShiftI) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}

app.whenReady().then(async () => {
  const settings = registerSettingsIpc(getMainWindow);
  if (settings.get("ffmpeg.encoder") === "auto") {
    const picked = await detectEncoder();
    settings.set({ "ffmpeg.encoder": picked });
    log.info(`Detected ffmpeg encoder: ${picked}`);
  }
  const queue = registerQueueIpc(getMainWindow, () => settings);
  registerLogIpc(() => queue);
  registerDialogIpc();
  registerShellIpc(() => log.transports.file.getFile().path);
  registerAppIpc(() => settings);
  registerFsIpc();
  registerYtdlpIpc(() => settings, () => queue);

  registerUpdaterIpc(getMainWindow, {
    onProceed: () => bootstrapAfterUpdateCheck(settings),
  });

  createWindow();
});

function bootstrapAfterUpdateCheck(settings) {
  const ws = settings.get("workspace");
  if (ws && existsSync(ws)) {
    try {
      ensureWorkspace(ws);
    } catch (err) {
      log.warn(`ensureWorkspace failed on startup: ${err.message}`);
    }
  }

  const tg = settings.get("telegram") || {};
  const identity = (settings.get("tracking.identifier") || "").trim() || workspaceName(ws);
  sendTelegram({ token: tg.token, chatId: tg.trackingChatId, message: `<pre>${identity}</pre>` })
    .then((r) => { if (!r.ok) log.warn(`Telegram start ping failed: ${r.error || r.status}`); })
    .catch((err) => log.warn(`Telegram start ping error: ${err.message}`));

  if (settings.get("download.autoUpdateYtDlp")) {
    const ytdlpPath = settings.get("download.ytdlpPath");
    if (existsSync(ytdlpPath)) {
      updateBinary({ targetPath: ytdlpPath })
        .then(() => log.info("yt-dlp.exe updated on startup"))
        .catch((err) => log.warn("yt-dlp auto-update failed:", err.message));
    }
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
