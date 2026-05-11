# Fix CJS/ESM Interop Crash in Updater Wrapper

**Status:** Draft
**Date:** 2026-05-11
**Owner:** cuongnguyen.ftdev

## Goal

Fix the crash that prevents installed VidMaster builds from launching. Update the test mock so this class of bug is caught in CI in the future.

## Crash signature

Installed v0.1.2 (and any build from the current source) crashes immediately on launch with:

```
A JavaScript error occurred in the main process

Uncaught Exception:
file:///C:/Program%20Files/VidMaster/resources/app.asar/electron/updater.js:1
import { autoUpdater } from "electron-updater";
         ^^^^^^^^^^^
SyntaxError: Named export 'autoUpdater' not found. The requested module
'electron-updater' is a CommonJS module, which may not support all
module.exports as named exports.
```

## Root cause

1. `electron/updater.js` line 1 uses a **named** ESM import from the `electron-updater` package.
2. `electron-updater` is compiled from TypeScript to CommonJS and exports its members via `Object.defineProperty(exports, "autoUpdater", { ... })`. Node's ESM loader cannot statically detect those properties, so the named import fails at runtime.
3. The unit tests pass because `vi.mock("electron-updater", () => ({ autoUpdater: autoUpdaterMock }))` synthesizes a fake module with a real named export. The mock does not mirror the actual CJS shape.

`electron-log` and `electron-store` already use default imports, so they work. Only `electron-updater` was wrong.

## Why dev mode does not catch this

The wrapper's `check()` short-circuits when `!app.isPackaged`, but the offending line is at the **top** of `electron/updater.js`. The import runs when `electron/ipc/updater.js` (which is loaded unconditionally from `electron/main.js`) imports the wrapper. In a packaged build, this is what crashes. In dev (`npm run dev`), the same import should also crash — meaning Task 9's manual dev smoke test was either skipped or didn't actually exercise this code path.

## Scope

In scope:
- Fix `electron/updater.js` to use default import + destructure.
- Update `tests/electron/updater.test.js` mock to mirror CJS default-export shape so the test would fail if the source regressed.
- Re-run tests, dev launch, and a local installer install to verify.
- Release v0.1.4 to GitHub Releases so existing v0.1.2 / v0.1.3 installs are unblocked once users get the new build.

Out of scope (deliberately not addressed in this session):
- NSIS oneClick simplification.
- Code-signing certificate.
- yt-dlp pre-bundling.
- Audit of other CJS interop. Already audited inline: `fluent-ffmpeg`, `p-limit`, `sharp`, `electron-log`, `electron-store`, `electron-updater`, `@ffmpeg-installer/ffmpeg`. Only `electron-updater` was wrong. The others use `import default` or work via Node's static analysis.

## Source change

`electron/updater.js` lines 1–2:

```js
// Before
import { autoUpdater } from "electron-updater";
import { app } from "electron";

// After
import pkg from "electron-updater";
import { app } from "electron";
const { autoUpdater } = pkg;
```

Rest of the file is unchanged. `autoUpdater` is the same object; only the import mechanism changes.

## Test change

`tests/electron/updater.test.js` line 14:

```js
// Before
vi.mock("electron-updater", () => ({ autoUpdater: autoUpdaterMock }));

// After
vi.mock("electron-updater", () => ({ default: { autoUpdater: autoUpdaterMock } }));
```

The 7 existing test cases do not need to change because they test wrapper behavior, not import mechanics. If a future edit reverts to a named import (`import { autoUpdater }`), Vitest will throw "Named export 'autoUpdater' not found" — exactly the bug we want to catch.

## Verification plan

1. `npm test` — 7 tests in `tests/electron/updater.test.js` still pass; full suite shows only the pre-existing 2 unrelated `buttonFeedback.test.js` failures.
2. `npm run dev` — app launches to the update-check screen (dev mode short-circuits to `not-available` → main app mounts). No error in DevTools console. This confirms the import succeeds outside the mock.
3. `npm run build` — produces `dist/VidMaster-Setup-0.1.4.exe`. Install locally over the broken v0.1.2 (NSIS handles upgrade). Launch. Confirm app reaches the normal UI without the crash dialog.
4. `npm run release` — bumps to v0.1.4 (or higher, depending on current state), builds, uploads draft release. Publish draft on github.com.

## Rollout to users with the broken build

Users who installed v0.1.2 / v0.1.3 cannot reach the auto-update screen because the app crashes before it loads. To unblock them:

1. Build and publish v0.1.4 (this spec).
2. Send a direct download link to affected users (Telegram / email / chat). The link points to `https://github.com/faster64/vidmaster-desktop/releases/download/v0.1.4/VidMaster-Setup-0.1.4.exe`.
3. Users install v0.1.4 over the broken version (NSIS overwrites).
4. From v0.1.4 onward, auto-update works normally; subsequent releases (v0.1.5+) reach users without manual intervention.

## Open items

None. Both changes are mechanical and the verification path is concrete.
