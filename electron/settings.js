import { app } from "electron";
import path from "path";
import Store from "electron-store";

const SCHEMA_VERSION = 2;
const DEFAULT_API_KEY = "AIzaSyDZTsPGvG0u5du3t7YGueGgnNi7IiulMus";

function defaultYtdlpPath() {
  return path.join(app.getPath("appData"), "VidMaster", "bin", "yt-dlp.exe");
}

function buildDefaults() {
  return {
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
    youtube: {
      apiKey: DEFAULT_API_KEY,
      minDurationMinutes: 8,
      sortOrder: "VIEW",
    },
    download: {
      ytdlpPath: defaultYtdlpPath(),
      autoUpdateYtDlp: false,
      maxConcurrent: 3,
    },
    ui: { theme: "light", logLevel: "info", completedHistorySize: 50 },
    lastUsedTask: "render",
    lastConfig: {},
  };
}

function migrate(store) {
  const v = store.get("version") ?? 1;
  if (v >= SCHEMA_VERSION) return;
  if (v < 2) {
    store.set("youtube", {
      apiKey: store.get("youtube.apiKey") ?? DEFAULT_API_KEY,
      minDurationMinutes: store.get("youtube.minDurationMinutes") ?? 8,
      sortOrder: store.get("youtube.sortOrder") ?? "VIEW",
    });
    store.set("download", {
      ytdlpPath: store.get("download.ytdlpPath") ?? defaultYtdlpPath(),
      autoUpdateYtDlp: store.get("download.autoUpdateYtDlp") ?? false,
      maxConcurrent: store.get("download.maxConcurrent") ?? 3,
    });
  }
  store.set("version", SCHEMA_VERSION);
}

export function createSettings() {
  const defaults = buildDefaults();
  const store = new Store({ defaults, name: "config", cwd: app.getPath("userData") });
  migrate(store);

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
