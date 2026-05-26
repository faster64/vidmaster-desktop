# VidMaster — Elderly Video (Video người già) — Design

**Date**: 2026-05-24 (extended 2026-05-25: nền video)
**Status**: Approved, ready for implementation plan
**Owner**: cuongnguyen.ftdev

## 1. Mục tiêu

Thêm task thứ 10 vào VidMaster: ghép một video overlay (.mp4) lên trên một **nền tĩnh (.jpg/.png) hoặc nền video (.mp4)** ở một vị trí xác định, output là video 1280×720. Use case chính: nội dung "người già" trên YouTube — nền là tranh/câu chữ tĩnh hoặc cảnh video nhẹ, video overlay là người nói chuyện đặt ở góc.

## 2. Phạm vi

**In scope:**
- Task mới `elderlyVideo` xuất hiện trong sidebar nhóm Tasks.
- Input: 1 folder nền hỗn hợp (.jpg/.png/.mp4) + 1 folder video overlay (.mp4) + cấu hình vị trí + kích thước overlay.
- Pairing tuần tự: `video[i]` ghép với `background[i % numBackgrounds]` (wrap quanh khi hết nền).
- Output 1280×720, nền scale-cover (crop để lấp đầy), overlay video resize về WxH user nhập.
- Audio lấy từ overlay video (volume 1.0). Nếu video overlay không có audio → silent track. Audio của nền video (nếu có) luôn bị bỏ.
- Duration output:
  - Nền là image → duration = duration overlay.
  - Nền là video → duration = `max(duration_bg, duration_overlay)`; nền hoặc overlay (cái ngắn hơn) sẽ được loop để fill.
- Tên file output = `<videoBase>.mp4`. History `_processed.json` + heal từ disk để skip video đã xử lý.
- Inherit GPU/encoder settings từ `settings.json` giống task `render`.
- Persist last config (paths, anchor, overlay size, offset) qua electron-store.
- Unit test validation + abort + position math.

**Out of scope:**
- Drag-drop UI trên preview canvas (chọn position bằng radio + offset px là đủ).
- Multiple overlays trong cùng một output.
- Output resolution khác 1280×720 (1080p, dọc, vuông).
- Ảnh nền scale `contain`/`stretch` (chỉ hỗ trợ `cover`).
- Loop video nếu video ngắn hơn duration mong muốn (duration luôn = video).
- Fade in/out cho overlay video.
- Pairing strategies khác round-robin.

## 3. Approach đã chọn

**Approach A — clone pattern `render` đơn giản hoá, một ffmpeg call mỗi cặp**

Mỗi cặp (background, video) → một ffmpeg invocation. Pipeline branch theo extension của nền:

**Nền là image (.jpg/.png):**
```
ffmpeg -y \
  -loop 1 -framerate 30 -i <image> \
  -i <video> \
  [-f lavfi -i anullsrc=...]  (chỉ khi video không có audio) \
  -filter_complex "[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720[bg];\
                   [1:v]scale=W:H[ov];[bg][ov]overlay=X:Y[v]" \
  -map "[v]" -map "1:a" (hoặc "-map 2:a" nếu silent) \
  -t <overlay_duration> \
  -c:v <libx264|h264_nvenc|...> \
  -c:a aac -ar 44100 -ac 2 \
  -movflags +faststart \
  <output>
```

**Nền là video (.mp4):**
```
ffmpeg -y \
  -stream_loop -1 -i <bg_video> \
  -stream_loop -1 -i <overlay_video> \
  [-f lavfi -i anullsrc=...]  (chỉ khi overlay không có audio) \
  -filter_complex "[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720[bg];\
                   [1:v]scale=W:H[ov];[bg][ov]overlay=X:Y[v]" \
  -map "[v]" -map "1:a" (hoặc "-map 2:a" nếu silent) \
  -t <max(bg_duration, overlay_duration)> \
  -c:v <libx264|h264_nvenc|...> \
  -c:a aac -ar 44100 -ac 2 \
  -movflags +faststart \
  <output>
```

Khác biệt giữa 2 nhánh chỉ ở input flags (`-loop 1 -framerate 30` cho image vs `-stream_loop -1` cho bg + overlay) và target duration. Filter graph giống nhau hoàn toàn.

**Lý do:**
- Khớp 100% pattern hiện có → reuse `TaskRunner`, `spawnFfmpeg` progress parser, queue manager, GPU detect, settings.
- Mỗi output là 1 ffmpeg invocation độc lập → dễ debug, dễ test, cancel sạch (kill 1 process).
- Lỗi 1 file không kill batch.

**Alternatives đã loại:**
- *Pre-compose ảnh nền ra PNG tạm rồi overlay* → round-robin nghĩa là mỗi ảnh chỉ dùng `ceil(numVideos/numImages)` lần, tiết kiệm không đáng phức tạp thêm.
- *Single ffmpeg call multi-output* → FFmpeg hỗ trợ kém, không cancel được giữa chừng, lỗi 1 file kill batch.

## 4. Architecture & file layout

**Files mới:**

| Path | Vai trò |
|---|---|
| [src/elderlyVideo.js](src/elderlyVideo.js) | Task module: batch ghép overlay video lên ảnh nền, dùng `TaskRunner` + `runner.spawnFfmpeg`. |
| [electron/renderer/screens/elderlyVideo.js](electron/renderer/screens/elderlyVideo.js) | Screen UI: form 3 folder picker + radio anchor + WxH overlay + offset XY. |
| [tests/elderlyVideo.test.js](tests/elderlyVideo.test.js) | Validation + abort + position math tests + happy path với fixture nhỏ. |

**Files thay đổi:**

| Path | Thay đổi |
|---|---|
| [electron/renderer/components/sidebar.js](electron/renderer/components/sidebar.js) | Thêm `{ id: "elderlyVideo", icon: "🧓", label: "Video người già" }` sau `recolorThumb` (trước `trendSearch`). |
| [electron/renderer/main.js](electron/renderer/main.js) | Route `elderlyVideo` → `renderElderlyVideo`; thêm `elderlyVideo: "Video người già"` vào `TASK_LABELS`. |
| [electron/ipc/queue.js](electron/ipc/queue.js) | Map `elderlyVideo: runElderlyVideo` trong `runners` + import. |

## 5. Module — `src/elderlyVideo.js`

**Signature:**

```js
export async function runElderlyVideo(config) // -> { ok, outputs, errors }
```

**`config` shape:**

```js
{
  inputImages:    string,    // folder chứa .jpg/.png
  inputVideos:    string,    // folder chứa .mp4
  output:         string,    // folder đầu ra
  anchor:         string,    // "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right"
  overlayWidth:   number,    // integer > 0, pixels
  overlayHeight:  number,    // integer > 0, pixels
  offsetX:        number,    // integer, có thể âm; px cộng vào anchor X
  offsetY:        number,    // integer, có thể âm; px cộng vào anchor Y
  ffmpeg:         { useGPU: boolean, encoder: string },
  signal:         AbortSignal,
}
```

**Steps:**

1. Tạo `TaskRunner(config)`.
2. Validate:
   - `inputImages` non-empty + tồn tại → throw `"Folder ảnh nền không tồn tại."`
   - `inputVideos` non-empty + tồn tại → throw `"Folder video không tồn tại."`
   - `output` non-empty → throw `"Thiếu folder output."`
   - `anchor` ∈ `ANCHORS` (set 9 anchor) → throw `"Anchor không hợp lệ: <value>"`
   - `overlayWidth`, `overlayHeight` integer > 0 → throw `"overlayWidth phải là số nguyên > 0."` / tương tự cho height
   - `offsetX`, `offsetY` integer (cho phép âm) → default 0 nếu undefined
3. List file:
   - Images: `fs.readdirSync(inputImages).filter(/\.(jpe?g|png)$/i).sort(naturalSort)` — trống → throw `"Folder ảnh không có file .jpg/.png."`
   - Videos: `fs.readdirSync(inputVideos).filter(/\.mp4$/i).sort(naturalSort)` — trống → throw `"Folder video không có file .mp4."`
4. `fs.mkdirSync(output, { recursive: true })`.
5. Read history `_processed.json`, heal từ disk (mọi `<base>.mp4` đã tồn tại trong output coi như đã xử lý).
6. Filter `todoVideos` = videos chưa có trong history. Nếu rỗng → log "đã xử lý hết, xoá `_processed.json` để chạy lại", return `{ ok: true, outputs: [], errors: [] }`.
7. Loop `todoVideos`:
   - `runner.checkAborted()`.
   - Lấy index gốc của video trong `videos` (để round-robin ổn định khi thêm video mới sau): `originalIdx = videos.indexOf(videoName)`.
   - `imagePath = path.join(inputImages, images[originalIdx % images.length])`.
   - `outputPath = path.join(output, <videoBase>.mp4)`.
   - Gọi `processOnePair(...)`.
   - Catch (trừ `AbortError`): push `errors[]`, `runner.log("error", ...)`, tiếp tục.
   - Trên success: push `outputs[]`, `history.add(videoBase)`, `writeHistory(history)`.
   - `runner.setProgress(((i+1)/todoVideos.length) * 100, "<i+1>/<total> <videoBase>")`.
8. Return `{ ok: errors.length === 0, outputs, errors }`.

**`processOnePair`:**

1. Probe video (`ffmpeg.ffprobe`) → `{ duration, hasAudio }`.
2. Tính `[X, Y] = computeOverlayXY(anchor, 1280, 720, overlayWidth, overlayHeight, offsetX, offsetY)`.
3. Build args:
   - `-y -loop 1 -framerate 30 -i <image>`
   - `-i <video>`
   - Nếu `!hasAudio`: `-f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100`
   - `-filter_complex "[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720[bg];[1:v]scale=W:H[ov];[bg][ov]overlay=X:Y[v]"`
   - `-map "[v]" -map "1:a"` (nếu hasAudio) hoặc `-map "[v]" -map "2:a"` (nếu silent)
   - `-t <duration>`
   - GPU branch: `-c:v <encoder> -preset fast -pix_fmt yuv420p -r 30 -g 60 -keyint_min 60 -sc_threshold 0 -cq:v 23 -rc:v vbr`
   - CPU branch: `-c:v libx264 -preset ultrafast -pix_fmt yuv420p -r 30 -g 60 -keyint_min 60 -sc_threshold 0 -crf 23`
   - `-c:a aac -ar 44100 -ac 2 -movflags +faststart <outputPath>`
4. `await runner.spawnFfmpeg(args, { totalDurationSec: duration, message: ... })`.

## 6. Position math — `computeOverlayXY`

Output canvas 1280×720, overlay box WxH. Anchor xác định góc tham chiếu, offset cộng vào.

```
ANCHORS = {
  "top-left":     [0,            0           ],
  "top":          [(1280 - W)/2, 0           ],
  "top-right":    [1280 - W,     0           ],
  "left":         [0,            (720 - H)/2 ],
  "center":       [(1280 - W)/2, (720 - H)/2 ],
  "right":        [1280 - W,     (720 - H)/2 ],
  "bottom-left":  [0,            720 - H     ],
  "bottom":       [(1280 - W)/2, 720 - H     ],
  "bottom-right": [1280 - W,     720 - H     ],
}

X = round(anchor.x + offsetX)
Y = round(anchor.y + offsetY)
```

**Không clamp về biên** — nếu user nhập offset/size làm overlay tràn ra ngoài 1280×720, ffmpeg `overlay` filter mặc định clip. Hành vi này hợp lý cho effect "video lệch ra ngoài" (vd: chỉ thấy một phần video). Validation chỉ check `W > 0`, `H > 0`.

## 7. Screen UI — `electron/renderer/screens/elderlyVideo.js`

**Function:** `export async function renderElderlyVideo(el)`.

**Layout** (form đơn giản, kế thừa `taskFormShell` + `bindTaskForm`):

```
🧓 Video người già
Ghép video overlay lên ảnh nền tĩnh. Output 1280×720.

📁 Folder ảnh nền (.jpg/.png)        [input] [📂] [↗]
📁 Folder video overlay (.mp4)       [input] [📂] [↗]
📁 Folder output                     [input] [📂] [↗]

📍 Vị trí video overlay
  3×3 grid radio:
   ◯ Trên trái   ◯ Trên       ◯ Trên phải
   ◯ Trái        ◯ Giữa       ◯ Phải
   ◉ Dưới trái   ◯ Dưới       ◯ Dưới phải

🔢 Kích thước overlay (px)
   W: [480]    H: [270]

🔧 Tuỳ chọn nâng cao
   Offset X (px): [0]    Offset Y (px): [0]
   ☐ Dùng GPU
   Encoder: <auto-resolved>

[▶ Thực hiện]  [Reset mặc định]
```

**Form fields & defaults:**

| Field | Control | Default |
|---|---|---|
| Folder ảnh nền | `type:folder`, `mustExist:"folder"` | `lastConfig.elderlyVideo.inputImages` hoặc `${ws}\elderly\images` |
| Folder video overlay | `type:folder`, `mustExist:"folder"` | `lastConfig.elderlyVideo.inputVideos` hoặc `${ws}\elderly\videos` |
| Folder output | `type:folder` | `lastConfig.elderlyVideo.output` hoặc `${ws}\elderly\output` |
| Vị trí (anchor) | 9 radio dạng 3×3 grid | `lastConfig.elderlyVideo.anchor` hoặc `"bottom-left"` |
| Overlay width | `type:number`, min=1, step=1 | `lastConfig.elderlyVideo.overlayWidth` hoặc `480` |
| Overlay height | `type:number`, min=1, step=1 | `lastConfig.elderlyVideo.overlayHeight` hoặc `270` |
| Offset X (advanced) | `type:number`, step=1 | `lastConfig.elderlyVideo.offsetX` hoặc `0` |
| Offset Y (advanced) | `type:number`, step=1 | `lastConfig.elderlyVideo.offsetY` hoặc `0` |
| useGPU (advanced) | `type:checkbox` | `settings.render.useGPU` |

**Đặc thù — 9-anchor radio grid:**

`taskFormShell` chuẩn không có field "anchor grid 3×3", nên screen sẽ:
- Define `fields` chuẩn cho folder + number + checkbox (qua `taskFormShell`).
- Thêm thủ công block HTML cho 3×3 anchor grid sau khi mount, hoặc render hoàn toàn thủ công (giống `thumbAvatar.js` không dùng `taskFormShell`).

→ Quyết định: **render thủ công** (giống `thumbAvatar.js`) vì có anchor grid + folder picker pattern phức tạp hơn các field chuẩn. Reuse `pickFolder`/`shell.openFolder` IPC.

**Submit flow:**

```js
const config = {
  inputImages, inputVideos, output,
  anchor, overlayWidth, overlayHeight,
  offsetX: offsetX || 0, offsetY: offsetY || 0,
  ffmpeg: { useGPU, encoder: settings.ffmpeg.encoder },
};
await window.api.queue.add({ type: "elderlyVideo", config });
await window.api.settings.set({
  "lastConfig.elderlyVideo": {
    inputImages, inputVideos, output,
    anchor, overlayWidth, overlayHeight, offsetX, offsetY,
  },
});
toast({ kind: "success", message: "✅ Đã thêm vào hàng đợi" });
```

## 8. History file — `_processed.json`

Pattern y hệt `_rendered.json` của `render.js`:

```json
{ "version": 1, "processed": ["video1", "video2", "..."] }
```

Lưu ở `<output>/_processed.json`. Heal từ disk: mọi file `<base>.mp4` trong output được add vào set. Skip video nếu `videoBase` ∈ set.

Helper functions (private trong `elderlyVideo.js`, không export):
- `readProcessedHistory(outputFolder)` → `string[]`
- `writeProcessedHistory(outputFolder, set)` → void
- `healProcessedFromDisk(outputFolder, history, videoNames)` → `Set<string>`

## 9. Error handling

| Trường hợp | Hành vi |
|---|---|
| `inputImages` không tồn tại | Throw `"Folder ảnh nền không tồn tại."` |
| `inputVideos` không tồn tại | Throw `"Folder video không tồn tại."` |
| `output` rỗng | Throw `"Thiếu folder output."` |
| Folder ảnh không có .jpg/.png | Throw `"Folder ảnh không có file .jpg/.png."` |
| Folder video không có .mp4 | Throw `"Folder video không có file .mp4."` |
| Anchor không hợp lệ | Throw `"Anchor không hợp lệ: <value>"` |
| `overlayWidth/Height` không integer hoặc ≤ 0 | Throw `"overlayWidth phải là số nguyên > 0."` / cho height |
| Video corrupt (ffprobe fail) | Catch per-file → push errors[], log error, tiếp tục |
| FFmpeg fail giữa chừng (1 file) | Catch (trừ AbortError) → push errors[], log error, tiếp tục |
| Output trùng input | Cho phép, ghi đè (pattern giống các task khác) |
| Abort giữa batch | Throw `AbortError`, task dừng; file đã ghi giữ nguyên trong output (đã add vào history). |

Toàn bộ message tiếng Việt, giữ technical keywords inline (`AbortError`, `.jpg`, `.mp4`).

## 10. Tests

**`tests/elderlyVideo.test.js`** (pattern giống `thumbAvatar.test.js` + `cutBg.test.js`):

Position math (pure unit, export `computeOverlayXY`):
- `top-left` → `[0, 0]`
- `bottom-right` 1280×720 với overlay 480×270 → `[800, 450]`
- `center` 480×270 → `[400, 225]`
- `bottom-right` + offset `(-20, -20)` → `[780, 430]`

Validation:
- `inputImages` rỗng / không tồn tại → throw match `/ảnh n.n/i`
- `inputVideos` không tồn tại → throw match `/video/i`
- `output` rỗng → throw match `/output/i`
- `inputImages` không có ảnh → throw match `/không có file/i`
- `inputVideos` không có video → throw match `/không có file/i`
- `anchor: "diagonal"` → throw match `/Anchor/i`
- `overlayWidth: 0` → throw match `/overlayWidth/i`
- `overlayHeight: -1` → throw match `/overlayHeight/i`

Abort:
- `AbortController().abort()` trước run → throw `/Aborted/`.

Happy path (1 cặp image+video → 1 output):
- Tạo tmpDir, copy `tests/fixtures/tiny.png` + `tests/fixtures/tiny-with-audio.mp4`, run với `anchor: "center"`, `overlayWidth: 320`, `overlayHeight: 180`.
- Expect output file tồn tại, `r.ok === true`, `r.outputs.length === 1`.

Skip already-processed:
- Pre-tạo `output/<videoBase>.mp4` trong output folder, run task.
- Expect không gọi ffmpeg, return `{ ok: true, outputs: [], errors: [] }`.
- Hoặc verify `_processed.json` được tạo/healed.

History persistence:
- Sau khi run 1 file thành công, `_processed.json` chứa `videoBase`.

Round-robin pairing:
- 3 ảnh + 5 video → expect log/output: video[0]+img[0], v[1]+img[1], v[2]+img[2], v[3]+img[0], v[4]+img[1].
- (Có thể test gián tiếp qua mock hoặc dry-run mode; nếu phức tạp, skip — covered ngầm bởi happy path).

## 11. Performance budget

- 1 ffmpeg invocation/file. Với CPU ultrafast + libx264, video 60s 1280×720 ~10–20s render.
- GPU NVENC: video 60s ~3–8s render.
- Queue runs serially (1 task tại 1 thời điểm) → không cần concurrency trong module.
- Memory: ffmpeg stream-based, không alloc đáng kể trong Node.

## 12. Acceptance criteria

1. Sidebar có nav item "🧓 Video người già" sau "🎨 Đổi màu thumbnail"; điều hướng OK, không break task khác.
2. Form: 3 folder picker, 9 radio anchor (3×3 grid), 2 number (WxH), 2 number offset (trong advanced), checkbox GPU.
3. Submit với 2 ảnh + 3 video → output 3 file, đúng pairing: v[0]+img[0], v[1]+img[1], v[2]+img[0] (wrap).
4. Output là mp4 1280×720, audio từ overlay video, duration = duration video.
5. Position đúng: với anchor `bottom-right` + overlay 480×270 + offset (0,0) → overlay nằm ở góc dưới phải, không có vùng đen bên trong.
6. Ảnh nền 4:3 vẫn lấp đầy 1280×720 (cover, cắt bớt phần thừa).
7. Video không có audio → output silent, vẫn render OK.
8. Chạy lại task → skip video đã xử lý (verify qua `_processed.json` hoặc absence of re-render).
9. Abort giữa batch → file đang render bị huỷ, file đã xong vẫn giữ trong output + history.
10. Tất cả tests xanh (`npm test`).

## 13. Non-goals / Future work

- Output resolution dynamic (1080p, dọc 9:16, vuông).
- Multiple overlays cùng lúc.
- Drag-drop position trên preview canvas.
- Fade in/out cho overlay.
- Loop video nếu video quá ngắn so với duration kỳ vọng.
- Audio mix (audio từ video + nhạc nền từ file thứ 3).
- Watermark trên output.
