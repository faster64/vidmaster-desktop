# Fix CJS/ESM Interop Crash in Updater Wrapper — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken named import in `electron/updater.js` with a default import + destructure, fix the test mock so it would catch this regression, then release a working v0.1.4.

**Architecture:** Two surgical edits — one in source, one in test — driven by TDD: change the test mock first (which would fail against current source), then change the source to match.

**Tech Stack:** Electron 30, `electron-updater` 6.x (CommonJS), vitest, electron-builder.

**Reference spec:** [`docs/superpowers/specs/2026-05-11-fix-cjs-esm-interop-design.md`](../specs/2026-05-11-fix-cjs-esm-interop-design.md)

---

## File Structure

**Modified files:**
- `electron/updater.js` — line 1 changes from named to default import + destructure
- `tests/electron/updater.test.js` — line 14 mock shape changes to `{ default: { autoUpdater: ... } }`

No new files. No file structure changes.

---

## Task 1: Make the test mock reflect real CJS shape (failing-first)

**Files:**
- Modify: `tests/electron/updater.test.js:14`

The current mock is a lie: it gives the wrapper a named export that the real CJS module does not provide. Step 1 is to make the mock truthful. With the current source still using named import, all 7 tests should fail in the same way the production crash failed.

- [ ] **Step 1: Update the mock**

In `d:\Programming\projects\vidmaster-desktop\tests\electron\updater.test.js`, find line 14 (or wherever the `vi.mock("electron-updater", ...)` lives) and replace:

```js
vi.mock("electron-updater", () => ({ autoUpdater: autoUpdaterMock }));
```

with:

```js
vi.mock("electron-updater", () => ({ default: { autoUpdater: autoUpdaterMock } }));
```

- [ ] **Step 2: Run the suite, verify failure**

Run from `d:\Programming\projects\vidmaster-desktop`:

```
npx vitest run tests/electron/updater.test.js
```

Expected: tests FAIL. The exact message will be something like `Named export 'autoUpdater' not found` or `Cannot destructure property 'autoUpdater' of 'undefined'` — whichever way Vitest surfaces the broken import. This is the same failure mode the production app exhibited.

If tests pass at this step, stop and report — it means the source already changed somehow and the mock fix alone covered it. Plan should be re-evaluated.

---

## Task 2: Fix the source to match the corrected mock

**Files:**
- Modify: `electron/updater.js:1-2`

- [ ] **Step 1: Switch to default import + destructure**

In `d:\Programming\projects\vidmaster-desktop\electron\updater.js`, find lines 1–2:

```js
import { autoUpdater } from "electron-updater";
import { app } from "electron";
```

Replace them with:

```js
import pkg from "electron-updater";
import { app } from "electron";
const { autoUpdater } = pkg;
```

Three lines instead of two. The `autoUpdater` binding stays in scope for the rest of the file unchanged.

- [ ] **Step 2: Run the updater test, verify it passes**

```
npx vitest run tests/electron/updater.test.js
```

Expected: PASS — 7 tests pass. The Vitest mock now matches the source's import pattern.

- [ ] **Step 3: Run the full suite**

```
npm test
```

Expected: 171 passed / 2 failed. The 2 failures are the pre-existing `tests/electron/buttonFeedback.test.js` unrelated to this work. No new failures.

---

## Task 3: Smoke-test in dev mode

This task verifies that the import works in a real Electron runtime, not just in mocked vitest.

- [ ] **Step 1: Launch dev mode**

```
npm run dev
```

Expected sequence:
1. Electron window opens.
2. Update-check overlay shows for a fraction of a second.
3. Renderer transitions to normal app (dev mode short-circuits the updater to `not-available`).
4. No "JavaScript error occurred in the main process" dialog.

If onboarding screen appears, that's fine — it means no workspace is configured yet. Skip past it or close the app.

- [ ] **Step 2: Check the log for updater short-circuit**

Open DevTools (`F12`) → Console. You should see no errors. Optionally, look in the log file (Settings → "Mở log" or `%APPDATA%\vidmaster-desktop\logs\main.log`) for a line:

```
updater: dev mode, skipping check
```

If you see this line, the wrapper loaded successfully and `check()` short-circuited as designed. Bug confirmed fixed.

- [ ] **Step 3: Close the app**

Quit cleanly. No commit yet — Task 4 ships the build.

---

## Task 4: Build, install, and verify the packaged app

This is the highest-confidence verification: install the packaged `.exe` over the broken v0.1.2 and confirm it launches.

- [ ] **Step 1: Build the installer**

```
npm run build
```

Expected:
- `prebuild` runs `scripts/bump-version.mjs` and bumps `package.json` version (e.g. `0.1.3 → 0.1.4`).
- `electron-builder` produces `dist/VidMaster-Setup-0.1.4.exe` (filename uses the bumped version).
- Exit code 0.

- [ ] **Step 2: Install over the broken version**

Run `dist/VidMaster-Setup-0.1.4.exe`. NSIS will overwrite the existing install at `%LOCALAPPDATA%\Programs\VidMaster`.

Expected: installer wizard completes, app launches automatically (or you launch it from the Start menu / Desktop shortcut).

- [ ] **Step 3: Verify no crash dialog**

Expected sequence:
1. App window opens.
2. "Đang kiểm tra cập nhật..." screen appears.
3. The updater checks GitHub Releases. If no newer release exists, `not-available` → app proceeds to normal UI. If a newer release exists (because of a prior `npm run release` v0.1.5+), the auto-update flow kicks in — that's also a valid success state, just not what we're testing here.
4. **No JavaScript error dialog**. The crash from the screenshot must not reappear.

- [ ] **Step 4: Confirm version in the running app**

Open DevTools (`F12`) and run in the Console:

```js
await window.api.app.getVersion()
```

Expected: returns `"0.1.4"` (matching the build).

Close the app.

---

## Task 5: Release v0.1.4 to GitHub

This step makes the fix reach users who installed v0.1.2 / v0.1.3 — but only after they upgrade once via direct download (auto-update can't rescue them from a crash-on-launch state).

- [ ] **Step 1: Verify `.env` has GH_TOKEN**

Run:
```
npx dotenv -- node -e "console.log('GH_TOKEN length:', process.env.GH_TOKEN ? process.env.GH_TOKEN.length : 'MISSING')"
```

Expected: prints `GH_TOKEN length: 40` (classic PAT) or `~93` (fine-grained PAT). If `MISSING`, fix `.env` before continuing.

- [ ] **Step 2: Run release**

```
npm run release
```

Expected:
- `prerelease` runs the bump script (already bumped in Task 4, so version goes from `0.1.4 → 0.1.5`, or whatever the current package.json says).
- `dotenv` loads `GH_TOKEN`.
- `electron-builder` builds and uploads `VidMaster-Setup-x.y.z.exe` + `latest.yml` + a `blockmap` file to GitHub Releases as a **draft**.
- Exit code 0.

If the version after Task 4's build is already what you want to release, you may want to skip the prerelease bump. To do that, manually edit `package.json` to set the version you want and run `npx electron-builder --win --x64 --publish always` directly (skipping the npm script). Otherwise, the script bumps automatically — which is fine, just produces a higher version number than Task 4.

- [ ] **Step 3: Publish the draft on GitHub**

Open https://github.com/faster64/vidmaster-desktop/releases. Find the draft release. Optionally edit the release notes (default is just the version number). Click **Publish release**.

- [ ] **Step 4: Notify affected users**

Users on v0.1.2 / v0.1.3 cannot auto-update because their app crashes before the update check runs. Send them the direct installer link:

```
https://github.com/faster64/vidmaster-desktop/releases/download/v0.1.5/VidMaster-Setup-0.1.5.exe
```

(Replace `0.1.5` with whatever version was actually released.) From this version onward, every subsequent release will reach them automatically.

---

## Task 6: Commit the source changes

This task is intentionally last because the user has a standing rule that commits should happen after manual verification (Task 4) — not before.

- [ ] **Step 1: Stage the source + test changes**

```
git add electron/updater.js tests/electron/updater.test.js
git status --short
```

Expected: shows both files as `M` (modified). `package.json` may also show as modified if Task 4's bump touched it — decide whether to include it in this commit (recommended yes, since the release version is part of the fix's traceable history) or in a separate `chore(release): v0.1.x` commit.

- [ ] **Step 2: Commit**

```
git commit -m "fix(updater): use default import for CJS electron-updater

electron-updater is compiled to CommonJS with Object.defineProperty
exports. Node's ESM loader cannot statically detect those, so the
named import 'import { autoUpdater } from \"electron-updater\"' fails
at runtime in the packaged app with 'Named export not found'.

Switch to default import + destructure. Update the vi.mock to mirror
real CJS shape ({ default: { autoUpdater } }) so the same regression
would fail in CI next time.

Affected releases: v0.1.2 and v0.1.3 crash on launch. Users on those
versions need a direct download of v0.1.4+ to recover."
```

- [ ] **Step 3: Push**

```
git push origin feat/trend-search
```

(Or current branch.) Expected: push succeeds.

---

## Self-review notes

**Spec coverage:**
- ✅ Source fix → Task 2
- ✅ Test mock fix → Task 1 (deliberately first, so failing test demonstrates the bug)
- ✅ Tests pass → Tasks 1.2, 2.2, 2.3
- ✅ Dev launch verification → Task 3
- ✅ Packaged-build verification → Task 4
- ✅ Release v0.1.4 → Task 5
- ✅ Rollout to users with broken builds → Task 5.4
- ✅ Commit (manual, per "no auto-commit" rule) → Task 6

**Placeholder scan:** Every step has concrete commands and exact file paths. The only "soft" instruction is Task 3.1's "If onboarding screen appears" — that's a conditional UI state, not a placeholder.

**Type consistency:** Only one symbol involved (`autoUpdater`), spelled the same way in the source, test mock, and spec. No drift possible.

**Bite-sized check:** 6 tasks, ~3 steps each, each step is one terminal command or one edit. Total realistic time ~15 minutes including the build (build itself takes ~2 min).
