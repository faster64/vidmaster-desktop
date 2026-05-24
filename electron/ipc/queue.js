import { ipcMain } from "electron";
import log from "electron-log";
import { QueueManager } from "../queue.js";
import { runRender } from "../../src/render.js";
import { runTrimEnds } from "../../src/trimEnds.js";
import { runCutBg } from "../../src/cutBg.js";
import { runGetUrls } from "../../src/getUrls.js";
import { runDownload } from "../../src/download.js";
import { runConcatHeadTail } from "../../src/concatHeadTail.js";
import { runThumbAvatar } from "../../src/thumbAvatar.js";
import { runRecolorThumb } from "../../src/recolorThumb.js";
import { runElderlyVideo } from "../../src/elderlyVideo.js";
import { runTrendSearch } from "../../src/trendSearch.js";
import { runYtdlpUpdate } from "./ytdlp.js";
import { sendTelegram, workspaceName, escapeHtml, fmtTime, fmtDurationMin } from "../telegram.js";

export function registerQueueIpc(getMainWindow, getSettings) {
  const runners = {
    render: runRender, trimEnds: runTrimEnds, cutBg: runCutBg,
    getUrls: runGetUrls, download: runDownload, concatHeadTail: runConcatHeadTail,
    thumbAvatar: runThumbAvatar,
    recolorThumb: runRecolorThumb,
    elderlyVideo: runElderlyVideo,
    trendSearch: runTrendSearch,
    _ytdlpUpdate: runYtdlpUpdate,
  };

  const notified = new Set();

  const queue = new QueueManager({
    runners,
    onUpdate: (state) => {
      const win = getMainWindow();
      win?.webContents.send("queue:update", state);

      for (const job of state.completed) {
        if (notified.has(job.id)) continue;
        notified.add(job.id);
        if (job.type === "render" && job.status === "done") {
          notifyRenderDone(job, getSettings?.()).catch((err) => log.warn(`Telegram render notify failed: ${err.message}`));
        }
      }
    },
  });

  ipcMain.handle("queue:add", (_, spec) => queue.add(spec));
  ipcMain.handle("queue:cancel", (_, jobId) => queue.cancel(jobId));
  ipcMain.handle("queue:clear", () => queue.clear());
  ipcMain.handle("queue:getState", () => queue.getState());

  return queue;
}

async function notifyRenderDone(job, settings) {
  const ws = settings?.get?.("workspace") ?? "";
  const tg = settings?.get?.("telegram") ?? {};
  const identifier = (settings?.get?.("tracking.identifier") || "").trim();
  const name = identifier || workspaceName(ws);
  const total = (job.result?.outputs?.length ?? 0) + (job.result?.errors?.length ?? 0);
  const okCount = job.result?.outputs?.length ?? 0;
  const errCount = job.result?.errors?.length ?? 0;
  const startedAt = job.startedAt ?? job.createdAt;
  const finishedAt = job.finishedAt ?? Date.now();
  const elapsedMs = finishedAt - startedAt;
  const avgPerVideo = okCount > 0 ? fmtDurationMin(elapsedMs / okCount) : "—";
  const errLine = errCount > 0 ? `\n${errCount} lỗi` : "";
  const message =
    "<pre>"
    + `📢📢📢 <b>${escapeHtml(name)}</b>\n\n`
    + `Render xong ${okCount}/${total} videos sau ${fmtDurationMin(elapsedMs)} `
    + `(${fmtTime(startedAt)} - ${fmtTime(finishedAt)})${errLine}\n`
    + `Trung bình: ${avgPerVideo}/video`
    + "</pre>";
  await sendTelegram({ token: tg.token, chatId: tg.groupId, message });
}
