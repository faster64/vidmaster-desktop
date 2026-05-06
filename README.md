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

## Cài đặt

1. Tải file `VidMaster Setup X.Y.Z.exe`.
2. Double-click để cài.
3. Lần đầu chạy, Windows có thể hiện cảnh báo "Windows đã bảo vệ máy tính của bạn" (SmartScreen).
   - Click **"Thông tin khác"** rồi **"Vẫn chạy"**.
   - Cảnh báo này xuất hiện vì bản internal chưa code-sign. Nếu sau này có cert Authenticode, cảnh báo sẽ biến mất.
