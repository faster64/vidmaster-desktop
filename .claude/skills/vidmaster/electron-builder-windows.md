---
name: electron-builder-windows
description: Configure electron-builder for a Windows-only NSIS installer with native modules (sharp, ffmpeg) — asarUnpack, per-user install, no code signing.
---

# electron-builder for Windows

## When to use

When packaging an Electron app for internal Windows distribution and you must:

- Ship native binaries (`sharp`, FFmpeg)
- Avoid UAC prompts (per-user install)
- Skip code signing (acceptable internally — shows SmartScreen warning once)

## Process

1. **Install:** `npm install --save-dev electron-builder`. Use the major version that matches your Electron major (e.g., electron 30 → electron-builder ^25).

2. **Add `package.json > build`** with the canonical block:

   ```json
   {
     "appId": "com.example.app",
     "productName": "VidMaster",
     "directories": { "output": "dist", "buildResources": "build" },
     "files": ["electron/**", "src/**", "node_modules/**", "package.json"],
     "asar": true,
     "asarUnpack": ["**/node_modules/{@ffmpeg-installer,ffmpeg-static,sharp}/**"],
     "win": {
       "target": [{ "target": "nsis", "arch": ["x64"] }],
       "icon": "build/icon.ico"
     },
     "nsis": {
       "oneClick": false,
       "perMachine": false,
       "allowToChangeInstallationDirectory": true,
       "createDesktopShortcut": true,
       "createStartMenuShortcut": true,
       "shortcutName": "VidMaster",
       "uninstallDisplayName": "VidMaster"
     }
   }
   ```

3. **`asarUnpack` is load-bearing.** Native modules and binary assets cannot be loaded from inside an asar archive. The glob `**/node_modules/{@ffmpeg-installer,ffmpeg-static,sharp}/**` covers nested deps. Don't broaden to `**/node_modules/**` — installer balloons.

4. **Build commands:**
   - `electron-builder --dir` — produces `dist/win-unpacked/` (no installer). Fast iteration; double-click the `.exe` inside to test.
   - `electron-builder --win --x64` — produces `dist/<Product> Setup <version>.exe` NSIS installer.

5. **Per-user install rationale:** `oneClick: false` + `perMachine: false` means no UAC prompt, install path picker shown, and the app is per-user. Trade-off: installer doesn't propagate to other Windows accounts on the same machine, but that's rarely a concern internally.

6. **Settings/log retention:** uninstaller deletes program files but leaves `%APPDATA%\<ProductName>\` intact (default behaviour). This is desirable — settings/logs persist across reinstalls.

## Examples

A single full build invocation:

```
npm run build
# → dist/VidMaster Setup 0.1.0.exe (~80–110 MB)
```

A directory build for fast manual testing:

```
npm run build:dir
# → dist/win-unpacked/VidMaster.exe
```

## Pitfalls

- **`asarUnpack` glob too broad.** Adding `**/node_modules/**` adds 100s of MB.
- **Forgetting to rebuild after schema changes.** Some changes (icon, asar contents) are not cached — but `package.json > build` changes always require a rebuild.
- **Setting `perMachine: true` casually.** Triggers UAC on every install. Only use if you genuinely need machine-wide install for service-like behaviour.
- **Code-signing skipped silently.** Add a SmartScreen note to README so users don't think the installer is malware on first launch.
- **Native binaries stripped.** If `sharp` errors with "Could not find the bindings file" after install, your `asarUnpack` didn't catch it. Verify the unpacked folder contains `node_modules/sharp/build/Release/*.node`.
- **Mismatched electron / electron-builder versions.** Major mismatch produces obscure failures during native rebuild. Pin both.
