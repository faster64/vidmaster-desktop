# Auto-Update on Startup + Automatic Version Bump on Build

**Status:** Draft
**Date:** 2026-05-11
**Owner:** cuongnguyen.ftdev

## Goal

When the user opens VidMaster, the app must:

1. Show a dedicated "Đang kiểm tra cập nhật..." screen as the first UI.
2. Compare the local version against the latest published version on a remote store.
3. If a newer version exists, download and install it automatically, then restart into the new version.
4. If no update or the check fails, fall through to the normal app shell.

Each `npm run build` (and `npm run release`) must automatically bump the `patch` segment of `package.json` `version` before the installer is produced, so every release artifact has a unique, monotonically increasing version.

## Non-goals

- Differential / delta updates (electron-updater handles this internally; no extra config).
- Multi-channel releases (beta/canary). Single stable channel for now.
- Custom signing certificates. NSIS unsigned installer is acceptable for this iteration.
- Auto-committing the version bump to git (the user has a standing "never auto-commit" rule).
- Update notifications outside of startup. There is no "Check for updates" menu item; checking happens only on launch.

## Constraints / context

- Repo: public GitHub `faster64/vidmaster-desktop`.
- Packager: `electron-builder` producing an NSIS installer for Windows x64.
- UI language: Vietnamese (technical keywords kept in English per project memory).
- Update host: **GitHub Releases** (decided during brainstorming).
- Update flow: **blocking** — user cannot enter app until the check completes (decided during brainstorming).
- Bump rule: **patch++ on every build, no commit** (decided during brainstorming).

## Architecture

### Components

```
Main process
├─ electron/main.js             reordered: do not init workspace/queue
│                               until renderer signals "proceed"
├─ electron/updater.js          new — wraps electron-updater's autoUpdater,
│                               emits typed events, applies 10s timeout
└─ electron/ipc/updater.js      new — IPC channel registration

Renderer
├─ electron/renderer/main.js    gates app mount behind update-check stage
└─ electron/renderer/screens/updateCheck.js   new — full-screen check UI

Build pipeline
├─ scripts/bump-version.mjs     new — patch++ in package.json
└─ package.json                 prebuild/release scripts, publish config,
                                electron-updater dep
```

Each component has a single responsibility and a narrow interface:

- `electron/updater.js` — exports `createUpdater({ window, log })` returning `{ check(), proceed(), dispose() }`. Hides `electron-updater` from the rest of the app.
- `electron/ipc/updater.js` — exports `registerUpdaterIpc(getWindow)` mirroring the pattern in `electron/ipc/*.js`. Defines channels `updater:check`, `updater:proceed`, and event push channel `updater:event`.
- `electron/renderer/screens/updateCheck.js` — exports `mountUpdateCheck({ onProceed })`. Pure UI; all state machine logic delegated to main via IPC.
- `scripts/bump-version.mjs` — pure node script, no electron deps, easy to unit-test.

### IPC contract

Renderer → main:
- `updater:check()` → starts the check. Idempotent (no-op if already running).
- `updater:proceed()` → renderer signals "I'm ready to mount the normal app" (called after `not-available` or after user clicks "Tiếp tục dùng app" on error).

Main → renderer (pushed via `webContents.send("updater:event", ...)`):
- `{ type: "checking" }`
- `{ type: "not-available", currentVersion }`
- `{ type: "available", currentVersion, nextVersion }`
- `{ type: "download-progress", percent, bytesPerSecond, transferred, total }`
- `{ type: "downloaded", nextVersion }` — main immediately calls `quitAndInstall()` after sending
- `{ type: "error", code, message }` — `code` is one of `"timeout" | "network" | "rate-limit" | "signature" | "unknown"`

### Startup sequence

```
app.whenReady
├─ registerSettingsIpc, registerQueueIpc, …  (unchanged)
├─ registerUpdaterIpc                         (new)
├─ createWindow()  → loads index.html
│   renderer mounts updateCheck.js
│   renderer fires updater:check
├─ updater path branches:
│   • not-available → renderer fires updater:proceed
│   • error/timeout → renderer shows retry/continue, then proceed
│   • available → download → quitAndInstall (process ends here)
└─ on updater:proceed (only fires when staying in app):
    ├─ ensureWorkspace
    ├─ Telegram start ping
    ├─ yt-dlp auto-update (if enabled)
    └─ renderer mounts sidebar + screens
```

The current `main.js` runs workspace/Telegram/yt-dlp setup synchronously inside `whenReady`. We defer those into a `bootstrapAfterUpdateCheck` function called from the `updater:proceed` handler so we don't waste work when an update is about to install.

### Dev mode

`!app.isPackaged` (i.e. `npm run dev`) short-circuits: the updater wrapper immediately emits `not-available` without touching the network. This keeps the dev loop instant.

## Data flow

```
[App start] → createWindow → renderer mounts updateCheck → IPC updater:check
                                                                  │
                                            autoUpdater.checkForUpdates()
                                            (with 10s timeout)
                                                                  │
              ┌───────────────────────┬─────────────┬─────────────┴───────────┐
              ▼                       ▼             ▼                         ▼
       not-available            available       error/timeout            (download)
              │                       │             │                         │
       proceed → app          progress events       │                  downloaded
                                      │             │                         │
                              downloaded event      │                         │
                                      │     [Thử lại] [Tiếp tục]              │
                              quitAndInstall                                  │
                                                    │                  quitAndInstall
                                              proceed → app
```

## Update screen UI

Full-window, no chrome:

```
┌─────────────────────────────────────┐
│                                     │
│           [VidMaster logo]          │
│                                     │
│      Đang kiểm tra cập nhật...      │
│         ⠋  (spinner)                │
│                                     │
└─────────────────────────────────────┘
```

States:
- **checking**: "Đang kiểm tra cập nhật..." + spinner.
- **available**: "Đã có bản v{next}. Đang tải..." + progress bar + "{percent}%  {speedMB}/s".
- **downloaded**: "Đang cài đặt v{next}..." + spinner. Quit follows immediately.
- **error**: Vietnamese message keyed by `code` (e.g. `timeout` → "Không kiểm tra được cập nhật (quá thời gian)"). Two buttons: **Thử lại** (re-fires `updater:check`), **Tiếp tục dùng app** (fires `updater:proceed`). After 5s of inactivity, the "Tiếp tục" button is auto-clicked so an unattended offline launch doesn't block the user.

Text style follows the existing app — Vietnamese sentences, raw error codes kept inline in parentheses for debuggability (e.g. "Không kết nối được (ENOTFOUND)").

## Build / publish pipeline

### Bump script

`scripts/bump-version.mjs`:

```js
import { readFileSync, writeFileSync } from "fs";
const file = "package.json";
const pkg = JSON.parse(readFileSync(file, "utf8"));
const [maj, min, pat] = pkg.version.split(".").map(Number);
if ([maj, min, pat].some(Number.isNaN)) {
  throw new Error(`Cannot parse version: ${pkg.version}`);
}
pkg.version = `${maj}.${min}.${pat + 1}`;
writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
console.log(`Version bumped → ${pkg.version}`);
```

### package.json additions

```json
{
  "scripts": {
    "bump": "node scripts/bump-version.mjs",
    "prebuild": "npm run bump",
    "build": "electron-builder --win --x64",
    "prerelease": "npm run bump",
    "release": "electron-builder --win --x64 --publish always"
  },
  "build": {
    "publish": [
      { "provider": "github", "owner": "faster64", "repo": "vidmaster-desktop" }
    ]
  },
  "dependencies": {
    "electron-updater": "^6.x"
  }
}
```

Notes:
- `prebuild` / `prerelease` are npm lifecycle hooks; they run automatically when `npm run build` / `npm run release` are invoked.
- `electron-builder` generates `app-update.yml` inside the installed app whenever `publish` is configured. No manual file needed.
- `GH_TOKEN` (PAT with `repo` scope) must be present in the shell env for `npm run release` to upload artifacts. Local `build` does not need it.
- Public repo means end users do not need any token to download updates.

### Two workflows

- `npm run build` — bumps version, builds installer locally to `dist/`, does not upload. Useful for testing.
- `npm run release` — bumps version, builds, uploads `VidMaster-Setup-x.y.z.exe` + `latest.yml` as a **draft** GitHub release. Developer manually publishes the draft on github.com when ready.

The bumped `package.json` is left unstaged. The developer commits it manually together with the release.

## Error handling

| Scenario                                | Handling                                                                                                |
|-----------------------------------------|---------------------------------------------------------------------------------------------------------|
| Offline / DNS failure                   | 10s timeout in updater wrapper → emit `error` with `code: "timeout"`. UI shows retry/continue.          |
| GitHub returns 404 (no release yet)     | `electron-updater` treats as no update → emit `not-available`. App proceeds.                            |
| GitHub rate limit (60/h unauth)         | `error` with `code: "rate-limit"`. UI shows retry/continue.                                             |
| Download fails mid-way                  | `electron-updater` retries internally up to 3 times. If still failing → `error` with `code: "network"`. |
| Signature/checksum mismatch             | `electron-updater` aborts install → `error` with `code: "signature"`. Do **not** attempt install.       |
| User closes window during download      | App quits cleanly. Next launch will re-check.                                                           |
| `app-update.yml` missing (old install)  | Caught error → emit `error` with `code: "unknown"`. UI shows continue.                                  |
| Dev mode (`!app.isPackaged`)            | Wrapper short-circuits to `not-available`. No network call.                                             |

All updater events are logged via the existing `electron-log` to `main.log`.

## Testing

### Unit tests (vitest)

- `scripts/bump-version.mjs` — extract the bump logic into an exported `bumpPatch(version)` pure function. Tests:
  - `"0.1.0" → "0.1.1"`
  - `"1.0.0" → "1.0.1"`
  - `"0.1.9" → "0.1.10"` (no overflow to minor)
  - `"abc" → throws`
- `electron/updater.js` — mock `electron-updater`'s `autoUpdater`. Test the state machine:
  - `check()` emits `checking`
  - `update-not-available` event → emit `not-available`
  - `update-available` event → emit `available`, then `download-progress`, then `downloaded`
  - 10s elapsed before any response → emit `error` with `code: "timeout"`
  - error from `autoUpdater` → emit `error` with matching `code`
  - `dispose()` after `check()` cancels the timeout

### Manual smoke test (cannot automate — needs Electron + NSIS + network)

1. Build and install `v0.1.0` (or whatever current). Confirm app opens normally — first install has no `app-update.yml` yet, so update check returns `error` → continue.
2. `npm run release` (bumps to next patch, uploads draft). Publish the draft on GitHub.
3. Open the installed v0.1.0 app → expect: check screen → "available" → progress bar → installer runs → app restarts as new version. Verify `package.json` version in DevTools or About section.
4. Offline test: disconnect network, open app → expect timeout after 10s → retry/continue UI → wait 5s → auto-continues into app.

## Open items

None. All design decisions resolved during brainstorming.

## Out-of-scope follow-ups

- Show current vs new version in a richer "What's new" panel sourced from GitHub release notes.
- Add a "Check for updates now" button in Settings.
- Sign the NSIS installer with a code-signing certificate (eliminates SmartScreen warning).
- Beta / canary channels using `electron-updater`'s `channel` config.
