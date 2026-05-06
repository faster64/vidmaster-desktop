import { app } from "electron";
import Store from "electron-store";

const SCHEMA_VERSION = 1;

const DEFAULTS = {
  version: SCHEMA_VERSION,
  workspace: "",
  ffmpeg: { encoder: "auto", maxConcurrent: 2 },
  render: {
    useGPU: false,
    chromaKey: { color: "#D4F9D7", similarity: 0.2 },
    opacity: 0.7,
    crop: { height: 220, yOffset: 490 },
    keepColor: { enabled: false, list: ["#FBFF02"] },
  },
  ui: { theme: "light", logLevel: "info", completedHistorySize: 50 },
  lastUsedTask: "render",
  lastConfig: {},
};

export function createSettings() {
  const store = new Store({ defaults: DEFAULTS, name: "config", cwd: app.getPath("userData") });
  const listeners = new Set();

  function get(key) {
    if (!key) return store.store;
    return store.get(key);
  }

  function set(patch) {
    for (const [k, v] of Object.entries(patch)) {
      store.set(k, v);
    }
    const snapshot = store.store;
    listeners.forEach((cb) => cb(snapshot));
  }

  function onChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  return { get, set, onChange };
}
