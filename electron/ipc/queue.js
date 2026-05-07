import { ipcMain } from "electron";
import { QueueManager } from "../queue.js";
import { runRender } from "../../src/render.js";
import { runSnow } from "../../src/snow.js";
import { runTrim } from "../../src/trim.js";
import { runTrimEnds } from "../../src/trimEnds.js";
import { runCutBg } from "../../src/cutBg.js";
import { runGetUrls } from "../../src/getUrls.js";
import { runDownload } from "../../src/download.js";
import { runConcat } from "../../src/concat.js";
import { runYtdlpUpdate } from "./ytdlp.js";

export function registerQueueIpc(getMainWindow) {
  const runners = {
    render: runRender, snow: runSnow, trim: runTrim, trimEnds: runTrimEnds, cutBg: runCutBg,
    getUrls: runGetUrls, download: runDownload, concat: runConcat,
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
