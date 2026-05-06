# Task form validation & user notification

**Date:** 2026-05-06
**Scope:** `electron/renderer/components/taskForm.js` + per-screen field schemas + small main-process IPC.

## Problem

When a user clicks "Thêm vào hàng đợi" with missing/invalid input, the form silently does nothing. Two failure modes:

1. **HTML5 validation on hidden field** — invalid fields inside collapsed `<details>` cause "An invalid form control with name='X' is not focusable", swallowed silently. (Already partially mitigated by setting `step="any"` on `opacity`, but the class of bug remains.)
2. **No path-existence check** — user can type/paste a non-existent folder; task gets queued and crashes minutes later when the runner tries to read it.

End-user receives no feedback in either case.

## Goals

- A submit attempt with insufficient data **always** produces a visible notification.
- Required input fields are declared in the field schema, not hardcoded.
- Folder/file paths declared as inputs (read by the runner) are checked for existence before the task is queued.
- Output folders are *not* existence-checked (runners create them).
- Numeric range errors continue to use HTML5 native validation (free, already wired).

## Non-goals

- Validating folder *content* (e.g., overlays folder must contain images). Runners already report errors for empty inputs; that path stays as-is and surfaces via the existing error-modal flow on `j.status === "error"`.
- Per-field inline error UI. Toast is the single notification surface.
- Async validation on blur. Validation runs only at submit time.

## Design

### Field schema additions

`taskForm.js` field objects gain two optional props:

| Prop | Type | Meaning |
|---|---|---|
| `required` | `boolean` | Empty value blocks submit. Reported via toast (no HTML5 `required` attribute — keeps notification surface unified). |
| `mustExist` | `"folder" \| "file"` | Path must exist on disk and match the kind. Skipped if value is empty (`required` covers that). |

### Submit flow (`bindTaskForm` in `taskForm.js`)

1. Programmatically open all `<details>` ancestors (`formEl.querySelectorAll("details").forEach(d => d.open = true)`). Prevents the "not focusable" error and lets HTML5 popups point at the right field.
2. Call `formEl.reportValidity()`. If false → return; native popup is shown.
3. Collect config from inputs (existing logic).
4. Run async validation:
   - For each field with `required: true` and an empty trimmed value → push `{label, reason: "trống"}` to errors.
   - For each field with `mustExist` and a non-empty value → call `window.api.fs.exists(path)` in parallel; if `!exists` → reason `"không tồn tại"`; if exists but kind mismatch (expected folder got file or vice versa) → reason `"sai loại"`.
5. If errors non-empty → `toast({ kind: "error", message: "Thiếu dữ liệu: " + errors.map(e => `${e.label} (${e.reason})`).join(", ") })`. Return.
6. Pass → existing `queue.add(...)` + `settings.set(...)`. Then `toast({ kind: "success", message: "✅ Đã thêm vào hàng đợi" })`.

### New IPC: `fs:exists`

New file `electron/ipc/fs.js`:

```js
import { ipcMain } from "electron";
import { statSync } from "fs";

export function registerFsIpc() {
  ipcMain.handle("fs:exists", (_, p) => {
    if (!p) return { exists: false };
    try {
      const s = statSync(p);
      return { exists: true, isFolder: s.isDirectory(), isFile: s.isFile() };
    } catch { return { exists: false }; }
  });
}
```

Wired in `electron/main.js` alongside the other `register*Ipc` calls. Exposed in `electron/preload.mjs` as:

```js
fs: { exists: (p) => ipcRenderer.invoke("fs:exists", p) },
```

### Toast extracted to module

`toast()` currently lives inside `electron/renderer/main.js` closure. Move to `electron/renderer/components/toast.js` exporting `toast({ message, kind, onClick })` and create the container lazily on first call. `main.js` imports it; `taskForm.js` imports it. No behavior change for existing call sites.

### Per-screen schema updates

For each screen, mark input paths as `required + mustExist`, output/temp paths as `required` only:

| Screen | Field path | required | mustExist |
|---|---|---|---|
| render | `inputs.overlays` | ✓ | folder |
| render | `inputs.backgrounds` | ✓ | folder |
| render | `output` | ✓ | — |
| snow | input folder field | ✓ | folder |
| snow | `snowAsset` | ✓ | file |
| snow | output folder field | ✓ | — |
| trim | input folder | ✓ | folder |
| trim | output folder (if separate) | ✓ | — |
| cutBg | input folder | ✓ | folder |
| cutBg | output folder | ✓ | — |
| thumb | input folder | ✓ | folder |
| thumb | output folder | ✓ | — |
| concat | input folder | ✓ | folder |
| concat | `tempDir` | ✓ | — |
| concat | output folder | ✓ | — |
| rename | input folder | ✓ | folder |

Exact field paths per screen are confirmed during implementation by reading each `screens/*.js`.

### Notification policy

- **Folder/file `required` empty** → toast (unified UX, no native popup for paths).
- **Folder/file `mustExist` missing** → toast.
- **Number out of range / wrong step** → native HTML5 popup (since `<details>` is now opened first, browser can focus the field).
- **Success** → green toast confirming the task was queued.

## Testing

- Unit test (vitest): in `tests/`, add `taskForm.validation.test.js` if feasible — but `taskForm.js` runs only in renderer (no DOM in vitest by default). If headless DOM testing is too costly, document manual test cases instead.
- Manual test matrix:
  1. Render screen, clear "Folder overlays", click submit → red toast lists "Folder overlays (trống)".
  2. Type fake path in "Folder backgrounds", click submit → red toast lists "Folder backgrounds (không tồn tại)".
  3. Open advanced, set opacity = 5, click submit → native popup on opacity (now focusable because details auto-opens).
  4. All fields valid → green toast "Đã thêm vào hàng đợi", task appears in queue dock.

## Open questions

None — design approved by user 2026-05-06.

## Files touched

- `electron/renderer/components/taskForm.js` — schema support + validation flow
- `electron/renderer/components/toast.js` — **new**
- `electron/renderer/main.js` — import toast from new module instead of local helper
- `electron/ipc/fs.js` — **new**
- `electron/main.js` — register fs IPC
- `electron/preload.mjs` — expose `fs.exists`
- `electron/renderer/screens/{render,snow,trim,cutBg,thumb,concat,rename}.js` — mark fields required/mustExist
