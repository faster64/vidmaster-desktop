import { ipcMain } from "electron";
import { QueueManager } from "../queue.js";
import { runRender } from "../../src/render.js";
import { runTrimEnds } from "../../src/trimEnds.js";
import { runCutBg } from "../../src/cutBg.js";
import { runGetUrls } from "../../src/getUrls.js";
import { runDownload } from "../../src/download.js";
import { runConcatHeadTail } from "../../src/concatHeadTail.js";
import { runYtdlpUpdate } from "./ytdlp.js";

export function registerQueueIpc(getMainWindow) {
  const runners = {
    render: runRender, trimEnds: runTrimEnds, cutBg: runCutBg,
    getUrls: runGetUrls, download: runDownload, concatHeadTail: runConcatHeadTail,
    _ytdlpUpdate: runYtdlpUpdate,
  };

  const queue = new QueueManager({
    runners,
    onUpdate: (state) => {
      const win = getMainWindow();
      win?.webContents.send("queue:update", state);
    },
  });

  ipcMain.handle("queue:add", (_, spec) => queue.add(spec));
  ipcMain.handle("queue:cancel", (_, jobId) => queue.cancel(jobId));
  ipcMain.handle("queue:clear", () => queue.clear());
  ipcMain.handle("queue:getState", () => queue.getState());

  return queue;
}
