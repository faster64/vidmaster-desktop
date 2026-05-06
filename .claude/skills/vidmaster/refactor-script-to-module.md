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
