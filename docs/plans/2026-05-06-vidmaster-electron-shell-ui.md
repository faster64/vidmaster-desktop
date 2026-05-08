# VidMaster — Plan 2: Electron Shell + UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
>
> **NOTE:** User has requested **no automatic git commits**. Do NOT run `git commit` or `git init` from any step. Leave changes for manual review.

**Goal:** Build an Electron desktop app shell that wraps the seven task modules from Plan 1 into a Windows-only GUI with sidebar navigation, per-task forms, a job queue with progress and cancel, an onboarding flow, and a settings screen. After Plan 2, the user can install nothing yet (no installer), but `npm run dev` boots a working app where each task runs end-to-end against the user's workspace.

**Architecture:** Electron main process owns the window, settings store, and a singleton queue manager that calls `runRender`/`runTrim`/etc. from `src/`. The renderer is vanilla HTML/CSS/ESM JS (no bundler, no framework) — `<script type="module">` loads UI modules directly. Communication is exclusively via `contextBridge` exposed as `window.api`. Native `nodeIntegration: false` and `contextIsolation: true` everywhere.

**Tech Stack:**
- Electron ^30 (with ESM support via `"type": "module"`)
- electron-store ^10 (settings JSON persistence)
- electron-log ^5 (rotating file log)
- Vanilla HTML/CSS/JS in renderer — no React, no bundler

**Plan 1 prerequisites (already in place):**
- `src/_lib/{abortError,ffmpeg,runner}.js`
- `src/{render,snow,trim,cutBg,thumb,concat,rename}.js` — each exports `runX(config)` returning `{ ok, outputs, errors }`.
- `tests/` with 29 passing tests.

**Deferred to Plan 3** (intentionally out of scope here, captured so nothing slips):
- GPU encoder auto-detect on first launch (spec §6.5). Plan 2 leaves `ffmpeg.encoder` defaulting to `"auto"` in settings; it is still respected by `render.js` if the user picks an explicit encoder, but no auto-detection runs yet.
- `electron-builder` config + NSIS installer (spec §7).
- Code-signing notes, app icon (spec §7.4–7.5).
- Pre-release smoke checklist on a clean Windows VM (spec §7.10).

---

## File Structure

Files this plan creates or modifies:

```
vidmaster-desktop/
├── package.json                       (MODIFY — add electron deps + dev/start scripts)
├── electron/                          (NEW)
│   ├── main.js                        (Electron entry, window mgmt, IPC handlers)
│   ├── preload.js                     (contextBridge → window.api)
│   ├── queue.js                       (QueueManager class)
│   ├── settings.js                    (electron-store wrapper + defaults)
│   ├── workspace.js                   (workspace folder helpers — create subfolders, validate)
│   ├── ipc/
│   │   ├── queue.js                   (queue:* IPC handlers)
│   │   ├── settings.js                (settings:* IPC handlers)
│   │   ├── dialog.js                  (dialog:* IPC handlers)
│   │   ├── shell.js                   (shell:* IPC handlers)
│   │   └── app.js                     (app:* IPC handlers)
│   └── renderer/                      (NEW UI)
│       ├── index.html                 (single-page shell)
│       ├── styles.css                 (theme + layout)
│       ├── main.js                    (router + bootstrap)
│       ├── components/
│       │   ├── sidebar.js
│       │   ├── queueDock.js
│       │   ├── taskForm.js            (shared form template)
│       │   ├── progressBar.js
│       │   └── modal.js               (error detail modal)
│       └── screens/
│           ├── render.js
│           ├── snow.js
│           ├── trim.js
│           ├── cutBg.js
│           ├── thumb.js
│           ├── concat.js
│           ├── rename.js
│           ├── queue.js
│           ├── settings.js
│           └── onboarding.js
├── tests/
│   └── electron/                      (NEW)
│       ├── queue.test.js
│       ├── settings.test.js
│       └── workspace.test.js
└── (Plan 1 files unchanged)
```

The renderer keeps every screen in its own file under `screens/`. Components are reused across screens. The router in `main.js` is ~30 lines: parse hash, mount the matching screen module.

---

## Task 1: Bootstrap Electron deps + scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1.1: Add Electron-related deps**

Edit `package.json` `dependencies` and `devDependencies` to include:

```json
{
  "dependencies": {
    "@ffmpeg-installer/ffmpeg": "^1.1.0",
    "ffmpeg-static": "^5.2.0",
    "fluent-ffmpeg": "^2.1.3",
    "p-limit": "^6.2.0",
    "sharp": "^0.33.5",
    "electron-store": "^10.0.1",
    "electron-log": "^5.2.0"
  },
  "devDependencies": {
    "vitest": "^1.6.0",
    "electron": "^30.5.1"
  },
  "main": "electron/main.js",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "electron ."
  }
}
```

- [ ] **Step 1.2: Install**

Run from project root: `npm install`. Expected: success. Electron download is ~80 MB.

- [ ] **Step 1.3: Confirm electron CLI works**

Run: `npx electron --version`. Expected: prints something like `v30.5.1`.

---

## Task 2: Electron main process skeleton

**Files:**
- Create: `electron/main.js`
- Create: `electron/preload.js` (stub — fleshed out in Task 4)

- [ ] **Step 2.1: Create `electron/main.js`**

```js
import { app, BrowserWindow } from "electron";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "VidMaster",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // allow preload to require Node modules
    },
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
```

- [ ] **Step 2.2: Create stub `electron/preload.js`**

```js
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("api", {
  // Filled in across later tasks. Stub for now so renderer can detect availability.
  app: { getVersion: () => "0.1.0-dev" },
});
```

> Note: ESM preload requires Electron 28+ and `"type": "module"` in package.json. We have both.

- [ ] **Step 2.3: Create temporary minimal `electron/renderer/index.html`** (full version in Task 5)

```html
<!doctype html>
<html lang="vi">
<head><meta charset="utf-8"><title>VidMaster</title></head>
<body><h1>VidMaster booting…</h1></body>
</html>
```

- [ ] **Step 2.4: Run the app**

Run: `npm run dev`
Expected: A window opens showing "VidMaster booting…". Close it.

If it errors on ESM imports: ensure `package.json` has `"type": "module"` and `"main": "electron/main.js"`.

---

## Task 3: Settings store wrapper + tests

**Files:**
- Create: `electron/settings.js`
- Create: `tests/electron/settings.test.js`

- [ ] **Step 3.1: Write the failing test**

`tests/electron/settings.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from "vitest";

// electron-store reads userData path from `app.getPath` — mock it before importing the wrapper.
vi.mock("electron", async () => {
  const os = await import("os");
  const path = await import("path");
  const fs = await import("fs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vm-settings-"));
  return {
    app: {
      getPath: (name) => name === "userData" ? tmp : tmp,
      getName: () => "vidmaster-test",
      getVersion: () => "0.1.0-test",
    },
  };
});

let createSettings;
beforeEach(async () => {
  vi.resetModules();
  ({ createSettings } = await import("../../electron/settings.js"));
});

describe("settings store", () => {
  it("returns defaults when no value has been set", () => {
    const s = createSettings();
    expect(s.get("ui.theme")).toBe("light");
    expect(s.get("ffmpeg.encoder")).toBe("auto");
  });

  it("persists patches via set()", () => {
    const s = createSettings();
    s.set({ workspace: "D:\\Test" });
    expect(s.get("workspace")).toBe("D:\\Test");
  });

  it("returns full snapshot when get() called with no args", () => {
    const s = createSettings();
    s.set({ workspace: "D:\\Test" });
    const all = s.get();
    expect(all.workspace).toBe("D:\\Test");
    expect(all.version).toBe(1);
  });

  it("notifies onChange subscribers", () => {
    const s = createSettings();
    const cb = vi.fn();
    s.onChange(cb);
    s.set({ workspace: "D:\\Other" });
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ workspace: "D:\\Other" }));
  });
});
```

- [ ] **Step 3.2: Run (expect fail)**

Run: `npm test -- tests/electron/settings.test.js`
Expected: FAIL — `electron/settings.js` not found.

- [ ] **Step 3.3: Implement `electron/settings.js`**

```js
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
  const store = new Store({ defaults: DEFAULTS, name: "config" });
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
```

- [ ] **Step 3.4: Run test (expect 4 pass)**

---

## Task 4: Workspace helpers + tests

**Files:**
- Create: `electron/workspace.js`
- Create: `tests/electron/workspace.test.js`

The workspace module:
- Knows the standard subfolder layout from spec Section 6.1.
- Has `ensureWorkspace(rootPath)` that creates missing subfolders.
- Has `defaultsForTask(workspace, taskType)` returning input/output paths a task UI should pre-fill.

- [ ] **Step 4.1: Write the failing test**

`tests/electron/workspace.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { ensureWorkspace, defaultsForTask, REQUIRED_SUBFOLDERS } from "../../electron/workspace.js";

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-ws-")); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe("ensureWorkspace", () => {
  it("creates all required subfolders", () => {
    ensureWorkspace(tmpDir);
    for (const sub of REQUIRED_SUBFOLDERS) {
      expect(fs.existsSync(path.join(tmpDir, sub))).toBe(true);
    }
  });

  it("is idempotent", () => {
    ensureWorkspace(tmpDir);
    ensureWorkspace(tmpDir); // no throw
    expect(fs.existsSync(path.join(tmpDir, "input"))).toBe(true);
  });
});

describe("defaultsForTask", () => {
  it("returns render input/output paths under the workspace", () => {
    const d = defaultsForTask(tmpDir, "render");
    expect(d.inputs.overlays).toBe(path.join(tmpDir, "overlays"));
    expect(d.inputs.backgrounds).toBe(path.join(tmpDir, "backgrounds"));
    expect(d.output).toBe(path.join(tmpDir, "done"));
  });

  it("returns trim input/output paths", () => {
    const d = defaultsForTask(tmpDir, "trim");
    expect(d.input).toBe(path.join(tmpDir, "input"));
    expect(d.output).toBe(path.join(tmpDir, "done"));
  });
});
```

- [ ] **Step 4.2: Run (expect fail).**

- [ ] **Step 4.3: Implement `electron/workspace.js`**

```js
import fs from "fs";
import path from "path";

export const REQUIRED_SUBFOLDERS = [
  "overlays", "backgrounds", "combined_videos", "done",
  "input", "output", "thumbs", "temp", "overlays_convert",
];

export function ensureWorkspace(root) {
  fs.mkdirSync(root, { recursive: true });
  for (const sub of REQUIRED_SUBFOLDERS) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
}

export function defaultsForTask(ws, type) {
  const p = (sub) => path.join(ws, sub);
  switch (type) {
    case "render":
      return {
        inputs: { overlays: p("overlays"), backgrounds: p("backgrounds"), combined: p("combined_videos") },
        output: p("done"),
      };
    case "snow":
      return { input: p("input"), output: p("output"), snowAsset: "" };
    case "trim":
      return { input: p("input"), output: p("done") };
    case "cutBg":
      return { input: p("backgrounds"), output: p("backgrounds") };
    case "thumb":
      return { input: p("overlays"), overlays: p("overlays_convert"), output: p("thumbs") };
    case "concat":
      return { thumbsDir: p("thumbs"), doneDir: p("done"), output: p("output"), tempDir: p("temp") };
    case "rename":
      return { folder: p("thumbs") };
    default:
      throw new Error(`Unknown task type: ${type}`);
  }
}
```

- [ ] **Step 4.4: Run (expect 4 pass).**

---

## Task 5: Queue Manager + tests

**Files:**
- Create: `electron/queue.js`
- Create: `tests/electron/queue.test.js`

The Queue Manager is the singleton that owns `pending[]`, `running` (max 1 job), `completed[]` (max 50). It dispatches the right `runX` from `src/` based on task type, wires `signal`/`onProgress`/`onLog` from the runner, and emits state updates through a callback.

- [ ] **Step 5.1: Write the failing test**

`tests/electron/queue.test.js`:

```js
import { describe, it, expect, vi } from "vitest";
import { QueueManager } from "../../electron/queue.js";

describe("QueueManager", () => {
  function fakeRunners({ delay = 50, fail = false } = {}) {
    return {
      noop: async ({ signal, onProgress }) => {
        for (let i = 0; i < 3; i++) {
          if (signal?.aborted) throw new Error("Aborted");
          await new Promise((r) => setTimeout(r, delay));
          onProgress?.((i + 1) * 33, `tick ${i}`);
        }
        if (fail) throw new Error("oops");
        return { ok: true, outputs: ["x"], errors: [] };
      },
    };
  }

  it("runs a single job and emits progress + final state", async () => {
    const updates = [];
    const q = new QueueManager({
      runners: fakeRunners(),
      onUpdate: (s) => updates.push(JSON.parse(JSON.stringify(s))),
    });
    const { jobId } = q.add({ type: "noop", config: {} });
    await q.waitIdle();

    const final = updates.at(-1);
    expect(final.completed.find((j) => j.id === jobId).status).toBe("done");
  });

  it("runs jobs serially: second only starts after first finishes", async () => {
    const order = [];
    const runners = {
      noop: async () => {
        order.push("start");
        await new Promise((r) => setTimeout(r, 30));
        order.push("end");
        return { ok: true, outputs: [], errors: [] };
      },
    };
    const q = new QueueManager({ runners, onUpdate: () => {} });
    q.add({ type: "noop", config: {} });
    q.add({ type: "noop", config: {} });
    await q.waitIdle();
    expect(order).toEqual(["start", "end", "start", "end"]);
  });

  it("cancel sets status to 'cancelled' and starts the next job", async () => {
    const runners = fakeRunners({ delay: 200 });
    const q = new QueueManager({ runners, onUpdate: () => {} });
    const { jobId } = q.add({ type: "noop", config: {} });
    q.add({ type: "noop", config: {} });
    setTimeout(() => q.cancel(jobId), 50);
    await q.waitIdle();
    const completed = q.getState().completed;
    expect(completed.find((j) => j.id === jobId).status).toBe("cancelled");
    expect(completed.length).toBe(2);
  });

  it("captures errors and continues to next job", async () => {
    const q = new QueueManager({
      runners: fakeRunners({ fail: true, delay: 5 }),
      onUpdate: () => {},
    });
    const { jobId } = q.add({ type: "noop", config: {} });
    q.add({ type: "noop", config: {} });
    await q.waitIdle();
    const failed = q.getState().completed.find((j) => j.id === jobId);
    expect(failed.status).toBe("error");
    expect(failed.error.message).toBe("oops");
  });

  it("caps completed history at 50 entries", async () => {
    const runners = {
      noop: async () => ({ ok: true, outputs: [], errors: [] }),
    };
    const q = new QueueManager({ runners, onUpdate: () => {}, historySize: 50 });
    for (let i = 0; i < 60; i++) q.add({ type: "noop", config: {} });
    await q.waitIdle();
    expect(q.getState().completed.length).toBe(50);
  });
});
```

- [ ] **Step 5.2: Run (expect fail).**

- [ ] **Step 5.3: Implement `electron/queue.js`**

```js
import { randomUUID } from "crypto";

export class QueueManager {
  constructor({ runners, onUpdate, historySize = 50 }) {
    this.runners = runners;
    this.onUpdate = onUpdate;
    this.historySize = historySize;
    this.pending = [];
    this.running = null;
    this.completed = [];
    this._idleResolvers = [];
  }

  add({ type, config }) {
    const job = {
      id: randomUUID(),
      type,
      config,
      status: "pending",
      progress: 0,
      message: "",
      createdAt: Date.now(),
    };
    this.pending.push(job);
    this._emit();
    this._maybeStart();
    return { jobId: job.id };
  }

  cancel(jobId) {
    if (this.running?.id === jobId) {
      this.running.controller?.abort();
    } else {
      const idx = this.pending.findIndex((j) => j.id === jobId);
      if (idx >= 0) {
        const [job] = this.pending.splice(idx, 1);
        job.status = "cancelled";
        this._pushCompleted(job);
        this._emit();
      }
    }
  }

  clear() {
    this.completed = [];
    this._emit();
  }

  getState() {
    return {
      running: this.running ? this._public(this.running) : null,
      pending: this.pending.map((j) => this._public(j)),
      completed: this.completed.map((j) => this._public(j)),
    };
  }

  waitIdle() {
    if (!this.running && this.pending.length === 0) return Promise.resolve();
    return new Promise((r) => this._idleResolvers.push(r));
  }

  _public(j) {
    const { controller, ...rest } = j;
    return rest;
  }

  _emit() {
    this.onUpdate?.(this.getState());
  }

  _pushCompleted(job) {
    this.completed.unshift(job);
    if (this.completed.length > this.historySize) {
      this.completed.length = this.historySize;
    }
  }

  _maybeStart() {
    if (this.running || this.pending.length === 0) return;
    const job = this.pending.shift();
    job.status = "running";
    job.controller = new AbortController();
    this.running = job;
    this._emit();

    const runner = this.runners[job.type];
    if (!runner) {
      this._fail(job, new Error(`No runner for type: ${job.type}`));
      return;
    }

    runner({
      ...job.config,
      signal: job.controller.signal,
      onProgress: (pct, msg) => {
        job.progress = pct;
        job.message = msg ?? "";
        this._emit();
      },
      onLog: (level, line) => {
        // forwarded via main-process logger; no-op here
      },
    }).then(
      (result) => {
        job.result = result;
        job.status = result.ok ? "done" : "error";
        if (!result.ok) job.error = { message: "Task reported errors", details: result.errors };
        this._finish(job);
      },
      (err) => {
        if (err.name === "AbortError") {
          job.status = "cancelled";
          this._finish(job);
        } else {
          this._fail(job, err);
        }
      },
    );
  }

  _fail(job, err) {
    job.status = "error";
    job.error = { message: err.message, stack: err.stack };
    this._finish(job);
  }

  _finish(job) {
    this.running = null;
    this._pushCompleted(job);
    this._emit();
    this._maybeStart();
    if (!this.running && this.pending.length === 0) {
      this._idleResolvers.forEach((r) => r());
      this._idleResolvers = [];
    }
  }
}
```

- [ ] **Step 5.4: Run test (expect 5 pass). Cumulative: 29 (Plan 1) + 4 (settings) + 4 (workspace) + 5 (queue) = 42 tests pass.**

---

## Task 6: Main process IPC wiring

**Files:**
- Create: `electron/ipc/queue.js`
- Create: `electron/ipc/settings.js`
- Create: `electron/ipc/dialog.js`
- Create: `electron/ipc/shell.js`
- Create: `electron/ipc/app.js`
- Modify: `electron/main.js`

- [ ] **Step 6.1: Implement `electron/ipc/queue.js`**

```js
import { ipcMain } from "electron";
import { QueueManager } from "../queue.js";
import { runRender } from "../../src/render.js";
import { runSnow } from "../../src/snow.js";
import { runTrim } from "../../src/trim.js";
import { runCutBg } from "../../src/cutBg.js";
import { runThumb } from "../../src/thumb.js";
import { runConcat } from "../../src/concat.js";
import { runRename } from "../../src/rename.js";

export function registerQueueIpc(getMainWindow) {
  const runners = {
    render: runRender, snow: runSnow, trim: runTrim, cutBg: runCutBg,
    thumb: runThumb, concat: runConcat, rename: runRename,
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
```

- [ ] **Step 6.2: Implement `electron/ipc/settings.js`**

```js
import { ipcMain } from "electron";
import { createSettings } from "../settings.js";

export function registerSettingsIpc(getMainWindow) {
  const settings = createSettings();

  settings.onChange((snapshot) => {
    getMainWindow()?.webContents.send("settings:change", snapshot);
  });

  ipcMain.handle("settings:get", (_, key) => settings.get(key));
  ipcMain.handle("settings:set", (_, patch) => settings.set(patch));

  return settings;
}
```

- [ ] **Step 6.3: Implement `electron/ipc/dialog.js`**

```js
import { ipcMain, dialog, BrowserWindow } from "electron";

export function registerDialogIpc() {
  ipcMain.handle("dialog:pickFolder", async (_, defaultPath) => {
    const win = BrowserWindow.getFocusedWindow();
    const r = await dialog.showOpenDialog(win, {
      properties: ["openDirectory", "createDirectory"],
      defaultPath,
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle("dialog:pickFile", async (_, opts = {}) => {
    const win = BrowserWindow.getFocusedWindow();
    const r = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: opts.filters,
      defaultPath: opts.defaultPath,
    });
    return r.canceled ? null : r.filePaths[0];
  });
}
```

- [ ] **Step 6.4: Implement `electron/ipc/shell.js`**

```js
import { ipcMain, shell } from "electron";

export function registerShellIpc(logFilePathFn) {
  ipcMain.handle("shell:openFolder", (_, p) => shell.openPath(p));
  ipcMain.handle("shell:openLogFile", () => shell.openPath(logFilePathFn()));
}
```

- [ ] **Step 6.5: Implement `electron/ipc/app.js`**

```js
import { app, ipcMain } from "electron";

export function registerAppIpc(getSettings) {
  ipcMain.handle("app:getVersion", () => app.getVersion());
  ipcMain.handle("app:getWorkspace", () => getSettings().get("workspace"));
}
```

- [ ] **Step 6.6: Modify `electron/main.js`** — wire it all up

Replace the contents of `electron/main.js`:

```js
import { app, BrowserWindow } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import log from "electron-log";
import { registerQueueIpc } from "./ipc/queue.js";
import { registerSettingsIpc } from "./ipc/settings.js";
import { registerDialogIpc } from "./ipc/dialog.js";
import { registerShellIpc } from "./ipc/shell.js";
import { registerAppIpc } from "./ipc/app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow;
const getMainWindow = () => mainWindow;

log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.file.fileName = "main.log";

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 900, minHeight: 600,
    title: "VidMaster",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  const settings = registerSettingsIpc(getMainWindow);
  registerQueueIpc(getMainWindow);
  registerDialogIpc();
  registerShellIpc(() => log.transports.file.getFile().path);
  registerAppIpc(() => settings);
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
```

- [ ] **Step 6.7: Update `electron/preload.js`** with the full surface

```js
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
  },
});
```

- [ ] **Step 6.8: Smoke-run** — `npm run dev`. Expected: window opens, no IPC errors in DevTools console (open with Ctrl+Shift+I temporarily; remove the menu suppression for this step or just check terminal stderr).

---

## Task 7: Renderer base shell — index.html, styles.css, main.js

**Files:**
- Modify: `electron/renderer/index.html`
- Create: `electron/renderer/styles.css`
- Create: `electron/renderer/main.js`

- [ ] **Step 7.1: Replace `electron/renderer/index.html`**

```html
<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';">
  <title>VidMaster</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <div id="app">
    <aside id="sidebar"></aside>
    <main id="content"></main>
    <footer id="queue-dock"></footer>
  </div>
  <div id="modal-root"></div>
  <script type="module" src="./main.js"></script>
</body>
</html>
```

- [ ] **Step 7.2: Create `electron/renderer/styles.css`**

```css
:root {
  --bg: #f8f9fb;
  --fg: #1f2937;
  --muted: #6b7280;
  --border: #e5e7eb;
  --accent: #3b82f6;
  --accent-fg: #fff;
  --danger: #dc2626;
  --success: #16a34a;
  --pending: #f59e0b;
  --sidebar-bg: #ffffff;
  --content-bg: #ffffff;
  --dock-bg: #f3f4f6;
}

* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.45 -apple-system, "Segoe UI", system-ui, sans-serif; color: var(--fg); background: var(--bg); }
#app { display: grid; grid-template-columns: 240px 1fr; grid-template-rows: 1fr auto; height: 100vh; }
#sidebar { grid-row: 1 / 3; background: var(--sidebar-bg); border-right: 1px solid var(--border); padding: 16px 0; overflow-y: auto; }
#content { background: var(--content-bg); padding: 24px 32px; overflow-y: auto; }
#queue-dock { grid-column: 2 / 3; background: var(--dock-bg); border-top: 1px solid var(--border); padding: 12px 32px; min-height: 48px; }

.sidebar-title { padding: 0 16px 12px; font-weight: 700; font-size: 16px; }
.sidebar-section-label { padding: 12px 16px 6px; font-size: 11px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.04em; }
.nav-item { display: block; padding: 8px 16px; cursor: pointer; user-select: none; border-left: 3px solid transparent; }
.nav-item:hover { background: #f1f5f9; }
.nav-item.active { border-left-color: var(--accent); background: #eef2ff; font-weight: 600; }
.nav-item .icon { margin-right: 8px; }
.nav-item .badge { float: right; background: var(--accent); color: var(--accent-fg); border-radius: 10px; padding: 0 6px; font-size: 11px; }

.screen-header { margin: 0 0 4px; font-size: 22px; font-weight: 700; }
.screen-subtitle { margin: 0 0 24px; color: var(--muted); }

.field { display: block; margin-bottom: 16px; }
.field label { display: block; margin-bottom: 4px; font-weight: 600; }
.field input[type=text], .field input[type=number] {
  width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; font: inherit;
}
.field .help { color: var(--muted); font-size: 12px; margin-top: 4px; }
.field.error input { border-color: var(--danger); }
.field .error-text { color: var(--danger); font-size: 12px; margin-top: 4px; }

.field-row { display: flex; gap: 8px; align-items: center; }
.field-row input[type=text] { flex: 1; }

button { font: inherit; padding: 8px 14px; border: 1px solid var(--border); border-radius: 6px; background: white; cursor: pointer; }
button:hover { background: #f3f4f6; }
button.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
button.primary:hover { background: #2563eb; }
button.danger { color: var(--danger); }

details.advanced { margin: 8px 0 16px; }
details.advanced summary { cursor: pointer; padding: 8px 0; font-weight: 600; }

.queue-item { display: flex; align-items: center; gap: 12px; padding: 6px 0; }
.queue-item .label { flex: 1; }
.progress { width: 100%; height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; }
.progress > .bar { height: 100%; background: var(--accent); transition: width 0.2s; }

.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: white; border-radius: 8px; max-width: 720px; width: 90vw; max-height: 80vh; display: flex; flex-direction: column; overflow: hidden; }
.modal-header { padding: 14px 18px; border-bottom: 1px solid var(--border); font-weight: 700; }
.modal-body { padding: 18px; overflow-y: auto; }
.modal-footer { padding: 12px 18px; border-top: 1px solid var(--border); text-align: right; }
.modal pre { background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 12px; white-space: pre-wrap; }

.toast-container { position: fixed; top: 16px; right: 16px; display: flex; flex-direction: column; gap: 8px; z-index: 200; }
.toast { background: white; border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: 6px; padding: 12px 16px; box-shadow: 0 2px 6px rgba(0,0,0,0.08); max-width: 360px; cursor: pointer; }
.toast.success { border-left-color: var(--success); }
.toast.error { border-left-color: var(--danger); }
```

- [ ] **Step 7.3: Create `electron/renderer/main.js`** — bootstrap + router

```js
import { mountSidebar } from "./components/sidebar.js";
import { mountQueueDock } from "./components/queueDock.js";
import { renderRender } from "./screens/render.js";
import { renderSnow } from "./screens/snow.js";
import { renderTrim } from "./screens/trim.js";
import { renderCutBg } from "./screens/cutBg.js";
import { renderThumb } from "./screens/thumb.js";
import { renderConcat } from "./screens/concat.js";
import { renderRename } from "./screens/rename.js";
import { renderQueue } from "./screens/queue.js";
import { renderSettings } from "./screens/settings.js";
import { renderOnboarding } from "./screens/onboarding.js";

const screens = {
  render: renderRender, snow: renderSnow, trim: renderTrim, cutBg: renderCutBg,
  thumb: renderThumb, concat: renderConcat, rename: renderRename,
  queue: renderQueue, settings: renderSettings,
};

const sidebarEl = document.getElementById("sidebar");
const contentEl = document.getElementById("content");
const dockEl = document.getElementById("queue-dock");

async function navigate(name) {
  const fn = screens[name];
  if (!fn) return;
  contentEl.innerHTML = "";
  await fn(contentEl);
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.screen === name));
  window.location.hash = name;
}

window.addEventListener("hashchange", () => {
  const name = window.location.hash.slice(1) || "render";
  navigate(name);
});

async function bootstrap() {
  const ws = await window.api.app.getWorkspace();
  if (!ws) {
    contentEl.innerHTML = "";
    await renderOnboarding(contentEl, async (chosen) => {
      await window.api.settings.set({ workspace: chosen });
      await navigate("render");
    });
    return;
  }
  mountSidebar(sidebarEl, navigate);
  mountQueueDock(dockEl);
  const initial = window.location.hash.slice(1) || "render";
  await navigate(initial);
}

bootstrap();
```

- [ ] **Step 7.4: Smoke-run** — `npm run dev`. Expected: window opens, then crashes because the screen module files don't exist yet. **This is fine** — Tasks 8+ create them. Confirm the IPC calls (`getWorkspace`) work without error in the main-process terminal output.

---

## Task 8: Sidebar + Queue dock components

**Files:**
- Create: `electron/renderer/components/sidebar.js`
- Create: `electron/renderer/components/queueDock.js`
- Create: `electron/renderer/components/progressBar.js`
- Create: `electron/renderer/components/modal.js`

- [ ] **Step 8.1: Create `components/sidebar.js`**

```js
const NAV_ITEMS = [
  { group: "Tasks", items: [
    { id: "render",  icon: "🎬", label: "Render Video" },
    { id: "snow",    icon: "❄️", label: "Tạo video từ ảnh" },
    { id: "trim",    icon: "✂️", label: "Cắt video 30s" },
    { id: "cutBg",   icon: "🎞️", label: "Chia nhỏ video nền" },
    { id: "thumb",   icon: "🖼️", label: "Tạo ảnh thu nhỏ" },
    { id: "concat",  icon: "🔗", label: "Ghép video + thumbnail" },
    { id: "rename",  icon: "✏️", label: "Sửa tên thu nhỏ" },
  ]},
  { group: "Hệ thống", items: [
    { id: "queue",    icon: "📋", label: "Hàng đợi" },
    { id: "settings", icon: "⚙️", label: "Cài đặt" },
  ]},
];

export function mountSidebar(el, onNavigate) {
  el.innerHTML = `<div class="sidebar-title">VidMaster</div>` +
    NAV_ITEMS.map((g) => `
      <div class="sidebar-section-label">${g.group}</div>
      ${g.items.map((it) => `
        <div class="nav-item" data-screen="${it.id}">
          <span class="icon">${it.icon}</span>${it.label}
          ${it.id === "queue" ? `<span class="badge" id="queue-badge" style="display:none">0</span>` : ""}
        </div>`).join("")}
    `).join("");

  el.addEventListener("click", (e) => {
    const item = e.target.closest(".nav-item");
    if (item) onNavigate(item.dataset.screen);
  });

  window.api.queue.onUpdate((s) => {
    const count = (s.running ? 1 : 0) + s.pending.length;
    const badge = document.getElementById("queue-badge");
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? "" : "none";
    }
  });
}
```

- [ ] **Step 8.2: Create `components/queueDock.js`**

```js
import { progressBar } from "./progressBar.js";

export function mountQueueDock(el) {
  const render = (state) => {
    if (!state.running && state.pending.length === 0) {
      el.innerHTML = `<span style="color:var(--muted)">Hàng đợi trống.</span>`;
      return;
    }
    const r = state.running;
    el.innerHTML = `
      ${r ? `
        <div class="queue-item">
          <span class="label">⏳ ${labelFor(r.type)} <span style="color:var(--muted)">${r.message ?? ""}</span></span>
          ${progressBar(r.progress)}
          <button data-cancel="${r.id}" class="danger">Huỷ</button>
        </div>` : ""}
      ${state.pending.length > 0 ? `<div style="color:var(--muted);margin-top:4px">⏸ ${state.pending.length} task đang chờ</div>` : ""}
    `;
  };

  el.addEventListener("click", (e) => {
    const id = e.target.dataset?.cancel;
    if (id) window.api.queue.cancel(id);
  });

  window.api.queue.onUpdate(render);
  window.api.queue.getState().then(render);
}

const LABELS = { render: "Render", snow: "Snow", trim: "Trim", cutBg: "CutBg", thumb: "Thumb", concat: "Concat", rename: "Rename" };
function labelFor(type) { return LABELS[type] || type; }
```

- [ ] **Step 8.3: Create `components/progressBar.js`**

```js
export function progressBar(percent) {
  const p = Math.max(0, Math.min(100, Math.round(percent || 0)));
  return `<div class="progress" style="flex:1;max-width:240px"><div class="bar" style="width:${p}%"></div></div><span style="min-width:42px;text-align:right">${p}%</span>`;
}
```

- [ ] **Step 8.4: Create `components/modal.js`**

```js
const root = () => document.getElementById("modal-root");

export function showModal({ title, body, footer }) {
  const r = root();
  r.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">${title}</div>
        <div class="modal-body">${body}</div>
        <div class="modal-footer">${footer ?? `<button class="primary" data-close>Đóng</button>`}</div>
      </div>
    </div>`;
  r.addEventListener("click", (e) => {
    if (e.target.matches(".modal-backdrop") || e.target.matches("[data-close]")) {
      r.innerHTML = "";
    }
  }, { once: true });
}

export function showErrorModal({ summary, error, fullLog }) {
  const stack = error?.stack || error?.details ? JSON.stringify(error, null, 2) : (error?.message || String(error));
  showModal({
    title: `❌ ${summary}`,
    body: `<p>${error?.message || "Có lỗi xảy ra."}</p>
           <h4>Chi tiết</h4><pre>${escape(stack)}</pre>
           ${fullLog ? `<h4>Log gần nhất</h4><pre>${escape(fullLog)}</pre>` : ""}`,
    footer: `
      <button onclick="navigator.clipboard.writeText(document.querySelector('.modal-body').innerText)">Copy log</button>
      <button onclick="window.api.shell.openLogFile()">Mở file log</button>
      <button class="primary" data-close>Đóng</button>
    `,
  });
}

function escape(s) { return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }
```

---

## Task 9: Onboarding screen

**Files:**
- Create: `electron/renderer/screens/onboarding.js`

- [ ] **Step 9.1: Create `screens/onboarding.js`**

```js
export async function renderOnboarding(el, onWorkspaceChosen) {
  el.innerHTML = `
    <h1 class="screen-header">Chào mừng đến VidMaster</h1>
    <p class="screen-subtitle">Trước khi bắt đầu, hãy chọn 1 thư mục làm "Workspace".
       App sẽ tự tạo các thư mục con bên trong (overlays, backgrounds, done, …).</p>
    <div class="field-row">
      <input type="text" id="ws-path" readonly placeholder="Chưa chọn">
      <button id="ws-pick" class="primary">📂 Chọn thư mục…</button>
    </div>
    <div style="margin-top:24px">
      <button id="ws-confirm" class="primary" disabled>Bắt đầu</button>
    </div>
  `;

  const pathEl = el.querySelector("#ws-path");
  const pickBtn = el.querySelector("#ws-pick");
  const confirmBtn = el.querySelector("#ws-confirm");
  let chosen = "";

  pickBtn.addEventListener("click", async () => {
    const p = await window.api.dialog.pickFolder();
    if (p) {
      chosen = p;
      pathEl.value = p;
      confirmBtn.disabled = false;
    }
  });

  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Đang tạo thư mục…";
    await window.api.app.ensureWorkspace(chosen);
    await window.api.shell.openFolder(chosen);
    await onWorkspaceChosen(chosen);
  });
}
```

(Step 9.2 below adds the `app:ensureWorkspace` IPC handler that this code calls.)

- [ ] **Step 9.2: Add `app:ensureWorkspace` IPC**

Modify `electron/ipc/app.js`:

```js
import { app, ipcMain } from "electron";
import { ensureWorkspace } from "../workspace.js";

export function registerAppIpc(getSettings) {
  ipcMain.handle("app:getVersion", () => app.getVersion());
  ipcMain.handle("app:getWorkspace", () => getSettings().get("workspace"));
  ipcMain.handle("app:ensureWorkspace", (_, root) => { ensureWorkspace(root); return true; });
}
```

Modify `electron/preload.js` `app:` block:

```js
app: {
  getVersion: () => ipcRenderer.invoke("app:getVersion"),
  getWorkspace: () => ipcRenderer.invoke("app:getWorkspace"),
  ensureWorkspace: (root) => ipcRenderer.invoke("app:ensureWorkspace", root),
},
```

- [ ] **Step 9.3: Smoke-run** — `npm run dev`. Expected: app shows onboarding (because settings has empty workspace). Pick a folder. Confirm subfolders are created. App should then load Render screen (which doesn't exist yet — expected error).

---

## Task 10: Shared task form template

**Files:**
- Create: `electron/renderer/components/taskForm.js`

The shared template renders a task screen with: title, description, input/output folder pickers, custom param fields, optional advanced section, "Add to queue" button.

- [ ] **Step 10.1: Create `components/taskForm.js`**

```js
export function taskFormShell({ icon, title, description, fields, advanced, taskType, lastConfig, defaults }) {
  return `
    <div class="screen-header">${icon} ${title}</div>
    <p class="screen-subtitle">${description}</p>
    <form id="task-form">
      ${fields.map((f) => fieldHtml(f, lastConfig, defaults)).join("")}
      ${advanced && advanced.length ? `
        <details class="advanced">
          <summary>Tuỳ chọn nâng cao</summary>
          ${advanced.map((f) => fieldHtml(f, lastConfig, defaults)).join("")}
        </details>` : ""}
      <button type="submit" class="primary">▶ Thêm vào hàng đợi</button>
      <button type="button" id="task-reset" style="margin-left:8px">Reset mặc định</button>
    </form>
  `;
}

function fieldHtml(f, lastConfig, defaults) {
  const v = pickValue(f.path, lastConfig) ?? pickValue(f.path, defaults) ?? f.default ?? "";
  if (f.type === "folder") {
    return `
      <div class="field" data-path="${f.path}" data-kind="folder">
        <label>📁 ${f.label}</label>
        <div class="field-row">
          <input type="text" name="${f.path}" value="${escape(v)}">
          <button type="button" data-pick="${f.path}">📂 Chọn…</button>
        </div>
        ${f.help ? `<div class="help">${f.help}</div>` : ""}
      </div>`;
  }
  if (f.type === "number") {
    return `
      <div class="field" data-path="${f.path}" data-kind="number">
        <label>🔢 ${f.label}</label>
        <input type="number" name="${f.path}" value="${escape(v)}" ${f.min != null ? `min="${f.min}"` : ""}>
        ${f.help ? `<div class="help">${f.help}</div>` : ""}
      </div>`;
  }
  if (f.type === "checkbox") {
    return `
      <div class="field" data-path="${f.path}" data-kind="checkbox">
        <label><input type="checkbox" name="${f.path}" ${v ? "checked" : ""}> ${f.label}</label>
        ${f.help ? `<div class="help">${f.help}</div>` : ""}
      </div>`;
  }
  if (f.type === "text") {
    return `
      <div class="field" data-path="${f.path}" data-kind="text">
        <label>${f.label}</label>
        <input type="text" name="${f.path}" value="${escape(v)}">
        ${f.help ? `<div class="help">${f.help}</div>` : ""}
      </div>`;
  }
  return "";
}

function escape(s) { return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])); }

function pickValue(p, obj) {
  if (!obj) return undefined;
  return p.split(".").reduce((acc, k) => acc?.[k], obj);
}

function setValue(p, obj, value) {
  const keys = p.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    o[keys[i]] = o[keys[i]] || {};
    o = o[keys[i]];
  }
  o[keys.at(-1)] = value;
}

export function bindTaskForm(formEl, { fields, taskType, defaults }) {
  formEl.addEventListener("click", async (e) => {
    const pickPath = e.target.dataset?.pick;
    if (pickPath) {
      const current = formEl.querySelector(`[name="${pickPath}"]`).value;
      const chosen = await window.api.dialog.pickFolder(current);
      if (chosen) formEl.querySelector(`[name="${pickPath}"]`).value = chosen;
    }
  });

  formEl.querySelector("#task-reset")?.addEventListener("click", () => {
    for (const f of fields) {
      const def = pickValue(f.path, defaults) ?? f.default ?? "";
      const input = formEl.querySelector(`[name="${f.path}"]`);
      if (input) {
        if (input.type === "checkbox") input.checked = !!def;
        else input.value = def;
      }
    }
  });

  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const config = {};
    for (const input of formEl.querySelectorAll("input")) {
      const name = input.name;
      if (!name) continue;
      let v;
      if (input.type === "checkbox") v = input.checked;
      else if (input.type === "number") v = parseFloat(input.value);
      else v = input.value;
      setValue(name, config, v);
    }
    await window.api.queue.add({ type: taskType, config });
    await window.api.settings.set({ [`lastConfig.${taskType}`]: config });
  });
}
```

---

## Task 11: Render screen (uses task form template)

**Files:**
- Create: `electron/renderer/screens/render.js`

- [ ] **Step 11.1: Create `screens/render.js`**

```js
import { taskFormShell, bindTaskForm } from "../components/taskForm.js";

export async function renderRender(el) {
  const ws = await window.api.app.getWorkspace();
  const settings = await window.api.settings.get();
  const defaults = {
    inputs: {
      overlays: `${ws}\\overlays`,
      backgrounds: `${ws}\\backgrounds`,
      combined: `${ws}\\combined_videos`,
    },
    output: `${ws}\\done`,
    currentDay: 1,
    videosPerFolder: 5,
    ffmpeg: { useGPU: settings.render.useGPU, encoder: settings.ffmpeg.encoder, maxConcurrent: settings.ffmpeg.maxConcurrent },
    chromaKey: settings.render.chromaKey,
    opacity: settings.render.opacity,
    crop: settings.render.crop,
    keepColor: settings.render.keepColor,
  };
  const lastConfig = settings.lastConfig?.render;

  const fields = [
    { type: "folder", path: "inputs.overlays",    label: "Folder overlays" },
    { type: "folder", path: "inputs.backgrounds", label: "Folder backgrounds" },
    { type: "folder", path: "output",             label: "Folder output" },
    { type: "number", path: "currentDay",         label: "Số ngày", min: 1 },
    { type: "number", path: "videosPerFolder",    label: "Số video / folder", min: 1 },
  ];
  const advanced = [
    { type: "checkbox", path: "ffmpeg.useGPU",      label: "Dùng GPU (NVIDIA/Intel/AMD)" },
    { type: "text",     path: "chromaKey.color",    label: "🎨 ChromaKey color (hex, vd #D4F9D7)" },
    { type: "number",   path: "opacity",            label: "Opacity (0–1)", min: 0 },
  ];

  el.innerHTML = taskFormShell({
    icon: "🎬", title: "Render Video",
    description: "",
    fields, advanced, taskType: "render", lastConfig, defaults,
  });
  bindTaskForm(el.querySelector("#task-form"), { fields: [...fields, ...advanced], taskType: "render", defaults });
}
```

- [ ] **Step 11.2: Smoke-run end-to-end**

Run: `npm run dev`. Workspace already chosen from Task 9. Render screen loads. Form pre-filled from defaults. Pick a different output folder (or accept). Click "▶ Thêm vào hàng đợi". Expected: dock shows the running task with a progress bar; when it errors (because input folders are empty), status flips to error in the queue dock and a toast shows.

(Toasts are added in Task 14. For now, confirm via DevTools console that the IPC `queue:add` resolved with `{jobId}` and a `queue:update` came back.)

---

## Task 12: Remaining 6 task screens

**Files:**
- Create: `electron/renderer/screens/snow.js`
- Create: `electron/renderer/screens/trim.js`
- Create: `electron/renderer/screens/cutBg.js`
- Create: `electron/renderer/screens/thumb.js`
- Create: `electron/renderer/screens/concat.js`
- Create: `electron/renderer/screens/rename.js`

Each screen follows the same pattern as `render.js` — load workspace + settings, define `fields` and (optional) `advanced`, render via `taskFormShell`, bind via `bindTaskForm`.

- [ ] **Step 12.1: Create `screens/snow.js`**

```js
import { taskFormShell, bindTaskForm } from "../components/taskForm.js";

export async function renderSnow(el) {
  const ws = await window.api.app.getWorkspace();
  const s = await window.api.settings.get();
  const defaults = {
    input: `${ws}\\input`, output: `${ws}\\output`,
    snowAsset: "", duration: 12,
  };
  const fields = [
    { type: "folder", path: "input",      label: "Folder ảnh đầu vào" },
    { type: "folder", path: "output",     label: "Folder video output" },
    { type: "text",   path: "snowAsset",  label: "Đường dẫn snow.mov", help: "File snow overlay (.mov hoặc .mp4)" },
    { type: "number", path: "duration",   label: "Thời lượng video (giây)", min: 1 },
  ];
  el.innerHTML = taskFormShell({
    icon: "❄️", title: "Tạo video từ ảnh",
    description: "Tạo video từ ảnh tĩnh + hiệu ứng snow overlay.",
    fields, advanced: [], taskType: "snow", lastConfig: s.lastConfig?.snow, defaults,
  });
  bindTaskForm(el.querySelector("#task-form"), { fields, taskType: "snow", defaults });
}
```

- [ ] **Step 12.2: Create `screens/trim.js`**

```js
import { taskFormShell, bindTaskForm } from "../components/taskForm.js";

export async function renderTrim(el) {
  const ws = await window.api.app.getWorkspace();
  const s = await window.api.settings.get();
  const defaults = { input: `${ws}\\input`, output: `${ws}\\done`, segmentSeconds: 30, replace: false };
  const fields = [
    { type: "folder",   path: "input",          label: "Folder input" },
    { type: "folder",   path: "output",         label: "Folder output" },
    { type: "number",   path: "segmentSeconds", label: "Độ dài segment (giây)", min: 1 },
    { type: "checkbox", path: "replace",        label: "Xoá file gốc sau khi cắt" },
  ];
  el.innerHTML = taskFormShell({
    icon: "✂️", title: "Cắt video 30s",
    description: "Cắt mỗi video trong folder thành các đoạn ngắn (mặc định 30s).",
    fields, advanced: [], taskType: "trim", lastConfig: s.lastConfig?.trim, defaults,
  });
  bindTaskForm(el.querySelector("#task-form"), { fields, taskType: "trim", defaults });
}
```

- [ ] **Step 12.3: Create `screens/cutBg.js`**

```js
import { taskFormShell, bindTaskForm } from "../components/taskForm.js";

export async function renderCutBg(el) {
  const ws = await window.api.app.getWorkspace();
  const s = await window.api.settings.get();
  const defaults = { input: `${ws}\\backgrounds`, output: `${ws}\\backgrounds` };
  const fields = [
    { type: "folder", path: "input",  label: "Folder background" },
    { type: "folder", path: "output", label: "Folder output (có thể trùng)" },
  ];
  el.innerHTML = taskFormShell({
    icon: "🎞️", title: "Chia nhỏ video nền",
    description: "Chia nhỏ video nền dài thành các segment.",
    fields, advanced: [], taskType: "cutBg", lastConfig: s.lastConfig?.cutBg, defaults,
  });
  bindTaskForm(el.querySelector("#task-form"), { fields, taskType: "cutBg", defaults });
}
```

- [ ] **Step 12.4: Create `screens/thumb.js`**

```js
import { taskFormShell, bindTaskForm } from "../components/taskForm.js";

export async function renderThumb(el) {
  const ws = await window.api.app.getWorkspace();
  const s = await window.api.settings.get();
  const defaults = { input: `${ws}\\overlays`, overlays: `${ws}\\overlays_convert`, output: `${ws}\\thumbs` };
  const fields = [
    { type: "folder", path: "input",    label: "Folder thumbnail gốc" },
    { type: "folder", path: "overlays", label: "Folder overlay images" },
    { type: "folder", path: "output",   label: "Folder thumbnail output" },
  ];
  el.innerHTML = taskFormShell({
    icon: "🖼️", title: "Tạo ảnh thu nhỏ",
    description: "Overlay nhiều ảnh lên thumbnail gốc.",
    fields, advanced: [], taskType: "thumb", lastConfig: s.lastConfig?.thumb, defaults,
  });
  bindTaskForm(el.querySelector("#task-form"), { fields, taskType: "thumb", defaults });
}
```

- [ ] **Step 12.5: Create `screens/concat.js`**

```js
import { taskFormShell, bindTaskForm } from "../components/taskForm.js";

export async function renderConcat(el) {
  const ws = await window.api.app.getWorkspace();
  const s = await window.api.settings.get();
  const defaults = {
    thumbsDir: `${ws}\\thumbs`,
    doneDir: `${ws}\\done`,
    output: `${ws}\\output`,
    tempDir: `${ws}\\temp`,
    chunkSize: 2,
    folderName: "",
  };
  const fields = [
    { type: "folder", path: "thumbsDir",  label: "Folder thumbs" },
    { type: "folder", path: "doneDir",    label: "Folder done (input)" },
    { type: "folder", path: "output",     label: "Folder output" },
    { type: "folder", path: "tempDir",    label: "Folder temp" },
    { type: "number", path: "chunkSize",  label: "Kích thước chunk", min: 1 },
    { type: "text",   path: "folderName", label: "Tên folder cụ thể (để trống = chạy tất cả)" },
  ];
  el.innerHTML = taskFormShell({
    icon: "🔗", title: "Ghép video + thumbnail",
    description: "Ghép videos trong từng folder con + thumbnail thành video cuối.",
    fields, advanced: [], taskType: "concat", lastConfig: s.lastConfig?.concat, defaults,
  });
  bindTaskForm(el.querySelector("#task-form"), { fields, taskType: "concat", defaults });
}
```

- [ ] **Step 12.6: Create `screens/rename.js`**

```js
import { taskFormShell, bindTaskForm } from "../components/taskForm.js";

export async function renderRename(el) {
  const ws = await window.api.app.getWorkspace();
  const s = await window.api.settings.get();
  const defaults = { folder: `${ws}\\thumbs` };
  const fields = [
    { type: "folder", path: "folder", label: "Folder cần sửa tên (NFC normalize)" },
  ];
  el.innerHTML = taskFormShell({
    icon: "✏️", title: "Sửa tên thu nhỏ",
    description: "Chuẩn hoá tên file unicode về dạng NFC trên toàn folder (đệ quy).",
    fields, advanced: [], taskType: "rename", lastConfig: s.lastConfig?.rename, defaults,
  });
  bindTaskForm(el.querySelector("#task-form"), { fields, taskType: "rename", defaults });
}
```

- [ ] **Step 12.7: Smoke-run** — `npm run dev`. Click each sidebar item; each screen renders without console error. The form fields differ per task. Don't yet need to run a real task per screen.

---

## Task 13: Queue full screen

**Files:**
- Create: `electron/renderer/screens/queue.js`

- [ ] **Step 13.1: Create `screens/queue.js`**

```js
import { progressBar } from "../components/progressBar.js";
import { showErrorModal } from "../components/modal.js";

export async function renderQueue(el) {
  let unsub;
  const render = async (state) => {
    el.innerHTML = `
      <div class="screen-header">📋 Hàng đợi</div>
      <p class="screen-subtitle">Mỗi lúc chỉ 1 task chạy. Có thể huỷ task đang chạy hoặc đang chờ.</p>
      <h3>⏳ Đang chạy</h3>
      ${state.running ? `
        <div class="queue-item">
          <span class="label">${labelFor(state.running.type)} <span style="color:var(--muted)">${state.running.message ?? ""}</span></span>
          ${progressBar(state.running.progress)}
          <button data-cancel="${state.running.id}" class="danger">✕ Huỷ</button>
        </div>` : `<p style="color:var(--muted)">Không có task nào đang chạy.</p>`}
      <h3>⏸ Đang chờ (${state.pending.length})</h3>
      ${state.pending.map((j) => `
        <div class="queue-item">
          <span class="label">${labelFor(j.type)}</span>
          <button data-cancel="${j.id}" class="danger">✕</button>
        </div>`).join("") || `<p style="color:var(--muted)">Không có task nào đang chờ.</p>`}
      <h3>✅ Đã hoàn thành (${state.completed.length}) <button id="queue-clear" style="font-weight:normal">Xoá lịch sử</button></h3>
      ${state.completed.map((j) => `
        <div class="queue-item">
          <span class="label">${statusIcon(j.status)} ${labelFor(j.type)} <span style="color:var(--muted)">${ago(j.createdAt)}</span></span>
          ${j.status === "done" && j.result?.outputs?.[0] ? `<button data-open="${escapeAttr(path(j.result.outputs[0]))}">📂 Mở folder</button>` : ""}
          ${j.status === "error" ? `<button data-error="${j.id}">Chi tiết lỗi</button>` : ""}
        </div>`).join("") || `<p style="color:var(--muted)">Lịch sử trống.</p>`}
    `;

    el.querySelector("#queue-clear")?.addEventListener("click", () => window.api.queue.clear());
  };

  el.addEventListener("click", (e) => {
    const id = e.target.dataset?.cancel;
    if (id) window.api.queue.cancel(id);
    const folder = e.target.dataset?.open;
    if (folder) window.api.shell.openFolder(folder);
    const errId = e.target.dataset?.error;
    if (errId) {
      window.api.queue.getState().then((s) => {
        const job = s.completed.find((j) => j.id === errId);
        if (job?.error) showErrorModal({ summary: `Task ${labelFor(job.type)} thất bại`, error: job.error });
      });
    }
  });

  const initial = await window.api.queue.getState();
  await render(initial);
  unsub = window.api.queue.onUpdate(render);
  // unsub on screen unmount: simple approach is to leave listeners; sidebar swap clears innerHTML.
}

const LABELS = { render: "Render Video", snow: "Snow", trim: "Trim", cutBg: "Cut BG", thumb: "Thumb", concat: "Concat", rename: "Rename" };
function labelFor(t) { return LABELS[t] || t; }
function statusIcon(s) { return ({ done: "✅", error: "❌", cancelled: "🚫" })[s] || "•"; }
function ago(ts) {
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s trước`;
  if (sec < 3600) return `${Math.round(sec / 60)} phút trước`;
  return `${Math.round(sec / 3600)} giờ trước`;
}
function path(filePath) {
  return filePath.replace(/[/\\][^/\\]+$/, "");
}
function escapeAttr(s) { return String(s).replace(/"/g, "&quot;"); }
```

- [ ] **Step 13.2: Smoke-run** — open Queue screen via sidebar. Submit a task from another screen; come back to Queue; see it running.

---

## Task 14: Settings screen + toast notifications on completion

**Files:**
- Create: `electron/renderer/screens/settings.js`
- Modify: `electron/renderer/main.js` (add toast on queue completion)

- [ ] **Step 14.1: Create `screens/settings.js`**

```js
export async function renderSettings(el) {
  const s = await window.api.settings.get();
  const version = await window.api.app.getVersion();

  el.innerHTML = `
    <div class="screen-header">⚙️ Cài đặt</div>

    <div class="field">
      <label>Workspace</label>
      <div class="field-row">
        <input id="ws" type="text" readonly value="${s.workspace || ""}">
        <button id="ws-pick">📂 Đổi…</button>
      </div>
      <div class="help">Nơi chứa các thư mục input/output mặc định.</div>
    </div>

    <h3>FFmpeg</h3>
    <div class="field">
      <label>Encoder</label>
      <select id="encoder">
        ${["auto","libx264","h264_nvenc","h264_qsv","h264_amf"].map((v) =>
          `<option value="${v}" ${v === s.ffmpeg.encoder ? "selected" : ""}>${v}</option>`).join("")}
      </select>
    </div>
    <div class="field">
      <label>Số luồng tối đa</label>
      <input id="maxConcurrent" type="number" min="1" value="${s.ffmpeg.maxConcurrent}">
    </div>

    <h3>Render defaults</h3>
    <div class="field"><label><input id="useGPU" type="checkbox" ${s.render.useGPU ? "checked" : ""}> Dùng GPU mặc định</label></div>
    <div class="field"><label>ChromaKey color</label><input id="chromaColor" type="text" value="${s.render.chromaKey.color}"></div>
    <div class="field"><label>Opacity (0–1)</label><input id="opacity" type="number" step="0.05" min="0" max="1" value="${s.render.opacity}"></div>
    <div class="field"><label>Crop height</label><input id="cropHeight" type="number" min="1" value="${s.render.crop.height}"></div>
    <div class="field"><label>Crop yOffset</label><input id="cropYOffset" type="number" min="0" value="${s.render.crop.yOffset}"></div>

    <h3>Log</h3>
    <div class="field">
      <label>Mức log</label>
      <select id="logLevel">
        ${["error","warn","info","debug"].map((v) =>
          `<option value="${v}" ${v === s.ui.logLevel ? "selected" : ""}>${v}</option>`).join("")}
      </select>
    </div>
    <button id="open-log">Mở file log</button>

    <h3 style="margin-top:32px">About</h3>
    <p>Version: <strong>${version}</strong></p>
    <button id="reset" class="danger">Reset tất cả về mặc định</button>
  `;

  el.querySelector("#ws-pick").addEventListener("click", async () => {
    const p = await window.api.dialog.pickFolder(s.workspace);
    if (p) {
      await window.api.app.ensureWorkspace(p);
      await window.api.settings.set({ workspace: p });
      el.querySelector("#ws").value = p;
    }
  });
  el.querySelector("#encoder").addEventListener("change", (e) =>
    window.api.settings.set({ "ffmpeg.encoder": e.target.value }));
  el.querySelector("#maxConcurrent").addEventListener("change", (e) =>
    window.api.settings.set({ "ffmpeg.maxConcurrent": parseInt(e.target.value, 10) }));
  el.querySelector("#useGPU").addEventListener("change", (e) =>
    window.api.settings.set({ "render.useGPU": e.target.checked }));
  el.querySelector("#chromaColor").addEventListener("change", (e) =>
    window.api.settings.set({ "render.chromaKey.color": e.target.value }));
  el.querySelector("#opacity").addEventListener("change", (e) =>
    window.api.settings.set({ "render.opacity": parseFloat(e.target.value) }));
  el.querySelector("#cropHeight").addEventListener("change", (e) =>
    window.api.settings.set({ "render.crop.height": parseInt(e.target.value, 10) }));
  el.querySelector("#cropYOffset").addEventListener("change", (e) =>
    window.api.settings.set({ "render.crop.yOffset": parseInt(e.target.value, 10) }));
  el.querySelector("#logLevel").addEventListener("change", (e) =>
    window.api.settings.set({ "ui.logLevel": e.target.value }));
  el.querySelector("#open-log").addEventListener("click", () => window.api.shell.openLogFile());
  el.querySelector("#reset").addEventListener("click", async () => {
    if (confirm("Reset toàn bộ cài đặt về mặc định? (Workspace path sẽ giữ nguyên)")) {
      const ws = (await window.api.settings.get("workspace")) || "";
      await window.api.settings.set({ /* defaults to be re-applied via clearing settings */ });
      // Simplest: re-set known keys to default values explicitly:
      await window.api.settings.set({
        ffmpeg: { encoder: "auto", maxConcurrent: 2 },
        render: {
          useGPU: false, chromaKey: { color: "#D4F9D7", similarity: 0.2 },
          opacity: 0.7, crop: { height: 220, yOffset: 490 },
          keepColor: { enabled: false, list: ["#FBFF02"] },
        },
        ui: { theme: "light", logLevel: "info", completedHistorySize: 50 },
        workspace: ws,
      });
      renderSettings(el);
    }
  });
}
```

- [ ] **Step 14.2: Add toast notifications**

Modify `electron/renderer/main.js`. Add at the top of the file, after the imports:

```js
const toastContainer = document.createElement("div");
toastContainer.className = "toast-container";
document.body.appendChild(toastContainer);

function toast({ message, kind = "success", onClick }) {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  if (onClick) el.addEventListener("click", onClick);
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}
```

Add at the bottom of the file (or after `bootstrap()` is defined):

```js
const completedSeen = new Set();
window.api.queue.onUpdate((state) => {
  for (const j of state.completed) {
    if (completedSeen.has(j.id)) continue;
    completedSeen.add(j.id);
    if (j.status === "done") {
      toast({ message: `✅ ${labelOf(j.type)} hoàn thành`, kind: "success",
              onClick: () => j.result?.outputs?.[0] && window.api.shell.openFolder(j.result.outputs[0].replace(/[/\\][^/\\]+$/, "")) });
    } else if (j.status === "error") {
      import("./components/modal.js").then(({ showErrorModal }) =>
        showErrorModal({ summary: `Task ${labelOf(j.type)} thất bại`, error: j.error }));
    }
  }
});

const TASK_LABELS = { render: "Render Video", snow: "Snow", trim: "Trim", cutBg: "Cut BG", thumb: "Thumb", concat: "Concat", rename: "Rename" };
function labelOf(t) { return TASK_LABELS[t] || t; }
```

---

## Task 15: End-to-end smoke + Plan 2 done criteria

- [ ] **Step 15.1: Run `npm test`**

Expected: 42 tests pass (29 from Plan 1 + 4 settings + 4 workspace + 5 queue).

- [ ] **Step 15.2: Run `npm run dev` and walk through every screen**

Manual checklist:
- [ ] App boots; if `workspace` empty, onboarding appears; otherwise Render screen.
- [ ] Sidebar shows 7 task items + Queue + Settings.
- [ ] Click each task screen → form renders, no console errors.
- [ ] Click Queue → empty state shown when no jobs.
- [ ] Click Settings → all fields populated; changing workspace works.
- [ ] Submit a Rename task on a real folder containing a NFD-named file. The task:
  - appears in queue dock with progress
  - completes
  - moves to "Đã hoàn thành" in Queue screen
  - emits a toast
  - file rename is correct
- [ ] Submit a task that errors (e.g., Render with empty folders). Error modal opens automatically; "Copy log" / "Mở file log" buttons work.
- [ ] Cancel a long-running task (e.g., Trim on a real video). Status flips to "cancelled" within a couple of seconds.

- [ ] **Step 15.3: Plan 2 done criteria**

- [ ] All 38 Vitest tests pass.
- [ ] `npm run dev` boots without main-process or DevTools console errors.
- [ ] All 9 sidebar screens render without errors.
- [ ] At least one task (Rename) runs end-to-end through the queue.
- [ ] Cancel works on at least one running task.
- [ ] Error modal opens automatically when a task fails.
- [ ] Settings persist across app restarts.

If any item fails, capture details and report DONE_WITH_CONCERNS.
