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
