# VidMaster — Elderly Render (Render video người già) — Design

**Date**: 2026-05-24
**Status**: Approved, ready for implementation
**Owner**: cuongnguyen.ftdev

## 1. Mục tiêu

Thêm task thứ 11 vào VidMaster: render video cuối cùng cho nội dung "người già" trên YouTube. Lấy folder input hỗn hợp (`.mp3` audio narration + `.mp4` video text) ghép lên video nền (output của task [`elderlyVideo`](2026-05-24-elderly-video-design.md)) → output `.mp4`.

Port từ pattern `RenderOlderAsync` + `RenderMusicVideosAsync` của project [D:\Programming\projects\ytb](D:/Programming/projects/ytb).

## 2. Phạm vi

**In scope:**
- Task mới `elderlyRender` xuất hiện trong sidebar nhóm Tasks.
- 1 folder input `(A)` chứa **lẫn lộn** `.mp3` + `.mp4`.
- 1 folder background `.mp4` (thường là output của task `elderlyVideo`).
- Pairing round-robin: `input[i] + background[i % numBackgrounds]`.
- 2 ffmpeg pipeline khác nhau theo extension:
  - `.mp4` → Older mode: `scale=1280:720 → crop → lutyuv threshold (text trắng) → format yuva420p → overlay`
  - `.mp3` → Music mode: `stream_loop background + mp3 audio → -c:v copy → -t mp3_duration`
- Position format: text field cho `cropValue` + `overlayValue` (ffmpeg expression, copy-paste từ ytb config).
- Audio output luôn lấy từ input file (mp3 hoặc mp4); background audio bị bỏ.
- Output 1280×720, tên file = `<inputBase>.mp4`.
- History `_rendered.json` + heal-from-disk (pattern giống task `render`).
- Inherit GPU/encoder settings từ `settings.json`.

**Out of scope:**
- Multiple input folder.
- Multiple background folder (channel concept của ytb).
- Mix audio bg + input audio.
- Chế độ Transparent (chroma key) — chỉ Older mode lần này.
- Subtitle burn-in.
- Concurrent render trong 1 task (queue serial là đủ).
- Tracking per-batch như ytb (`RenderTrackingService`, `BatchId`...).
- Telegram notification riêng (tận dụng pattern hiện có nếu cần sau).

## 3. Approach đã chọn

**Approach A — single module, 2 ffmpeg pipeline theo extension**

`src/elderlyRender.js` phân loại từng file input:
- `.mp4` → gọi `processMp4Pair()` build Older-mode args + spawn ffmpeg.
- `.mp3` → gọi `processMp3Pair()` build Music-mode args + spawn ffmpeg.

Lý do:
- 2 pipeline khác hẳn nhau (filter graph vs copy). Tách function rõ ràng.
- Reuse cùng `TaskRunner`, `runner.spawnFfmpeg` progress parsing, history.
- Mỗi file 1 ffmpeg invocation độc lập — cancel + lỗi per-file giống các task khác.

**Alternatives đã loại:**
- *Unify thành 1 filter graph chung* → mp3 không có video stream, ffmpeg syntax khác hẳn. Cố gộp sẽ phức tạp, không tăng giá trị.
- *Pre-convert mp3 → mp4 (silent video) rồi dùng Older mode* → tốn round-trip, mất ưu điểm `-c:v copy` của mp3.

## 4. Architecture & file layout

**Files mới:**

| Path | Vai trò |
|---|---|
| [src/elderlyRender.js](src/elderlyRender.js) | Task module: phân loại input, 2 pipeline, history. |
| [electron/renderer/screens/elderlyRender.js](electron/renderer/screens/elderlyRender.js) | Screen UI: 3 folder picker + 2 text field expression + GPU advanced. |
| [tests/elderlyRender.test.js](tests/elderlyRender.test.js) | Validation + abort + happy paths (mp3, mp4, mixed) + skip-rendered. |

**Files thay đổi:**

| Path | Thay đổi |
|---|---|
| [electron/renderer/components/sidebar.js](electron/renderer/components/sidebar.js) | Thêm nav item `elderlyRender` sau `elderlyVideo`. |
| [electron/renderer/main.js](electron/renderer/main.js) | Route + `TASK_LABELS`. |
| [electron/ipc/queue.js](electron/ipc/queue.js) | Map `elderlyRender: runElderlyRender`. |
| [electron/workspace.js](electron/workspace.js) | Thêm `elderly/originals`, `elderly/rendered` vào `REQUIRED_SUBFOLDERS`. |
| [tests/fixtures/generate.js](tests/fixtures/generate.js) | Thêm fixture `tiny.mp3` (1s sine 440Hz) cho test. |

## 5. Module — `src/elderlyRender.js`

**Signature:**

```js
export async function runElderlyRender(config) // -> { ok, outputs, errors }
```

**`config` shape:**

```js
{
  inputFolder:      string,    // folder chứa .mp3 + .mp4
  backgroundFolder: string,    // folder chứa .mp4
  output:           string,    // folder output
  cropValue:        string,    // ffmpeg crop expression, vd "in_w:205:0:480"
  overlayValue:     string,    // ffmpeg overlay expression, vd "(main_w-overlay_w)/2:550"
  ffmpeg:           { useGPU: boolean, encoder: string },
  signal:           AbortSignal,
}
```

**Steps:**

1. Tạo `TaskRunner(config)`. `runner.checkAborted()`.
2. Validate:
   - `inputFolder` tồn tại → throw `"Folder input không tồn tại."`
   - `backgroundFolder` tồn tại → throw `"Folder video nền không tồn tại."`
   - `output` non-empty → throw `"Thiếu folder output."`
3. List input:
   - `inputs = fs.readdirSync(inputFolder).filter(/\.(mp3|mp4)$/i).sort(naturalSort)`.
   - Empty → throw `"Folder input không có file .mp3/.mp4."`
4. List backgrounds: `.mp4` files; empty → throw `"Folder video nền không có file .mp4."`
5. Kiểm tra nếu **có file .mp4** trong inputs và `cropValue` hoặc `overlayValue` rỗng → throw `"Cần cropValue + overlayValue cho file .mp4."`
6. `fs.mkdirSync(output, { recursive: true })`.
7. Read `_rendered.json` + heal-from-disk (bất kỳ `<base>.mp4` đã có trong output).
8. Filter `todoInputs`; nếu rỗng → return `{ ok: true, outputs: [], errors: [] }` + log.
9. Loop `todoInputs`:
   - `runner.checkAborted()`.
   - `originalIdx = inputs.indexOf(name)`.
   - `bgPath = backgrounds[originalIdx % backgrounds.length]`.
   - Ext = `.mp3` → `processMp3Pair(...)` / `.mp4` → `processMp4Pair(...)`.
   - On success: push `outputs[]`, `history.add(base)`, `writeHistory()`.
   - Catch (trừ AbortError) → push `errors[]`, log error, tiếp tục.
   - `runner.setProgress(((i+1)/total) * 100, ...)`.
10. Return.

**`processMp4Pair`** (Older mode, port từ `RenderOlderAsync`):

```
-y -stream_loop -1 -i <bg.mp4> -i <input.mp4>
-filter_complex "[1:v]scale=1280:720,crop={cropValue},
                 lutyuv=y='if(gt(val,180),255,0)':u=128:v=128,
                 format=yuva420p,colorchannelmixer=aa=1.0[overlay];
                 [0:v][overlay]overlay={overlayValue}:shortest=1[outv]"
-map "[outv]" -map 1:a?
-c:v <libx264|h264_nvenc> -crf 23 -preset ultrafast (CPU) | -preset fast -cq:v 23 -rc:v vbr (GPU)
-pix_fmt yuv420p -r 30 -g 60 -keyint_min 60 -sc_threshold 0
-c:a aac -ar 44100 -ac 2
-shortest -movflags +faststart <output.mp4>
```

`totalDurationSec` cho progress: probe duration của input video.

**`processMp3Pair`** (Music mode, port từ `RenderMusicVideosAsync`):

```
-y -i <input.mp3> -stream_loop -1 -i <bg.mp4>
-t <mp3_duration>
-map "1:v" -map "0:a"
-c:v copy
-c:a aac -ar 44100 -ac 2 -b:a 192k
-movflags +faststart <output.mp4>
```

mp3 duration lấy qua ffprobe. `-c:v copy` để nhanh (không re-encode background).

## 6. Position math

Không có math — `cropValue` + `overlayValue` truyền nguyên xi vào ffmpeg filter expression. User responsibility để nhập đúng cú pháp.

Validation client-side: chỉ check non-empty khi có `.mp4` input. Cú pháp sai → ffmpeg throw, catch per-file.

**Default values** (giống ytb config):
- `cropValue = "in_w:205:0:480"` — full width, height 205px, lấy từ y=480 trở xuống.
- `overlayValue = "(main_w-overlay_w)/2:550"` — căn giữa ngang, y=550.

## 7. Screen UI — `electron/renderer/screens/elderlyRender.js`

**Function:** `export async function renderElderlyRender(el)`.

**Layout** (manual render, không dùng `taskFormShell` vì có 2 text expression field đặc thù):

```
🎬 Render video người già
Ghép .mp3 (audio) hoặc .mp4 (overlay text) lên video nền. Output 1280×720.

📁 Folder input (.mp3 + .mp4)     [input] [📂] [↗]
📁 Folder video nền (.mp4)        [input] [📂] [↗]
   (mặc định = output task "Video nền người già")
📁 Folder output                  [input] [📂] [↗]

🎞️ Cấu hình overlay (chỉ áp dụng cho .mp4)
   Crop expression:    [in_w:205:0:480              ]
   Overlay position:   [(main_w-overlay_w)/2:550   ]
   <help>Format ffmpeg. cropValue: w:h:x:y. overlayValue: x:y.</help>

🔧 Tuỳ chọn nâng cao
   ☐ Dùng GPU (encoder: <auto-resolved>)

[▶ Thực hiện]
```

**Form fields & defaults:**

| Field | Default |
|---|---|
| inputFolder | `lastConfig.elderlyRender.inputFolder` ?? `${ws}\elderly\originals` |
| backgroundFolder | `lastConfig.elderlyRender.backgroundFolder` ?? `${ws}\elderly\output` |
| output | `lastConfig.elderlyRender.output` ?? `${ws}\elderly\rendered` |
| cropValue | `lastConfig.elderlyRender.cropValue` ?? `in_w:205:0:480` |
| overlayValue | `lastConfig.elderlyRender.overlayValue` ?? `(main_w-overlay_w)/2:550` |
| useGPU | `settings.render.useGPU` |

**Submit flow:**

```js
const config = {
  inputFolder, backgroundFolder, output,
  cropValue, overlayValue,
  ffmpeg: { useGPU, encoder: settings.ffmpeg.encoder },
};
await window.api.queue.add({ type: "elderlyRender", config });
await window.api.settings.set({
  "lastConfig.elderlyRender": {
    inputFolder, backgroundFolder, output, cropValue, overlayValue,
  },
});
toast({ kind: "success", message: "✅ Đã thêm vào hàng đợi" });
```

## 8. History file — `_rendered.json`

Pattern y hệt task `render`:

```json
{ "version": 1, "rendered": ["base1", "base2", "..."] }
```

Heal từ disk: mọi `<base>.mp4` trong output được add vào set. Skip input nếu `inputBase` ∈ set.

Helpers private trong `elderlyRender.js`: `readRenderedHistory`, `writeRenderedHistory`, `healRenderedFromDisk`.

## 9. Workspace folders mới

Thêm vào [REQUIRED_SUBFOLDERS](electron/workspace.js):

```js
"elderly/originals",   // input A (mp3 + mp4)
"elderly/rendered",    // output cuối cùng
```

Workflow đầy đủ:
1. User bỏ ảnh nền vào `elderly/images`, video overlay vào `elderly/videos`.
2. Chạy task `elderlyVideo` → output `elderly/output/*.mp4` (video nền 1280×720).
3. User bỏ narration/text vào `elderly/originals/` (`.mp3` + `.mp4`).
4. Chạy task `elderlyRender` (default background = `elderly/output`) → output `elderly/rendered/*.mp4`.

## 10. Error handling

| Trường hợp | Hành vi |
|---|---|
| inputFolder/backgroundFolder không tồn tại | Throw rõ message |
| output rỗng | Throw `"Thiếu folder output."` |
| inputFolder không có .mp3/.mp4 | Throw `"Folder input không có file .mp3/.mp4."` |
| backgroundFolder không có .mp4 | Throw `"Folder video nền không có file .mp4."` |
| Có .mp4 input mà cropValue/overlayValue rỗng | Throw `"Cần cropValue + overlayValue cho file .mp4."` |
| FFprobe fail (file corrupt) | Catch per-file → push errors[], tiếp tục |
| FFmpeg fail 1 file | Catch (trừ AbortError) → push errors[], tiếp tục |
| `cropValue`/`overlayValue` sai cú pháp | FFmpeg throw → catch per-file (không validate trước vì cú pháp ffmpeg phức tạp) |
| Abort | Throw AbortError, dừng batch; file đã render giữ nguyên + đã add vào history |

## 11. Tests

**`tests/elderlyRender.test.js`** (pattern giống `elderlyVideo.test.js`):

Validation:
- inputFolder không tồn tại → throw `/input/i`
- backgroundFolder không tồn tại → throw `/video n.n/i`
- output rỗng → throw `/output/i`
- inputFolder không có mp3/mp4 → throw `/không có file/i`
- backgroundFolder không có mp4 → throw `/không có file/i`
- có .mp4 input + cropValue rỗng → throw `/cropValue|overlayValue/i`

Abort:
- `AbortController().abort()` trước run → throw `/Aborted/`.

Happy path:
- 1 mp4 + 1 background → 1 output (dùng `tiny-with-audio.mp4` cho input, `tiny.mp4` cho bg).
- 1 mp3 + 1 background → 1 output (cần fixture `tiny.mp3`).
- Mixed: 1 mp3 + 1 mp4 + 2 backgrounds → 2 outputs.

Skip already-rendered:
- Pre-tạo `<base>.mp4` trong output + `_rendered.json` → expect 0 outputs.

Heal from disk:
- Pre-tạo `<base>.mp4` trong output (no `_rendered.json`) → expect 0 outputs (heal pick it up).

History persistence:
- Sau render thành công, `_rendered.json` chứa base.

## 12. Test fixture mới — `tiny.mp3`

Bổ sung vào [tests/fixtures/generate.js](tests/fixtures/generate.js):

```js
// 7. tiny.mp3 — 1s sine 440Hz mono
const mp3 = path.join(__dirname, "tiny.mp3");
if (fs.existsSync(mp3)) fs.unlinkSync(mp3);
const r7 = spawnSync(ffmpegPath, [
  "-y",
  "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
  "-c:a", "libmp3lame", "-b:a", "64k",
  mp3,
]);
if (r7.status !== 0) { console.error(r7.stderr.toString()); process.exit(1); }
console.log("✓ tiny.mp3");
```

Chạy `node tests/fixtures/generate.js` để tạo fixture trước khi run test.

## 13. Performance budget

- 1 ffmpeg invocation/file. Queue serial.
- `.mp3` (Music mode): rất nhanh vì `-c:v copy` không decode/encode video — chỉ remux audio. ~1–3s/file.
- `.mp4` (Older mode): re-encode toàn bộ. CPU ultrafast 1280×720 60s → ~10–20s. GPU NVENC → ~3–8s.

## 14. Acceptance criteria

1. Sidebar có nav item "🎬 Render video người già" sau "Video nền người già"; navigate OK.
2. Form: 3 folder picker, 2 text expression field (crop, overlay), GPU advanced.
3. Submit 1 .mp3 + 1 background → 1 output 1280×720, duration = mp3 duration, audio = mp3.
4. Submit 1 .mp4 + 1 background → 1 output 1280×720, duration = mp4 duration, audio = mp4.
5. Mixed batch (2 .mp4 + 3 .mp3 + 2 backgrounds) → 5 outputs, pairing round-robin theo `input[i] % 2`.
6. Re-run với cùng input → skip (verify qua `_rendered.json` hoặc 0 outputs).
7. Abort giữa batch → các file đã render giữ trong output + history.
8. `cropValue`/`overlayValue` sai cú pháp → task không crash, file đó vào errors[].
9. Tất cả tests xanh (`npm test`).

## 15. Non-goals / Future work

- Transparent/chroma-key mode (chỉ Older lần này).
- Multiple background folder (channel concept).
- Audio mix bg + input.
- Subtitle/text burn-in từ file `.srt`.
- Telegram render-done notification cho task này (có thể thêm sau nếu cần).
- Per-input cropValue/overlayValue (1 set cho cả batch lần này).
