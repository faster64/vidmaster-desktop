# VidMaster — Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **NOTE:** User has requested **no automatic git commits**. After each task, leave changes staged-or-unstaged for manual review. Do NOT run `git commit` from any step.

**Goal:** Bootstrap the `vidmaster-desktop` project and refactor the seven retained `vid-master` scripts into reusable async modules under `src/` with a uniform signature, abort/progress support, and unit tests. After Plan 1, modules are independently testable from Node — Electron is not yet introduced.

**Architecture:** Each existing CLI script is ported to an `export async function runX(config)` in `src/<name>.js`, consuming explicit input/output paths instead of hardcoded `./folder` and CWD. A shared `TaskRunner` utility (`src/_lib/runner.js`) routes log lines to a callback, throttles progress, propagates `AbortSignal` into FFmpeg child processes, and centralises `spawnFfmpeg` parsing so each task only writes its own pipeline shape. Tests use small fixture files; FFmpeg-touching tests run against tiny real videos to keep them under 1s.

**Tech Stack:**
- Node.js 20+ (ESM, `"type": "module"`)
- `fluent-ffmpeg` + `@ffmpeg-installer/ffmpeg` (existing FFmpeg integration)
- `sharp` (image processing for thumb)
- `p-limit` (parallelism control inside modules)
- `vitest` (test runner — fast, ESM-native, watch mode)

**Source project:** `d:\Project2\vid-master` (read-only — copy logic, do not modify)
**Target project:** `d:\Project2\vidmaster-desktop` (this folder)

---

## File Structure

Files this plan creates:

```
vidmaster-desktop/
├── package.json
├── .gitignore
├── README.md                          (1-paragraph stub)
├── vitest.config.js
├── src/
│   ├── _lib/
│   │   ├── runner.js                  (TaskRunner class)
│   │   ├── abortError.js              (AbortError + helper)
│   │   └── ffmpeg.js                  (shared spawnFfmpeg wrapper)
│   ├── render.js                      (runRender)
│   ├── snow.js                        (runSnow)
│   ├── trim.js                        (runTrim)
│   ├── cutBg.js                       (runCutBg)
│   ├── thumb.js                       (runThumb)
│   ├── concat.js                      (runConcat)
│   └── rename.js                      (runRename)
├── tests/
│   ├── fixtures/
│   │   ├── tiny.mp4                   (<1s, ~100 KB — generated in Task 2)
│   │   ├── tiny.png
│   │   └── README.md                  (how fixtures were generated)
│   ├── _lib/
│   │   ├── runner.test.js
│   │   └── ffmpeg.test.js
│   ├── rename.test.js
│   ├── trim.test.js
│   ├── cutBg.test.js
│   ├── thumb.test.js
│   ├── snow.test.js
│   ├── render.test.js
│   └── concat.test.js
```

Each `src/*.js` is a single-purpose module exporting one async function. `_lib/` holds shared utilities; tests mirror `src/` paths.

---

## Refactor Pattern (apply identically across Tasks 4–10)

For every existing script in `vid-master/`, the conversion is:

1. **Copy** the script's logic into the new module file under `src/`.
2. **Wrap** the top-level body in `export async function runX(config) { ... return { ok, outputs, errors }; }`. Remove `process.argv` parsing.
3. **Parameterize folders**: every `"./overlays"`, `"./done"`, etc. becomes a destructured config field (`config.inputs.overlays`, `config.output`, …). No CWD assumptions.
4. **Construct a TaskRunner** at the top: `const runner = new TaskRunner(config);` and replace:
   - `console.log(...)` → `runner.log("info", ...)`
   - `console.error(...)` → `runner.log("error", ...)`
   - Custom `log()` helpers (e.g. in `render.js`) → `runner.log(level, ...)`.
5. **Inject abort checks**: at the top of every outer `for` loop iterating over input files, call `runner.checkAborted()`.
6. **Replace direct ffmpeg spawns** with `runner.spawnFfmpeg(args, { totalDurationSec })` from `_lib/ffmpeg.js` so progress is parsed centrally. (For `fluent-ffmpeg` chains, swap to direct args via `runner.spawnFfmpeg`; the chain configuration becomes an array of `-i`, filter, output flags.)
7. **Emit progress** at meaningful points:
   - File-count tasks (trim, cutBg, thumb, rename, snow): `runner.setProgress(i / total * 100, \`Đang xử lý \${name}\`)` after each file.
   - FFmpeg-heavy tasks (render, concat): rely on `spawnFfmpeg` parsing per ffmpeg invocation, then post-multiply by stage weight.
8. **Catch and accumulate errors**: each per-file failure pushes to a local `errors[]`; module returns `{ ok: errors.length === 0, outputs, errors }` instead of `process.exit(1)`.
9. **No top-level side effects**: nothing runs at import time. The function is pure-by-call.

---

## Task 1: Project bootstrap

**Files:**
- Create: `vidmaster-desktop/package.json`
- Create: `vidmaster-desktop/.gitignore`
- Create: `vidmaster-desktop/README.md`
- Create: `vidmaster-desktop/vitest.config.js`

- [ ] **Step 1.1: Create `package.json`**

```json
{
  "name": "vidmaster-desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "VidMaster — Windows desktop app (Plan 1: foundation modules only)",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "@ffmpeg-installer/ffmpeg": "^1.1.0",
    "ffmpeg-static": "^5.2.0",
    "fluent-ffmpeg": "^2.1.3",
    "p-limit": "^6.2.0",
    "sharp": "^0.33.5"
  },
  "devDependencies": {
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 1.2: Create `.gitignore`**

```
node_modules/
dist/
*.log
.DS_Store
.vscode/
.idea/
tests/fixtures/*.mp4
tests/fixtures/*.png
!tests/fixtures/README.md
```

(Fixtures are gitignored because they're regenerated on demand; only the README documenting how to recreate them is kept in git.)

- [ ] **Step 1.3: Create `README.md`**

```markdown
# VidMaster Desktop

Windows desktop app for video processing. Wraps the legacy `vid-master` CLI tool.

See `docs/specs/2026-05-06-vidmaster-desktop-app-design.md` for the full design.
See `docs/plans/` for implementation plans.

## Status

- Plan 1 (Foundation): in progress — Node modules under `src/`.
- Plan 2 (Electron shell + UI): not started.
- Plan 3 (Polish + packaging): not started.
- Plan 4 (Skills package): not started.

## Dev

```bash
npm install
npm test
```
```

- [ ] **Step 1.4: Create `vitest.config.js`**

```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    testTimeout: 10_000, // ffmpeg-touching tests need headroom on Windows
    pool: "threads",
    poolOptions: { threads: { singleThread: false } },
  },
});
```

- [ ] **Step 1.5: Install dependencies**

Run from `vidmaster-desktop/`:
```
npm install
```
Expected: `node_modules/` populated, no errors. Sharp may show a one-time download for the platform binary.

- [ ] **Step 1.6: Verify Vitest boots**

Run:
```
npm test
```
Expected: `No test files found, exiting with code 1`. (No tests yet — this just confirms vitest is wired.)

---

## Task 2: Test fixtures

**Files:**
- Create: `tests/fixtures/README.md`
- Create: `tests/fixtures/generate.js` (one-shot generator script)
- Generated (not committed): `tests/fixtures/tiny.mp4`, `tests/fixtures/tiny.png`

- [ ] **Step 2.1: Create `tests/fixtures/README.md`**

```markdown
# Test fixtures

Regenerate locally:

```
node tests/fixtures/generate.js
```

Produces:

- `tiny.mp4` — 1 second, 320×180, 30 fps, silent. ~30 KB.
- `tiny.png` — 320×180 solid colour. ~1 KB.

These are gitignored to keep the repo small.
```

- [ ] **Step 2.2: Create `tests/fixtures/generate.js`**

```js
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1. tiny.mp4 — 1s silent black 320×180
const mp4 = path.join(__dirname, "tiny.mp4");
if (fs.existsSync(mp4)) fs.unlinkSync(mp4);
const r1 = spawnSync(ffmpegPath, [
  "-y",
  "-f", "lavfi", "-i", "color=size=320x180:rate=30:duration=1:color=black",
  "-pix_fmt", "yuv420p",
  mp4,
]);
if (r1.status !== 0) {
  console.error(r1.stderr.toString());
  process.exit(1);
}
console.log("✓ tiny.mp4");

// 2. tiny.png — solid 320×180
const png = path.join(__dirname, "tiny.png");
await sharp({
  create: { width: 320, height: 180, channels: 3, background: { r: 64, g: 128, b: 200 } },
}).png().toFile(png);
console.log("✓ tiny.png");
```

- [ ] **Step 2.3: Run the generator**

Run:
```
node tests/fixtures/generate.js
```
Expected output: `✓ tiny.mp4` then `✓ tiny.png`. Both files appear under `tests/fixtures/`.

---

## Task 3: `src/_lib/abortError.js` and helper

**Files:**
- Create: `src/_lib/abortError.js`
- Create: `tests/_lib/abortError.test.js`

- [ ] **Step 3.1: Write the failing test**

`tests/_lib/abortError.test.js`:
```js
import { describe, it, expect } from "vitest";
import { AbortError, throwIfAborted } from "../../src/_lib/abortError.js";

describe("AbortError", () => {
  it("identifies itself by name", () => {
    const err = new AbortError();
    expect(err.name).toBe("AbortError");
    expect(err).toBeInstanceOf(Error);
  });

  it("accepts an optional message", () => {
    expect(new AbortError("stopped").message).toBe("stopped");
    expect(new AbortError().message).toBe("Aborted");
  });
});

describe("throwIfAborted", () => {
  it("does nothing when signal is not aborted", () => {
    const ctrl = new AbortController();
    expect(() => throwIfAborted(ctrl.signal)).not.toThrow();
  });

  it("throws AbortError when signal is aborted", () => {
    const ctrl = new AbortController();
    ctrl.abort();
    expect(() => throwIfAborted(ctrl.signal)).toThrow(AbortError);
  });

  it("is a no-op when signal is undefined", () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
  });
});
```

- [ ] **Step 3.2: Run the test (expect fail)**

Run: `npm test -- tests/_lib/abortError.test.js`
Expected: FAIL — module `src/_lib/abortError.js` not found.

- [ ] **Step 3.3: Implement**

`src/_lib/abortError.js`:
```js
export class AbortError extends Error {
  constructor(message = "Aborted") {
    super(message);
    this.name = "AbortError";
  }
}

export function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    throw new AbortError();
  }
}
```

- [ ] **Step 3.4: Run the test (expect pass)**

Run: `npm test -- tests/_lib/abortError.test.js`
Expected: 4 tests pass.

---

## Task 4: `src/_lib/ffmpeg.js` — `spawnFfmpeg` with progress + abort

**Files:**
- Create: `src/_lib/ffmpeg.js`
- Create: `tests/_lib/ffmpeg.test.js`

This is the heart of progress reporting. It spawns ffmpeg, parses `time=HH:MM:SS.ms` from stderr, computes percent against a known `totalDurationSec`, and kills the process when the abort signal fires.

- [ ] **Step 4.1: Write the failing test**

`tests/_lib/ffmpeg.test.js`:
```js
import { describe, it, expect } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { spawnFfmpeg } from "../../src/_lib/ffmpeg.js";
import { AbortError } from "../../src/_lib/abortError.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "..", "fixtures");
const tinyMp4 = path.join(fixturesDir, "tiny.mp4");

describe("spawnFfmpeg", () => {
  it("re-encodes a tiny clip and reports progress", async () => {
    const out = path.join(fixturesDir, ".tmp-encoded.mp4");
    const progressTicks = [];

    const result = await spawnFfmpeg(
      ["-y", "-i", tinyMp4, "-c:v", "libx264", "-preset", "ultrafast", out],
      { totalDurationSec: 1, onProgress: (p) => progressTicks.push(p) }
    );

    expect(result.exitCode).toBe(0);
    expect(progressTicks.length).toBeGreaterThan(0);
    expect(progressTicks.at(-1)).toBeGreaterThanOrEqual(0);
  });

  it("rejects with AbortError when signal aborts mid-run", async () => {
    const out = path.join(fixturesDir, ".tmp-aborted.mp4");
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 50);

    await expect(
      spawnFfmpeg(
        ["-y", "-f", "lavfi", "-i", "color=c=black:s=320x180:d=10", out],
        { signal: ctrl.signal, totalDurationSec: 10 }
      )
    ).rejects.toThrow(AbortError);
  });

  it("rejects on non-zero exit", async () => {
    await expect(
      spawnFfmpeg(["-i", "no-such-file.mp4", "out.mp4"], { totalDurationSec: 1 })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 4.2: Run the test (expect fail)**

Run: `npm test -- tests/_lib/ffmpeg.test.js`
Expected: FAIL — `spawnFfmpeg` not found.

- [ ] **Step 4.3: Implement `src/_lib/ffmpeg.js`**

```js
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { spawn } from "child_process";
import { AbortError } from "./abortError.js";

const TIME_RE = /time=(\d+):(\d+):(\d+\.\d+)/;

/**
 * Spawn ffmpeg with the given arg array, parse stderr for progress,
 * and resolve with { exitCode, stderr } on success.
 *
 * @param {string[]} args - ffmpeg arguments (no leading 'ffmpeg').
 * @param {object} opts
 * @param {number} opts.totalDurationSec - expected duration of the operation; used for progress %.
 * @param {(percent: number, currentSec: number) => void} [opts.onProgress]
 * @param {(line: string) => void} [opts.onLogLine]
 * @param {AbortSignal} [opts.signal]
 */
export function spawnFfmpeg(args, opts = {}) {
  const { totalDurationSec, onProgress, onLogLine, signal } = opts;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError());

    const child = spawn(ffmpegPath, args, { windowsHide: true });
    const stderrChunks = [];
    let aborted = false;

    const onAbort = () => {
      aborted = true;
      try { child.kill("SIGTERM"); } catch {}
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    child.stderr.on("data", (buf) => {
      const s = buf.toString();
      stderrChunks.push(s);
      onLogLine?.(s);
      if (totalDurationSec && onProgress) {
        const m = TIME_RE.exec(s);
        if (m) {
          const sec = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
          const pct = Math.min(100, (sec / totalDurationSec) * 100);
          onProgress(pct, sec);
        }
      }
    });

    child.on("error", (err) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(err);
    });

    child.on("close", (exitCode) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      if (aborted) return reject(new AbortError());
      if (exitCode !== 0) {
        return reject(new Error(`ffmpeg exited with code ${exitCode}\n${stderrChunks.join("")}`));
      }
      resolve({ exitCode, stderr: stderrChunks.join("") });
    });
  });
}
```

- [ ] **Step 4.4: Run the test (expect pass)**

Run: `npm test -- tests/_lib/ffmpeg.test.js`
Expected: 3 tests pass within ~3s.

- [ ] **Step 4.5: Clean tmp outputs**

Manually verify `tests/fixtures/.tmp-encoded.mp4` and `.tmp-aborted.mp4` are present, then delete them. (They're gitignored anyway.)

---

## Task 5: `src/_lib/runner.js` — `TaskRunner`

**Files:**
- Create: `src/_lib/runner.js`
- Create: `tests/_lib/runner.test.js`

`TaskRunner` is the per-job context. It owns: log routing, progress throttling, and abort checks. Each module instantiates one at the start of its run.

- [ ] **Step 5.1: Write the failing test**

`tests/_lib/runner.test.js`:
```js
import { describe, it, expect, vi } from "vitest";
import { TaskRunner } from "../../src/_lib/runner.js";
import { AbortError } from "../../src/_lib/abortError.js";

describe("TaskRunner", () => {
  it("forwards log calls to onLog with level + message", () => {
    const onLog = vi.fn();
    const r = new TaskRunner({ onLog });
    r.log("info", "hello");
    expect(onLog).toHaveBeenCalledWith("info", "hello");
  });

  it("works with no callbacks (no-op)", () => {
    const r = new TaskRunner({});
    expect(() => r.log("info", "x")).not.toThrow();
    expect(() => r.setProgress(50, "y")).not.toThrow();
  });

  it("throttles progress to at most one call per 500ms by default", async () => {
    vi.useFakeTimers();
    const onProgress = vi.fn();
    const r = new TaskRunner({ onProgress });

    r.setProgress(10, "a"); // emits immediately (first call)
    r.setProgress(20, "b"); // throttled
    r.setProgress(30, "c"); // throttled
    expect(onProgress).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500);
    r.setProgress(40, "d"); // emits
    expect(onProgress).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("always emits progress at 100 (final tick bypasses throttle)", () => {
    const onProgress = vi.fn();
    const r = new TaskRunner({ onProgress });
    r.setProgress(50, "halfway"); // first → emits
    r.setProgress(100, "done");   // bypass throttle
    expect(onProgress).toHaveBeenLastCalledWith(100, "done");
  });

  it("checkAborted throws AbortError when signal aborted", () => {
    const ctrl = new AbortController();
    const r = new TaskRunner({ signal: ctrl.signal });
    expect(() => r.checkAborted()).not.toThrow();
    ctrl.abort();
    expect(() => r.checkAborted()).toThrow(AbortError);
  });
});
```

- [ ] **Step 5.2: Run the test (expect fail)**

Run: `npm test -- tests/_lib/runner.test.js`
Expected: FAIL — `TaskRunner` not found.

- [ ] **Step 5.3: Implement `src/_lib/runner.js`**

```js
import { throwIfAborted } from "./abortError.js";
import { spawnFfmpeg } from "./ffmpeg.js";

const DEFAULT_THROTTLE_MS = 500;

export class TaskRunner {
  constructor({ signal, onProgress, onLog, throttleMs = DEFAULT_THROTTLE_MS } = {}) {
    this.signal = signal;
    this.onProgress = onProgress;
    this.onLog = onLog;
    this.throttleMs = throttleMs;
    this._lastProgressEmit = 0;
  }

  log(level, message) {
    this.onLog?.(level, message);
  }

  setProgress(percent, message) {
    if (!this.onProgress) return;
    const now = Date.now();
    const isFinal = percent >= 100;
    if (isFinal || now - this._lastProgressEmit >= this.throttleMs) {
      this._lastProgressEmit = now;
      this.onProgress(percent, message);
    }
  }

  checkAborted() {
    throwIfAborted(this.signal);
  }

  /** Convenience: spawn ffmpeg with this runner's signal/progress/log wiring. */
  spawnFfmpeg(args, { totalDurationSec, stageWeight = 1, stageOffset = 0 } = {}) {
    return spawnFfmpeg(args, {
      signal: this.signal,
      totalDurationSec,
      onProgress: (pct) => this.setProgress(stageOffset + pct * stageWeight, ""),
      onLogLine: (line) => this.onLog?.("debug", line),
    });
  }
}
```

- [ ] **Step 5.4: Run the test (expect pass)**

Run: `npm test -- tests/_lib/runner.test.js`
Expected: 5 tests pass.

---

## Task 6: `src/rename.js` (smallest module — port `convertNormalize.js`)

**Files:**
- Create: `src/rename.js`
- Create: `tests/rename.test.js`
- Reference: `d:/Project2/vid-master/convertNormalize.js`

This is the simplest port — fully synchronous, file-rename only, 27 lines of source. Doing it first validates the refactor pattern before tackling FFmpeg-heavy modules.

- [ ] **Step 6.1: Write the failing test**

`tests/rename.test.js`:
```js
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { runRename } from "../src/rename.js";

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-rename-"));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("runRename", () => {
  it("normalises decomposed unicode filenames to NFC recursively", async () => {
    // Decomposed (NFD) Vietnamese filename — must be normalised to NFC.
    const nfd = "Việt".normalize("NFD") + ".jpg";
    const nfc = "Việt".normalize("NFC") + ".jpg";
    expect(nfd).not.toBe(nfc); // sanity

    const sub = path.join(tmpDir, "sub");
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(tmpDir, nfd), "x");
    fs.writeFileSync(path.join(sub, nfd), "y");

    const onLog = vi.fn();
    const result = await runRename({ folder: tmpDir, onLog });

    expect(result.ok).toBe(true);
    expect(fs.readdirSync(tmpDir).map((n) => n.normalize("NFC")))
      .toContain(nfc);
    expect(onLog).toHaveBeenCalled();
  });

  it("returns ok with empty outputs for an already-normalised tree", async () => {
    fs.writeFileSync(path.join(tmpDir, "ascii.txt"), "x");
    const result = await runRename({ folder: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.outputs).toEqual([]);
  });

  it("throws AbortError when aborted before start", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(runRename({ folder: tmpDir, signal: ctrl.signal }))
      .rejects.toThrow("Aborted");
  });
});
```

- [ ] **Step 6.2: Run the test (expect fail)**

Run: `npm test -- tests/rename.test.js`
Expected: FAIL — `runRename` not found.

- [ ] **Step 6.3: Implement `src/rename.js`**

Port from `vid-master/convertNormalize.js`. Apply the refactor pattern from the top of this plan.

```js
import fs from "fs";
import path from "path";
import { TaskRunner } from "./_lib/runner.js";

/**
 * Recursively rename files in `folder` to NFC unicode form.
 * Mirrors the behaviour of vid-master/convertNormalize.js.
 *
 * @param {object} config
 * @param {string} config.folder
 * @param {AbortSignal} [config.signal]
 * @param {(level: string, msg: string) => void} [config.onLog]
 */
export async function runRename(config) {
  const runner = new TaskRunner(config);
  const { folder } = config;
  runner.checkAborted();

  const renamed = [];
  walk(folder, runner, renamed);
  return { ok: true, outputs: renamed, errors: [] };
}

function walk(folderPath, runner, renamed) {
  runner.checkAborted();
  const items = fs.readdirSync(folderPath, { withFileTypes: true });
  for (const item of items) {
    runner.checkAborted();
    const oldPath = path.join(folderPath, item.name);
    const normalized = item.name.normalize("NFC");
    const newPath = path.join(folderPath, normalized);
    if (oldPath !== newPath) {
      fs.renameSync(oldPath, newPath);
      renamed.push(newPath);
      runner.log("info", `Đã đổi tên: ${item.name} → ${normalized}`);
    }
    if (item.isDirectory()) {
      walk(newPath, runner, renamed);
    }
  }
}
```

- [ ] **Step 6.4: Run the test (expect pass)**

Run: `npm test -- tests/rename.test.js`
Expected: 3 tests pass.

---

## Task 7: `src/trim.js` (port `trim-videos.js`)

**Files:**
- Create: `src/trim.js`
- Create: `tests/trim.test.js`
- Reference: `d:/Project2/vid-master/trim-videos.js`

`trim-videos.js` cuts each video in `input/` into 30-second segments. It already uses `fluent-ffmpeg` and a `--replace` flag.

- [ ] **Step 7.1: Read the source file fully**

Read `d:/Project2/vid-master/trim-videos.js` (174 lines) end to end so the port preserves behaviour: input enumeration, duration probing, segment loop, replace-vs-keep semantics.

- [ ] **Step 7.2: Write the failing test**

`tests/trim.test.js`:
```js
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { runTrim } from "../src/trim.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tinyMp4 = path.join(__dirname, "fixtures", "tiny.mp4");

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-trim-"));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("runTrim", () => {
  it("produces a single 1s segment for a 1s input", async () => {
    const input = path.join(tmpDir, "in");
    const output = path.join(tmpDir, "out");
    fs.mkdirSync(input);
    fs.copyFileSync(tinyMp4, path.join(input, "v1.mp4"));

    const ticks = [];
    const result = await runTrim({
      input, output, segmentSeconds: 30, replace: false,
      onProgress: (p) => ticks.push(p),
    });

    expect(result.ok).toBe(true);
    expect(result.outputs.length).toBeGreaterThanOrEqual(1);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.at(-1)).toBe(100);
  });

  it("replaces originals when replace=true", async () => {
    const input = path.join(tmpDir, "in");
    fs.mkdirSync(input);
    const original = path.join(input, "v1.mp4");
    fs.copyFileSync(tinyMp4, original);

    await runTrim({ input, output: input, segmentSeconds: 30, replace: true });

    // Original removed; segments live in `input/`.
    expect(fs.existsSync(original)).toBe(false);
  });

  it("throws AbortError when signal aborted before start", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      runTrim({ input: tmpDir, output: tmpDir, segmentSeconds: 30, signal: ctrl.signal })
    ).rejects.toThrow("Aborted");
  });
});
```

- [ ] **Step 7.3: Run the test (expect fail)**

Run: `npm test -- tests/trim.test.js`
Expected: FAIL — `runTrim` not found.

- [ ] **Step 7.4: Implement `src/trim.js`**

Apply the refactor pattern. Key shape:
```js
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { TaskRunner } from "./_lib/runner.js";
ffmpeg.setFfmpegPath(ffmpegPath);

export async function runTrim(config) {
  const runner = new TaskRunner(config);
  const { input, output, segmentSeconds = 30, replace = false } = config;
  runner.checkAborted();

  fs.mkdirSync(output, { recursive: true });
  const files = fs.readdirSync(input).filter((n) => /\.mp4$/i.test(n));
  const outputs = [];
  const errors = [];

  for (let i = 0; i < files.length; i++) {
    runner.checkAborted();
    const file = files[i];
    const fullPath = path.join(input, file);
    try {
      const duration = await probeDuration(fullPath);
      const segments = Math.ceil(duration / segmentSeconds);
      for (let s = 0; s < segments; s++) {
        runner.checkAborted();
        const start = s * segmentSeconds;
        const segName = `${path.parse(file).name}_part${s + 1}.mp4`;
        const segPath = path.join(output, segName);
        await runner.spawnFfmpeg(
          ["-y", "-ss", String(start), "-t", String(segmentSeconds),
           "-i", fullPath, "-c", "copy", "-an", segPath],
          { totalDurationSec: segmentSeconds }
        );
        outputs.push(segPath);
      }
      if (replace) fs.unlinkSync(fullPath);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      errors.push({ file, message: err.message, stack: err.stack });
      runner.log("error", `Trim ${file} failed: ${err.message}`);
    }
    runner.setProgress(((i + 1) / files.length) * 100, `Trim ${file}`);
  }
  runner.setProgress(100, "Trim done");
  return { ok: errors.length === 0, outputs, errors };
}

function probeDuration(file) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, meta) => err ? reject(err) : resolve(meta.format.duration));
  });
}
```

When porting, preserve any progress-log strings the source script used so user-facing log lines are familiar.

- [ ] **Step 7.5: Run the test (expect pass)**

Run: `npm test -- tests/trim.test.js`
Expected: 3 tests pass within ~5s.

---

## Task 8: `src/cutBg.js` (port `cut-bg.js`)

**Files:**
- Create: `src/cutBg.js`
- Create: `tests/cutBg.test.js`
- Reference: `d:/Project2/vid-master/cut-bg.js`

`cut-bg.js` cuts each background video into N segments using ffprobe + ffmpeg. 97 lines.

- [ ] **Step 8.1: Read the source file fully**

Read `d:/Project2/vid-master/cut-bg.js` end to end. Note: it uses `videoCodec("copy").noAudio()` — preserve.

- [ ] **Step 8.2: Write the failing test**

`tests/cutBg.test.js`:
```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { runCutBg } from "../src/cutBg.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tinyMp4 = path.join(__dirname, "fixtures", "tiny.mp4");

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-cutbg-")); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe("runCutBg", () => {
  it("produces at least one output segment", async () => {
    const input = path.join(tmpDir, "in"); fs.mkdirSync(input);
    const output = path.join(tmpDir, "out"); fs.mkdirSync(output);
    fs.copyFileSync(tinyMp4, path.join(input, "bg.mp4"));

    const result = await runCutBg({ input, output });
    expect(result.ok).toBe(true);
    expect(result.outputs.length).toBeGreaterThan(0);
  });

  it("throws AbortError when aborted before start", async () => {
    const ctrl = new AbortController(); ctrl.abort();
    await expect(runCutBg({ input: tmpDir, output: tmpDir, signal: ctrl.signal }))
      .rejects.toThrow("Aborted");
  });
});
```

- [ ] **Step 8.3: Run the test (expect fail)**

Run: `npm test -- tests/cutBg.test.js`
Expected: FAIL — `runCutBg` not found.

- [ ] **Step 8.4: Implement `src/cutBg.js`**

Port from `vid-master/cut-bg.js` applying the refactor pattern. Preserve the segment-count logic from the source (it uses a fixed segment length internally — keep that constant or surface it as a config field if the source already exposed it).

Skeleton:
```js
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { TaskRunner } from "./_lib/runner.js";
ffmpeg.setFfmpegPath(ffmpegPath);

export async function runCutBg(config) {
  const runner = new TaskRunner(config);
  const { input, output } = config;
  runner.checkAborted();
  fs.mkdirSync(output, { recursive: true });

  const files = fs.readdirSync(input).filter((n) => /\.(mp4|mov|mkv)$/i.test(n));
  const outputs = [];
  const errors = [];

  for (let i = 0; i < files.length; i++) {
    runner.checkAborted();
    const file = files[i];
    try {
      // ... copy segment-cutting logic from source, calling runner.spawnFfmpeg ...
      // outputs.push(...)
    } catch (err) {
      if (err.name === "AbortError") throw err;
      errors.push({ file, message: err.message, stack: err.stack });
    }
    runner.setProgress(((i + 1) / files.length) * 100, `CutBg ${file}`);
  }
  runner.setProgress(100, "CutBg done");
  return { ok: errors.length === 0, outputs, errors };
}
```

Fill in the inner ffmpeg invocation by translating `cut-bg.js` `cutVideoSegment` to `runner.spawnFfmpeg(["-y", "-ss", String(start), "-t", String(segDur), "-i", file, "-c:v", "copy", "-an", outFile], { totalDurationSec: segDur })`.

- [ ] **Step 8.5: Run the test (expect pass)**

Run: `npm test -- tests/cutBg.test.js`
Expected: 2 tests pass.

---

## Task 9: `src/thumb.js` (port `thumb.js`)

**Files:**
- Create: `src/thumb.js`
- Create: `tests/thumb.test.js`
- Reference: `d:/Project2/vid-master/thumb.js`

This module uses `sharp` to overlay images on thumbnails. 116 lines. No FFmpeg.

- [ ] **Step 9.1: Read the source file fully**

Read `d:/Project2/vid-master/thumb.js`.

- [ ] **Step 9.2: Write the failing test**

`tests/thumb.test.js`:
```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { runThumb } from "../src/thumb.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tinyPng = path.join(__dirname, "fixtures", "tiny.png");

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-thumb-")); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe("runThumb", () => {
  it("produces output thumbnails when overlay images are present", async () => {
    const baseThumb = path.join(tmpDir, "base"); fs.mkdirSync(baseThumb);
    const overlays = path.join(tmpDir, "overlays"); fs.mkdirSync(overlays);
    const out = path.join(tmpDir, "out"); fs.mkdirSync(out);

    fs.copyFileSync(tinyPng, path.join(baseThumb, "1.png"));
    fs.copyFileSync(tinyPng, path.join(overlays, "1.png"));

    const result = await runThumb({
      input: baseThumb, overlays, output: out,
    });
    expect(result.ok).toBe(true);
    expect(result.outputs.length).toBeGreaterThan(0);
  });

  it("throws AbortError when aborted before start", async () => {
    const ctrl = new AbortController(); ctrl.abort();
    await expect(runThumb({
      input: tmpDir, overlays: tmpDir, output: tmpDir, signal: ctrl.signal,
    })).rejects.toThrow("Aborted");
  });
});
```

- [ ] **Step 9.3: Run the test (expect fail)**

Run: `npm test -- tests/thumb.test.js`
Expected: FAIL.

- [ ] **Step 9.4: Implement `src/thumb.js`**

Port `thumb.js`. Map source constants to flat config:
| Source const | Config field |
|---|---|
| `DOWNLOAD_DIR` (base thumbs) | `config.input` |
| `OVERLAY_IMAGES_DIR` | `config.overlays` |
| `OUTPUT_THUMBS_BASE_DIR` | `config.output` |

This module uses Sharp (not FFmpeg) — no `runner.spawnFfmpeg` calls. Apply abort checks before each file iteration. Use `runner.setProgress((i+1)/total*100, ...)`.

- [ ] **Step 9.5: Run the test (expect pass)**

Run: `npm test -- tests/thumb.test.js`
Expected: 2 tests pass.

---

## Task 10: `src/snow.js` (port `createVideoSnow.js`)

**Files:**
- Create: `src/snow.js`
- Create: `tests/snow.test.js`
- Reference: `d:/Project2/vid-master/createVideoSnow.js`

219 lines. Generates videos from still images with a snow overlay. Uses FFmpeg.

- [ ] **Step 10.1: Read the source file fully**

Read `d:/Project2/vid-master/createVideoSnow.js` end to end. Note any external assets it references (e.g. `snow.mov`) — they must be passed in via `config.snowAsset`.

- [ ] **Step 10.2: Write the failing test**

`tests/snow.test.js`:
```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { runSnow } from "../src/snow.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tinyPng = path.join(__dirname, "fixtures", "tiny.png");

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-snow-")); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe("runSnow", () => {
  it("rejects with a clear error if snowAsset is missing", async () => {
    await expect(runSnow({
      input: tmpDir, output: tmpDir, snowAsset: path.join(tmpDir, "no-such.mov"), duration: 1,
    })).rejects.toThrow();
  });

  it("throws AbortError when aborted before start", async () => {
    const ctrl = new AbortController(); ctrl.abort();
    await expect(runSnow({
      input: tmpDir, output: tmpDir, snowAsset: "x", duration: 1, signal: ctrl.signal,
    })).rejects.toThrow("Aborted");
  });
});
```

(The happy-path test is intentionally omitted in this plan because it requires a `snow.mov` fixture which is non-trivial. The first integration verification happens in Plan 2 when wired into the Electron app — flagged in the smoke checklist.)

- [ ] **Step 10.3: Run the test (expect fail)**

Run: `npm test -- tests/snow.test.js`
Expected: FAIL.

- [ ] **Step 10.4: Implement `src/snow.js`**

Port `createVideoSnow.js`. Parameterize: `config.input` (image dir), `config.output` (video dir), `config.snowAsset` (path to snow.mov), `config.duration`. Replace direct ffmpeg invocations with `runner.spawnFfmpeg`. Add abort check at top of each per-image loop.

- [ ] **Step 10.5: Run the test (expect pass)**

Run: `npm test -- tests/snow.test.js`
Expected: 2 tests pass.

---

## Task 11: `src/concat.js` (port `concat-video.js`)

**Files:**
- Create: `src/concat.js`
- Create: `tests/concat.test.js`
- Reference: `d:/Project2/vid-master/concat-video.js`

359 lines — biggest module after render. Concatenates videos with thumbnails. Has auto-mode (process all subdirs of `done/`) and manual-mode (specific folder + chunk size).

- [ ] **Step 11.1: Read the source file fully**

Read `d:/Project2/vid-master/concat-video.js` end to end. Identify: `THUMBS_DIR`, `DONE_DIR`, `OUTPUT_DIR`, `TEMP_DIR`, `SILENT_AUDIO_PATH` (uses `silence.mp3`), `THUMB_DURATION`, `DEFAULT_CHUNK_SIZE`. Auto-mode iterates subdirs of `DONE_DIR`; manual takes `chunkSize` + `folderName`.

- [ ] **Step 11.2: Copy `silence.mp3` into the new project**

Run:
```
cp d:/Project2/vid-master/silence.mp3 d:/Project2/vidmaster-desktop/src/_lib/silence.mp3
```

(`silence.mp3` is a static asset; we keep it next to `_lib` so it's bundled with the modules.)

- [ ] **Step 11.3: Write the failing test**

`tests/concat.test.js`:
```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { runConcat } from "../src/concat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tinyMp4 = path.join(__dirname, "fixtures", "tiny.mp4");
const tinyPng = path.join(__dirname, "fixtures", "tiny.png");

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-concat-")); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe("runConcat", () => {
  it("produces a concatenated output for a single-folder manual run", async () => {
    const thumbs = path.join(tmpDir, "thumbs"); fs.mkdirSync(thumbs);
    const done = path.join(tmpDir, "done", "f1"); fs.mkdirSync(done, { recursive: true });
    const output = path.join(tmpDir, "out"); fs.mkdirSync(output);
    const temp = path.join(tmpDir, "temp"); fs.mkdirSync(temp);

    fs.copyFileSync(tinyMp4, path.join(done, "1.mp4"));
    fs.copyFileSync(tinyPng, path.join(thumbs, "f1.jpg"));

    const result = await runConcat({
      thumbsDir: thumbs, doneDir: path.dirname(done), output, tempDir: temp,
      chunkSize: 1, folderName: "f1",
    });
    expect(result.ok).toBe(true);
    expect(result.outputs.length).toBeGreaterThan(0);
  });

  it("throws AbortError when aborted before start", async () => {
    const ctrl = new AbortController(); ctrl.abort();
    await expect(runConcat({
      thumbsDir: tmpDir, doneDir: tmpDir, output: tmpDir, tempDir: tmpDir, signal: ctrl.signal,
    })).rejects.toThrow("Aborted");
  });
});
```

- [ ] **Step 11.4: Run the test (expect fail)**

Run: `npm test -- tests/concat.test.js`
Expected: FAIL.

- [ ] **Step 11.5: Implement `src/concat.js`**

Port `concat-video.js`. Map source constants to config:

| Source | Config field |
|---|---|
| `THUMBS_DIR` | `config.thumbsDir` |
| `DONE_DIR` | `config.doneDir` |
| `OUTPUT_DIR` | `config.output` |
| `TEMP_DIR` | `config.tempDir` (default: `path.join(os.tmpdir(), "vidmaster-concat-${jobId}")` — but accept override) |
| `SILENT_AUDIO_PATH` | `path.join(__dirname, "_lib", "silence.mp3")` (constant) |
| auto mode (no args) | `folderName` undefined → iterate subdirs of `doneDir` |
| manual mode | `folderName + chunkSize` provided |

Apply refactor pattern. Preserve `sourceVideoMetadata` discovery and the per-chunk concat logic verbatim — wrap each ffmpeg call in `runner.spawnFfmpeg`.

- [ ] **Step 11.6: Run the test (expect pass)**

Run: `npm test -- tests/concat.test.js`
Expected: 2 tests pass within ~6s.

---

## Task 12: `src/render.js` (port `render.js` — the big one)

**Files:**
- Create: `src/render.js`
- Create: `tests/render.test.js`
- Reference: `d:/Project2/vid-master/render.js`

721 lines, the heart of the app. Renders combined videos from overlays + backgrounds with chroma key, opacity, optional GPU encoding.

- [ ] **Step 12.1: Read the source file fully**

Read `d:/Project2/vid-master/render.js` end to end. Map every hardcoded constant to either:
- a config field (passed by caller), or
- a constant kept in code (if not user-facing).

Constants to surface as config (per Section 5 of the spec):
| Source const | Config path |
|---|---|
| `args[0]` (currentDay) | `config.currentDay` |
| `args[1]` (videosPerFolder) | `config.videosPerFolder` |
| `overlayFolder` | `config.inputs.overlays` |
| `backgroundFolder` | `config.inputs.backgrounds` |
| `combinedVideosFolder` | `config.inputs.combined` (default: a tmp dir under `os.tmpdir`) |
| `outputFolder` | `config.output` |
| `useGPU` | `config.ffmpeg.useGPU` |
| `gpuVideoCodec` | `config.ffmpeg.encoder` (mapped: nvidia → `h264_nvenc`, intel → `h264_qsv`, amd → `h264_amf`, cpu → `libx264`) |
| `useChromaKey`, `color` | `config.chromaKey.color` (presence enables chroma) |
| `keepSimilarity` | `config.chromaKey.similarity` |
| `useKeepColor`, `keepColorsList`, `keepColorAndCrop` | `config.keepColor.{enabled, list, andCrop}` |
| `opacity`, `topTransparent` | `config.opacity`, `config.topTransparent` |
| `height`, `y_offset` | `config.crop.height`, `config.crop.yOffset` |
| `currentDayFile`, `chromaKeyFile` | `config.workspaceFiles.{currentDay, chromaKey}` (default to paths under workspace) |
| `useAutoUploadVps`, `ipList` | **DROPPED** (VPS removed) |
| `maxConcurrentProcesses` | `config.ffmpeg.maxConcurrent` |

- [ ] **Step 12.2: Strip VPS code from the port**

When porting, do not bring over: `useAutoUploadVps`, `ipList`, anything that references `vps.txt` or FTP. These are in lines roughly around the VPS config block; remove the related branch entirely.

- [ ] **Step 12.3: Write the failing test (smoke-only)**

`tests/render.test.js`:
```js
import { describe, it, expect } from "vitest";
import { runRender } from "../src/render.js";

describe("runRender", () => {
  it("rejects with a clear error if input folders are missing", async () => {
    await expect(runRender({
      currentDay: 1,
      videosPerFolder: 1,
      inputs: { overlays: "/nope/overlays", backgrounds: "/nope/bg" },
      output: "/nope/out",
      ffmpeg: { useGPU: false, encoder: "libx264", maxConcurrent: 1 },
    })).rejects.toThrow();
  });

  it("throws AbortError when aborted before start", async () => {
    const ctrl = new AbortController(); ctrl.abort();
    await expect(runRender({
      currentDay: 1, videosPerFolder: 1,
      inputs: { overlays: "/x", backgrounds: "/y" },
      output: "/z",
      ffmpeg: { useGPU: false, encoder: "libx264", maxConcurrent: 1 },
      signal: ctrl.signal,
    })).rejects.toThrow("Aborted");
  });
});
```

(A real happy-path render test would need an overlay+background fixture set producing a meaningful result. That's deferred to the Plan 2 smoke checklist; the source script's logic is preserved verbatim, so the per-step refactor is the unit test.)

- [ ] **Step 12.4: Run the test (expect fail)**

Run: `npm test -- tests/render.test.js`
Expected: FAIL.

- [ ] **Step 12.5: Implement `src/render.js`**

Port `render.js`. Approach:

1. Copy the entire file body into `src/render.js`.
2. Wrap in `export async function runRender(config) { ... }`.
3. Delete the `process.argv` parsing block — read `currentDay` and `videosPerFolder` from `config`.
4. Delete the VPS block (Step 12.2).
5. Replace every `console.log` / custom `log()` with `runner.log("info" | "warn" | "error", ...)`.
6. Replace direct `ffmpeg(...)` chain calls with `runner.spawnFfmpeg(args, { totalDurationSec, stageWeight, stageOffset })`. The render pipeline has multiple stages — assign each stage a `stageOffset` and `stageWeight` so total progress is monotonic 0→100.
7. Add `runner.checkAborted()` at the top of every `for` loop iterating over folders / videos.
8. Replace the keep-color + crop conditional branches with reads from `config.keepColor` and `config.crop`.
9. At the end, return `{ ok, outputs, errors }`.

If a section of source logic is unclear during the port, preserve the source behaviour verbatim — copy the lines as-is, then parameterize only what Step 12.1's mapping table calls out. Do not add `TODO`/`FIXME` comments; if logic is genuinely unclear, leave it copied verbatim and document the question by adding the test case that pins down expected behaviour.

- [ ] **Step 12.6: Run the test (expect pass)**

Run: `npm test -- tests/render.test.js`
Expected: 2 tests pass.

---

## Task 13: Smoke-run the whole module suite

**Files:** none (runtime check only).

- [ ] **Step 13.1: Run all tests**

Run: `npm test`
Expected: All previous tests pass. Total runtime under 30s on a typical laptop.

- [ ] **Step 13.2: Verify `npm run test:watch` works**

Run: `npm run test:watch`
Expected: vitest UI shows all tests green and waits for file changes. Quit with `q`.

- [ ] **Step 13.3: Author a manual one-shot exercise script**

Create `scripts/smoke.js` (project root):
```js
// One-shot manual smoke: invokes runRename on a tmp dir to confirm modules load from CLI Node.
import { runRename } from "../src/rename.js";
import fs from "fs";
import os from "os";
import path from "path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vm-smoke-"));
fs.writeFileSync(path.join(tmp, "Việt".normalize("NFD") + ".txt"), "x");
const r = await runRename({ folder: tmp, onLog: (l, m) => console.log(`[${l}] ${m}`) });
console.log("Result:", r);
fs.rmSync(tmp, { recursive: true, force: true });
```

Run:
```
node scripts/smoke.js
```
Expected: log line `[info] Đã đổi tên: ...` plus `Result: { ok: true, outputs: [...], errors: [] }`.

This confirms ESM imports work outside Vitest.

---

## Plan 1 — Done Criteria

- [ ] All Vitest tests pass (`npm test` exit 0).
- [ ] `scripts/smoke.js` runs without error.
- [ ] No source file imports `process.argv`.
- [ ] No source file references `./overlays`, `./done`, `./backgrounds`, etc. with hardcoded relative paths (grep returns clean).
- [ ] No file under `src/` references VPS, FTP, Discord, Telegram, googleapis, or youtube-dl.
- [ ] `package.json` lists only the dependencies in Task 1.
- [ ] User has reviewed the resulting code and is ready to start Plan 2 (Electron shell + UI).
