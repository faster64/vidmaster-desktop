import { contextBridge, ipcRenderer } from "electron";

const subscribers = { "queue:update": new Set(), "settings:change": new Set() };
ipcRenderer.on("queue:update", (_, s) => subscribers["queue:update"].forEach((cb) => cb(s)));
ipcRenderer.on("settings:change", (_, s) => subscribers["settings:change"].forEach((cb) => cb(s)));

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
    onChange: (cb) => { subscribers["settings:change"].add(cb); return () => subscribers["settings:change"].delete(cb); },
  },
  dialog: {
    pickFolder: (defaultPath) => ipcRenderer.invoke("dialog:pickFolder", defaultPath),
    pickFile: (opts) => ipcRenderer.invoke("dialog:pickFile", opts),
  },
  shell: {
    openFolder: (p) => ipcRenderer.invoke("shell:openFolder", p),
    openLogFile: () => ipcRenderer.invoke("shell:openLogFile"),
  },
  app: {
    getVersion: () => ipcRenderer.invoke("app:getVersion"),
    getWorkspace: () => ipcRenderer.invoke("app:getWorkspace"),
    ensureWorkspace: (root) => ipcRenderer.invoke("app:ensureWorkspace", root),
  },
  log: {
    getRecent: (jobId) => ipcRenderer.invoke("log:getRecent", jobId),
  },
});
