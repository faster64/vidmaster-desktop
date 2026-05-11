# VidMaster Desktop App — Design Spec

- **Date:** 2026-05-06
- **Status:** Draft (awaiting user approval)
- **Source project:** `d:\Project2\vid-master` (CLI tool to be converted)
- **Target project:** `d:\Project2\vidmaster-desktop` (this folder, new independent project)
- **Scope:** Convert the existing Node.js CLI video-processing tool into a Windows-only Electron desktop app for internal team use.

## 1. Overview & Goals

VidMaster is an Electron desktop app that wraps the existing FFmpeg/Sharp-based video-processing scripts of `vid-master` into a friendly GUI for non-technical internal users.

**Goals**
1. Users install via `.exe` installer, launch the app, pick a task, and click run — no CLI exposure.
2. Reuse existing Node.js logic (FFmpeg, Sharp pipelines) with minimal rewrite — only restructure into modules.
3. Serial queue: one job runs at a time, multiple jobs can be queued, with progress and cancel.
4. Hybrid workspace: sensible defaults plus per-task folder overrides.
5. Drop all features unrelated to the seven retained tasks (download, get-url, schedule, VPS, get-color, convertVideo, uniqUrl, createBackgrounds).

**Non-goals**
- macOS / Linux builds.
- Auto-update mechanism.
- Cloud sync, multi-user, accounts, licensing.
- Plugin/extension system.
- Backwards-compatible CLI mode.

**Final deliverables**
1. NSIS `.exe` installer for Windows (electron-builder).
2. Source code laid out per the "Thin Electron wrapper" structure (Section 2).
3. A Claude superpowers skills package at `.claude/skills/vidmaster/` documenting the conversion process and ongoing maintenance patterns (Section 8).

## 2. Architecture

```
┌──────────────────────────────────────────────────────┐
│  Renderer Process (Chromium)                         │
│  ┌─────────────┐  ┌────────────────────────────────┐│
│  │  Sidebar    │  │  Main Panel (per-task forms)   ││
│  │  - Render   │  │  - Inputs + Browse buttons     ││
│  │  - Snow     │  │  - [Add to Queue] button       ││
│  │  - Trim …   │  └────────────────────────────────┘│
│  └─────────────┘  ┌────────────────────────────────┐│
│                   │  Queue Dock (bottom)           ││
│                   └────────────────────────────────┘│
└──────────────────┬───────────────────────────────────┘
                   │ IPC (contextBridge, preload.js)
                   ▼
┌──────────────────────────────────────────────────────┐
│  Main Process (Node.js)                              │
│  ┌─────────────────┐  ┌────────────────────────────┐│
│  │  IPC Handlers   │──│  Queue Manager (singleton) ││
│  └─────────────────┘  └────────────────────────────┘│
│         │                       │                    │
│         ▼                       ▼                    │
│  ┌─────────────────┐  ┌────────────────────────────┐│
│  │  Settings Store │  │  Task Modules (../src/*)   ││
│  └─────────────────┘  └────────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

**Project layout (Phương án 1 — Thin Electron wrapper)**
```
vidmaster-desktop/
├── electron/
│   ├── main.js              (Electron main, queue manager, IPC handlers)
│   ├── preload.js           (contextBridge → window.api)
│   └── renderer/            (vanilla HTML/CSS/JS UI)
├── src/
│   ├── _lib/
│   │   └── runner.js        (TaskRunner shared utility)
│   ├── render.js            (export runRender)
│   ├── snow.js              (export runSnow)
│   ├── trim.js              (export runTrim)
│   ├── cutBg.js             (export runCutBg)
│   ├── thumb.js             (export runThumb)
│   ├── concat.js            (export runConcat)
│   └── rename.js            (export runRename)
├── tests/
│   └── fixtures/            (small sample files for unit tests)
├── build/
│   ├── icon.ico             (Windows app icon)
│   └── installer assets
├── docs/
│   └── specs/               (this file)
├── .claude/
│   └── skills/vidmaster/    (skills package, see Section 8)
├── package.json
└── README.md
```

**Task module signature (uniform across all 7 tasks)**
```js
async function runX({ /* per-task config */, signal, onProgress, onLog }) {
  // ...
  return { ok, outputs: string[], errors: [...] };
}
```
- `signal`: `AbortSignal` for cancel.
- `onProgress(percent, message)`: progress callback (throttled by main process before IPC emit).
- `onLog(level, line)`: log callback; written to file and forwarded to renderer.

**Queue Manager (singleton, main process)**
- State: `pending[]`, `running` (max 1 job), `completed[]` (in-memory only, max 50).
- API: `add(spec) → {jobId}`, `cancel(jobId)`, `clear()`, `getState()`.
- Emits `queue:update` to renderer on every state change or progress tick.

**Settings Store**
- Engine: `electron-store` (JSON file at `%APPDATA%\VidMaster\config.json`).
- Schema versioned with migration hook.

**Renderer**
- Vanilla HTML/CSS/JS for v1 (no React) — minimize footprint and ship fast.
- Communicates with main only via `window.api` (exposed by preload).
- `nodeIntegration: false`, `contextIsolation: true`.

## 3. Components & Screens

### 3.1 Sidebar (persistent left)
- Logo + "VidMaster" header.
- **Tasks** group (icon + Vietnamese label, 7 items):
  - 🎬 Render Video
  - ❄️ Tạo video từ ảnh
  - ✂️ Cắt video 30s
  - 🎞️ Chia nhỏ video nền
  - 🖼️ Tạo ảnh thu nhỏ
  - 🔗 Ghép video + thumbnail
  - ✏️ Sửa tên thu nhỏ
- **System** group:
  - 📋 Hàng đợi (badge: count of running + pending)
  - ⚙️ Cài đặt
- Active item visually highlighted.

### 3.2 Task screen template (consistent across all 7)
```
┌──────────────────────────────────────────┐
│  🎬  Render Video                        │
│  Render video chính từ background +      │
│  overlay với hiệu ứng chroma key.        │
│ ────────────────────────────────────────│
│  📁 Folder input                         │
│  [📂 D:\VidMaster-Workspace\overlays  ] │
│   (Mặc định từ Workspace · [Đổi…])       │
│                                          │
│  📁 Folder output                        │
│  [📂 D:\VidMaster-Workspace\done      ] │
│                                          │
│  🔢 Số ngày             [  1  ]          │
│  🔢 Số video / folder   [  5  ]          │
│                                          │
│  Tuỳ chọn nâng cao                     │
│   ☑ Dùng GPU (NVIDIA)                   │
│   🎨 ChromaKey color  [#D4F9D7] [▢]     │
│   ⏲️ Opacity  [────●────] 70%           │
│                                          │
│            [ ▶  Thực hiện ]      │
└──────────────────────────────────────────┘
```
- Defaults pre-filled from workspace + settings + last-used config.
- Native folder picker via `dialog.pickFolder` — never raw text input.
- Inline validation: numbers must be > 0, folders must exist; helper text below field.
- Each task has a one-line description so users know what it does.

### 3.3 Render Video — exposed parameters

Per Section 7 of the brainstorm (Q8 = option B "basic + advanced collapsible"):
- **Basic (always visible):** số ngày, số video / folder.
- **Advanced (collapsible):** Use GPU toggle, ChromaKey color, opacity slider.
- **Settings-level (not in form):** crop height/yOffset, KeepColor list, encoder selection — moved to global Settings.

### 3.4 Per-task config storage
- Each task remembers its last-used config under `electron-store` key `lastConfig.<taskType>`.
- Opening a task screen pre-fills from `lastConfig.<type>` if present, falling back to workspace defaults.
- "Reset to defaults" button per task to clear `lastConfig.<type>`.

### 3.5 Queue screen
```
┌──────────────────────────────────────────┐
│  📋 Hàng đợi                              │
│  ─────────────────────────────────────── │
│  ⏳ Đang chạy                             │
│   🎬 Render Video                        │
│   ████████████░░░░░░░░  62%              │
│   Đang xử lý video 3/5 · ETA 4 phút     │
│                       [✕ Huỷ]            │
│                                          │
│  ⏸ Đang chờ (2)                          │
│   ❄️ Tạo video từ ảnh         [✕]        │
│   ✂️ Cắt video 30s            [✕]        │
│                                          │
│  ✅ Đã hoàn thành (5) [Xoá lịch sử]      │
│   🖼️ Tạo ảnh thu nhỏ · 2 phút trước     │
│   ↳ Mở folder output                     │
└──────────────────────────────────────────┘
```
- Queue dock at bottom always shows summary; click expands to full Queue screen.
- Toast notification on task completion (visible from any screen).
- Each completed task offers "Mở folder output" — important for non-technical UX.
- "Xem log chi tiết" opens a modal showing full stdout/stderr for that job.

### 3.6 Settings screen
- **Workspace**: current path + `[Đổi…]` button + helper text "Đây là nơi chứa input/output mặc định".
- **FFmpeg / GPU**: encoder dropdown (CPU / NVIDIA / Intel / AMD), auto-detected by default.
- **Render defaults**: ChromaKey color, opacity, crop height / yOffset, KeepColor list.
- **Mức log**: dropdown (Tối thiểu / Bình thường / Chi tiết).
- **Mở folder log** button.
- **Reset về mặc định** button (with confirm dialog).
- **About**: version + link to skills/docs.

### 3.7 Onboarding (first launch)
Single-step dialog: "Chọn workspace folder" → app creates required subfolders → opens Explorer pointing at workspace so user sees it → returns to app on the Render screen.

### 3.8 Empty states & error display

**Empty states**
- Empty input folder → illustration + one-line guidance ("Hãy đặt video vào folder này").

**Error display (internal use — full visibility)**
- On task failure, a "Chi tiết lỗi" modal opens automatically.
- Modal contents:
  - One-line Vietnamese summary at the top (e.g., "Không tìm thấy file/folder").
  - Full stack trace below.
  - Error code, file path, exact FFmpeg command that ran.
  - Buttons: "Copy log", "Mở file log".
- Nothing is hidden from the user. This tool is internal — more detail is better for debugging.

## 4. Data flow & Queue mechanics

### 4.1 Job lifecycle
1. User clicks `[Add to Queue]` on a task form → renderer calls `window.api.queue.add({ type, config })`.
2. IPC handler in main → `queueManager.add(spec)`.
3. Manager pushes to `pending`. If `running` is empty, pops next and invokes `runRender(config, { signal, onProgress, onLog })`.
4. Each `onProgress(p, msg)` → throttled → `webContents.send('queue:update', state)` → renderer updates dock and Queue screen.
5. On settle: status becomes `done | error | cancelled`, completed entry pushed to history (capped at 50), next pending job pops.

### 4.2 IPC contract (`window.api`)
```js
window.api = {
  queue: {
    add(spec),       // → { jobId }
    cancel(jobId),
    clear(),
    getState(),      // → { running, pending[], completed[] }
    onUpdate(cb)     // subscribe to 'queue:update'
  },
  settings: {
    get(key?),
    set(patch),
    onChange(cb)
  },
  dialog: {
    pickFolder(defaultPath?),
    pickFile(opts)
  },
  shell: {
    openFolder(path),
    openLogFile()
  },
  app: {
    getVersion(),
    getWorkspace()
  }
}
```

### 4.3 Cancel handling
- `signal` is an `AbortSignal` attached to the job. `cancel(jobId)` calls `controller.abort()`.
- Each task module checks `signal.aborted` at two points:
  1. Before each iteration of the main `for` loop (between video files).
  2. Inside `spawnFfmpeg`, which calls `ffmpeg.kill('SIGTERM')` when abort fires.
- Cancel does **not** delete partial output files — user may want to inspect them. Status becomes `cancelled` and UI shows "Đã huỷ — file dở vẫn còn trong folder output".

### 4.4 Persistence
- **Active queue state**: in-memory only. If app crashes mid-job, queue is empty on restart. Tradeoff accepted to avoid persistence edge cases.
- **Completed history**: in-memory, max 50 entries, lost on app close. Sufficient for "look back at what just ran" UX.
- **Logs**: written to `%APPDATA%\VidMaster\logs\main.log` via `electron-log` (rotation: 5 files × 5 MB).

### 4.5 Progress signal sources
- **Render / Concat / Snow**: parse FFmpeg stderr `time=HH:MM:SS.ms` against known total duration → percent.
- **Trim / CutBg / Thumb / Rename**: file-count progress (`i / total`).

### 4.6 Throttling
- FFmpeg can emit progress ~10×/sec. Main process throttles `queue:update` IPC sends to **2/sec** to avoid renderer spam.

### 4.7 Error propagation
- Errors from task modules → reject promise → Queue Manager catches → `status = 'error'`, `result.errors = [{ message, file?, stack, ffmpegCmd? }]`.
- Full stack and details surface in the UI modal (Section 3.8). Nothing redacted. Logs always include full detail.
- Vietnamese summary at top of modal is a convenience, not a substitute for the raw error.

## 5. Scripts refactor mapping

Each existing script becomes a module in `src/` with a uniform signature.

| Source (in `vid-master/`) | Target (in `vidmaster-desktop/src/`) | Config shape |
|---|---|---|
| `render.js` | `render.js` | `{ inputs: {overlays, backgrounds, combined?}, output, currentDay, videosPerFolder, ffmpeg: {useGPU, encoder}, chromaKey: {color, similarity?}, opacity, crop: {height, yOffset}, keepColor?, signal, onProgress, onLog }` |
| `createVideoSnow.js` | `snow.js` | `{ input, output, snowAsset, duration, signal, onProgress, onLog }` |
| `trim-videos.js` | `trim.js` | `{ input, output, segmentSeconds: 30, replace: false, signal, onProgress, onLog }` |
| `cut-bg.js` | `cutBg.js` | `{ input, output, signal, onProgress, onLog }` |
| `thumb.js` | `thumb.js` | `{ input, output, signal, onProgress, onLog }` |
| `concat-video.js` | `concat.js` | `{ thumbsDir, doneDir, output, chunkSize?, folderName?, signal, onProgress, onLog }` |
| `convertNormalize.js` | `rename.js` | `{ folder, signal, onLog }` |

### 5.1 Shared utility (`src/_lib/runner.js`)
```js
export class TaskRunner {
  constructor({ signal, onProgress, onLog }) { ... }
  log(level, msg)               // forwards to onLog + electron-log
  setProgress(percent, message) // forwards to onProgress
  checkAborted()                // throws AbortError if signal.aborted
  spawnFfmpeg(args, { totalDurationSec }) // returns Promise, parses stderr → progress
}
```

### 5.2 Refactor pattern
**Before:**
```js
// render.js (current)
const args = process.argv.slice(2);
const currentDay = parseInt(args[0]);
const overlayFolder = "./overlays";  // hardcoded cwd
// ... main logic runs at import time
```
**After:**
```js
// src/render.js
export async function runRender(config) {
  const runner = new TaskRunner(config);
  const { inputs, output, currentDay, videosPerFolder, ... } = config;
  // ... main logic, using inputs.overlays instead of "./overlays"
  // calls runner.setProgress(p) instead of console.log
  // calls runner.checkAborted() inside loops
  return { ok, outputs, errors };
}
```

### 5.3 Files dropped entirely (not ported to new project)
- `vps-config.js`, `vps-config.txt`
- `download.js`, `get-url.js`, `convertVideo.js`, `schedule.js`, `uniqUrl.js`, `get-color.py`
- `createVideoBackgrounds.js`, `create-bg.js`
- `main.js` (CLI menu — replaced by Electron app)

### 5.4 Asset to inspect when porting
- `silence.mp3` — keep if `concat-video.js` uses it (verify during implementation).

### 5.5 Dependencies

**Removed (vs source `vid-master`):** `youtube-dl-exec`, `googleapis`, `discord.js`, `node-telegram-bot-api`, `inquirer`, `qs`.

**Added:** `electron`, `electron-builder` (devDep), `electron-store`, `electron-log`, `vitest` (devDep).

**Kept:** `@ffmpeg-installer/ffmpeg`, `ffmpeg-static`, `fluent-ffmpeg`, `sharp`, `axios` (only if still needed after audit), `p-limit`.

## 6. Workspace, Settings & Persistence

### 6.1 Workspace structure (auto-created on workspace selection)
```
<workspace>/
├── overlays/              ← input for Render
├── backgrounds/           ← input for Render & CutBg
├── combined_videos/       ← intermediate (Render)
├── done/                  ← output of Render + input for Concat
├── input/                 ← input for Snow / Trim / Convert
├── output/                ← output of Concat
├── thumbs/                ← input for Concat
├── temp/                  ← scratch (auto-cleaned)
├── overlays_convert/      ← legacy intermediate
└── chromaKey.txt          ← per-file chroma override (preserves current pattern)
```
- Subfolders are auto-created if missing on app launch or workspace change.
- First-launch onboarding: pick folder → app creates subfolders → opens Explorer → returns to Render screen.

### 6.2 Settings schema (`%APPDATA%\VidMaster\config.json`)
```json
{
  "version": 1,
  "workspace": "D:\\VidMaster-Workspace",
  "ffmpeg": {
    "encoder": "auto",
    "maxConcurrent": 2
  },
  "render": {
    "useGPU": false,
    "chromaKey": { "color": "#D4F9D7", "similarity": 0.2 },
    "opacity": 0.7,
    "crop": { "height": 220, "yOffset": 490 },
    "keepColor": { "enabled": false, "list": ["#FBFF02"] }
  },
  "ui": {
    "theme": "light",
    "logLevel": "info",
    "completedHistorySize": 50
  },
  "lastUsedTask": "render"
}
```
- `version` bumped on schema changes; `migrateSettings(old)` ports forward.
- Validation: lightweight (Zod or hand-rolled). Invalid fields reset to defaults with a warning log.

### 6.3 Logging
- Engine: `electron-log` (built-in rotation).
- Path: `%APPDATA%\VidMaster\logs\main.log`, rotated (5 × 5 MB).
- Sinks: console (dev), file (always full), renderer (via IPC `log:append` for the in-app log modal).
- Level configurable via Settings: `error | warn | info | debug`.
- Each task log line is prefixed with `[jobId][taskType]` for filtering.

### 6.4 FFmpeg & native binaries
- `@ffmpeg-installer/ffmpeg` provides the binary in dev. With `electron-builder`, the binary ships in `app.asar.unpacked` because asar cannot pack executables.
- `sharp` is a native module; `electron-builder` rebuilds it for the target Electron version automatically.
- `package.json > build.asarUnpack` glob: `**/node_modules/{@ffmpeg-installer,ffmpeg-static,sharp}/**` (leading `**/` to catch nested deps; same value used in Section 7.2).

### 6.5 GPU encoder auto-detect
- On first launch (or when `encoder: "auto"`): run `ffmpeg -hide_banner -encoders` and grep for `nvenc`, `qsv`, `amf`. Pick the first available; fall back to CPU.
- Cached in settings; user can override in Settings.

## 7. Distribution, Packaging & Build

### 7.1 Tooling
- **`electron-builder`** for packaging.
- **NSIS installer** (`.exe`) — Windows x64 only.

### 7.2 `package.json > build` (key fields)
```json
{
  "build": {
    "appId": "com.vidmaster.app",
    "productName": "VidMaster",
    "directories": { "output": "dist", "buildResources": "build" },
    "files": ["electron/**", "src/**", "node_modules/**", "package.json"],
    "asar": true,
    "asarUnpack": ["**/node_modules/{@ffmpeg-installer,ffmpeg-static,sharp}/**"],
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
}
```

### 7.3 Installer UX
- Per-user install (no UAC prompt, default install path: `%LOCALAPPDATA%\Programs\VidMaster`).
- User can change install location.
- Creates Desktop + Start Menu shortcuts.
- Uninstaller removes program files but leaves `%APPDATA%\VidMaster` (settings, logs) untouched for reinstall continuity.

### 7.4 Code signing
- **Skipped in v1.** Internal use; SmartScreen warning is acceptable. Document in README/skills how users dismiss it.

### 7.5 App icon
- `build/icon.ico`, 256×256 multi-resolution. Placeholder if no designer available.

### 7.6 Build commands (`package.json > scripts`)
```jsonc
{
  "dev": "electron .",
  "build": "electron-builder --win --x64",
  "build:dir": "electron-builder --dir",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

### 7.7 Versioning
- Semver, source of truth in `package.json > version`. Displayed in Settings → About.
- v1 release: `1.0.0`.

### 7.8 Distribution
- Internal: copy `.exe` over Drive / Slack / email. No public hosting.
- No auto-update in v1.
- Upgrade path: user uninstalls and installs the new version; `%APPDATA%\VidMaster` survives so settings/workspace persist.

### 7.9 Output size estimate
- Bundle: ~180–220 MB uncompressed.
- NSIS installer (compressed): ~80–110 MB.
- Acceptable for internal distribution.

### 7.10 Pre-release checklist
- [ ] FFmpeg binary runs on a clean Windows install (no Node required).
- [ ] Sharp loads without "module not found".
- [ ] Workspace folder picker works.
- [ ] Each of the 7 tasks runs successfully on a sample folder.
- [ ] Cancel kills FFmpeg and leaves no dangling processes.
- [ ] Installer installs and uninstalls cleanly.
- [ ] App runs on Windows 10 and Windows 11 without Node installed.

## 8. Testing & Skills package

### 8.1 Testing strategy

**Unit tests (Vitest)**
- One test file per module in `src/`, using small fixture videos (~1 MB) in `tests/fixtures/`.
- Cases per module: happy path, abort, missing input, invalid config.
- `_lib/runner.js` tested separately: progress throttling, abort propagation, log routing.
- Mock FFmpeg at `spawnFfmpeg` level for speed; keep 1–2 integration tests that invoke real FFmpeg on fixtures.

**Integration smoke (manual checklist)**
- Run installer on a clean Windows 10/11 VM.
- Run each task with a fixture set; verify output format and folder layout.
- Cancel mid-job; verify FFmpeg processes are gone.

**CI**
- Skipped in v1. If added later: GitHub Actions windows-latest runner running `npm test` + `npm run build:dir`.

**E2E**
- Playwright + Electron skipped in v1; revisit if UI bugs become frequent.

### 8.2 Skills package (deliverable)

Located at `.claude/skills/vidmaster/`. Documents both the conversion process and ongoing maintenance patterns.

| Skill | Purpose | When invoked |
|---|---|---|
| `SKILL.md` | Index + overview (root skill) | When user says "build/extend VidMaster" |
| `convert-cli-to-electron.md` | End-to-end process for converting a Node.js CLI to Electron | When converting a similar tool |
| `refactor-script-to-module.md` | Pattern: `process.argv` script → exported async function with progress/abort | When adding a new task module |
| `electron-queue-manager.md` | Pattern: Queue Manager singleton, IPC, cancel | When changing queue logic |
| `electron-ipc-contract.md` | `contextBridge` API structure and security defaults | When adding an IPC handler |
| `task-form-component.md` | Per-task UI form pattern (browse, advanced collapsible, validation) | When adding new task UI |
| `ffmpeg-progress-parsing.md` | Stderr parsing → percent, duration detection, throttling | When integrating FFmpeg into a new task |
| `electron-builder-windows.md` | electron-builder NSIS config, asarUnpack, native modules | When changing packaging |
| `vidmaster-workspace-layout.md` | Workspace folder layout + settings schema + migration | When changing settings schema |
| `add-new-task.md` | End-to-end checklist to add a new task (module + UI + sidebar item + tests) | When extending the app post-release |

Each skill follows the superpowers format:
```markdown
---
name: <skill-name>
description: <when this skill triggers>
---

# <Title>

## When to use
...

## Process
1. Step with concrete code/commands
2. ...

## Examples
- Before → After

## Pitfalls
- Common mistakes
```

`SKILL.md` (root) and `add-new-task.md` are the highest-priority skills — written first and most thoroughly. The remainder can be tighter (~50–100 lines each).

---

## Tasks added post-foundation

Each task added after the v1 foundation has its own design + plan doc:

- **Thumb Avatar** — see [2026-05-07-vidmaster-thumb-avatar-design.md](2026-05-07-vidmaster-thumb-avatar-design.md)
- **YouTube tasks (GetUrls, Download, ConcatHeadTail)** — see [2026-05-07-vidmaster-youtube-tasks-design.md](2026-05-07-vidmaster-youtube-tasks-design.md)
- **Trend Search** (keyword → trending videos + channels with Gemini "why hot" analysis) — see [2026-05-09-trend-search-design.md](2026-05-09-trend-search-design.md)
