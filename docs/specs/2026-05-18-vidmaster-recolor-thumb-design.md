# VidMaster — Recolor Thumbnail (Đổi màu thumbnail) — Design

**Date**: 2026-05-18
**Status**: Approved, ready for implementation plan
**Owner**: cuongnguyen.ftdev

## 1. Mục tiêu

Thêm task thứ 9 vào VidMaster: thay vùng có một màu chủ đạo trong thumbnail bằng một **gradient** (start → end, theo trục dọc/ngang), batch trên cả folder. Cho phép user pick màu gốc bằng eyedropper trên ảnh mẫu và xem preview live trước khi chạy batch.

Use case chính: thumbnail có nền/áo/badge một màu tương đối phẳng, user muốn tạo nhiều biến thể bằng cách thay vùng đó thành gradient hồng (hoặc bất kỳ gradient nào khác). Thuật toán port từ một đoạn C# reference (`ReplaceBackgroundWithGradient`) đã được dùng quen.

## 2. Phạm vi

**In scope:**
- Một task mới `recolorThumb` xuất hiện trong sidebar nhóm Tasks.
- Pure module thuật toán dùng được ở cả renderer (preview) và main (batch).
- Eyedropper trên canvas ảnh mẫu + hex input cho cả 3 màu (source, gradient start, gradient end).
- Live preview với debounce 200ms khi đổi tham số.
- Batch xử lý folder → folder, giữ extension gốc (.jpg/.png), JPEG quality 90.
- Persist last config (paths) + last params (màu/tolerance) qua electron-store.
- Unit test thuật toán + validation test cho task.

**Out of scope (có thể mở rộng sau):**
- Multi-source colors (nhiều màu nguồn cùng lúc).
- Edge feathering / anti-aliasing tại biên tolerance.
- Preset gradient (lưu nhiều gradient yêu thích).
- Per-pixel mask hoặc selection vùng (free-form).
- Hỗ trợ định dạng ngoài .jpg/.png (vd .webp).

## 3. Approach đã chọn

**Approach A — shared algorithm, preview renderer + batch main**

Một module thuần ESM `src/_lib/recolorImage.js` chỉ thao tác trên buffer RGBA (Uint8Array/Uint8ClampedArray). Không import DOM, không import Node-specific.

- **Renderer** (preview): load ảnh mẫu vào `<canvas>` → `getImageData()` → gọi `recolorPixels()` → `putImageData()`. Đổi tham số → debounce → re-process từ buffer gốc.
- **Main process** (batch): `sharp(input).rotate().ensureAlpha().raw().toBuffer()` → gọi `recolorPixels()` → `sharp(buf, {raw}).toFormat(ext).toFile(out)`.

Lý do: một thuật toán duy nhất tránh drift; preview nhanh không cần IPC round-trip; batch theo pattern task hiện có (heavy work ở main + queue manage abort/concurrency).

Alternatives đã loại:
- Tất cả ở main + preview qua IPC → preview lag 300–800ms.
- Tất cả ở renderer → batch lớn block UI, lệch khỏi pattern hiện có.

## 4. Architecture & file layout

**Files mới:**

| Path | Vai trò |
|---|---|
| `src/recolorThumb.js` | Task module (chạy ở main qua queue), batch folder → folder. |
| `src/_lib/recolorImage.js` | Pure module: `recolorPixels`, `hexToRgb`, `rgbToHex`. |
| `electron/renderer/screens/recolorThumb.js` | Screen UI: form + canvas preview + eyedropper + live update. |
| `tests/recolorImage.test.js` | Unit test thuật toán + helpers. |
| `tests/recolorThumb.test.js` | Validation + abort test. |

**Files thay đổi:**

| Path | Thay đổi |
|---|---|
| `electron/renderer/components/sidebar.js` | Thêm nav item `recolorThumb` (icon 🎨, label "Đổi màu thumbnail") ngay sau `thumbAvatar`. |
| `electron/renderer/main.js` | Route `recolorThumb` → `renderRecolorThumb`. |
| `electron/main.js` (hoặc nơi đăng ký queue handlers) | Map task type `recolorThumb` → `runRecolorThumb`. |
| `electron/ipc/fs.js` | Thêm handlers `fs:listImages`, `fs:readImageDataUrl` (xem mục 4.1). |
| `electron/preload.mjs` | Expose `window.api.fs.listImages` và `window.api.fs.readImageDataUrl`. |
| `scripts/generate-defaults.mjs` | Bổ sung defaults cho `recolor.last`. |

### 4.1. IPC mới

Renderer cần đọc ảnh mẫu để vẽ lên canvas. Vì CSP hiện tại là `default-src 'self'`, không thể `<img src="file://...">` trực tiếp. Nhưng [index.html](electron/renderer/index.html) đã cho phép `img-src 'self' data:` → dùng data URL là cách sạch nhất.

**`fs:listImages(folder)` → `Array<string>`** (chỉ tên file, không full path):
- Filter `/\.(jpe?g|png)$/i`, sort theo tên natural (numeric, base-insensitive — pattern giống `listMp4`).
- Trả `[]` nếu folder không tồn tại / rỗng.

**`fs:readImageDataUrl(fullPath)` → `string | null`**:
- Đọc file, encode base64 → `data:image/<jpeg|png>;base64,<...>`.
- Trả `null` nếu file không tồn tại hoặc extension không hợp lệ.
- Map MIME: `.jpg/.jpeg` → `image/jpeg`, `.png` → `image/png`.

Preload exposure:
```js
fs: {
  // ...existing
  listImages: (folder) => ipcRenderer.invoke("fs:listImages", folder),
  readImageDataUrl: (p) => ipcRenderer.invoke("fs:readImageDataUrl", p),
}
```

## 5. Shared algorithm module — `src/_lib/recolorImage.js`

**API:**

```js
export function recolorPixels(rgba, width, height, params) { /* mutates rgba */ }
export function hexToRgb(hex) { /* "#7A97C1" -> {r,g,b} */ }
export function rgbToHex({ r, g, b }) { /* -> "#7A97C1" uppercase */ }
```

**`params` shape:**

```js
{
  sourceColor:       { r, g, b },   // màu cần thay
  tolerance:         70,            // integer 0–255, Chebyshev channel-wise
  gradientStart:     { r, g, b },   // mặc định #FFC0CB
  gradientEnd:       { r, g, b },   // mặc định #FF69B4
  gradientDirection: "vertical",    // "vertical" | "horizontal"
}
```

**Thuật toán** (port nguyên xi từ C#, RGBA thay vì BGRA):

```
for y in 0..height-1:
  for x in 0..width-1:
    i = (y * width + x) * 4
    R = rgba[i], G = rgba[i+1], B = rgba[i+2]
    if (R >= sR-t && R <= sR+t)
       && (G >= sG-t && G <= sG+t)
       && (B >= sB-t && B <= sB+t):
        ratio = (direction == "horizontal") ? x / width : y / height
        rgba[i  ] = round(startR + (endR - startR) * ratio)
        rgba[i+1] = round(startG + (endG - startG) * ratio)
        rgba[i+2] = round(startB + (endB - startB) * ratio)
        // rgba[i+3] (alpha) giữ nguyên
```

**Implementation notes:**
- Tránh `Math.abs` trong hot loop, dùng so sánh range.
- Pre-compute `deltaR/G/B = end - start` ngoài loop.
- Single pass, O(w·h). 1280×720 mục tiêu ~25–40ms trên V8.
- Mutates buffer in-place; không alloc array mới.

**Helpers:**
- `hexToRgb(hex)`: nhận `"#RRGGBB"` (6 hex digits, có dấu `#`). Throw `Error("Hex sai format (cần #RRGGBB)")` nếu không match `/^#[0-9A-Fa-f]{6}$/`.
- `rgbToHex({r,g,b})`: trả về `"#RRGGBB"` uppercase. Không validate range — caller đảm bảo 0–255.

## 6. Task module — `src/recolorThumb.js`

**Signature:**

```js
export async function runRecolorThumb(config) // -> { ok, outputs, errors }
```

**`config` shape:**

```js
{
  inputDir:          string,   // folder chứa .jpg/.png
  output:            string,   // folder đầu ra
  sourceColor:       string,   // "#RRGGBB"
  tolerance:         number,   // 0–255 integer
  gradientStart:     string,   // "#RRGGBB"
  gradientEnd:       string,   // "#RRGGBB"
  gradientDirection: "vertical" | "horizontal",
  signal:            AbortSignal,   // bơm vào TaskRunner pattern
}
```

**Steps:**

1. Tạo `TaskRunner(config)` — pattern giống `thumbAvatar.js`.
2. Validate:
   - `inputDir` tồn tại; nếu không → throw `"Folder thumbnail không tồn tại."`
   - `output` non-empty → throw `"Thiếu folder output."`
   - 3 hex match regex → throw `"Màu sai format (cần #RRGGBB)."`
   - `tolerance` integer trong [0, 255] → throw `"Tolerance phải là số nguyên 0–255."`
   - `gradientDirection` ∈ {vertical, horizontal} → throw `"gradientDirection không hợp lệ: <value>"`
3. Liệt kê file: `fs.readdirSync(inputDir).filter(/\.(jpe?g|png)$/i).sort()`. Trống → throw `"Folder không có file ảnh (.jpg/.png)."`
4. `fs.mkdirSync(output, { recursive: true })`.
5. Convert 3 hex → rgb một lần (cache trong `params`).
6. Loop files:
   - `runner.checkAborted()`.
   - `sharp(in).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true })` → `{ data, info }`.
   - `recolorPixels(data, info.width, info.height, params)`.
   - Output extension giữ nguyên từ input. `.jpg/.jpeg` → `sharp.jpeg({ quality: 90 })`, `.png` → `sharp.png()`.
   - `.toFile(outPath)`.
   - Catch per-file (trừ AbortError) → push vào `errors[]`, `runner.log("error", ...)`, tiếp tục.
   - `runner.setProgress(((i+1)/total) * 100, "i+1/total filename")`.
7. Return `{ ok: errors.length === 0, outputs, errors }`.

**Filename**: output giữ tên gốc + extension gốc. Nếu input và output cùng path thì input bị overwrite — đây là behavior khớp các task khác (user tự chịu trách nhiệm).

## 7. Renderer screen — `electron/renderer/screens/recolorThumb.js`

**Function:** `export async function renderRecolorThumb(el)`.

**Layout** (2 cột; ≥1024px chia đôi, <1024px stack dọc):

```
🎨 Đổi màu thumbnail
Thay vùng có 1 màu chủ đạo bằng gradient. Click ảnh để pick màu gốc.

┌── form (trái) ────────────────────┬── preview (phải) ──────────────────┐
│ 📁 Folder thumbnail               │ <canvas preview ảnh mẫu>            │
│  [input ] [📂 pick] [↗ open]      │ (click khi 💧 active = eyedropper)  │
│ 📁 Folder output                  │ Đang xem: <name>  (WxH)             │
│  [input ] [📂] [↗]                │ ◉ Sau xử lý   ◯ Gốc                 │
│                                   │                                     │
│ 🖼️ Ảnh mẫu:                       │                                     │
│  [<select files> ▾]  [🔀 random]  │                                     │
│                                   │                                     │
│ 🎯 Màu gốc:                       │                                     │
│  [■#7A97C1] [hex] [💧 eyedropper] │                                     │
│  Tolerance: [slider 0–255] 70     │                                     │
│                                   │                                     │
│ 🎨 Gradient thay thế:             │                                     │
│  Start: [■#FFC0CB] [hex] [color]  │                                     │
│  End:   [■#FF69B4] [hex] [color]  │                                     │
│  Hướng: ◉ Dọc   ◯ Ngang           │                                     │
│                                   │                                     │
│ [▶ Thực hiện]  [↺ Reset]          │                                     │
└───────────────────────────────────┴─────────────────────────────────────┘
```

**Form fields:**

| Field | Control | Default |
|---|---|---|
| Folder thumbnail | text + pick + open buttons (pattern giống thumbAvatar) | `lastConfig.recolorThumb.inputDir` hoặc `${ws}\thumbs` |
| Folder output | text + pick + open | `lastConfig.recolorThumb.output` hoặc `${ws}\recolored` |
| Ảnh mẫu | `<select>` các file trong folder + nút random | file đầu tiên (sort theo tên) |
| Màu gốc | swatch + hex input + nút eyedropper | `recolor.last.sourceColor` hoặc `#7A97C1` |
| Tolerance | `<input type=range min=0 max=255 step=1>` + số bên cạnh | `recolor.last.tolerance` hoặc `70` |
| Gradient start | swatch + hex input + native `<input type=color>` (ẩn, mở khi click swatch) | `recolor.last.gradientStart` hoặc `#FFC0CB` |
| Gradient end | swatch + hex input + native color picker | `recolor.last.gradientEnd` hoặc `#FF69B4` |
| Hướng | radio `vertical`/`horizontal` | `recolor.last.gradientDirection` hoặc `vertical` |

**Sample image lifecycle:**
- Đổi folder thumbnail → gọi `window.api.fs.listImages(folder)` → fill `<select>`, chọn file đầu tiên (nếu có).
- File rỗng / folder không tồn tại → ẩn canvas, hiện thông báo "Chọn folder để xem preview".
- Load ảnh: `await window.api.fs.readImageDataUrl(fullPath)` → tạo `Image` element → `img.onload` → vẽ vào detached canvas ở resolution gốc (memory) cho eyedropper; đồng thời vẽ scaled lên canvas hiển thị (max 720×405, preserve aspect).

**Eyedropper:**
- Click nút 💧 → state `eyedropperActive = true`, cursor canvas chuyển thành crosshair.
- Click canvas → lấy `event.offsetX/Y`, convert về tọa độ ảnh gốc (chia tỷ lệ ngược) → đọc R/G/B từ detached canvas → set source color (swatch + hex input) → tắt eyedropper.
- Press Esc → tắt eyedropper.

**Live preview:**
- Mọi thay đổi (đổi sample, đổi source, đổi gradient start/end, đổi tolerance, đổi direction, toggle "Sau xử lý / Gốc") → trigger `schedulePreview()`.
- Debounce 200ms (`setTimeout` reset trên mỗi call) trước khi process.
- Process: copy buffer gốc → `recolorPixels()` → `putImageData()`. Khi toggle "Gốc" → bỏ qua processing.

**Submit:**

```js
const config = {
  inputDir, output,
  sourceColor, tolerance,
  gradientStart, gradientEnd, gradientDirection,
};
await window.api.queue.add({ type: "recolorThumb", config });
await window.api.settings.set({
  "lastConfig.recolorThumb": { inputDir, output },
  "recolor.last": { sourceColor, tolerance, gradientStart, gradientEnd, gradientDirection },
});
toast({ kind: "success", message: "✅ Đã thêm vào hàng đợi" });
```

**Reset:**
- Khôi phục `recolor.last` về defaults C# (`#7A97C1`, tol 70, `#FFC0CB` → `#FF69B4`, vertical).
- Giữ nguyên `inputDir` và `output`.

## 8. Settings schema

**Workspace settings (electron-store):**

```js
recolor: {
  last: {
    sourceColor:       "#7A97C1",
    tolerance:         70,
    gradientStart:     "#FFC0CB",
    gradientEnd:       "#FF69B4",
    gradientDirection: "vertical",
  }
}

lastConfig: {
  recolorThumb: { inputDir: "", output: "" }
}
```

**Lý do tách:**
- `lastConfig.recolorThumb` chỉ chứa path — đặc trưng workspace, đồng nhất với các task khác (cùng namespace `lastConfig.<task>`).
- `recolor.last` chứa tham số màu — preference cá nhân, gom vào `recolor.*` để dễ mở rộng (vd preset sau này).

**Migration**: không cần — keys mới hoàn toàn; fresh install hoặc upgrade đều fallback về hằng số mặc định nếu key chưa có.

**`scripts/generate-defaults.mjs`**: thêm các default trên vào defaults được generate khi build.

## 9. Error handling

| Trường hợp | Hành vi |
|---|---|
| `inputDir` không tồn tại | Throw `"Folder thumbnail không tồn tại."` — queue marks task error. |
| `output` rỗng | Throw `"Thiếu folder output."` |
| Folder không có .jpg/.png | Throw `"Folder không có file ảnh (.jpg/.png)."` |
| Hex sai format | Throw `"Màu sai format (cần #RRGGBB)."` |
| Tolerance ngoài [0,255] hoặc không integer | Throw `"Tolerance phải là số nguyên 0–255."` |
| `gradientDirection` không hợp lệ | Throw `"gradientDirection không hợp lệ: <value>"` |
| File hỏng giữa batch | Catch, push vào `errors[]`, `runner.log("error", ...)`, tiếp tục file kế tiếp. |
| Abort giữa batch | Throw `AbortError`, task dừng; các file đã ghi giữ nguyên trong output. |
| Output trùng input | Cho phép (overwrite) — pattern giống các task khác; user tự chịu trách nhiệm. |

Toàn bộ message giữ tiếng Việt + giữ technical keywords inline (vd `RRGGBB`, `gradientDirection`, `AbortError`) theo convention dự án.

## 10. Tests

**`tests/recolorImage.test.js`** — unit test pure module:
- `hexToRgb` / `rgbToHex` round-trip cho vài giá trị.
- `hexToRgb` reject `"#GGG"`, `"abc"`, `""`, `"#FFFFFFG"`.
- Build buffer 2×1 RGBA, pixel khớp exact source → kiểm tra byte cụ thể đổi đúng.
- Pixel ngoài tolerance → byte không đổi.
- Pixel ở biên `|dR|=tolerance` → đổi (inclusive, match C# `<=`).
- Vertical: pixel ở `y=0` → start color; ở `y=h-1` → ≈ end color (±1 do rounding).
- Horizontal: cùng buffer, đổi direction → pixel ở `x=0` → start, `x=w-1` → ≈ end.
- Alpha channel giữ nguyên (set alpha=128 trước, sau processing vẫn 128).
- `tolerance=0` chỉ đổi pixel khớp chính xác R=sR, G=sG, B=sB.

**`tests/recolorThumb.test.js`** — validation + abort (pattern giống `tests/concatHeadTail.test.js`):
- `inputDir` rỗng / không tồn tại → throw match `/không tồn tại/`.
- `output` rỗng → throw match `/output/`.
- `inputDir` không có file ảnh → throw match `/không có file ảnh/`.
- Hex sai format → throw match `/sai format/`.
- Tolerance < 0, > 255, hoặc `1.5` → throw match `/Tolerance/`.
- `gradientDirection: "diagonal"` → throw match `/gradientDirection/`.
- `AbortController.abort()` trước khi gọi → throw `AbortError` (`"Aborted"`).

Không test happy-path E2E qua sharp — match convention dự án (skip vì cần fixture binary).

## 11. Performance budget

- **Preview**: 1280×720 RGBA single-pass ≈ 25–40ms trên V8. Debounce 200ms đủ mượt.
- **Batch**: với folder ~50 ảnh, dominant cost là `sharp` decode/encode (~80–150ms/ảnh), thuật toán ~30ms/ảnh. Tổng ~5–10s cho 50 ảnh.
- **Không cần worker pool** — đơn nhiệm trong queue manager (1 task tại 1 thời điểm).

**Memory:** 1 ảnh RGBA full-res 1280×720 ≈ 3.5MB. Loop xử lý từng ảnh, không giữ buffer đồng thời. Không cần stream.

## 12. Acceptance criteria

1. Sidebar có nav item "🎨 Đổi màu thumbnail" sau "Gắn avatar"; điều hướng hoạt động, không break task khác.
2. Eyedropper: click canvas → swatch + hex input update sang đúng RGB của pixel tại tọa độ click (sau khi tính ngược scaling).
3. Preview update < 300ms sau khi đổi slider/màu/direction/sample.
4. Toggle "Sau xử lý / Gốc" lập tức (không debounce).
5. Batch xử lý folder ≥10 ảnh thực, output đúng format gốc, gradient direction đúng (đầu trên = start với vertical, trái = start với horizontal).
6. Defaults C# (`#7A97C1`, tol 70, pink gradient vertical) load đúng trên fresh install.
7. Abort giữa batch → task dừng, các file đã ghi giữ nguyên, queue chuyển state về `cancelled`.
8. Tất cả tests xanh (`npm test`).
9. `npm run build:dir` thành công, app khởi động được, task chạy được trong installer mode.

## 13. Non-goals / Future work

- Multi-source colors (gom nhiều màu nguồn thành 1 mask).
- Edge feathering / anti-aliasing tại biên tolerance để mượt hơn.
- Preset gradient (lưu nhiều combo yêu thích).
- Selection vùng tự do (vd brush mask).
- Hỗ trợ định dạng .webp, .bmp, .gif.
- Tự động tối ưu source color (vd k-means trên ảnh mẫu).
