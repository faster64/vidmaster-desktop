# Add-to-Queue Button Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Note on commits:** The user has a standing instruction to not auto-commit (per `.claude/skills/vidmaster/SKILL.md`). Each task ends with a "Commit" step — the implementer should pause and ask for explicit approval before running the commit, or leave changes unstaged.

**Goal:** Khi click nút **▶  Thực hiện**, hiển thị spinner xoay 1 giây rồi `✅ OK` 1 giây trước khi nút trở lại trạng thái ban đầu — đồng thời disable trong suốt 2s để chặn double-submit.

**Architecture:** Một helper renderer `runWithFeedback(button, asyncFn, opts)` đảm nhiệm state machine của nút. Hai chỗ submit (`taskForm.js` cho 6 màn task, `getUrls.js` cho màn Lấy link kênh) gọi cùng helper. Helper là logic thuần thao tác property — testable bằng vitest mà không cần jsdom.

**Tech Stack:** Vanilla JS modules, ESM, vitest (đã có sẵn), CSS thuần.

**Spec:** `docs/superpowers/specs/2026-05-07-add-to-queue-button-feedback-design.md`

---

## File Structure

| File | Loại | Trách nhiệm |
|---|---|---|
| `electron/renderer/components/buttonFeedback.js` | **Mới** | Helper `runWithFeedback`: quản lý vòng đời spinner → OK → restore |
| `tests/electron/buttonFeedback.test.js` | **Mới** | Unit tests cho `runWithFeedback` |
| `electron/renderer/styles.css` | Sửa | Thêm `.btn-spinner` + keyframes + `button:disabled` |
| `electron/renderer/components/taskForm.js` | Sửa | Submit handler dùng `runWithFeedback`, bỏ toast success |
| `electron/renderer/screens/getUrls.js` | Sửa | Submit handler dùng `runWithFeedback`, bỏ toast success |

Boundaries: helper module chỉ phụ thuộc DOM property API (`innerHTML`, `disabled`) — không phụ thuộc bất kỳ module renderer nào khác. Các file consumer chỉ import named export `runWithFeedback`.

---

## Task 1: buttonFeedback helper (TDD)

**Files:**
- Create: `electron/renderer/components/buttonFeedback.js`
- Create: `tests/electron/buttonFeedback.test.js`

- [ ] **Step 1.1: Write the failing tests**

Tạo `tests/electron/buttonFeedback.test.js`:

```js
import { describe, it, expect, vi } from "vitest";
import { runWithFeedback } from "../../electron/renderer/components/buttonFeedback.js";

function makeButton(initial = { innerHTML: "▶  Thực hiện", disabled: false }) {
  return { ...initial };
}

describe("runWithFeedback", () => {
  it("returns the result of asyncFn", async () => {
    const btn = makeButton();
    const result = await runWithFeedback(btn, async () => "queued", { spinnerMs: 5, okMs: 5 });
    expect(result).toBe("queued");
  });

  it("restores original innerHTML and disabled after completion", async () => {
    const btn = makeButton({ innerHTML: "▶  Thực hiện", disabled: false });
    await runWithFeedback(btn, async () => {}, { spinnerMs: 5, okMs: 5 });
    expect(btn.innerHTML).toBe("▶  Thực hiện");
    expect(btn.disabled).toBe(false);
  });

  it("shows spinner and disables button while asyncFn runs", async () => {
    const btn = makeButton();
    let resolveFn;
    const asyncFn = () => new Promise((r) => { resolveFn = r; });
    const promise = runWithFeedback(btn, asyncFn, { spinnerMs: 0, okMs: 0 });
    await Promise.resolve();
    await Promise.resolve();
    expect(btn.disabled).toBe(true);
    expect(btn.innerHTML).toContain("btn-spinner");
    resolveFn();
    await promise;
  });

  it("shows OK text between spinner and restore", async () => {
    const btn = makeButton();
    const seen = [];
    const originalHtml = btn.innerHTML;
    const proxy = new Proxy(btn, {
      set(target, prop, value) {
        if (prop === "innerHTML") seen.push(value);
        target[prop] = value;
        return true;
      },
    });
    await runWithFeedback(proxy, async () => {}, { spinnerMs: 5, okMs: 5, okHtml: "✅ OK" });
    expect(seen).toEqual([
      expect.stringContaining("btn-spinner"),
      "✅ OK",
      originalHtml,
    ]);
  });

  it("respects spinnerMs as a minimum (waits even if asyncFn finishes instantly)", async () => {
    const btn = makeButton();
    const start = Date.now();
    await runWithFeedback(btn, async () => {}, { spinnerMs: 60, okMs: 10 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(60);
  });

  it("restores button state when asyncFn throws and propagates the error", async () => {
    const btn = makeButton({ innerHTML: "▶ X", disabled: false });
    const boom = new Error("nope");
    await expect(
      runWithFeedback(btn, async () => { throw boom; }, { spinnerMs: 5, okMs: 5 })
    ).rejects.toBe(boom);
    expect(btn.innerHTML).toBe("▶ X");
    expect(btn.disabled).toBe(false);
  });

  it("preserves the originalDisabled value if button was already disabled", async () => {
    const btn = makeButton({ innerHTML: "▶", disabled: true });
    await runWithFeedback(btn, async () => {}, { spinnerMs: 5, okMs: 5 });
    expect(btn.disabled).toBe(true);
  });

  it("uses default spinnerHtml and okHtml when not overridden", async () => {
    const btn = makeButton();
    const seen = [];
    const proxy = new Proxy(btn, {
      set(target, prop, value) {
        if (prop === "innerHTML") seen.push(value);
        target[prop] = value;
        return true;
      },
    });
    await runWithFeedback(proxy, async () => {}, { spinnerMs: 5, okMs: 5 });
    expect(seen[0]).toContain('class="btn-spinner"');
    expect(seen[1]).toBe("✅ OK");
  });
});
```

- [ ] **Step 1.2: Run tests and verify they fail**

Run: `npm test -- buttonFeedback`
Expected: FAIL — module `electron/renderer/components/buttonFeedback.js` not found.

- [ ] **Step 1.3: Implement the helper**

Tạo `electron/renderer/components/buttonFeedback.js`:

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

- [ ] **Step 1.4: Run tests and verify they pass**

Run: `npm test -- buttonFeedback`
Expected: PASS — all 8 tests green.

- [ ] **Step 1.5: Run full suite to confirm no regressions**

Run: `npm test`
Expected: ALL PASS (existing tests + 8 new ones).

- [ ] **Step 1.6: Commit (request approval first)**

Per standing instruction, ask user before committing. If approved:

```bash
git add electron/renderer/components/buttonFeedback.js tests/electron/buttonFeedback.test.js
git commit -m "feat(renderer): add runWithFeedback helper for button visual feedback"
```

---

## Task 2: CSS spinner & disabled state

**Files:**
- Modify: `electron/renderer/styles.css` (append at end of file)

- [ ] **Step 2.1: Append spinner styles**

Mở `electron/renderer/styles.css`. Thêm vào cuối file:

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

- [ ] **Step 2.2: Confirm tests still green**

Run: `npm test`
Expected: ALL PASS (CSS không ảnh hưởng test).

- [ ] **Step 2.3: Commit (request approval first)**

```bash
git add electron/renderer/styles.css
git commit -m "feat(renderer): add CSS spinner and disabled button styles"
```

---

## Task 3: Wire into taskForm submit handler

**Files:**
- Modify: `electron/renderer/components/taskForm.js:1-2` (add import)
- Modify: `electron/renderer/components/taskForm.js:128-130` (replace queue.add + toast block)

- [ ] **Step 3.1: Add import**

Tại đầu file `electron/renderer/components/taskForm.js`, sau dòng 2 (`import { toast } from "./toast.js";`), thêm:

```js
import { runWithFeedback } from "./buttonFeedback.js";
```

- [ ] **Step 3.2: Replace queue.add + toast block**

Trong `bindTaskForm`, đoạn cuối submit handler hiện là:

```js
    await window.api.queue.add({ type: taskType, config });
    await window.api.settings.set({ [`lastConfig.${taskType}`]: config });
    toast({ kind: "success", message: "✅ Đã thêm vào hàng đợi" });
```

Thay bằng:

```js
    const submitBtn = formEl.querySelector('button[type="submit"]');
    await runWithFeedback(submitBtn, async () => {
      await window.api.queue.add({ type: taskType, config });
      await window.api.settings.set({ [`lastConfig.${taskType}`]: config });
    });
```

(Toast `success` bị bỏ. Toast `error` cho nhánh validate fail vẫn ở lại không đổi.)

- [ ] **Step 3.3: Run tests**

Run: `npm test`
Expected: ALL PASS — không test nào touch trực tiếp `taskForm.js` submit logic, nhưng chạy cho chắc.

- [ ] **Step 3.4: Commit (request approval first)**

```bash
git add electron/renderer/components/taskForm.js
git commit -m "feat(renderer): wire taskForm submit through runWithFeedback"
```

---

## Task 4: Wire into getUrls submit handler

**Files:**
- Modify: `electron/renderer/screens/getUrls.js:1` (add import)
- Modify: `electron/renderer/screens/getUrls.js:38-40` (replace queue.add + toast block)

- [ ] **Step 4.1: Add import**

Tại đầu file `electron/renderer/screens/getUrls.js`, sau dòng 1 (`import { toast } from "../components/toast.js";`), thêm:

```js
import { runWithFeedback } from "../components/buttonFeedback.js";
```

- [ ] **Step 4.2: Replace queue.add + toast block**

Trong submit handler, đoạn hiện là:

```js
    await window.api.queue.add({ type: "getUrls", config });
    await window.api.settings.set({ "lastConfig.getUrls": { handle } });
    toast({ kind: "success", message: "✅ Đã thêm vào hàng đợi" });
```

Thay bằng:

```js
    const submitBtn = el.querySelector('button[type="submit"]');
    await runWithFeedback(submitBtn, async () => {
      await window.api.queue.add({ type: "getUrls", config });
      await window.api.settings.set({ "lastConfig.getUrls": { handle } });
    });
```

(Import `toast` giữ lại — file vẫn dùng cho lỗi tương lai.)

- [ ] **Step 4.3: Run tests**

Run: `npm test`
Expected: ALL PASS.

- [ ] **Step 4.4: Commit (request approval first)**

```bash
git add electron/renderer/screens/getUrls.js
git commit -m "feat(renderer): wire getUrls submit through runWithFeedback"
```

---

## Task 5: Manual smoke test

Phần này cần app chạy thật trong Electron. Thực hiện theo từng bước:

- [ ] **Step 5.1: Khởi động app**

Run: `npm run dev`
Expected: cửa sổ Electron mở, sidebar có 7 màn task.

- [ ] **Step 5.2: Test golden path mỗi màn (7 lần)**

Cho mỗi màn trong: Render, Snow, Trim, CutBg, Download, Concat, GetUrls:
1. Điền các field bắt buộc (folder hợp lệ / handle YouTube hợp lệ).
2. Bấm **▶  Thực hiện**.
3. Quan sát:
   - Trong 1s đầu: nút có vòng xoay trắng, bị disabled (không click được).
   - Trong 1s tiếp: nút đổi thành `✅ OK`, vẫn disabled.
   - Sau đó: nút trở lại `▶  Thực hiện`, enable lại.
4. Form vẫn giữ nguyên giá trị đã điền.
5. Queue dock dưới đáy app có thêm 1 job mới đúng type.

Expected: cả 7 màn đều hoạt động giống nhau. Không có toast `success` nào nữa.

- [ ] **Step 5.3: Test chống double-submit**

Tại 1 màn bất kỳ, điền hợp lệ, bấm submit, rồi bấm liên tiếp 5 lần trong 2s.
Expected: chỉ có **1** job mới trong Queue dock.

- [ ] **Step 5.4: Test validate fail**

Tại màn Render, để trống `outputDir`, bấm submit.
Expected:
- Không thấy spinner.
- Toast `⚠️ Thiếu dữ liệu: ...` hiện ở góc phải.
- Không có job mới trong Queue dock.

- [ ] **Step 5.5: Test navigation race**

Tại 1 màn, điền hợp lệ, bấm submit, ngay lập tức click sang màn khác trong sidebar (trong vòng 1-2s).
Expected: không có lỗi trong DevTools console (mở Ctrl+Shift+I để xem).

- [ ] **Step 5.6: Báo cáo kết quả**

Nếu tất cả 5.2-5.5 đạt: implementation complete.
Nếu fail bất kỳ bước nào: ghi rõ bước nào, hành vi quan sát được, console errors → debug và quay lại task tương ứng.

---

## Self-Review Checklist (đã chạy)

**Spec coverage:**
- ✅ Helper `runWithFeedback` với API trong spec → Task 1
- ✅ CSS spinner + disabled → Task 2
- ✅ Tích hợp taskForm (6 màn) → Task 3
- ✅ Tích hợp getUrls → Task 4
- ✅ Bỏ toast success, giữ toast error → Task 3 + Task 4 (đã ghi rõ)
- ✅ Edge cases (validate fail, throw, navigation, double-click) → Task 1 (test) + Task 5 (manual)

**Placeholder scan:** không có TBD/TODO/"add error handling" — mọi step đều có code hoặc command cụ thể.

**Type consistency:** signature `runWithFeedback(button, asyncFn, opts)` nhất quán trong test, impl, và 2 chỗ gọi. Tham số `spinnerMs/okMs/okHtml/spinnerHtml` khớp giữa test và impl.
