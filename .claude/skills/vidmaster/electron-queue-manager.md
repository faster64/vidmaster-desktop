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
