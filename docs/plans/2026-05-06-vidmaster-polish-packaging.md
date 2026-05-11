# VidMaster — Plan 3: Polish + Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
>
> **NOTE:** **Do NOT run `git commit` or `git init` from any step.** Leave changes for manual review.

**Goal:** Take the Plan 2 working app from "boots and runs" to "shippable .exe installer with internal-quality polish": GPU encoder auto-detect, full logging integration with the renderer error modal, app icon, NSIS installer via `electron-builder`, and a manual pre-release smoke checklist.

**Architecture:** No new architectural surface — Plan 3 fills in the polish layer over the existing main/renderer split. The `electron-builder` config lives in `package.json > build`. Native modules (`sharp`, `@ffmpeg-installer/ffmpeg`) ship via `asarUnpack`. The installer is per-user (no admin) so it never prompts UAC.

**Tech Stack additions:**
- `electron-builder` ^25 (devDep — NSIS installer for Windows)
- No runtime additions

**Plans 1 + 2 prerequisites:** all 7 task modules + Electron shell + 9 screens functional via `npm run dev`.

---

## File Structure

Files this plan creates or modifies:

```
vidmaster-desktop/
├── package.json                       (MODIFY — add electron-builder, build config, scripts)
├── build/                             (NEW — packaging assets)
│   ├── icon.ico                       (256×256 multi-res)
│   ├── icon.png                       (1024×1024 source for icon, optional)
│   └── installer-header.bmp           (optional NSIS branding; skip if no asset)
├── electron/
│   ├── main.js                        (MODIFY — wire detectGpu + log forwarding to renderer)
│   ├── gpuDetect.js                   (NEW — runs ffmpeg -encoders once)
│   ├── logForwarder.js                (NEW — forwards log lines to renderer for error modal)
│   └── ipc/log.js                     (NEW — log:* handlers: tail latest, recent lines per job)
├── electron/renderer/
│   └── components/modal.js            (MODIFY — show last N log lines in error modal)
└── tests/
    └── electron/gpuDetect.test.js     (NEW)
```

The plan keeps the polish surface narrow: GPU detect + log forwarding + packaging. Anything bigger (auto-update, code signing) is Non-goals per the spec.

---

## Task 1: GPU encoder auto-detect

**Files:**
- Create: `electron/gpuDetect.js`
- Create: `tests/electron/gpuDetect.test.js`
- Modify: `electron/main.js` (call once on first boot when `encoder === "auto"`)

- [ ] **Step 1.1: Write the failing test**

`tests/electron/gpuDetect.test.js`:

```js
import { describe, it, expect, vi } from "vitest";
import { pickEncoderFromFfmpegOutput } from "../../electron/gpuDetect.js";

describe("pickEncoderFromFfmpegOutput", () => {
  it("picks h264_nvenc when present", () => {
    const sample = ` V..... h264_nvenc           NVIDIA NVENC H.264 encoder\n V..... libx264              libx264 H.264 / AVC`;
    expect(pickEncoderFromFfmpegOutput(sample)).toBe("h264_nvenc");
  });
  it("picks h264_qsv when nvenc absent but qsv present", () => {
    const sample = ` V..... h264_qsv             H.264 / AVC (Intel Quick Sync Video)\n V..... libx264              libx264`;
    expect(pickEncoderFromFfmpegOutput(sample)).toBe("h264_qsv");
  });
  it("picks h264_amf when only AMF available", () => {
    const sample = ` V..... h264_amf             AMD AMF\n V..... libx264              libx264`;
    expect(pickEncoderFromFfmpegOutput(sample)).toBe("h264_amf");
  });
  it("falls back to libx264 when no GPU encoder is reported", () => {
    expect(pickEncoderFromFfmpegOutput(` V..... libx264              libx264`)).toBe("libx264");
  });
});
```

- [ ] **Step 1.2: Run (expect fail).**

- [ ] **Step 1.3: Implement `electron/gpuDetect.js`**

```js
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { spawn } from "child_process";

const PRIORITY = ["h264_nvenc", "h264_qsv", "h264_amf", "libx264"];

export function pickEncoderFromFfmpegOutput(text) {
  for (const enc of PRIORITY) {
    if (text.includes(enc)) return enc;
  }
  return "libx264";
}

export function detectEncoder() {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-encoders"], { windowsHide: true });
    let out = "";
    child.stdout.on("data", (b) => { out += b.toString(); });
    child.stderr.on("data", (b) => { out += b.toString(); });
    child.on("error", () => resolve("libx264"));
    child.on("close", () => resolve(pickEncoderFromFfmpegOutput(out)));
  });
}
```

- [ ] **Step 1.4: Run (expect 4 pass). Cumulative tests: 46.**

- [ ] **Step 1.5: Wire into `electron/main.js`**

Inside `app.whenReady()`, after `registerSettingsIpc(...)` returns the settings handle, add:

```js
import { detectEncoder } from "./gpuDetect.js";
// ...
app.whenReady().then(async () => {
  const settings = registerSettingsIpc(getMainWindow);
  if (settings.get("ffmpeg.encoder") === "auto") {
    const picked = await detectEncoder();
    settings.set({ "ffmpeg.encoder": picked });
    log.info(`Detected ffmpeg encoder: ${picked}`);
  }
  registerQueueIpc(getMainWindow);
  registerDialogIpc();
  registerShellIpc(() => log.transports.file.getFile().path);
  registerAppIpc(() => settings);
  createWindow();
});
```

- [ ] **Step 1.6: Verify in dev**

Run: `npm run dev`. Open Settings screen. Confirm encoder dropdown shows the detected value (e.g., `h264_nvenc` on a NVIDIA machine). Restart the app — detection does not run again because `encoder !== "auto"` now. Confirm by adding a temporary `console.log` in `main.js` and checking it only fires when needed.

---

## Task 2: Log forwarder + Log IPC

The Plan 2 error modal shows the JSON `error` from a failed job, but does not show the FFmpeg stderr lines that led up to the failure. Plan 3 forwards a ring buffer of recent log lines per job and surfaces them in the modal.

**Files:**
- Create: `electron/logForwarder.js`
- Create: `electron/ipc/log.js`
- Modify: `electron/queue.js` (capture per-job log lines into the job)
- Modify: `electron/preload.js` (expose `log.getRecent(jobId)`)
- Modify: `electron/renderer/components/modal.js` (show recent log in error modal)

- [ ] **Step 2.1: Modify `electron/queue.js` — capture per-job log**

In `_maybeStart()`, change the runner invocation to capture log lines onto the job (cap at the most recent 200 lines per job):

```js
const LOG_RING_SIZE = 200;
// ...
runner({
  ...job.config,
  signal: job.controller.signal,
  onProgress: (pct, msg) => {
    job.progress = pct;
    job.message = msg ?? "";
    this._emit();
  },
  onLog: (level, line) => {
    job.logs = job.logs || [];
    job.logs.push({ level, line, ts: Date.now() });
    if (job.logs.length > LOG_RING_SIZE) job.logs.shift();
  },
}).then(/* ... */);
```

Update `_public(j)` to include `logs` in the snapshot (so renderer can show them):

```js
_public(j) {
  const { controller, ...rest } = j;
  return rest;
}
```

(Already includes everything except `controller`. No change needed if `logs` is just a plain array.)

- [ ] **Step 2.2: Create `electron/ipc/log.js`**

```js
import { ipcMain } from "electron";

export function registerLogIpc(getQueue) {
  ipcMain.handle("log:getRecent", (_, jobId) => {
    const q = getQueue();
    if (!q) return [];
    const all = [q.getState().running, ...q.getState().completed, ...q.getState().pending];
    const job = all.find((j) => j?.id === jobId);
    return job?.logs ?? [];
  });
}
```

- [ ] **Step 2.3: Wire into `electron/main.js`**

Capture the queue from `registerQueueIpc` and pass to `registerLogIpc`:

```js
import { registerLogIpc } from "./ipc/log.js";
// ...
const queue = registerQueueIpc(getMainWindow);
registerLogIpc(() => queue);
```

(Update `registerQueueIpc` to return the queue: it already does in Plan 2.)

- [ ] **Step 2.4: Modify `electron/preload.js`** — add `log` namespace

```js
log: {
  getRecent: (jobId) => ipcRenderer.invoke("log:getRecent", jobId),
},
```

- [ ] **Step 2.5: Modify `electron/renderer/components/modal.js`** — pull recent log

Replace `showErrorModal`:

```js
export async function showErrorModal({ summary, error, jobId }) {
  let logs = [];
  if (jobId) {
    try { logs = await window.api.log.getRecent(jobId); } catch {}
  }
  const stack = error?.stack || (error?.details ? JSON.stringify(error.details, null, 2) : "");
  const logLines = logs.map((l) => `[${l.level}] ${l.line}`).join("");
  showModal({
    title: `❌ ${summary}`,
    body: `<p>${escape(error?.message || "Có lỗi xảy ra.")}</p>
           <h4>Stack / details</h4><pre>${escape(stack)}</pre>
           ${logLines ? `<h4>Log gần nhất (${logs.length} dòng)</h4><pre>${escape(logLines)}</pre>` : ""}`,
    footer: `
      <button id="copy-log">Copy log</button>
      <button onclick="window.api.shell.openLogFile()">Mở file log</button>
      <button class="primary" data-close>Đóng</button>
    `,
  });
  document.getElementById("copy-log")?.addEventListener("click", () => {
    navigator.clipboard.writeText(stack + "\n\n" + logLines);
  });
}
```

(`escape` already exists in the file.)

- [ ] **Step 2.6: Update callers**

In `electron/renderer/main.js` and `screens/queue.js`, change:

```js
showErrorModal({ summary: ..., error: j.error })
```

to:

```js
showErrorModal({ summary: ..., error: j.error, jobId: j.id })
```

- [ ] **Step 2.7: Smoke**

Run a task that errors (Render with empty folders). Modal opens, shows the stack, and shows recent FFmpeg/log lines.

---

## Task 3: App icon

**Files:**
- Create: `build/icon.ico`
- Create: `build/icon.png` (optional source, 1024×1024)

- [ ] **Step 3.1: Create a placeholder icon**

If no designer is available, generate a simple placeholder. Run from project root using Node:

```js
// scripts/make-placeholder-icon.js
import sharp from "sharp";
import path from "path";
const svg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <rect width="1024" height="1024" rx="160" fill="#3b82f6"/>
  <text x="50%" y="58%" font-family="Segoe UI, sans-serif" font-size="500" font-weight="700"
        text-anchor="middle" fill="#fff">VM</text>
</svg>`);
await sharp(svg).png().toFile(path.resolve("build", "icon.png"));
console.log("✓ icon.png");
```

Run: `node scripts/make-placeholder-icon.js`. Produces `build/icon.png`.

- [ ] **Step 3.2: Convert PNG to multi-resolution ICO**

`electron-builder` can use a PNG directly on Windows when listed under `win.icon`, but it requires 256×256+ and converts internally. To be robust, ship an `.ico`:

Install `png-to-ico` as a one-shot devDep, or use an online converter. Programmatic option:

```bash
npm install --save-dev png-to-ico
```

Then `scripts/make-ico.js`:

```js
import pngToIco from "png-to-ico";
import fs from "fs";
import path from "path";

const sizes = [16, 32, 48, 64, 128, 256];
const buffers = await Promise.all(
  sizes.map(async (s) => {
    const sharp = (await import("sharp")).default;
    return await sharp(path.resolve("build", "icon.png")).resize(s, s).png().toBuffer();
  })
);
const ico = await pngToIco(buffers);
fs.writeFileSync(path.resolve("build", "icon.ico"), ico);
console.log("✓ icon.ico");
```

Run: `node scripts/make-ico.js`. Produces `build/icon.ico`. Verify file is non-empty and starts with bytes `00 00 01 00`.

- [ ] **Step 3.3: Add `png-to-ico` to package.json devDeps if installed via cli**

(Already done in Step 3.2 if `--save-dev` was used.)

---

## Task 4: `electron-builder` config + scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 4.1: Install electron-builder**

Run: `npm install --save-dev electron-builder@^25.1.7`

- [ ] **Step 4.2: Add `build` block to `package.json`**

Insert at top level:

```json
"build": {
  "appId": "com.vidmaster.app",
  "productName": "VidMaster",
  "directories": { "output": "dist", "buildResources": "build" },
  "files": [
    "electron/**",
    "src/**",
    "node_modules/**",
    "package.json"
  ],
  "asar": true,
  "asarUnpack": [
    "**/node_modules/{@ffmpeg-installer,ffmpeg-static,sharp}/**"
  ],
  "win": {
    "target": [{ "target": "nsis", "arch": ["x64"] }],
    "icon": "build/icon.ico"
  },
  "nsis": {
    "oneClick": false,
    "perMachine": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "VidMaster",
    "uninstallDisplayName": "VidMaster"
  }
}
```

- [ ] **Step 4.3: Add build scripts**

Update `scripts`:

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "dev": "electron .",
  "build": "electron-builder --win --x64",
  "build:dir": "electron-builder --dir"
}
```

- [ ] **Step 4.4: Build a directory artifact (no installer)**

Run: `npm run build:dir`
Expected: `dist/win-unpacked/VidMaster.exe` exists and is ~150 MB. The folder also contains the unpacked `app.asar.unpacked/node_modules/{sharp,ffmpeg-static,@ffmpeg-installer}` directories.

- [ ] **Step 4.5: Run the unpacked exe**

Open `dist/win-unpacked/VidMaster.exe`. Verify the app launches (workspace prompt or Render screen). If FFmpeg fails to spawn, the `asarUnpack` glob is wrong — fix and rebuild.

- [ ] **Step 4.6: Build the installer**

Run: `npm run build`
Expected: `dist/VidMaster Setup 0.1.0.exe` created (~80–110 MB).

- [ ] **Step 4.7: Test install / uninstall on the dev machine**

Double-click the installer. Choose install path. Verify:
- Install completes without UAC prompt (per-user install).
- Desktop + Start Menu shortcuts created.
- App launches from shortcut.
- Settings persist between launches at `%APPDATA%\VidMaster\config.json`.
- Uninstall via Start Menu / Add-Remove Programs removes shortcuts and program files.
- After uninstall, `%APPDATA%\VidMaster\` still exists (deliberate — settings preserved for reinstall).

---

## Task 5: SmartScreen note in README

**Files:**
- Modify: `README.md`

- [ ] **Step 5.1: Add a "Cài đặt và bỏ qua SmartScreen" section to `README.md`**

Append:

```markdown
## Cài đặt

1. Tải file `VidMaster Setup X.Y.Z.exe`.
2. Double-click để cài.
3. Lần đầu chạy, Windows có thể hiện cảnh báo "Windows đã bảo vệ máy tính của bạn" (SmartScreen).
   - Click **"Thông tin khác"** rồi **"Vẫn chạy"**.
   - Cảnh báo này xuất hiện vì bản internal chưa code-sign. Nếu sau này có cert Authenticode, cảnh báo sẽ biến mất.
```

---

## Task 6: Pre-release smoke checklist (manual)

This task does not change code — it is the human verification gate before sharing the installer. Document the checklist in `docs/release-checklist.md` so it can be reused for future releases.

**Files:**
- Create: `docs/release-checklist.md`

- [ ] **Step 6.1: Create `docs/release-checklist.md`**

```markdown
# Pre-release smoke checklist

Run on a clean Windows 10 or 11 VM (no Node, no dev tools installed).

## Install
- [ ] Double-click installer; install completes without UAC.
- [ ] Desktop shortcut exists.
- [ ] Start Menu shortcut exists.

## First launch
- [ ] App launches from shortcut.
- [ ] Onboarding asks for workspace folder.
- [ ] After choosing folder, all 9 subfolders are created (`overlays`, `backgrounds`, `combined_videos`, `done`, `input`, `output`, `thumbs`, `temp`, `overlays_convert`).
- [ ] Render screen renders.

## Each task (with sample data)
- [ ] Render Video runs end-to-end on a small overlay+background set.
- [ ] Tạo video từ ảnh runs (with a snow.mov in workspace).
- [ ] Cắt video 30s runs and produces segments.
- [ ] Chia nhỏ video nền runs.
- [ ] Tạo ảnh thu nhỏ runs.
- [ ] Ghép video + thumbnail runs.
- [ ] Sửa tên thu nhỏ runs.

## Queue + cancel
- [ ] Submit two tasks; only one runs at a time.
- [ ] Cancel running task; FFmpeg process terminates within 5 s; queue moves to next.

## Error display
- [ ] Trigger a deliberate error (e.g., point Render at empty folders).
- [ ] Error modal opens automatically with stack and recent log lines.
- [ ] "Copy log" copies. "Mở file log" opens log in Notepad.

## Settings persistence
- [ ] Change a Render default. Restart app. Setting persists.

## Uninstall
- [ ] Uninstall via Start Menu removes program files and shortcuts.
- [ ] `%APPDATA%\VidMaster\` retained.

If any item fails, do not ship; file a bug and fix before retrying the checklist.
```

---

## Plan 3 — Done Criteria

- [ ] All Vitest tests pass (cumulative: 46).
- [ ] `npm run build:dir` produces a working `dist/win-unpacked/VidMaster.exe`.
- [ ] `npm run build` produces a working installer.
- [ ] Installer installs and uninstalls cleanly on the dev machine.
- [ ] GPU encoder auto-detect runs once on first launch and persists.
- [ ] Error modal shows recent log lines in addition to the stack.
- [ ] `docs/release-checklist.md` exists and has been completed at least once on the dev machine.
- [ ] User has reviewed the resulting `.exe` and is ready to start Plan 4 (Skills package).
