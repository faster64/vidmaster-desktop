import { app, ipcMain } from "electron";
import log from "electron-log";
import { ensureWorkspace } from "../workspace.js";
import { sendTelegram, workspaceName } from "../telegram.js";

export function registerAppIpc(getSettings) {
  ipcMain.handle("app:getVersion", () => app.getVersion());
  ipcMain.handle("app:getWorkspace", () => getSettings().get("workspace"));
  ipcMain.handle("app:ensureWorkspace", (_, root) => { ensureWorkspace(root); return true; });
  ipcMain.handle("app:trackingPing", async () => {
    const settings = getSettings();
    const tg = settings.get("telegram") || {};
    const ws = settings.get("workspace");
    const identity = (settings.get("tracking.identifier") || "").trim() || workspaceName(ws);
    const r = await sendTelegram({ token: tg.token, chatId: tg.trackingChatId, message: `<pre>${identity}</pre>` });
    if (!r.ok) log.warn(`Telegram tracking ping failed: ${r.error || r.status}`);
    return r;
  });
}
