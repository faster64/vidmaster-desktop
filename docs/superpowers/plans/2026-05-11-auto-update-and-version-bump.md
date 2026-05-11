# Auto-Update on Startup + Version Bump on Build — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make VidMaster check GitHub Releases for a newer version on every launch, force-install if found, and auto-bump `package.json` patch on every build.

**Architecture:** Renderer mounts a blocking "Đang kiểm tra cập nhật..." screen first. It talks to a thin `electron/updater.js` wrapper in main that drives `electron-updater`'s `autoUpdater` with a 10-second timeout. If a newer version is published on GitHub Releases, it auto-downloads and runs the NSIS installer. Workspace/Telegram/yt-dlp setup is deferred until renderer signals "proceed". A pre-build npm hook (`scripts/bump-version.mjs`) increments the patch number and `electron-builder`'s `publish: github` config uploads `latest.yml` + installer.

**Tech Stack:** Electron 30, `electron-updater` 6.x, `electron-builder` 25, vitest, NSIS, GitHub Releases.

**Reference spec:** [`docs/superpowers/specs/2026-05-11-auto-update-and-version-bump-design.md`](../specs/2026-05-11-auto-update-and-version-bump-design.md)

---

## File Structure

**New files:**
- `scripts/bump-version.mjs` — pure node, exports `bumpPatch(version)` + CLI entry
- `scripts/bump-version.test.mjs` — vitest tests for `bumpPatch`
- `electron/updater.js` — `createUpdater({ webContents, log })` wrapper with state machine + timeout
- `electron/updater.test.js` — vitest tests with mocked `electron-updater`
- `electron/ipc/updater.js` — IPC registration (`updater:check`, `updater:proceed`)
- `electron/renderer/screens/updateCheck.js` — full-screen UI for the check stage

**Modified files:**
- `package.json` — scripts (`bump`, `prebuild`, `prerelease`, `release`), `publish` config, `electron-updater` dep
- `electron/preload.mjs` — expose `window.api.updater`
- `electron/main.js` — register updater IPC, defer post-update bootstrap
- `electron/renderer/main.js` — mount update screen first, gate normal bootstrap
- `electron/renderer/styles.css` — styles for `.update-check` layout

Each file has one responsibility. `electron/updater.js` hides the `electron-updater` package so the rest of main never imports it directly.

---

## Task 1: Install electron-updater + configure publish

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install electron-updater**

Run:
```bash
npm install electron-updater@^6
```

Expected: package added under `dependencies`, no peer warnings.

- [ ] **Step 2: Add publish config and scripts to `package.json`**

Edit [package.json](../../package.json):

Inside the `"scripts"` object, add `bump`, `prebuild`, `prerelease`, `release`. The final `"scripts"` block must look like:

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "dev": "electron .",
  "bump": "node scripts/bump-version.mjs",
  "prebuild": "npm run bump",
  "build": "electron-builder --win --x64",
  "prerelease": "npm run bump",
  "release": "electron-builder --win --x64 --publish always",
  "build:dir": "electron-builder --dir"
},
```

Inside the `"build"` object (sibling of `"appId"`, `"productName"`, etc.), add:

```json
"publish": [
  { "provider": "github", "owner": "faster64", "repo": "vidmaster-desktop" }
],
```

- [ ] **Step 3: Verify install resolves**

Run:
```bash
npm ls electron-updater
```

Expected: shows `electron-updater@6.x.x` with no missing dependency warnings.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(updater): add electron-updater + GitHub publish config"
```

---

## Task 2: Pure bump-version logic (TDD)

**Files:**
- Create: `scripts/bump-version.mjs`
- Test: `scripts/bump-version.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/bump-version.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { bumpPatch } from "./bump-version.mjs";

describe("bumpPatch", () => {
  it("increments patch on 0.1.0", () => {
    expect(bumpPatch("0.1.0")).toBe("0.1.1");
  });

  it("increments patch on 1.0.0", () => {
    expect(bumpPatch("1.0.0")).toBe("1.0.1");
  });

  it("does not overflow into minor on 0.1.9", () => {
    expect(bumpPatch("0.1.9")).toBe("0.1.10");
  });

  it("handles two-digit patch", () => {
    expect(bumpPatch("2.3.99")).toBe("2.3.100");
  });

  it("throws on non-semver input", () => {
    expect(() => bumpPatch("abc")).toThrow(/Cannot parse version/);
  });

  it("throws on missing segment", () => {
    expect(() => bumpPatch("1.2")).toThrow(/Cannot parse version/);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run:
```bash
npx vitest run scripts/bump-version.test.mjs
```

Expected: FAIL — module cannot be resolved.

- [ ] **Step 3: Create the implementation**

Create `scripts/bump-version.mjs`:

```js
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";

export function bumpPatch(version) {
  const parts = version.split(".");
  if (parts.length !== 3) throw new Error(`Cannot parse version: ${version}`);
  const [maj, min, pat] = parts.map(Number);
  if ([maj, min, pat].some(Number.isNaN)) {
    throw new Error(`Cannot parse version: ${version}`);
  }
  return `${maj}.${min}.${pat + 1}`;
}

// CLI entry — only runs when invoked directly, not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = "package.json";
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  pkg.version = bumpPatch(pkg.version);
  writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`Version bumped → ${pkg.version}`);
}
```

- [ ] **Step 4: Run test, verify it passes**

Run:
```bash
npx vitest run scripts/bump-version.test.mjs
```

Expected: PASS — 6 tests pass.

- [ ] **Step 5: Smoke-test the CLI**

Run:
```bash
node scripts/bump-version.mjs
```

Expected: prints `Version bumped → 0.1.1` (or one higher than the current version). `package.json` `version` field has been updated.

Revert the bump (we don't want it in this commit):
```bash
git checkout package.json
```

- [ ] **Step 6: Commit**

```bash
git add scripts/bump-version.mjs scripts/bump-version.test.mjs
git commit -m "feat(build): add bump-version script with tests"
```

---

## Task 3: Updater wrapper state machine (TDD)

**Files:**
- Create: `electron/updater.js`
- Test: `electron/updater.test.js`

The wrapper exposes:
```js
createUpdater({ send, log, isPackaged })
  → { check(), dispose() }
```

`send(event)` is a function the wrapper calls to push events to the renderer. In production main.js will pass `(event) => webContents.send("updater:event", event)`. In tests we inject a spy.

- [ ] **Step 1: Write failing tests**

Create `electron/updater.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

// We'll mock electron-updater. The wrapper imports autoUpdater from it.
const autoUpdaterMock = {
  on: vi.fn(),
  removeAllListeners: vi.fn(),
  checkForUpdates: vi.fn(),
  quitAndInstall: vi.fn(),
  autoDownload: true,
  autoInstallOnAppQuit: true,
};

vi.mock("electron-updater", () => ({ autoUpdater: autoUpdaterMock }));

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

async function loadFresh() {
  vi.resetModules();
  return (await import("./updater.js")).createUpdater;
}

beforeEach(() => {
  Object.values(autoUpdaterMock).forEach((v) => typeof v === "function" && v.mockReset?.());
  autoUpdaterMock.on.mockImplementation(() => {});
});

describe("createUpdater", () => {
  it("short-circuits in dev mode (isPackaged=false)", async () => {
    const create = await loadFresh();
    const send = vi.fn();
    const updater = create({ send, log: silentLog, isPackaged: false });
    await updater.check();
    expect(send).toHaveBeenCalledWith({ type: "not-available", currentVersion: expect.any(String) });
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();
  });

  it("emits checking then forwards update-not-available", async () => {
    const create = await loadFresh();
    const send = vi.fn();
    const handlers = {};
    autoUpdaterMock.on.mockImplementation((event, cb) => { handlers[event] = cb; });
    autoUpdaterMock.checkForUpdates.mockResolvedValue({});
    const updater = create({ send, log: silentLog, isPackaged: true });
    await updater.check();
    expect(send).toHaveBeenCalledWith({ type: "checking" });
    handlers["update-not-available"]({ version: "0.1.0" });
    expect(send).toHaveBeenCalledWith({ type: "not-available", currentVersion: expect.any(String) });
  });

  it("forwards update-available, download-progress, and downloaded events", async () => {
    const create = await loadFresh();
    const send = vi.fn();
    const handlers = {};
    autoUpdaterMock.on.mockImplementation((event, cb) => { handlers[event] = cb; });
    autoUpdaterMock.checkForUpdates.mockResolvedValue({});
    const updater = create({ send, log: silentLog, isPackaged: true });
    await updater.check();

    handlers["update-available"]({ version: "0.1.5" });
    expect(send).toHaveBeenCalledWith({ type: "available", currentVersion: expect.any(String), nextVersion: "0.1.5" });

    handlers["download-progress"]({ percent: 42.7, bytesPerSecond: 1500000, transferred: 500, total: 1000 });
    expect(send).toHaveBeenCalledWith({
      type: "download-progress",
      percent: 42.7,
      bytesPerSecond: 1500000,
      transferred: 500,
      total: 1000,
    });

    handlers["update-downloaded"]({ version: "0.1.5" });
    expect(send).toHaveBeenCalledWith({ type: "downloaded", nextVersion: "0.1.5" });
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalled();
  });

  it("emits timeout error when no event arrives within 10s", async () => {
    vi.useFakeTimers();
    const create = await loadFresh();
    const send = vi.fn();
    autoUpdaterMock.on.mockImplementation(() => {});
    autoUpdaterMock.checkForUpdates.mockResolvedValue({});
    const updater = create({ send, log: silentLog, isPackaged: true });
    await updater.check();
    vi.advanceTimersByTime(10_000);
    expect(send).toHaveBeenCalledWith({ type: "error", code: "timeout", message: expect.any(String) });
    vi.useRealTimers();
  });

  it("forwards autoUpdater error event with code: unknown by default", async () => {
    const create = await loadFresh();
    const send = vi.fn();
    const handlers = {};
    autoUpdaterMock.on.mockImplementation((event, cb) => { handlers[event] = cb; });
    autoUpdaterMock.checkForUpdates.mockResolvedValue({});
    const updater = create({ send, log: silentLog, isPackaged: true });
    await updater.check();
    handlers["error"](new Error("boom"));
    expect(send).toHaveBeenCalledWith({ type: "error", code: "unknown", message: "boom" });
  });

  it("classifies network errors", async () => {
    const create = await loadFresh();
    const send = vi.fn();
    const handlers = {};
    autoUpdaterMock.on.mockImplementation((event, cb) => { handlers[event] = cb; });
    autoUpdaterMock.checkForUpdates.mockResolvedValue({});
    const updater = create({ send, log: silentLog, isPackaged: true });
    await updater.check();
    const err = new Error("getaddrinfo ENOTFOUND github.com");
    err.code = "ENOTFOUND";
    handlers["error"](err);
    expect(send).toHaveBeenCalledWith({ type: "error", code: "network", message: expect.stringContaining("ENOTFOUND") });
  });

  it("dispose() cancels the pending timeout", async () => {
    vi.useFakeTimers();
    const create = await loadFresh();
    const send = vi.fn();
    autoUpdaterMock.on.mockImplementation(() => {});
    autoUpdaterMock.checkForUpdates.mockResolvedValue({});
    const updater = create({ send, log: silentLog, isPackaged: true });
    await updater.check();
    updater.dispose();
    vi.advanceTimersByTime(15_000);
    const errorCalls = send.mock.calls.filter(([e]) => e.type === "error");
    expect(errorCalls).toHaveLength(0);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run:
```bash
npx vitest run electron/updater.test.js
```

Expected: FAIL — `electron/updater.js` doesn't exist.

- [ ] **Step 3: Implement the wrapper**

Create `electron/updater.js`:

```js
import { autoUpdater } from "electron-updater";
import { app } from "electron";

const TIMEOUT_MS = 10_000;

function classifyError(err) {
  const msg = err?.message || String(err);
  const code = err?.code || "";
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN/.test(code) || /ENOTFOUND|getaddrinfo/.test(msg)) {
    return "network";
  }
  if (/rate limit|API rate/i.test(msg)) return "rate-limit";
  if (/signature|checksum|sha512/i.test(msg)) return "signature";
  return "unknown";
}

export function createUpdater({ send, log, isPackaged }) {
  let timeoutHandle = null;
  let disposed = false;

  const currentVersion = app?.getVersion?.() ?? "0.0.0";

  function clearPendingTimeout() {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  }

  function safeSend(event) {
    if (disposed) return;
    try { send(event); } catch (err) { log.warn(`updater send failed: ${err.message}`); }
  }

  function attachListeners() {
    autoUpdater.on("checking-for-update", () => log.info("updater: checking-for-update"));

    autoUpdater.on("update-not-available", () => {
      clearPendingTimeout();
      log.info(`updater: up to date (v${currentVersion})`);
      safeSend({ type: "not-available", currentVersion });
    });

    autoUpdater.on("update-available", (info) => {
      clearPendingTimeout();
      log.info(`updater: available v${info?.version}`);
      safeSend({ type: "available", currentVersion, nextVersion: info?.version });
    });

    autoUpdater.on("download-progress", (p) => {
      safeSend({
        type: "download-progress",
        percent: p?.percent ?? 0,
        bytesPerSecond: p?.bytesPerSecond ?? 0,
        transferred: p?.transferred ?? 0,
        total: p?.total ?? 0,
      });
    });

    autoUpdater.on("update-downloaded", (info) => {
      log.info(`updater: downloaded v${info?.version}`);
      safeSend({ type: "downloaded", nextVersion: info?.version });
      try { autoUpdater.quitAndInstall(); } catch (err) {
        log.error(`quitAndInstall failed: ${err.message}`);
        safeSend({ type: "error", code: "unknown", message: err.message });
      }
    });

    autoUpdater.on("error", (err) => {
      clearPendingTimeout();
      const code = classifyError(err);
      log.warn(`updater error (${code}): ${err?.message}`);
      safeSend({ type: "error", code, message: err?.message || "Unknown error" });
    });
  }

  attachListeners();

  return {
    async check() {
      if (disposed) return;

      if (!isPackaged) {
        log.info("updater: dev mode, skipping check");
        safeSend({ type: "not-available", currentVersion });
        return;
      }

      safeSend({ type: "checking" });

      clearPendingTimeout();
      timeoutHandle = setTimeout(() => {
        timeoutHandle = null;
        log.warn("updater: check timed out");
        safeSend({ type: "error", code: "timeout", message: "Quá thời gian kiểm tra (10s)" });
      }, TIMEOUT_MS);

      try {
        await autoUpdater.checkForUpdates();
      } catch (err) {
        clearPendingTimeout();
        const code = classifyError(err);
        log.warn(`updater checkForUpdates threw (${code}): ${err?.message}`);
        safeSend({ type: "error", code, message: err?.message || "Unknown error" });
      }
    },

    dispose() {
      disposed = true;
      clearPendingTimeout();
      autoUpdater.removeAllListeners();
    },
  };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run:
```bash
npx vitest run electron/updater.test.js
```

Expected: PASS — 7 tests pass.

- [ ] **Step 5: Run full suite to confirm no regressions**

Run:
```bash
npm test
```

Expected: all tests green.

- [ ] **Step 6: Commit**

```bash
git add electron/updater.js electron/updater.test.js
git commit -m "feat(updater): wrap electron-updater with timeout + classified errors"
```

---

## Task 4: Updater IPC channel

**Files:**
- Create: `electron/ipc/updater.js`

- [ ] **Step 1: Create the IPC registration module**

Create `electron/ipc/updater.js`:

```js
import { ipcMain, app } from "electron";
import log from "electron-log";
import { createUpdater } from "../updater.js";

export function registerUpdaterIpc(getMainWindow, { onProceed }) {
  let updater = null;
  let proceedFired = false;

  function send(event) {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send("updater:event", event);
  }

  ipcMain.handle("updater:check", () => {
    if (!updater) {
      updater = createUpdater({ send, log, isPackaged: app.isPackaged });
    }
    updater.check();
    return true;
  });

  ipcMain.handle("updater:proceed", () => {
    if (proceedFired) return false;
    proceedFired = true;
    if (updater) updater.dispose();
    try { onProceed(); } catch (err) { log.error(`onProceed failed: ${err.message}`); }
    return true;
  });
}
```

- [ ] **Step 2: Verify file is syntactically valid**

Run:
```bash
node --check electron/ipc/updater.js
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add electron/ipc/updater.js
git commit -m "feat(updater): add IPC channels for check + proceed"
```

---

## Task 5: Expose updater bridge in preload

**Files:**
- Modify: `electron/preload.mjs`

- [ ] **Step 1: Add updater event subscriber + API**

Edit [electron/preload.mjs](../../electron/preload.mjs):

Replace the `subscribers` constant and the two `ipcRenderer.on(...)` lines just below it with:

```js
const subscribers = {
  "queue:update": new Set(),
  "settings:change": new Set(),
  "updater:event": new Set(),
};
ipcRenderer.on("queue:update", (_, s) => subscribers["queue:update"].forEach((cb) => cb(s)));
ipcRenderer.on("settings:change", (_, s) => subscribers["settings:change"].forEach((cb) => cb(s)));
ipcRenderer.on("updater:event", (_, e) => subscribers["updater:event"].forEach((cb) => cb(e)));
```

Inside the `contextBridge.exposeInMainWorld("api", { ... })` object, add a new `updater` property as a sibling of `app`:

```js
updater: {
  check: () => ipcRenderer.invoke("updater:check"),
  proceed: () => ipcRenderer.invoke("updater:proceed"),
  onEvent: (cb) => { subscribers["updater:event"].add(cb); return () => subscribers["updater:event"].delete(cb); },
},
```

- [ ] **Step 2: Verify file parses**

Run:
```bash
node --check electron/preload.mjs
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add electron/preload.mjs
git commit -m "feat(updater): expose updater bridge in preload"
```

---

## Task 6: Update check screen UI

**Files:**
- Create: `electron/renderer/screens/updateCheck.js`
- Modify: `electron/renderer/styles.css`

- [ ] **Step 1: Add CSS for the update-check stage**

Edit [electron/renderer/styles.css](../../electron/renderer/styles.css). Append at the bottom of the file:

```css
.update-check {
  position: fixed; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: var(--bg, #1e1e1e); color: var(--fg, #eee);
  font-family: system-ui, sans-serif;
  z-index: 10000;
  padding: 32px;
  text-align: center;
}
.update-check__logo { font-size: 32px; font-weight: 700; margin-bottom: 24px; letter-spacing: 1px; }
.update-check__status { font-size: 16px; margin-bottom: 16px; min-height: 24px; }
.update-check__sub { font-size: 13px; opacity: 0.7; margin-bottom: 16px; min-height: 18px; }
.update-check__spinner {
  width: 28px; height: 28px; border: 3px solid #555; border-top-color: #4a9eff;
  border-radius: 50%; animation: uc-spin 0.8s linear infinite; margin: 8px 0;
}
@keyframes uc-spin { to { transform: rotate(360deg); } }
.update-check__progress {
  width: 320px; height: 8px; background: #333; border-radius: 4px; overflow: hidden; margin: 8px 0;
}
.update-check__bar { height: 100%; background: #4a9eff; transition: width 200ms linear; width: 0%; }
.update-check__actions { display: flex; gap: 12px; margin-top: 16px; }
.update-check__btn {
  padding: 8px 20px; border-radius: 4px; border: 1px solid #555; background: #2a2a2a; color: #eee;
  cursor: pointer; font-size: 14px;
}
.update-check__btn:hover { background: #353535; }
.update-check__btn--primary { background: #4a9eff; border-color: #4a9eff; }
.update-check__btn--primary:hover { background: #5fa8ff; }
```

- [ ] **Step 2: Create the screen module**

Create `electron/renderer/screens/updateCheck.js`:

```js
const ERROR_MESSAGES = {
  timeout: "Không kiểm tra được cập nhật (quá thời gian)",
  network: "Không kết nối được tới máy chủ cập nhật (network)",
  "rate-limit": "GitHub giới hạn truy cập, vui lòng thử lại sau (rate-limit)",
  signature: "Bản cập nhật không hợp lệ (signature)",
  unknown: "Có lỗi khi kiểm tra cập nhật",
};

const AUTO_CONTINUE_MS = 5000;

function formatSpeed(bps) {
  if (!bps) return "";
  const mbps = bps / (1024 * 1024);
  if (mbps >= 1) return `${mbps.toFixed(1)} MB/s`;
  const kbps = bps / 1024;
  return `${kbps.toFixed(0)} KB/s`;
}

export function mountUpdateCheck(root, { onProceed }) {
  root.innerHTML = `
    <div class="update-check">
      <div class="update-check__logo">VidMaster</div>
      <div class="update-check__status" data-status>Đang kiểm tra cập nhật...</div>
      <div class="update-check__spinner" data-spinner></div>
      <div class="update-check__progress" data-progress-wrap hidden>
        <div class="update-check__bar" data-bar></div>
      </div>
      <div class="update-check__sub" data-sub></div>
      <div class="update-check__actions" data-actions hidden>
        <button class="update-check__btn update-check__btn--primary" data-retry>Thử lại</button>
        <button class="update-check__btn" data-continue>Tiếp tục dùng app</button>
      </div>
    </div>
  `;

  const $status = root.querySelector("[data-status]");
  const $sub = root.querySelector("[data-sub]");
  const $spinner = root.querySelector("[data-spinner]");
  const $progressWrap = root.querySelector("[data-progress-wrap]");
  const $bar = root.querySelector("[data-bar]");
  const $actions = root.querySelector("[data-actions]");
  const $retry = root.querySelector("[data-retry]");
  const $continue = root.querySelector("[data-continue]");

  let unsubscribe = null;
  let autoContinueTimer = null;
  let proceeded = false;

  function clearAutoContinue() {
    if (autoContinueTimer) { clearTimeout(autoContinueTimer); autoContinueTimer = null; }
  }

  function showError(code) {
    clearAutoContinue();
    $status.textContent = ERROR_MESSAGES[code] || ERROR_MESSAGES.unknown;
    $sub.textContent = `(${code})`;
    $spinner.hidden = true;
    $progressWrap.hidden = true;
    $actions.hidden = false;
    autoContinueTimer = setTimeout(() => { doProceed(); }, AUTO_CONTINUE_MS);
  }

  function showChecking() {
    $status.textContent = "Đang kiểm tra cập nhật...";
    $sub.textContent = "";
    $spinner.hidden = false;
    $progressWrap.hidden = true;
    $actions.hidden = true;
  }

  function showAvailable(currentVersion, nextVersion) {
    clearAutoContinue();
    $status.textContent = `Đã có bản v${nextVersion}. Đang tải...`;
    $sub.textContent = `Hiện tại: v${currentVersion}`;
    $spinner.hidden = true;
    $progressWrap.hidden = false;
    $actions.hidden = true;
    $bar.style.width = "0%";
  }

  function showProgress(percent, bps) {
    const p = Math.max(0, Math.min(100, percent || 0));
    $bar.style.width = `${p}%`;
    $sub.textContent = `${p.toFixed(0)}%  ${formatSpeed(bps)}`;
  }

  function showDownloaded(nextVersion) {
    $status.textContent = `Đang cài đặt v${nextVersion}...`;
    $sub.textContent = "App sẽ khởi động lại sau khi cài xong.";
    $spinner.hidden = false;
    $progressWrap.hidden = true;
    $actions.hidden = true;
  }

  async function doProceed() {
    if (proceeded) return;
    proceeded = true;
    clearAutoContinue();
    if (unsubscribe) unsubscribe();
    await window.api.updater.proceed();
    onProceed();
  }

  $retry.addEventListener("click", () => {
    showChecking();
    window.api.updater.check();
  });

  $continue.addEventListener("click", () => { doProceed(); });

  unsubscribe = window.api.updater.onEvent((event) => {
    switch (event.type) {
      case "checking": showChecking(); break;
      case "not-available": doProceed(); break;
      case "available": showAvailable(event.currentVersion, event.nextVersion); break;
      case "download-progress": showProgress(event.percent, event.bytesPerSecond); break;
      case "downloaded": showDownloaded(event.nextVersion); break;
      case "error": showError(event.code); break;
    }
  });

  window.api.updater.check();
}
```

- [ ] **Step 3: Commit**

```bash
git add electron/renderer/screens/updateCheck.js electron/renderer/styles.css
git commit -m "feat(updater): full-screen update check stage UI"
```

---

## Task 7: Wire updater into main process startup

**Files:**
- Modify: `electron/main.js`

The current main.js runs workspace/Telegram/yt-dlp synchronously inside `whenReady`. We must move them into a `bootstrapAfterUpdateCheck` function called only when `onProceed` fires.

- [ ] **Step 1: Replace `whenReady` body**

Edit [electron/main.js](../../electron/main.js). Replace the entire `app.whenReady().then(async () => { ... })` block with:

```js
app.whenReady().then(async () => {
  const settings = registerSettingsIpc(getMainWindow);
  if (settings.get("ffmpeg.encoder") === "auto") {
    const picked = await detectEncoder();
    settings.set({ "ffmpeg.encoder": picked });
    log.info(`Detected ffmpeg encoder: ${picked}`);
  }
  const queue = registerQueueIpc(getMainWindow, () => settings);
  registerLogIpc(() => queue);
  registerDialogIpc();
  registerShellIpc(() => log.transports.file.getFile().path);
  registerAppIpc(() => settings);
  registerFsIpc();
  registerYtdlpIpc(() => settings, () => queue);

  registerUpdaterIpc(getMainWindow, {
    onProceed: () => bootstrapAfterUpdateCheck(settings),
  });

  createWindow();
});

function bootstrapAfterUpdateCheck(settings) {
  const ws = settings.get("workspace");
  if (ws && existsSync(ws)) {
    try {
      ensureWorkspace(ws);
    } catch (err) {
      log.warn(`ensureWorkspace failed on startup: ${err.message}`);
    }
  }

  const tg = settings.get("telegram") || {};
  const identity = (settings.get("tracking.identifier") || "").trim() || workspaceName(ws);
  sendTelegram({ token: tg.token, chatId: tg.trackingChatId, message: `<pre>${identity}</pre>` })
    .then((r) => { if (!r.ok) log.warn(`Telegram start ping failed: ${r.error || r.status}`); })
    .catch((err) => log.warn(`Telegram start ping error: ${err.message}`));

  if (settings.get("download.autoUpdateYtDlp")) {
    const ytdlpPath = settings.get("download.ytdlpPath");
    if (existsSync(ytdlpPath)) {
      updateBinary({ targetPath: ytdlpPath })
        .then(() => log.info("yt-dlp.exe updated on startup"))
        .catch((err) => log.warn("yt-dlp auto-update failed:", err.message));
    }
  }
}
```

- [ ] **Step 2: Add the import for `registerUpdaterIpc`**

In the import block at the top of [electron/main.js](../../electron/main.js), add this line near the other `./ipc/*.js` imports (after the `registerYtdlpIpc` import):

```js
import { registerUpdaterIpc } from "./ipc/updater.js";
```

- [ ] **Step 3: Syntax check**

Run:
```bash
node --check electron/main.js
```

Expected: no output.

- [ ] **Step 4: Run full suite**

Run:
```bash
npm test
```

Expected: all green. (No tests directly exercise main.js, but this confirms no import cycle was introduced.)

- [ ] **Step 5: Commit**

```bash
git add electron/main.js
git commit -m "feat(updater): defer post-update bootstrap behind updater:proceed"
```

---

## Task 8: Gate renderer bootstrap behind the update screen

**Files:**
- Modify: `electron/renderer/main.js`

- [ ] **Step 1: Add update-check gating**

Edit [electron/renderer/main.js](../../electron/renderer/main.js). Wrap the existing logic so the update screen runs first, then the normal `bootstrap()` runs after `onProceed`. Replace the entire file with:

```js
import { mountSidebar } from "./components/sidebar.js";
import { mountQueueDock } from "./components/queueDock.js";
import { renderRender } from "./screens/render.js";
import { renderTrimEnds } from "./screens/trimEnds.js";
import { renderCutBg } from "./screens/cutBg.js";
import { renderGetUrls } from "./screens/getUrls.js";
import { renderDownload } from "./screens/download.js";
import { renderConcatHeadTail } from "./screens/concatHeadTail.js";
import { renderThumbAvatar } from "./screens/thumbAvatar.js";
import { renderTrendSearch } from "./screens/trendSearch.js";
import { renderQueue } from "./screens/queue.js";
import { renderSettings } from "./screens/settings.js";
import { renderOnboarding } from "./screens/onboarding.js";
import { mountUpdateCheck } from "./screens/updateCheck.js";
import { toast } from "./components/toast.js";

const screens = {
  render: renderRender, trimEnds: renderTrimEnds, cutBg: renderCutBg,
  getUrls: renderGetUrls, download: renderDownload, concatHeadTail: renderConcatHeadTail,
  thumbAvatar: renderThumbAvatar, trendSearch: renderTrendSearch,
  queue: renderQueue, settings: renderSettings,
};

const appEl = document.getElementById("app");
const sidebarEl = document.getElementById("sidebar");
const contentEl = document.getElementById("content");
const dockEl = document.getElementById("queue-dock");

async function navigate(name) {
  const fn = screens[name];
  if (!fn) return;
  contentEl.innerHTML = "";
  contentEl.dataset.screen = name;
  await fn(contentEl);
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.screen === name));
  window.location.hash = name;
}

window.addEventListener("hashchange", () => {
  const name = window.location.hash.slice(1) || "render";
  navigate(name);
});

async function bootstrap() {
  appEl.hidden = false;

  const list = await window.api.workspace.list();
  if (list.length === 0) {
    contentEl.innerHTML = "";
    await new Promise((resolve) => {
      renderOnboarding(
        contentEl,
        { initialWorkspace: "", initialIdentifier: "" },
        async ({ workspace, identifier }) => {
          await window.api.app.ensureWorkspace(workspace);
          const ws = await window.api.workspace.create({ path: workspace, identifier });
          await window.api.workspace.setActive(ws.id);
          await window.api.app.trackingPing();
          resolve();
        },
      );
    });
  }
  await mountSidebar(sidebarEl, navigate);
  mountQueueDock(dockEl);
  const initial = window.location.hash.slice(1) || "render";
  await navigate(initial);
}

function startUpdateCheck() {
  appEl.hidden = true;
  const overlay = document.createElement("div");
  overlay.id = "update-check-root";
  document.body.appendChild(overlay);

  mountUpdateCheck(overlay, {
    onProceed: () => {
      overlay.remove();
      bootstrap();
    },
  });
}

startUpdateCheck();

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
        showErrorModal({ summary: `Task ${labelOf(j.type)} thất bại`, error: j.error, jobId: j.id }));
    }
  }
});

const TASK_LABELS = {
  render: "Render Video", trimEnds: "Cắt đầu/cuối", cutBg: "Chia nhỏ video nền",
  getUrls: "Lấy link kênh", download: "Tải video", concatHeadTail: "Nối đầu/cuối",
  thumbAvatar: "Gắn avatar", trendSearch: "Tìm trend",
};
function labelOf(t) { return TASK_LABELS[t] || t; }
```

Note the changes:
- Imported `mountUpdateCheck`.
- Grabbed `appEl` from the DOM.
- `bootstrap()` no longer runs on module load; instead `startUpdateCheck()` runs and only calls `bootstrap()` after `onProceed`.
- App container is hidden during update check so the queue/sidebar don't flash behind the overlay.

- [ ] **Step 2: Syntax check**

Run:
```bash
node --check electron/renderer/main.js
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add electron/renderer/main.js
git commit -m "feat(updater): show update check screen before app bootstrap"
```

---

## Task 9: Manual smoke test in dev mode

This task has no commit — it's a verification gate.

- [ ] **Step 1: Launch in dev mode**

Run:
```bash
npm run dev
```

Expected behavior:
1. Window opens.
2. The update-check overlay is **briefly visible** then disappears almost immediately (dev mode short-circuits to `not-available`).
3. Normal sidebar + render screen mounts.
4. No errors in DevTools console (`F12`).

If onboarding appears (no workspace yet), complete it. The app should land on the render screen.

- [ ] **Step 2: Check the log**

Open the log file (Settings → "Mở log") or read directly:

```bash
type "%APPDATA%\vidmaster-desktop\logs\main.log" | findstr updater
```

Expected: log lines like `updater: dev mode, skipping check`.

- [ ] **Step 3: Force the error path (still in dev) — optional sanity check**

Temporarily edit `electron/updater.js`:
- Change `if (!isPackaged) { ... return; }` to a no-op (comment the early return).
- Save, re-run `npm run dev`.

Expected:
- Update screen shows "Đang kiểm tra cập nhật...".
- 10s later flips to "Không kiểm tra được cập nhật (quá thời gian)" with two buttons.
- After 5s more, "Tiếp tục dùng app" auto-fires and the app mounts.

**Important:** revert the change before continuing:
```bash
git checkout electron/updater.js
```

---

## Task 10: Manual smoke test for real update (gated on first release)

This task is the end-to-end production verification. Run it once, after the first published release exists.

- [ ] **Step 1: Cut the first release**

Set `GH_TOKEN` in the shell (PAT with `repo` scope), then run:

```bash
$env:GH_TOKEN = "ghp_xxx"
npm run release
```

Expected:
1. `npm run bump` increments patch (e.g. `0.1.0 → 0.1.1`).
2. `electron-builder` builds installer.
3. Artifacts (`VidMaster-Setup-0.1.1.exe` + `latest.yml`) uploaded as a **draft** release on github.com/faster64/vidmaster-desktop/releases.

- [ ] **Step 2: Install the freshly-built installer locally**

Run the installer from `dist/VidMaster-Setup-0.1.1.exe`. Launch the installed app.

Expected:
- Update check screen briefly → "Không kiểm tra được cập nhật" or proceeds, depending on whether the draft has been **published** on GitHub. (Drafts are not visible to the public update feed.)
- Either way, app mounts normally. Close it.

- [ ] **Step 3: Publish the draft on GitHub**

On github.com, edit the draft release → click "Publish release". This makes `latest.yml` reachable.

- [ ] **Step 4: Bump and release a second version**

```bash
npm run release
```

(This bumps to `0.1.2` and uploads a new draft.) Publish this draft too.

- [ ] **Step 5: Reopen the installed v0.1.1 app**

Expected sequence:
1. Update screen shows "Đang kiểm tra cập nhật...".
2. Flips to "Đã có bản v0.1.2. Đang tải..." with progress bar.
3. Progress bar advances; speed text shows MB/s.
4. Flips to "Đang cài đặt v0.1.2...". App quits.
5. NSIS installer runs silently. App relaunches as `v0.1.2`.
6. Update screen shows "Không kiểm tra được cập nhật" or proceeds (already at latest).

- [ ] **Step 6: Offline test**

Disconnect network. Launch the installed app.

Expected:
1. "Đang kiểm tra cập nhật..." for 10 seconds.
2. "Không kiểm tra được cập nhật (quá thời gian)" + two buttons.
3. After 5s, "Tiếp tục dùng app" auto-fires and app mounts normally.

- [ ] **Step 7: Commit the bumped versions**

After successful smoke test, the local `package.json` will be at the latest released version (`0.1.2`). Stage and commit:

```bash
git add package.json package-lock.json
git commit -m "chore(release): v0.1.2"
```

(The user's "never auto-commit" rule applies to the build step. Manually committing after a verified release is intentional.)

---

## Self-review notes

Spec coverage check:
- ✅ Block until update check completes — Task 8 (renderer gating) + Task 7 (main defers bootstrap)
- ✅ GitHub Releases as host — Task 1 (`publish: github` config)
- ✅ Auto-download + install — Task 3 (`update-downloaded` → `quitAndInstall`)
- ✅ 10s timeout + retry/continue — Task 3 (timeout) + Task 6 (UI buttons)
- ✅ 5s auto-continue on error — Task 6 (`AUTO_CONTINUE_MS`)
- ✅ Dev mode short-circuit — Task 3 (`!isPackaged` branch)
- ✅ Bump patch on every build — Task 1 (`prebuild` hook) + Task 2 (script)
- ✅ No auto-commit — Task 2 step 5 reverts the test bump; release flow leaves bumped `package.json` for manual commit
- ✅ Vietnamese UI with error codes inline — Task 6 (`(${code})` in sub-line)
- ✅ Workspace/Telegram/yt-dlp deferred — Task 7 (`bootstrapAfterUpdateCheck`)
- ✅ Logging via electron-log — Task 3 (`log.info`, `log.warn`)
- ✅ Tests — Task 2 (bump) + Task 3 (updater wrapper)

Type/name consistency check:
- `createUpdater({ send, log, isPackaged })` used in Task 3 and Task 4. ✅
- Event shapes (`{ type, currentVersion, nextVersion, percent, bytesPerSecond }`) match between Task 3 emit and Task 6 consume. ✅
- IPC channel names: `updater:check`, `updater:proceed`, `updater:event` used consistently in Tasks 4, 5, 6. ✅
- `mountUpdateCheck(root, { onProceed })` matches between Task 6 definition and Task 8 caller. ✅
