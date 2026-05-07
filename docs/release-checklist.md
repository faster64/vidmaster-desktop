# Pre-release smoke checklist

Run on a clean Windows 10 or 11 VM (no Node, no dev tools installed).

## Install
- [ ] Double-click installer; install completes without UAC.
- [ ] Desktop shortcut exists.
- [ ] Start Menu shortcut exists.

## First launch
- [ ] App launches from shortcut.
- [ ] Onboarding asks for workspace folder.
- [ ] After choosing folder, all 3 subfolders are created (`overlays`, `backgrounds`, `done`).
- [ ] Render screen renders.

## Each task (with sample data)
- [ ] Render Video runs end-to-end on a small overlay+background set.
- [ ] Cắt đầu/cuối runs and produces trimmed videos.
- [ ] Chia nhỏ video nền runs.
- [ ] Lấy link kênh / Tải video / Nối đầu/cuối run end-to-end.

## Queue + cancel
- [ ] Submit two tasks; only one runs at a time.
- [ ] Cancel running task; FFmpeg process terminates within 5 s; queue moves to next.

## Error display
- [ ] Trigger a deliberate error (e.g., point Render at empty folders).
- [ ] Error modal opens automatically with stack and recent log lines.
- [ ] "Copy log" copies. "Mở file log" opens log in Notepad.

## Settings persistence
- [ ] Change a Render default. Restart app. Setting persists.

## Uninstall
- [ ] Uninstall via Start Menu removes program files and shortcuts.
- [ ] `%APPDATA%\VidMaster\` retained.

If any item fails, do not ship; file a bug and fix before retrying the checklist.
