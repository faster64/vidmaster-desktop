import { ipcMain } from "electron";

export function registerLogIpc(getQueue) {
  ipcMain.handle("log:getRecent", (_, jobId) => {
    const q = getQueue();
    if (!q) return [];
    const state = q.getState();
    const all = [state.running, ...state.completed, ...state.pending].filter(Boolean);
    const job = all.find((j) => j?.id === jobId);
    return job?.logs ?? [];
  });
}
