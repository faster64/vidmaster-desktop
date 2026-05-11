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

The Plan 1 ports of `trim`, `cutBg`, `snow`, `render` are the four worked examples — each followed steps 1–3 above. Plan 2 then added each one through steps 4–8.

## Pitfalls

- **Skipping the tests.** Without TDD, the queue silently fails on submit because the runner returns `undefined`.
- **Forgetting the router map.** The task screen module exists but `navigate("watermark")` does nothing — silent.
- **Wrong workspace defaults.** Pre-fills point to non-existent folders → user immediately gets ENOENT before they understand what the task does.
- **Not adding the task to `TASK_LABELS`.** Queue dock and toasts show the raw type id (`"watermark"`) instead of the friendly Vietnamese label.
