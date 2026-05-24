# VidMaster — Download MP3/MP4 Format Selector — Design

**Date**: 2026-05-18
**Status**: Approved, ready for implementation plan
**Owner**: cuongnguyen.ftdev

## 1. Mục tiêu

Cho phép user chọn định dạng output trong task "Tải video": **mp4** (mặc định, hành vi hiện tại — video+audio merged) hoặc **mp3** (chỉ audio, extract qua ffmpeg).

Lý do: user có nhu cầu tải nhạc/podcast dạng audio-only thay vì luôn lấy video.

## 2. Phạm vi

**In scope:**
- UI radio "📦 Định dạng" trong screen "Tải video": mp4 / mp3 (default mp4).
- `runDownload` accept `format` param, validate, branch yt-dlp args theo format.
- Thumbnail: vẫn lưu file `.jpg` song song cho cả 2 mode (consistent với mp4 hiện tại).
- Archive file `downloaded.txt`: shared cross-format (user xóa thủ công nếu muốn re-download format khác).
- Persist `lastConfig.download.format` qua session.
- `outputs` array trả về đúng file media (.mp4 hoặc .mp3 theo format).
- Test mới: validate format invalid, verify args mp3 mode khác mp4 mode.

**Out of scope:**
- Embed thumbnail vào mp3 metadata (đã loại — user chọn "lưu .jpg riêng").
- Format-specific archive (`downloaded.mp4.txt` / `downloaded.mp3.txt`) — đã loại, dùng chung.
- Audio quality picker (mặc định `--audio-quality 0` = best VBR).
- Audio bitrate constant (320 kbps fixed) — VBR best là đủ tốt.
- Hỗ trợ format khác (m4a, wav, opus, webm).
- Migration `downloaded.txt` cũ.

## 3. Architecture & file layout

**Files thay đổi (2):**

| Path | Thay đổi |
|---|---|
| `src/download.js` | Accept `format` param trong `runDownload`, validate, pass xuống `downloadOne`. Branch yt-dlp args theo format. `renameSanitized` xử lý cả `.mp3`. |
| `electron/renderer/screens/download.js` | Thêm field "📦 Định dạng" với 2 radio mp4/mp3. Read `lastConfig.download.format`, persist khi submit. |

**File test cập nhật:**
- `tests/download.test.js` — thêm test cho format validation + args branching.

**Không thay đổi:**
- `electron/ipc/queue.js` — task type `download` không đổi, config shape mở rộng nhưng runner registration giữ nguyên.
- `electron/preload.mjs` — API không đổi.
- Sidebar, router — không đổi.

## 4. `runDownload` API thay đổi

**Config shape mở rộng:**

```js
{
  urlsFile:      string,
  output:        string,
  ytdlpPath:     string,
  maxConcurrent: number,
  format:        "mp4" | "mp3",   // NEW — default "mp4"
  signal:        AbortSignal,
}
```

**Validation:**

Thêm sau các check hiện có (urlsFile, output, ytdlpPath):

```js
if (format !== "mp4" && format !== "mp3") {
  throw new Error(`Định dạng không hợp lệ: ${format}`);
}
```

Default `format = "mp4"` trong destructure khớp hành vi cũ (caller không pass `format` → mp4).

## 5. `downloadOne` args branching

**Hiện tại (mp4 only):**

```js
const args = [
  "-f", "bestvideo+bestaudio/best",
  "--merge-output-format", "mp4",
  "-o", path.join(output, "%(title)s.%(ext)s"),
  "--write-thumbnail",
  "--convert-thumbnails", "jpg",
  "--no-overwrites",
  "--download-archive", archiveFile,
  url,
];
```

**Sau khi branch:**

```js
const args = format === "mp3"
  ? [
      "-f", "bestaudio/best",
      "--extract-audio",
      "--audio-format", "mp3",
      "--audio-quality", "0",
      "-o", path.join(output, "%(title)s.%(ext)s"),
      "--write-thumbnail",
      "--convert-thumbnails", "jpg",
      "--no-overwrites",
      "--download-archive", archiveFile,
      url,
    ]
  : [
      "-f", "bestvideo+bestaudio/best",
      "--merge-output-format", "mp4",
      "-o", path.join(output, "%(title)s.%(ext)s"),
      "--write-thumbnail",
      "--convert-thumbnails", "jpg",
      "--no-overwrites",
      "--download-archive", archiveFile,
      url,
    ];
```

**Lý do chọn args mp3:**
- `bestaudio/best`: yt-dlp fallback nếu không có audio-only stream (vd: livestream).
- `--extract-audio --audio-format mp3 --audio-quality 0`: ffmpeg encode mp3 quality cao nhất (VBR ~245 kbps).
- `--write-thumbnail --convert-thumbnails jpg`: giữ thumbnail .jpg song song (lựa chọn của user trong brainstorm).
- `--no-overwrites --download-archive`: same với mp4 — skip nếu đã tải.

## 6. `renameSanitized` mở rộng

**Hiện tại:**

```js
function renameSanitized(folder) {
  const out = [];
  for (const ext of [".mp4", ".jpg"]) {
    // ... rename loop
    if (ext === ".mp4") out.push(...);
  }
  return out;
}
```

**Sau:**

```js
function renameSanitized(folder, format) {
  const out = [];
  const mediaExt = format === "mp3" ? ".mp3" : ".mp4";
  for (const ext of [mediaExt, ".jpg"]) {
    const files = fs.readdirSync(folder).filter((n) => n.toLowerCase().endsWith(ext));
    for (const file of files) {
      const base = file.slice(0, file.length - ext.length);
      const safe = sanitizeFilename(base);
      if (safe === base) {
        if (ext === mediaExt) out.push(path.join(folder, file));
        continue;
      }
      const newName = safe + ext;
      const newPath = path.join(folder, newName);
      if (!fs.existsSync(newPath)) {
        fs.renameSync(path.join(folder, file), newPath);
      }
      if (ext === mediaExt) out.push(newPath);
    }
  }
  return out;
}
```

Caller: `const outputs = renameSanitized(output, format);` — thay vì gọi không param.

## 7. Renderer UI

**Field mới** thêm giữa "Folder output" và "Số tải song song":

```html
<div class="field">
  <label>📦 Định dạng</label>
  <div style="display:flex;gap:16px;margin-top:4px">
    <label><input type="radio" name="format" value="mp4" ${lastFormat === "mp4" ? "checked" : ""}> 🎬 mp4 (video + audio)</label>
    <label><input type="radio" name="format" value="mp3" ${lastFormat === "mp3" ? "checked" : ""}> 🎵 mp3 (chỉ audio)</label>
  </div>
</div>
```

**Read last config:**

```js
const lastFormat = last.format ?? "mp4";
```

**Submit handler:**

```js
const format = el.querySelector('input[name="format"]:checked')?.value || "mp4";
// ...
const config = {
  urlsFile, output, maxConcurrent, format,
  ytdlpPath: s.download.ytdlpPath,
};
// ...
await window.api.settings.set({ "lastConfig.download": { urlsFile, output, maxConcurrent, format } });
```

## 8. Settings persistence

`lastConfig.download.format` — string, default `"mp4"` nếu chưa có (renderer fallback). Không cần migration: missing key → fallback hằng số.

## 9. Tests cập nhật

`tests/download.test.js` — thêm các test sau (sử dụng pattern mock spawn hiện có):

**Test 1: Default format=mp4 produces existing args**

```js
it("uses mp4 args by default (no format param)", async () => {
  const urlsFile = path.join(tmpDir, "urls.txt");
  fs.writeFileSync(urlsFile, "u1\n", "utf8");
  const cp = await import("child_process");

  const promise = runDownload({
    urlsFile, output: tmpDir, ytdlpPath: "/yt.exe", maxConcurrent: 1,
  });
  await new Promise((r) => setImmediate(r));
  fakeChildren[0].emit("close", 0);
  await promise;

  const args = cp.spawn.mock.calls[0][1];
  expect(args).toContain("--merge-output-format");
  expect(args).toContain("mp4");
  expect(args).not.toContain("--extract-audio");
});
```

**Test 2: format=mp3 produces audio-extract args**

```js
it("uses mp3 args when format=mp3", async () => {
  const urlsFile = path.join(tmpDir, "urls.txt");
  fs.writeFileSync(urlsFile, "u1\n", "utf8");
  const cp = await import("child_process");

  const promise = runDownload({
    urlsFile, output: tmpDir, ytdlpPath: "/yt.exe", maxConcurrent: 1, format: "mp3",
  });
  await new Promise((r) => setImmediate(r));
  fakeChildren[0].emit("close", 0);
  await promise;

  const args = cp.spawn.mock.calls[0][1];
  expect(args).toContain("--extract-audio");
  expect(args).toContain("--audio-format");
  expect(args).toContain("mp3");
  expect(args).not.toContain("--merge-output-format");
});
```

**Test 3: Invalid format throws**

```js
it("rejects invalid format", async () => {
  const urlsFile = path.join(tmpDir, "urls.txt");
  fs.writeFileSync(urlsFile, "u1\n", "utf8");
  await expect(runDownload({
    urlsFile, output: tmpDir, ytdlpPath: "/yt.exe", maxConcurrent: 1, format: "wav",
  })).rejects.toThrow(/Định dạng không hợp lệ/);
});
```

**Existing tests:** không sửa — backward compatible vì `format` default mp4. 5 tests cũ vẫn pass.

## 10. Error handling

- `format` invalid → throw `"Định dạng không hợp lệ: <value>"` (early, trước khi spawn yt-dlp).
- yt-dlp lỗi mp3 mode (vd: video không có audio stream) → catch trong `downloadOne` per-URL, push vào `errors[]`, tiếp tục. Pattern giống mp4 mode.

## 11. Acceptance criteria

1. Tab "Tải video" hiển thị field "📦 Định dạng" với 2 radio mp4 (checked) / mp3, ngay sau folder output.
2. `lastConfig.download.format` persist qua session (kiểm tra reload renderer giữ lựa chọn).
3. Submit với mp4: hành vi y hệt hiện tại (mp4 + jpg trong output folder).
4. Submit với mp3: file `.mp3` + `.jpg` song song trong output folder, không có `.mp4`.
5. `outputs` array trả về đúng path media file (`.mp4` hoặc `.mp3` theo format).
6. Invalid format (vd: gọi API trực tiếp với `format: "wav"`) → task error với message tiếng Việt.
7. `npm test` baseline + 3 test mới — không regression.
8. `npm run build:dir` thành công.

## 12. Non-goals / Future work

- Embed thumbnail vào mp3.
- Cho phép chọn audio bitrate cụ thể (192k/256k/320k).
- Hỗ trợ format khác (m4a, opus, wav).
- Format-specific archive file.
- Show estimated file size khác nhau giữa mp4 vs mp3 trước khi tải.
