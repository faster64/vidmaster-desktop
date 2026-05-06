import { ipcMain } from "electron";
import { QueueManager } from "../queue.js";
import { runRender } from "../../src/render.js";
import { runSnow } from "../../src/snow.js";
import { runTrim } from "../../src/trim.js";
import { runCutBg } from "../../src/cutBg.js";

export function registerQueueIpc(getMainWindow) {
  const runners = {
    render: runRender, snow: runSnow, trim: runTrim, cutBg: runCutBg,
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
