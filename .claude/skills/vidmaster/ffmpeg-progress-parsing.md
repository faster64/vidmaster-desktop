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
