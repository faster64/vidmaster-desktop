import { contextBridge, ipcRenderer } from "electron";

const subscribers = {
  "queue:update": new Set(),
  "settings:change": new Set(),
  "updater:event": new Set(),
};
ipcRenderer.on("queue:update", (_, s) => subscribers["queue:update"].forEach((cb) => cb(s)));
ipcRenderer.on("settings:change", (_, s) => subscribers["settings:change"].forEach((cb) => cb(s)));
ipcRenderer.on("updater:event", (_, e) => subscribers["updater:event"].forEach((cb) => cb(e)));

contextBridge.exposeInMainWorld("api", {
  queue: {
    add: (spec) => ipcRenderer.invoke("queue:add", spec),
    cancel: (id) => ipcRenderer.invoke("queue:cancel", id),
    clear: () => ipcRenderer.invoke("queue:clear"),
    getState: () => ipcRenderer.invoke("queue:getState"),
    onUpdate: (cb) => { subscribers["queue:update"].add(cb); return () => subscribers["queue:update"].delete(cb); },
  },
  settings: {
    get: (key) => ipcRenderer.invoke("settings:get", key),
    set: (patch) => ipcRenderer.invoke("settings:set", patch),
    resetAll: () => ipcRenderer.invoke("settings:resetAll"),
    softReset: () => ipcRenderer.invoke("settings:softReset"),
    onChange: (cb) => { subscribers["settings:change"].add(cb); return () => subscribers["settings:change"].delete(cb); },
  },
  workspace: {
    list: () => ipcRenderer.invoke("workspace:list"),
    getActive: () => ipcRenderer.invoke("workspace:getActive"),
    create: ({ path, identifier }) => ipcRenderer.invoke("workspace:create", { path, identifier }),
    setActive: (id) => ipcRenderer.invoke("workspace:setActive", id),
    update: (id, patch) => ipcRenderer.invoke("workspace:update", { id, patch }),
    remove: (id) => ipcRenderer.invoke("workspace:remove", id),
  },
  dialog: {
    pickFolder: (defaultPath) => ipcRenderer.invoke("dialog:pickFolder", defaultPath),
    pickFile: (opts) => ipcRenderer.invoke("dialog:pickFile", opts),
  },
  shell: {
    openFolder: (p) => ipcRenderer.invoke("shell:openFolder", p),
    openLogFile: () => ipcRenderer.invoke("shell:openLogFile"),
    openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  },
  app: {
    getVersion: () => ipcRenderer.invoke("app:getVersion"),
    getWorkspace: () => ipcRenderer.invoke("app:getWorkspace"),
    ensureWorkspace: (root) => ipcRenderer.invoke("app:ensureWorkspace", root),
    trackingPing: () => ipcRenderer.invoke("app:trackingPing"),
  },
  updater: {
    check: () => ipcRenderer.invoke("updater:check"),
    proceed: () => ipcRenderer.invoke("updater:proceed"),
    onEvent: (cb) => { subscribers["updater:event"].add(cb); return () => subscribers["updater:event"].delete(cb); },
  },
  fs: {
    exists: (p) => ipcRenderer.invoke("fs:exists", p),
    listMp4: (folder) => ipcRenderer.invoke("fs:listMp4", folder),
    readUrlsFile: (p) => ipcRenderer.invoke("fs:readUrlsFile", p),
    readVideoInfos: (p) => ipcRenderer.invoke("fs:readVideoInfos", p),
    writeTrendUrls: (args) => ipcRenderer.invoke("fs:writeTrendUrls", args),
  },
  ytdlp: {
    getStatus: () => ipcRenderer.invoke("ytdlp:getStatus"),
    update: () => ipcRenderer.invoke("ytdlp:update"),
  },
  log: {
    getRecent: (jobId) => ipcRenderer.invoke("log:getRecent", jobId),
  },
});
