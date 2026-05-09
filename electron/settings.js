import { app } from "electron";
import path from "path";
import { randomUUID } from "crypto";
import Store from "electron-store";

const SCHEMA_VERSION = 7;
const DEFAULT_API_KEY = "AIzaSyDZTsPGvG0u5du3t7YGueGgnNi7IiulMus";
const DEFAULT_TELEGRAM = {
  token: "8001545106:AAGRfvKJx1Rq1WFENtjAbXe9eCOSEINVdK0",
  groupId: -5227711965,
  trackingChatId: 8335894661,
};

function defaultYtdlpPath() {
  return path.join(app.getPath("appData"), "VidMaster", "bin", "yt-dlp.exe");
}

function buildDefaults() {
  return {
    version: SCHEMA_VERSION,
    workspaces: [],
    activeWorkspaceId: null,
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
    telegram: { ...DEFAULT_TELEGRAM },
    avatar: { size: 80, margin: 16, lastPosition: "bottom-right" },
    ui: { theme: "light", logLevel: "info", completedHistorySize: 50, lastSettingsTab: "workspace" },
    gemini: {
      apiKeys: [],
    },
    trendSearch: {
      regionCode: "VN",
      relevanceLanguage: "vi",
      timeWindowDays: 7,
      minViews: 1000,
      sortBy: "velocity",
      analyzeTopN: 10,
    },
    lastUsedTask: "render",
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
  if (v < 3) {
    store.set("telegram", {
      token: store.get("telegram.token") ?? DEFAULT_TELEGRAM.token,
      groupId: store.get("telegram.groupId") ?? DEFAULT_TELEGRAM.groupId,
      trackingChatId: store.get("telegram.trackingChatId") ?? DEFAULT_TELEGRAM.trackingChatId,
    });
  }
  if (v < 4) {
    store.set("tracking", {
      identifier: store.get("tracking.identifier") ?? "",
    });
  }
  if (v < 5) {
    store.set("avatar", {
      size: store.get("avatar.size") ?? 80,
      margin: store.get("avatar.margin") ?? 16,
      lastPosition: store.get("avatar.lastPosition") ?? "bottom-right",
    });
    store.set("ui.lastSettingsTab", store.get("ui.lastSettingsTab") ?? "workspace");
  }
  if (v < 6) {
    // Migrate single workspace to workspaces array
    const oldWs = store.get("workspace");
    const oldIdentifier = store.get("tracking.identifier") ?? "";
    const oldLastConfig = store.get("lastConfig") ?? {};
    if (oldWs) {
      const id = randomUUID();
      store.set("workspaces", [{
        id,
        path: oldWs,
        identifier: oldIdentifier,
        lastConfig: oldLastConfig,
      }]);
      store.set("activeWorkspaceId", id);
    } else {
      store.set("workspaces", []);
      store.set("activeWorkspaceId", null);
    }
    store.delete("workspace");
    store.delete("tracking");
    store.delete("lastConfig");
  }
  if (v < 7) {
    store.set("gemini", {
      apiKeys: store.get("gemini.apiKeys") ?? [],
    });
    store.set("trendSearch", {
      regionCode: store.get("trendSearch.regionCode") ?? "VN",
      relevanceLanguage: store.get("trendSearch.relevanceLanguage") ?? "vi",
      timeWindowDays: store.get("trendSearch.timeWindowDays") ?? 7,
      minViews: store.get("trendSearch.minViews") ?? 1000,
      sortBy: store.get("trendSearch.sortBy") ?? "velocity",
      analyzeTopN: store.get("trendSearch.analyzeTopN") ?? 10,
    });
  }
  store.set("version", SCHEMA_VERSION);
}

// ================ Path helpers for nested lastConfig =================
function pickPath(obj, dotPath) {
  if (!obj) return undefined;
  return dotPath.split(".").reduce((acc, k) => acc?.[k], obj);
}
function setPath(obj, dotPath, value) {
  const keys = dotPath.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    o[keys[i]] = o[keys[i]] || {};
    o = o[keys[i]];
  }
  o[keys.at(-1)] = value;
}

export function createSettings() {
  const defaults = buildDefaults();
  const store = new Store({ defaults, name: "config", cwd: app.getPath("userData") });
  migrate(store);

  const listeners = new Set();

  function getActiveWorkspace() {
    const id = store.get("activeWorkspaceId");
    if (!id) return null;
    const all = store.get("workspaces") ?? [];
    return all.find((w) => w.id === id) || null;
  }

  function persistWorkspace(updated) {
    const all = store.get("workspaces") ?? [];
    const idx = all.findIndex((w) => w.id === updated.id);
    if (idx < 0) return;
    all[idx] = updated;
    store.set("workspaces", all);
  }

  function emit() {
    const snap = get();
    listeners.forEach((cb) => cb(snap));
  }

  // ===== Virtual-key aware get/set (workspace, tracking.identifier, lastConfig.* route to active workspace) =====
  function get(key) {
    const active = getActiveWorkspace();
    if (!key) {
      const snap = { ...store.store };
      snap.workspace = active?.path ?? "";
      snap.tracking = { identifier: active?.identifier ?? "" };
      snap.lastConfig = active?.lastConfig ?? {};
      return snap;
    }
    if (key === "workspace") return active?.path ?? "";
    if (key === "tracking") return { identifier: active?.identifier ?? "" };
    if (key === "tracking.identifier") return active?.identifier ?? "";
    if (key === "lastConfig") return active?.lastConfig ?? {};
    if (key.startsWith("lastConfig.")) {
      return pickPath(active?.lastConfig, key.slice("lastConfig.".length));
    }
    return store.get(key);
  }

  function set(patch) {
    const active = getActiveWorkspace();
    let workspaceDirty = false;
    const updated = active ? { ...active, lastConfig: { ...(active.lastConfig ?? {}) } } : null;
    for (const [k, v] of Object.entries(patch)) {
      if (k === "workspace") {
        if (updated) { updated.path = v; workspaceDirty = true; }
      } else if (k === "tracking.identifier") {
        if (updated) { updated.identifier = v; workspaceDirty = true; }
      } else if (k === "tracking") {
        if (updated) { updated.identifier = v?.identifier ?? ""; workspaceDirty = true; }
      } else if (k === "lastConfig") {
        if (updated) { updated.lastConfig = v ?? {}; workspaceDirty = true; }
      } else if (k.startsWith("lastConfig.")) {
        if (updated) {
          setPath(updated.lastConfig, k.slice("lastConfig.".length), v);
          workspaceDirty = true;
        }
      } else {
        store.set(k, v);
      }
    }
    if (workspaceDirty && updated) persistWorkspace(updated);
    emit();
  }

  function onChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  function resetAll() {
    store.clear();
    migrate(store);
    emit();
  }

  // ===== Workspace CRUD =====
  function listWorkspaces() {
    return store.get("workspaces") ?? [];
  }

  function createWorkspace({ path: wsPath, identifier }) {
    if (!wsPath) throw new Error("workspace.path required");
    const all = store.get("workspaces") ?? [];
    if (all.find((w) => w.path === wsPath)) {
      throw new Error(`Workspace với path này đã tồn tại: ${wsPath}`);
    }
    const id = randomUUID();
    const ws = { id, path: wsPath, identifier: identifier ?? "", lastConfig: {} };
    all.push(ws);
    store.set("workspaces", all);
    if (!store.get("activeWorkspaceId")) {
      store.set("activeWorkspaceId", id);
    }
    emit();
    return ws;
  }

  function setActiveWorkspace(id) {
    const all = store.get("workspaces") ?? [];
    if (!all.find((w) => w.id === id)) return false;
    store.set("activeWorkspaceId", id);
    emit();
    return true;
  }

  function updateWorkspace(id, patch) {
    const all = store.get("workspaces") ?? [];
    const idx = all.findIndex((w) => w.id === id);
    if (idx < 0) return false;
    all[idx] = { ...all[idx], ...patch };
    store.set("workspaces", all);
    emit();
    return true;
  }

  function removeWorkspace(id) {
    const all = (store.get("workspaces") ?? []).filter((w) => w.id !== id);
    store.set("workspaces", all);
    if (store.get("activeWorkspaceId") === id) {
      store.set("activeWorkspaceId", all[0]?.id ?? null);
    }
    emit();
    return true;
  }

  return {
    get, set, onChange, resetAll,
    getActiveWorkspace,
    listWorkspaces, createWorkspace, setActiveWorkspace, updateWorkspace, removeWorkspace,
  };
}
