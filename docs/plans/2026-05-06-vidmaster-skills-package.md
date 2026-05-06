# VidMaster — Plan 4: Skills Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.
>
> **NOTE:** **Do NOT run `git commit` or `git init`.** Leave changes for manual review.

**Goal:** Write the 10 Claude superpowers skills that document the conversion process and ongoing maintenance patterns. After Plan 4, anyone (human or Claude) can use these skills to extend VidMaster (add a new task, change the queue, repackage) without re-deriving the design.

**Architecture:** Skills are flat `.md` files under `.claude/skills/vidmaster/` with superpowers frontmatter. They describe **patterns and processes**, not code dumps — the code already exists in the repo for reference. Each skill stays under ~150 lines unless it carries a non-trivial process (e.g., `convert-cli-to-electron.md` is allowed up to ~250 lines).

**Tech Stack:** Markdown only.

**Plans 1–3 prerequisites:**
- All 7 task modules under `src/` (Plan 1)
- Electron shell + 9 screens + Queue Manager + IPC (Plan 2)
- electron-builder config + GPU detect + log forwarding (Plan 3)
- The implemented code IS the source of truth for skill content. Each skill should reference real files + line ranges, not paraphrase.

---

## File Structure

Files this plan creates:

```
vidmaster-desktop/
└── .claude/
    └── skills/
        └── vidmaster/
            ├── SKILL.md
            ├── convert-cli-to-electron.md
            ├── refactor-script-to-module.md
            ├── electron-queue-manager.md
            ├── electron-ipc-contract.md
            ├── task-form-component.md
            ├── ffmpeg-progress-parsing.md
            ├── electron-builder-windows.md
            ├── vidmaster-workspace-layout.md
            └── add-new-task.md
```

The `.claude/skills/vidmaster/` directory was created in Plan 0 (brainstorming setup); confirm it still exists before writing files.

---

## Skill template (apply to all 10 files)

Every skill file MUST have this structure:

```markdown
---
name: <skill-name-kebab-case>
description: <one sentence — when to invoke this skill, ≤120 chars>
---

# <Title>

## When to use

<2–4 sentences describing the trigger conditions.>

## Process

<Numbered list of concrete steps. Reference real files via [path](relative/path.js#L42-L60) markdown links where useful.>

## Examples

<1–2 short before/after snippets showing the pattern in practice.>

## Pitfalls

<Bulleted list of common mistakes to avoid.>
```

The `description` field is what Claude pattern-matches against in future sessions — be specific, not generic.

---

## Task 1: `SKILL.md` (root index)

**Files:**
- Create: `.claude/skills/vidmaster/SKILL.md`

The root skill is the entry point. It tells Claude when *any* of the VidMaster skills apply and points at the specialised ones.

- [ ] **Step 1.1: Create `SKILL.md`**

```markdown
---
name: vidmaster
description: Use when working on the VidMaster desktop app — adding tasks, refactoring scripts, changing queue/IPC, or repackaging. Loads the skill index.
---

# VidMaster Skills

## When to use

Invoke this skill whenever the request touches the VidMaster project — typically when the working directory is `d:\Project2\vidmaster-desktop` (or a clone), or when the user mentions "VidMaster", "vid-master", or one of the seven task names (Render, Snow, Trim, CutBg, Thumb, Concat, Rename).

## Index of sub-skills

- **convert-cli-to-electron** — top-level recipe for porting a Node.js CLI tool to an Electron desktop app. Use when starting a similar conversion from scratch.
- **refactor-script-to-module** — pattern for converting a `process.argv`-driven script into an exported async module function with progress + abort.
- **electron-queue-manager** — singleton Queue Manager pattern: serial executor, IPC events, cancel propagation.
- **electron-ipc-contract** — `contextBridge` API shape, security defaults, naming conventions.
- **task-form-component** — shared per-task UI template (`taskForm.js`): folder pickers, advanced section, validation, last-config persistence.
- **ffmpeg-progress-parsing** — parsing `time=HH:MM:SS.ms` from FFmpeg stderr to drive progress bars.
- **electron-builder-windows** — `electron-builder` NSIS config, `asarUnpack`, native module rebuild.
- **vidmaster-workspace-layout** — workspace folder layout, settings schema, settings migration hook.
- **add-new-task** — end-to-end checklist for adding an 8th task: module, test, screen, sidebar item.

## Working with VidMaster

- Source of truth for design: `docs/specs/2026-05-06-vidmaster-desktop-app-design.md`.
- Plans: `docs/plans/2026-05-06-vidmaster-{foundation,electron-shell-ui,polish-packaging,skills-package}.md`.
- Tests: `npm test` from project root. All changes that touch `src/` or `electron/` must keep tests green.
- The user has a standing instruction to **not auto-commit**. Leave changes unstaged for manual review.
```

---

## Task 2: `convert-cli-to-electron.md`

**Files:**
- Create: `.claude/skills/vidmaster/convert-cli-to-electron.md`

This is the highest-leverage skill — captures the whole conversion recipe so a similar tool could be migrated using it as a template.

- [ ] **Step 2.1: Create `convert-cli-to-electron.md`**

```markdown
---
name: convert-cli-to-electron
description: Recipe for porting a Node.js CLI tool (inquirer/argv-driven) to a Windows Electron desktop app with serial queue and per-task forms.
---

# Convert CLI to Electron

## When to use

When you need to turn a CLI tool that runs scripts via `node script.js [args]` into a desktop app for non-technical users. The source tool typically:

- Uses `inquirer` or `process.argv` for input
- Has 5–15 independent processing scripts that produce file output
- Is internal-use (no public distribution, no code signing required)

If the tool needs cloud sync, multi-user, or auto-update — this skill's scope is too narrow; consult a fuller framework guide instead.

## Process

Plan the conversion in four phases. Each phase produces a testable deliverable. See `docs/plans/2026-05-06-vidmaster-{foundation,electron-shell-ui,polish-packaging,skills-package}.md` for the executed reference plan.

### Phase 1 — Foundation (modules + tests)

1. Create the new project alongside the old (do NOT modify the source). New `package.json` with only the runtime deps the new app needs (drop CLI deps like `inquirer`, integrations like `discord.js`, etc).
2. Set up Vitest. Generate small test fixtures (a 1-second `.mp4`, a 320×180 `.png`).
3. Build shared utilities first: `AbortError` + `throwIfAborted`, then `spawnFfmpeg(args, {totalDurationSec, onProgress, signal})`, then `TaskRunner` (log routing + progress throttle + abort check).
4. Port each script to `src/<name>.js` exporting `runX(config)` per the **refactor-script-to-module** skill. Test each module with abort + happy-path tests using fixtures.

### Phase 2 — Electron shell + UI

1. Add `electron`, `electron-store`, `electron-log` to deps. Set `"main": "electron/main.js"`, add `"dev": "electron ."`.
2. Build `electron/main.js`: window creation, no menu, contextIsolation true.
3. Build the singleton **Queue Manager** (see electron-queue-manager skill).
4. Build IPC handlers under `electron/ipc/`: queue, settings, dialog, shell, app, log.
5. Build the renderer with vanilla HTML/CSS/JS — no bundler unless the UI grows. ESM via `<script type="module">`. Single-page, hash-based router.
6. Build a shared **task form component** (see task-form-component skill) and a screen per task that just configures fields + defaults + lastConfig.
7. Build Sidebar + Queue dock + Queue full screen + Settings + Onboarding.

### Phase 3 — Polish + packaging

1. Auto-detect GPU encoder on first launch (`ffmpeg -encoders` parsing).
2. Forward per-job log ring buffers (last 200 lines) to the renderer error modal.
3. Generate a placeholder app icon. Convert to multi-resolution `.ico`.
4. Configure `electron-builder` NSIS — per-user install, no code signing in v1, `asarUnpack` for native modules.
5. Build directory artifact (`build:dir`), then installer (`build`).
6. Run the manual pre-release smoke checklist on a clean Windows VM.

### Phase 4 — Skills

Document the patterns you actually used (not the patterns you considered). One skill per pattern, ≤150 lines each.

## Examples

The reference conversion took the `vid-master` CLI (10 scripts, ~1700 LOC) to a working `.exe` installer in 4 plans / ~50 + ~70 + ~30 + 10 = ~160 atomic implementation steps. See `docs/specs/2026-05-06-vidmaster-desktop-app-design.md` for the resulting architecture.

## Pitfalls

- **Don't try to swap fluent-ffmpeg chains for raw `spawnFfmpeg` everywhere at once.** For complex chains with per-event callbacks, keeping fluent and tracking progress at file-count granularity is acceptable for v1.
- **Don't introduce a bundler "just in case".** Vanilla ESM in the renderer keeps cognitive load low and works fine until the UI exceeds ~3000 LOC.
- **Don't auto-detect GPU on every boot.** Run once when `encoder === "auto"`, then persist.
- **Don't `asarUnpack: ["**/node_modules/**"]`.** Be specific (`@ffmpeg-installer`, `ffmpeg-static`, `sharp`) — broad globs balloon installer size.
- **Don't omit per-job log ring buffers.** Without them, error modals show only stack traces — debugging FFmpeg failures becomes painful.
- **Don't use `oneClick: true` NSIS** — it skips the install path picker, which is hostile to anyone who keeps a small `C:`.
```

---

## Task 3: `refactor-script-to-module.md`

**Files:**
- Create: `.claude/skills/vidmaster/refactor-script-to-module.md`

- [ ] **Step 3.1: Create `refactor-script-to-module.md`**

```markdown
---
name: refactor-script-to-module
description: Convert a Node.js script that runs at import time (process.argv, hardcoded paths, console.log) into an exported async function with progress and abort support.
---

# Refactor script to module

## When to use

When porting a CLI script into a library function — typically because it will be called from a desktop app, a queue, a test, or any context where:

- Imports must NOT have side effects
- Inputs come from a config object, not `process.argv`
- Progress and cancel must be observable
- Errors must be returned, not `process.exit`'d

## Process

Apply these eight transformations in order. After each, run tests.

1. **Wrap the body**: replace the top-level execution with `export async function runX(config) { ... }`. Move all top-level code inside.

2. **Remove `process.argv` parsing**: pull values from `config.<field>` instead. Keep the same names where reasonable.

3. **Parameterize file paths**: every literal `"./folder"` becomes `config.<name>`. Validate presence at the top — throw `Error(\`Missing config: <name>\`)` rather than silently defaulting.

4. **Construct a `TaskRunner`** at the top: `const runner = new TaskRunner(config);`. The runner reads `signal`, `onProgress`, `onLog` from `config`. See `src/_lib/runner.js`.

5. **Replace logging**: every `console.log(msg)` → `runner.log("info", msg)`. `console.error` → `runner.log("error", ...)`. Custom `log()` helpers (e.g. `render.js` had one writing to `./render.log`) are deleted entirely — `electron-log` covers that path now.

6. **Inject abort checks**: `runner.checkAborted()` at the top of every outer `for` loop iterating over input files, plus before any expensive operation. The runner throws `AbortError`, which propagates up to the queue.

7. **Replace direct ffmpeg calls** with `runner.spawnFfmpeg(args, { totalDurationSec })` where the chain is straightforward. Where the source uses `fluent-ffmpeg` with per-event callbacks (`.on("progress", ...)`, `.on("end", ...)`), it is acceptable to keep fluent — wrap the resulting promise with `runner.checkAborted()` between iterations and emit progress at file-count granularity.

8. **Return `{ ok, outputs, errors }`** instead of `process.exit`. Per-file failures push to a local `errors` array; the function continues unless the error is `AbortError` (which always re-throws).

## Examples

**Before** (`vid-master/convertNormalize.js`):

```js
import fs from "fs";
const rootFolder = "./thumbs";
function normalizeFilenamesRecursively(p) { /* recurses, console.logs */ }
normalizeFilenamesRecursively(rootFolder); // top-level side effect!
```

**After** (`src/rename.js`):

```js
import { TaskRunner } from "./_lib/runner.js";
export async function runRename(config) {
  const runner = new TaskRunner(config);
  runner.checkAborted();
  const renamed = [];
  walk(config.folder, runner, renamed);
  return { ok: true, outputs: renamed, errors: [] };
}
```

## Pitfalls

- **Forgetting to remove top-level side effects.** If `normalizeFilenamesRecursively(rootFolder)` is left at the bottom, importing the module triggers a renaming run.
- **Hardcoding even one path.** A `path.join(__dirname, "thumbs")` is still a hardcoded path. Everything must come from config.
- **Catching `AbortError` and continuing.** The pattern is: catch all errors, but if `err.name === "AbortError"`, re-throw immediately. Otherwise the cancel button does nothing.
- **Not surfacing `signal` to FFmpeg.** `runner.spawnFfmpeg` does this automatically; manual `spawn` calls must call `child.kill("SIGTERM")` on abort.
- **Returning truthy `ok` when `errors.length > 0`.** Always: `ok: errors.length === 0`.
```

---

## Task 4: `electron-queue-manager.md`

**Files:**
- Create: `.claude/skills/vidmaster/electron-queue-manager.md`

- [ ] **Step 4.1: Create `electron-queue-manager.md`**

```markdown
---
name: electron-queue-manager
description: Singleton serial queue pattern in Electron main — pending/running/completed state, AbortController per job, IPC events to renderer, in-memory history.
---

# Electron Queue Manager

## When to use

When the app runs long, exclusive jobs (video encoding, large file ops) and the user must:

- See a single source of truth for what's running, queued, and done
- Cancel any job
- Run jobs serially (one at a time) without race conditions on shared resources (GPU, FFmpeg, disk)

## Process

1. **Singleton in main process.** The Queue Manager is constructed once in `electron/ipc/queue.js` and reused. Never instantiate per IPC call.

2. **State shape:**
   - `pending: Job[]`
   - `running: Job | null` (max one)
   - `completed: Job[]` (capped, default 50, FIFO drop-oldest)

3. **Job shape:** `{ id, type, config, status, progress, message, createdAt, controller?, result?, error?, logs? }`. The `controller` is an `AbortController`; the `_public(job)` helper strips it before sending to the renderer.

4. **API surface:**
   - `add({ type, config }) → { jobId }` — push to `pending`, kick `_maybeStart()`, emit update.
   - `cancel(jobId)` — if running, `running.controller.abort()`; if pending, splice + push to completed with `status="cancelled"`.
   - `clear()` — empty `completed`, emit update.
   - `getState()` — public snapshot.

5. **Runner dispatch:** `_maybeStart()` pops one pending job, sets `running`, creates the controller, and calls `runners[type]({ ...config, signal, onProgress, onLog })`. The runners map is wired at construction.

6. **Result handling:**
   - Resolved with `{ok:true,...}` → `status="done"`.
   - Resolved with `{ok:false,...}` → `status="error"`, `error.details = result.errors`.
   - Rejected with `AbortError` → `status="cancelled"`.
   - Rejected with anything else → `status="error"`, `error = { message, stack }`.
   - All paths call `_finish(job)` which moves to completed, emits, and starts the next.

7. **Progress + log forwarding:**
   - `onProgress(pct, msg)` mutates `job.progress` and `job.message`, then calls `_emit()`. The `TaskRunner` already throttles to 2/sec, so no further throttling is needed.
   - `onLog(level, line)` pushes to `job.logs` (capped at 200 entries) for the error-modal recent-log surface.

8. **IPC events:** `onUpdate(state)` fires after every state mutation. The IPC layer wires it to `webContents.send("queue:update", state)`.

## Examples

```js
// Construction (electron/ipc/queue.js)
const queue = new QueueManager({
  runners: { render: runRender, trim: runTrim, /* ... */ },
  onUpdate: (state) => getMainWindow()?.webContents.send("queue:update", state),
  historySize: 50,
});
ipcMain.handle("queue:add", (_, spec) => queue.add(spec));
```

## Pitfalls

- **Don't persist the queue across restarts.** Spec explicitly accepts the trade-off; persistence introduces edge cases (jobs partway through, file locks, etc).
- **Don't expose `controller` to the renderer.** Use `_public(job)` to strip it; otherwise the IPC clone fails on `AbortController`.
- **Don't allow `maxConcurrent > 1` here.** This manager is intentionally serial. Internal parallelism (`p-limit`) lives inside individual task modules.
- **Don't forget to re-emit after `_pushCompleted`.** A subtle bug if the cancel path skips `_emit()` — the renderer will not show the cancellation immediately.
```

---

## Task 5: `electron-ipc-contract.md`

**Files:**
- Create: `.claude/skills/vidmaster/electron-ipc-contract.md`

- [ ] **Step 5.1: Create `electron-ipc-contract.md`**

```markdown
---
name: electron-ipc-contract
description: contextBridge IPC pattern — namespaced window.api, Promise-returning invoke handlers, push events with subscribe/unsubscribe, security defaults.
---

# Electron IPC contract

## When to use

When designing or extending the renderer↔main communication surface in an Electron app with `contextIsolation: true` and `nodeIntegration: false` (the secure defaults).

## Process

1. **Single namespace:** expose one object as `window.api`. Group calls into sub-namespaces (`api.queue`, `api.settings`, `api.dialog`, …). Never expose `ipcRenderer` directly.

2. **Two patterns only:**
   - **invoke/handle** for request/response: `ipcRenderer.invoke("foo:bar", arg) → Promise<result>` paired with `ipcMain.handle("foo:bar", (_, arg) => result)`.
   - **on/send** for push events: `webContents.send("foo:update", state)` from main, captured by a single `ipcRenderer.on(...)` in preload that fans out to subscribers.

3. **Subscribe/unsubscribe pattern for push events:**

   ```js
   const subs = new Set();
   ipcRenderer.on("queue:update", (_, s) => subs.forEach((cb) => cb(s)));
   contextBridge.exposeInMainWorld("api", {
     queue: {
       onUpdate: (cb) => { subs.add(cb); return () => subs.delete(cb); },
     },
   });
   ```
   The returned function is the unsubscribe handle — store it and call on screen unmount.

4. **Channel naming:** `<namespace>:<verb>`. Verbs: `get`, `set`, `add`, `cancel`, `clear`, `pickFolder`, `openFolder`, etc. Stay imperative; avoid `do-foo` prefixes.

5. **Security defaults (non-negotiable):**
   - `contextIsolation: true`
   - `nodeIntegration: false`
   - `sandbox: false` only because preload uses Node modules; never pair with `nodeIntegration: true`.
   - CSP `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';">` in `index.html`.

6. **Schema discipline:** the renderer never trusts main-process data, but main never trusts renderer args either. Validate inputs in `ipcMain.handle`.

## Examples

```js
// preload.js
contextBridge.exposeInMainWorld("api", {
  queue: {
    add: (spec) => ipcRenderer.invoke("queue:add", spec),
    onUpdate: (cb) => { subs.add(cb); return () => subs.delete(cb); },
  },
  dialog: {
    pickFolder: (defaultPath) => ipcRenderer.invoke("dialog:pickFolder", defaultPath),
  },
});

// main (handler)
ipcMain.handle("dialog:pickFolder", async (_, defaultPath) => {
  const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
    properties: ["openDirectory", "createDirectory"],
    defaultPath,
  });
  return r.canceled ? null : r.filePaths[0];
});
```

## Pitfalls

- **Exposing `ipcRenderer` directly.** Defeats `contextIsolation`. Always wrap in named, typed methods.
- **Forgetting the unsubscribe return.** Memory leak: every screen mount adds a subscriber that is never removed.
- **Returning non-cloneable objects from handlers** (functions, classes with private fields, `AbortController`). Strip before returning.
- **Mixing invoke and send.** Pick one per channel — don't `webContents.send` *and* `ipcMain.handle` the same channel name.
```

---

## Task 6: `task-form-component.md`

**Files:**
- Create: `.claude/skills/vidmaster/task-form-component.md`

- [ ] **Step 6.1: Create `task-form-component.md`**

```markdown
---
name: task-form-component
description: Shared per-task UI form pattern — folder/number/checkbox/text fields, advanced collapsible, last-config persistence, native folder picker integration.
---

# Task form component

## When to use

When adding a new task screen or changing a field on an existing one in `electron/renderer/screens/`. The shared component is `electron/renderer/components/taskForm.js`.

## Process

1. **Define `defaults`**: a plain object whose keys mirror the task's runner config. Values come from workspace defaults + settings (e.g. `${ws}\\overlays`).

2. **Define `fields`**: an array describing top-level form fields. Each entry: `{ type, path, label, help?, min?, default? }`.
   - `type`: `"folder" | "number" | "checkbox" | "text"`.
   - `path`: dotted path into the config (e.g., `"inputs.overlays"`, `"chromaKey.color"`).
   - `label`: Vietnamese label shown above the input.

3. **Define `advanced`** (optional): same shape as `fields`, rendered inside `<details class="advanced">`. Use this for params that have sensible defaults most users won't change (chroma color, opacity, GPU toggle).

4. **Render via `taskFormShell({...})`** — returns the HTML string. Mount with `el.innerHTML = ...`.

5. **Bind via `bindTaskForm(formEl, { fields: [...fields, ...advanced], taskType, defaults })`**. This wires:
   - Folder picker buttons → `window.api.dialog.pickFolder()`.
   - "Reset to defaults" button.
   - Submit → `window.api.queue.add({ type: taskType, config })` then `settings.set({ \`lastConfig.${taskType}\`: config })`.

6. **Pre-fill order:** `lastConfig.<type>` (per-task storage) > `defaults` (workspace + settings) > `field.default` > `""`.

## Examples

`electron/renderer/screens/trim.js`:

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
    description: "Cắt mỗi video trong folder thành các đoạn ngắn.",
    fields, advanced: [], taskType: "trim", lastConfig: s.lastConfig?.trim, defaults,
  });
  bindTaskForm(el.querySelector("#task-form"), { fields, taskType: "trim", defaults });
}
```

## Pitfalls

- **Forgetting to include `advanced` fields in the bind call.** They render but won't be picked up by submit. Always pass `[...fields, ...advanced]` to `bindTaskForm`.
- **Using the same `path` twice.** Form serialisation overwrites. Each path must be unique within the screen.
- **Storing absolute paths in `lastConfig`** without considering workspace changes. If the user moves their workspace, prior `lastConfig` paths still point to the old location — this is acceptable in v1 (user re-picks via "Reset"), but flag if it becomes painful.
- **Not escaping the field value when rendering.** `taskFormShell` already escapes via the internal `escape()` helper; don't bypass it with raw template strings.
```

---

## Task 7: `ffmpeg-progress-parsing.md`

**Files:**
- Create: `.claude/skills/vidmaster/ffmpeg-progress-parsing.md`

- [ ] **Step 7.1: Create `ffmpeg-progress-parsing.md`**

```markdown
---
name: ffmpeg-progress-parsing
description: Parse FFmpeg stderr time= lines into a percent against a known total duration; throttle and forward via TaskRunner.
---

# FFmpeg progress parsing

## When to use

Whenever a task needs to drive a progress bar from an FFmpeg invocation. Reference: `src/_lib/ffmpeg.js` (the `spawnFfmpeg` function).

## Process

1. **Know the total duration up front.** FFmpeg only emits `time=` (current position); to compute `percent`, you must already know `totalDurationSec`. Sources:
   - For trim/cutBg: probe the input via `ffmpeg.ffprobe(file)` → `meta.format.duration`.
   - For render: pre-known clip length (e.g., `THUMB_DURATION + clipLen`).
   - For unknown lengths: don't show a percent; show indeterminate spinner instead.

2. **Regex on stderr lines:** `time=(\d+):(\d+):(\d+\.\d+)`. Capture groups → seconds: `h*3600 + m*60 + s`.

3. **Compute percent:** `Math.min(100, sec / totalDurationSec * 100)`. Cap at 100 — FFmpeg sometimes overshoots by ~1% due to timestamp rounding.

4. **Throttle inside TaskRunner.** Don't throttle in `spawnFfmpeg` — it just emits raw values. `TaskRunner.setProgress` enforces ≥500 ms between emits, and bypasses for the final 100% tick.

5. **Multi-stage progress:** when a task has N FFmpeg stages (e.g., probe → encode → mux), pass `stageOffset` and `stageWeight` to `runner.spawnFfmpeg`. Example: stage 1 covers 0–50%, stage 2 covers 50–100% → `{ stageOffset: 0, stageWeight: 0.5 }` then `{ stageOffset: 50, stageWeight: 0.5 }`.

6. **Abort propagation:** `spawnFfmpeg` already calls `child.kill("SIGTERM")` when `signal.aborted` fires. Re-check it via `runner.checkAborted()` before each *next* invocation, so a queued series of FFmpeg calls aborts between iterations.

## Examples

```js
// Single-stage encode
await runner.spawnFfmpeg(
  ["-y", "-i", input, "-c:v", "libx264", "-preset", "fast", output],
  { totalDurationSec: probedDuration }
);
```

```js
// Two-stage: probe-then-encode reflected as 0–10% / 10–100%
const dur = await probe(input);
runner.setProgress(10, "Encoding...");
await runner.spawnFfmpeg([...args],
  { totalDurationSec: dur, stageOffset: 10, stageWeight: 0.9 });
```

## Pitfalls

- **Using fluent-ffmpeg `.on("progress")` for percent.** Its `progress.percent` field is unreliable for short clips and missing in some FFmpeg builds. Stick with stderr `time=` parsing.
- **Forgetting `windowsHide: true` on `spawn`.** A console window flashes on every FFmpeg call.
- **Computing `percent` against the input file's whole duration when only encoding a slice.** If you `-ss 30 -t 10` to grab a 10-second slice, `totalDurationSec` is 10, not the full file length.
- **Emitting progress synchronously every line.** With a fast machine you can fire 100/s — the renderer will jank. Always go through `TaskRunner.setProgress` (throttled).
```

---

## Task 8: `electron-builder-windows.md`

**Files:**
- Create: `.claude/skills/vidmaster/electron-builder-windows.md`

- [ ] **Step 8.1: Create `electron-builder-windows.md`**

```markdown
---
name: electron-builder-windows
description: Configure electron-builder for a Windows-only NSIS installer with native modules (sharp, ffmpeg) — asarUnpack, per-user install, no code signing.
---

# electron-builder for Windows

## When to use

When packaging an Electron app for internal Windows distribution and you must:

- Ship native binaries (`sharp`, FFmpeg)
- Avoid UAC prompts (per-user install)
- Skip code signing (acceptable internally — shows SmartScreen warning once)

## Process

1. **Install:** `npm install --save-dev electron-builder`. Use the major version that matches your Electron major (e.g., electron 30 → electron-builder ^25).

2. **Add `package.json > build`** with the canonical block:

   ```json
   {
     "appId": "com.example.app",
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
   ```

3. **`asarUnpack` is load-bearing.** Native modules and binary assets cannot be loaded from inside an asar archive. The glob `**/node_modules/{@ffmpeg-installer,ffmpeg-static,sharp}/**` covers nested deps. Don't broaden to `**/node_modules/**` — installer balloons.

4. **Build commands:**
   - `electron-builder --dir` — produces `dist/win-unpacked/` (no installer). Fast iteration; double-click the `.exe` inside to test.
   - `electron-builder --win --x64` — produces `dist/<Product> Setup <version>.exe` NSIS installer.

5. **Per-user install rationale:** `oneClick: false` + `perMachine: false` means no UAC prompt, install path picker shown, and the app is per-user. Trade-off: installer doesn't propagate to other Windows accounts on the same machine, but that's rarely a concern internally.

6. **Settings/log retention:** uninstaller deletes program files but leaves `%APPDATA%\<ProductName>\` intact (default behaviour). This is desirable — settings/logs persist across reinstalls.

## Examples

A single full build invocation:

```
npm run build
# → dist/VidMaster Setup 0.1.0.exe (~80–110 MB)
```

A directory build for fast manual testing:

```
npm run build:dir
# → dist/win-unpacked/VidMaster.exe
```

## Pitfalls

- **`asarUnpack` glob too broad.** Adding `**/node_modules/**` adds 100s of MB.
- **Forgetting to rebuild after schema changes.** Some changes (icon, asar contents) are not cached — but `package.json > build` changes always require a rebuild.
- **Setting `perMachine: true` casually.** Triggers UAC on every install. Only use if you genuinely need machine-wide install for service-like behaviour.
- **Code-signing skipped silently.** Add a SmartScreen note to README so users don't think the installer is malware on first launch.
- **Native binaries stripped.** If `sharp` errors with "Could not find the bindings file" after install, your `asarUnpack` didn't catch it. Verify the unpacked folder contains `node_modules/sharp/build/Release/*.node`.
- **Mismatched electron / electron-builder versions.** Major mismatch produces obscure failures during native rebuild. Pin both.
```

---

## Task 9: `vidmaster-workspace-layout.md`

**Files:**
- Create: `.claude/skills/vidmaster/vidmaster-workspace-layout.md`

- [ ] **Step 9.1: Create `vidmaster-workspace-layout.md`**

```markdown
---
name: vidmaster-workspace-layout
description: Workspace folder layout, settings schema, and migration hook used by VidMaster — required subfolders, default paths per task, schema versioning.
---

# VidMaster workspace layout

## When to use

When changing the workspace folder layout, adding/removing a default subfolder, or evolving the settings schema (e.g., new fields, renames). Reference: `electron/workspace.js` and `electron/settings.js`.

## Process

### Workspace folders

The user's workspace is a single root directory containing the following subfolders. They are auto-created on workspace selection and on every app launch (idempotent).

| Subfolder | Used by |
|---|---|
| `overlays/` | Render (input), Thumb (input thumbnails) |
| `backgrounds/` | Render (input), CutBg (input + output) |
| `combined_videos/` | Render (intermediate) |
| `done/` | Render (output), Concat (input), Trim (output) |
| `input/` | Snow (input), Trim (input) |
| `output/` | Snow (output), Concat (output) |
| `thumbs/` | Concat (input thumbs), Rename (target), Thumb (output) |
| `temp/` | Concat (scratch) |
| `overlays_convert/` | Thumb (overlay images) |

`REQUIRED_SUBFOLDERS` in `electron/workspace.js` is the source of truth. To add a new subfolder, also update `defaultsForTask()`.

### Settings schema

`electron/settings.js > DEFAULTS` defines the schema. Layout:

```js
{
  version: 1,
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
  lastConfig: {},  // keyed by task type
}
```

### Schema migration

When changing the schema in a way that breaks compatibility:

1. Bump `SCHEMA_VERSION` in `electron/settings.js`.
2. Add a `migrate(old)` function that takes the previous schema and returns the new one.
3. In `createSettings()`, after loading: if `store.get("version") < SCHEMA_VERSION`, run `migrate` and write the result back.
4. Add a Vitest unit test that loads a v1 fixture and asserts the v2 result.

### Adding a per-task config field

1. Add the field to the relevant `runX(config)` signature in `src/<task>.js`. Update tests.
2. Add the default value to `electron/settings.js > DEFAULTS` if it's user-configurable.
3. Add a field row to the relevant `electron/renderer/screens/<task>.js` via the task form template.
4. (Optional) add to Settings screen if it's a global-default, not per-task.

## Examples

Add a `frameRate` config to Render:

1. `src/render.js`: read `config.frameRate`, default 30 inside the function.
2. `electron/settings.js`: add `render.frameRate: 30` under DEFAULTS, bump `SCHEMA_VERSION` to 2 since old configs lack it. Add a migration that fills it in.
3. `electron/renderer/screens/render.js`: add `{ type: "number", path: "frameRate", label: "FPS", min: 1 }` to the `advanced` array.
4. Run tests: settings test should still pass; render test should still pass; migration test (new) should pass.

## Pitfalls

- **Forgetting to update `REQUIRED_SUBFOLDERS`.** New subfolders won't be created; tasks using them fail with `ENOENT` for non-technical users.
- **Not bumping `version`.** Old config files mixed with new code cause subtle bugs (undefined fields, wrong defaults).
- **Migrating in-place.** Always return a new object, write back fully — don't mutate. Easier to test.
- **Putting per-job settings into the global schema.** If it's per-task config (`lastConfig.<type>`), keep it under `lastConfig`, not at the top level.
```

---

## Task 10: `add-new-task.md`

**Files:**
- Create: `.claude/skills/vidmaster/add-new-task.md`

This is the user-facing checklist for adding an 8th task — the most common future change.

- [ ] **Step 10.1: Create `add-new-task.md`**

```markdown
---
name: add-new-task
description: End-to-end checklist for adding a new processing task to VidMaster — module + tests + sidebar item + screen + workspace defaults.
---

# Add a new task

## When to use

When adding an 8th processing task to VidMaster — e.g., "Convert to MP3", "Watermark batch", "Resize to 1080p".

## Process

Follow each step in order. After each, run `npm test`. The new task should not be visible in the UI until everything compiles and tests pass.

### 1. Design the config shape

Decide:
- Inputs: which workspace subfolders or files?
- Outputs: where do results go?
- Params: which user-tunable values?
- Advanced params: which sensible defaults can hide?

Write the runner signature on paper before coding:

```
runWatermark({ input, output, watermark, opacity, signal, onProgress, onLog }) → { ok, outputs, errors }
```

### 2. Implement the module

Create `src/watermark.js` following **refactor-script-to-module**. Use `TaskRunner` for log + progress + abort. If FFmpeg is involved, prefer `runner.spawnFfmpeg` — see **ffmpeg-progress-parsing**.

### 3. Write the tests

Create `tests/watermark.test.js` with at least:
- One happy-path test using `tests/fixtures/tiny.mp4` or `tiny.png`.
- One abort test (`signal.aborted` before run → throws `AbortError`).
- One missing-input test (clear error message).

Run `npm test -- tests/watermark.test.js` until green.

### 4. Wire into the queue

`electron/ipc/queue.js`: add `watermark: runWatermark` to the `runners` map. Add `import { runWatermark } from "../../src/watermark.js"`.

### 5. Add workspace defaults

`electron/workspace.js > defaultsForTask()`: add a `case "watermark"` returning the input/output paths under the workspace.

### 6. Add a sidebar item

`electron/renderer/components/sidebar.js`: add `{ id: "watermark", icon: "💧", label: "Watermark hàng loạt" }` to the Tasks group.

### 7. Add the screen

`electron/renderer/screens/watermark.js`: implement `renderWatermark(el)` using **task-form-component** pattern. Define `defaults`, `fields`, optional `advanced`. Call `taskFormShell` + `bindTaskForm`.

### 8. Register the screen in the router

`electron/renderer/main.js`: import `renderWatermark` and add `{ watermark: renderWatermark, ... }` to the `screens` map. Also add the task type to `TASK_LABELS`.

### 9. (Optional) settings defaults

If the task has a global-default param (e.g., `defaultWatermark` path), add it to `electron/settings.js > DEFAULTS`. See **vidmaster-workspace-layout**.

### 10. Smoke test

Run `npm run dev`. Click the new sidebar item. Submit a job with valid input. Verify it queues, runs, completes, and shows in the Queue screen.

### 11. Update tests count

Update Plan/spec docs so the cumulative test count stays accurate (cosmetic but helpful).

## Examples

The Plan 1 ports of `rename`, `trim`, `cutBg`, `thumb`, `snow`, `concat`, `render` are the seven worked examples — each followed steps 1–3 above. Plan 2 then added each one through steps 4–8.

## Pitfalls

- **Skipping the tests.** Without TDD, the queue silently fails on submit because the runner returns `undefined`.
- **Forgetting the router map.** The task screen module exists but `navigate("watermark")` does nothing — silent.
- **Wrong workspace defaults.** Pre-fills point to non-existent folders → user immediately gets ENOENT before they understand what the task does.
- **Not adding the task to `TASK_LABELS`.** Queue dock and toasts show the raw type id (`"watermark"`) instead of the friendly Vietnamese label.
```

---

## Task 11: Verify all skills + done criteria

- [ ] **Step 11.1: Verify all 10 skills exist and have valid frontmatter**

Run from project root:
```
ls .claude/skills/vidmaster/
```
Expected: 10 `.md` files (`SKILL.md` + 9 sub-skills).

For each, verify frontmatter:
```
head -5 .claude/skills/vidmaster/<file>.md
```
Each must start with `---`, have `name: <kebab-case>`, `description: <sentence>`, end with `---`.

- [ ] **Step 11.2: Verify markdown is renderable**

Open one in VSCode preview. Check no broken syntax (unclosed code blocks, broken tables).

- [ ] **Step 11.3: Plan 4 done criteria**

- [ ] All 10 skill files exist under `.claude/skills/vidmaster/`.
- [ ] Each has valid frontmatter (`name`, `description`).
- [ ] Each describes a real pattern present in the implemented code.
- [ ] `SKILL.md` indexes the other 9.
- [ ] No skill references files or symbols that don't exist (run a quick grep against `src/` and `electron/`).
- [ ] User has reviewed at least 2 skills (`add-new-task.md` and one other) and confirmed accuracy.
