---
name: vidmaster
description: Use when working on the VidMaster desktop app — adding tasks, refactoring scripts, changing queue/IPC, or repackaging. Loads the skill index.
---

# VidMaster Skills

## When to use

Invoke this skill whenever the request touches the VidMaster project — typically when the working directory is `d:\Project2\vidmaster-desktop` (or a clone), or when the user mentions "VidMaster", "vid-master", or one of the four task names (Render, Snow, Trim, CutBg).

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
