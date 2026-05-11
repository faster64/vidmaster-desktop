# Add-to-Queue Button Feedback — Design

**Date:** 2026-05-07
**Status:** Approved (pending implementation)
**Scope:** Renderer-only UI polish; no IPC / main process / native module changes.

## Problem

Khi người dùng bấm nút **▶  Thực hiện** ở các màn task, phản hồi duy nhất hiện tại là một toast trượt vào góc phải. Hai vấn đề:

1. Toast nằm xa con trỏ chuột — người dùng không nhận ngay được click đã ăn.
2. Không có khoảng "khoá" giữa các click liên tiếp, có thể double-submit.

## Goal

Khi click submit hợp lệ, nút phải:
1. Đổi sang spinner xoay trong **1 giây** (đồng thời disable để chặn double-click).
2. Đổi sang `✅ OK` trong **1 giây**.
3. Quay về `▶  Thực hiện`, enable lại; form giữ nguyên giá trị.

Toast `success` bị bỏ. Toast `error` (validate fail) giữ nguyên — phản hồi lỗi vẫn cần.

## Non-Goals

- Không thay đổi luồng queue / IPC / settings.
- Không refactor `taskFormShell` hay `getUrls.js` ngoài đoạn submit handler.
- Không tạo unit test mới (UI components hiện không có unit test; manual test đủ).

## Architecture

### File mới

**`electron/renderer/components/buttonFeedback.js`** — một export:

```js
export async function runWithFeedback(button, asyncFn, opts = {}) {
  const {
    spinnerMs = 1000,
    okMs = 1000,
    okHtml = "✅ OK",
    spinnerHtml = '<span class="btn-spinner"></span>',
  } = opts;

  const originalHtml = button.innerHTML;
  const originalDisabled = button.disabled;
  button.disabled = true;
  button.innerHTML = spinnerHtml;

  try {
    const [result] = await Promise.all([
      asyncFn(),
      new Promise((r) => setTimeout(r, spinnerMs)),
    ]);
    button.innerHTML = okHtml;
    await new Promise((r) => setTimeout(r, okMs));
    return result;
  } finally {
    button.innerHTML = originalHtml;
    button.disabled = originalDisabled;
  }
}
```

**Quyết định thiết kế:**
- `spinnerMs` là **tối thiểu** — `Promise.all` đảm bảo đợi đủ 1s ngay cả khi `asyncFn` xong sớm (queue.add gần như instant).
- `originalHtml` capture từ chính nút — không hardcode `▶  Thực hiện`. Helper dùng được cho bất kỳ nút submit nào sau này (tương lai có thể tái dùng cho nút Reset, nút export, v.v.).
- `try/finally` đảm bảo restore khi `asyncFn` throw — lỗi vẫn propagate ra ngoài, gọi-bên-ngoài quyết định hiển thị.
- API tham số mặc định cho phép override `okHtml` / `spinnerHtml` / timing nếu sau này cần.

### CSS bổ sung

Thêm vào cuối `electron/renderer/styles.css`:

```css
.btn-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: btn-spin 0.7s linear infinite;
  vertical-align: -2px;
}
@keyframes btn-spin { to { transform: rotate(360deg); } }

button:disabled { opacity: 0.7; cursor: not-allowed; }
```

**Quyết định:**
- Spinner màu trắng — phù hợp với nền xanh + chữ trắng của `button.primary` (cả 7 nút submit hiện tại).
- 14×14px khớp font-size, tránh nút "nhảy" chiều cao khi đổi nội dung.
- Style `button:disabled` global — cũng có lợi cho các nút khác (queue dock, modal, taskForm reset).

### Tích hợp

#### `electron/renderer/components/taskForm.js`

- Thêm import: `import { runWithFeedback } from "./buttonFeedback.js";`
- Trong `bindTaskForm`, đoạn cuối submit handler thay từ:
  ```js
  await window.api.queue.add({ type: taskType, config });
  await window.api.settings.set({ [`lastConfig.${taskType}`]: config });
  toast({ kind: "success", message: "✅ Đã thêm vào hàng đợi" });
  ```
  thành:
  ```js
  const submitBtn = formEl.querySelector('button[type="submit"]');
  await runWithFeedback(submitBtn, async () => {
    await window.api.queue.add({ type: taskType, config });
    await window.api.settings.set({ [`lastConfig.${taskType}`]: config });
  });
  ```
- `formEl.querySelector('button[type="submit"]')` lấy đúng nút submit (không nhầm với `#task-reset` vì nút reset có `type="button"`).

Áp dụng cho 6 màn dùng `taskFormShell`: Render, Snow, Trim, CutBg, Download, Concat.

#### `electron/renderer/screens/getUrls.js`

- Thêm import: `import { runWithFeedback } from "../components/buttonFeedback.js";`
- Đoạn cuối submit handler thay từ:
  ```js
  await window.api.queue.add({ type: "getUrls", config });
  await window.api.settings.set({ "lastConfig.getUrls": { handle } });
  toast({ kind: "success", message: "✅ Đã thêm vào hàng đợi" });
  ```
  thành:
  ```js
  const submitBtn = el.querySelector('button[type="submit"]');
  await runWithFeedback(submitBtn, async () => {
    await window.api.queue.add({ type: "getUrls", config });
    await window.api.settings.set({ "lastConfig.getUrls": { handle } });
  });
  ```
- `toast` import vẫn giữ — phòng cho lỗi sau này.

## Data Flow

```
[User click submit]
       │
       ▼
[reportValidity / validateConfig]
       │
       ├── fail ──► toast(error) ──► return (không spinner)
       │
       └── pass
            │
            ▼
[runWithFeedback]
   ├─ disable button, innerHTML = spinner
   ├─ Promise.all([asyncFn(), sleep(1000ms)])
   │    └─ asyncFn: queue.add + settings.set
   ├─ innerHTML = "✅ OK"
   ├─ sleep(1000ms)
   └─ finally: restore innerHTML + disabled
```

## Edge Cases

| Tình huống | Hành vi |
|---|---|
| Validate fail (`reportValidity` hoặc errors > 0) | Không vào helper, toast error giữ nguyên, nút không đổi |
| `queue.add` throw | `finally` restore nút; lỗi propagate (giữ parity với code hiện tại) |
| User chuyển màn trong 2s | Nút bị detach; gán `innerHTML` trên node rời không lỗi |
| User bấm liên tục | `disabled = true` từ tick đầu — không double-submit |
| Form còn `<details class="advanced">` đóng và có field invalid bên trong | Code hiện đã mở `details` trước `reportValidity` — không đổi |

## Files Affected

| File | Loại |
|---|---|
| `electron/renderer/components/buttonFeedback.js` | Mới (~25 dòng) |
| `electron/renderer/components/taskForm.js` | Sửa (+ import, đoạn 6 dòng) |
| `electron/renderer/screens/getUrls.js` | Sửa (+ import, đoạn 6 dòng) |
| `electron/renderer/styles.css` | Sửa (+ ~12 dòng cuối file) |

## Test Plan (manual)

1. **Golden path mỗi màn:** mở 7 màn task, điền hợp lệ, bấm submit → thấy spinner 1s → `✅ OK` 1s → nút trở lại text gốc, form giữ nguyên giá trị.
2. **Anti double-submit:** trong 2s đó, bấm lại nút → không tạo job thứ hai (kiểm tra Queue dock).
3. **Validate fail:** Render với `outputDir` trống → không spinner, toast `⚠️ Thiếu dữ liệu` hiện ra.
4. **Navigation race:** bấm submit xong chuyển màn ngay → không lỗi console.
5. **Queue chính xác:** mỗi click hợp lệ → đúng 1 job mới trong dock.

## Out of Scope (cho lần sau)

- Spinner cho nút màu khác (non-primary): hiện không cần.
- Animation chuyển trạng thái mượt hơn (fade/slide): YAGNI cho version đầu.
- i18n cho text `OK`: app đang chỉ tiếng Việt.
