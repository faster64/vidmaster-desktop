# VidMaster Manual Update Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm nút "🔄 Kiểm tra cập nhật" + dòng status vào Settings → About, để user có thể check update bằng tay sau khi đã vào main app. Reuse cơ chế `electron-updater` đã có; sửa bug `updater.dispose()` trong `updater:proceed` để updater stay alive cho lần check thứ 2.

**Architecture:** Hai thay đổi tách biệt: (1) xoá 1 dòng `updater.dispose()` trong handler IPC `updater:proceed` để giữ updater sống qua splash → main app, (2) rewrite `renderAboutTab` trong `settings.js` thêm section update + handler subscribe-during-check.

**Tech Stack:** Electron 30, electron-updater 6, vanilla JS renderer, Vitest 1.6.

**Reference spec:** [docs/specs/2026-05-18-vidmaster-manual-update-check-design.md](../specs/2026-05-18-vidmaster-manual-update-check-design.md)

**Commit policy (user preference):** Do NOT auto-commit. Each task ends with `git diff` review only — leave changes unstaged.

---

## File Structure

**Modify (2 files):**
- `electron/ipc/updater.js` — Xoá 1 dòng `updater.dispose()` trong handler `updater:proceed`.
- `electron/renderer/screens/settings.js` — Rewrite `renderAboutTab` thêm update section + handler; thêm module-scope helpers `UPDATE_ERROR_MESSAGES` + `formatSpeed`.

**No new files. No test changes.**

---

## Task 1: Fix `updater:proceed` không dispose updater

**Files:**
- Modify: `electron/ipc/updater.js`

- [ ] **Step 1: Apply the fix**

Open `electron/ipc/updater.js` and find this handler (around line 23-29):

```js
  ipcMain.handle("updater:proceed", () => {
    if (proceedFired) return false;
    proceedFired = true;
    if (updater) updater.dispose();
    try { onProceed(); } catch (err) { log.error(`onProceed failed: ${err.message}`); }
    return true;
  });
```

Remove ONLY the line `if (updater) updater.dispose();`. The handler should become:

```js
  ipcMain.handle("updater:proceed", () => {
    if (proceedFired) return false;
    proceedFired = true;
    try { onProceed(); } catch (err) { log.error(`onProceed failed: ${err.message}`); }
    return true;
  });
```

Keep `proceedFired` guard (still needed to prevent double-firing `onProceed`).

- [ ] **Step 2: Run the existing updater test suite**

Run: `npx vitest run tests/electron/updater.test.js`

Expected: All tests pass. The existing tests cover `createUpdater` (the wrapper) — not the IPC layer — so they're unaffected by this fix.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`

Expected: 197 pass, 2 pre-existing failures in `tests/electron/buttonFeedback.test.js` (unrelated baseline). No new failures.

- [ ] **Step 4: Stop — review diff, do NOT commit**

Run: `git diff electron/ipc/updater.js`

Verify the only change is removal of that single line. Leave unstaged.

---

## Task 2: Rewrite `renderAboutTab` with update check section

**Files:**
- Modify: `electron/renderer/screens/settings.js`

- [ ] **Step 1: Replace the body of `renderAboutTab`**

Open `electron/renderer/screens/settings.js` and locate `renderAboutTab` (around lines 323-347). Replace the entire function body with:

```js
function renderAboutTab(el, s, version, rerender) {
  el.innerHTML = `
    <h3>📦 Phiên bản</h3>
    <p>Phiên bản hiện tại: <strong>${escapeAttr(version)}</strong></p>
    <div class="field-row" style="margin:8px 0;align-items:center">
      <button id="check-update">🔄 Kiểm tra cập nhật</button>
      <span id="update-status" style="margin-left:12px;color:#aaa"></span>
    </div>

    <h3 style="margin-top:24px">⚙️ Quản lý dữ liệu</h3>
    <button id="reset" class="danger">Reset settings về mặc định (giữ workspace + định danh)</button>
    <button id="reset-all" class="danger" style="margin-left:8px">🗑 Xoá toàn bộ dữ liệu — làm lại từ đầu</button>
    <div class="help" style="margin-top:6px">"Xoá toàn bộ" sẽ xoá settings + workspace + định danh + lastConfig. App sẽ reload và yêu cầu onboarding lại. Files trong folder workspace KHÔNG bị xoá.</div>
  `;

  el.querySelector("#reset").addEventListener("click", async () => {
    if (!confirm("Reset toàn bộ cài đặt về mặc định? (Workspace path sẽ giữ nguyên)")) return;
    await window.api.settings.softReset();
    rerender();
  });
  el.querySelector("#reset-all").addEventListener("click", async () => {
    const confirmed = confirm(
      "Bạn chắc chắn muốn XOÁ TOÀN BỘ DỮ LIỆU?\n\n" +
      "- Settings, workspace path, định danh, lastConfig sẽ bị xoá.\n" +
      "- App sẽ reload và yêu cầu onboarding lại.\n" +
      "- Files trong folder workspace KHÔNG bị xoá.\n\n" +
      "Hành động này không thể hoàn tác."
    );
    if (!confirmed) return;
    await window.api.settings.resetAll();
    location.reload();
  });

  const $btn = el.querySelector("#check-update");
  const $status = el.querySelector("#update-status");
  let unsubscribe = null;

  function setStatus(text, color = "#aaa") {
    $status.textContent = text;
    $status.style.color = color;
  }

  $btn.addEventListener("click", () => {
    $btn.disabled = true;
    setStatus("Đang kiểm tra...", "#aaa");
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    unsubscribe = window.api.updater.onEvent((event) => {
      switch (event.type) {
        case "checking":
          setStatus("Đang kiểm tra...", "#aaa");
          break;
        case "not-available":
          setStatus("✓ Bạn đang dùng bản mới nhất.", "#4caf50");
          $btn.disabled = false;
          if (unsubscribe) { unsubscribe(); unsubscribe = null; }
          break;
        case "available":
          setStatus(`Có v${event.nextVersion} — đang tải...`, "#2196f3");
          break;
        case "download-progress":
          setStatus(`Đang tải ${(event.percent || 0).toFixed(0)}% (${formatSpeed(event.bytesPerSecond)})`, "#2196f3");
          break;
        case "downloaded":
          setStatus(`✓ Đã tải xong v${event.nextVersion} — app sẽ khởi động lại...`, "#4caf50");
          // Don't unsubscribe — app is restarting via autoUpdater.quitAndInstall().
          break;
        case "error":
          setStatus(`❌ ${UPDATE_ERROR_MESSAGES[event.code] || event.message || event.code}`, "#f44336");
          $btn.disabled = false;
          if (unsubscribe) { unsubscribe(); unsubscribe = null; }
          break;
      }
    });
    window.api.updater.check();
  });
}
```

- [ ] **Step 2: Add module-scope helpers**

In the same file `electron/renderer/screens/settings.js`, add these two helpers near the existing `escapeAttr` helper (around line 349). Place them right BEFORE `function escapeAttr(s)`:

```js
const UPDATE_ERROR_MESSAGES = {
  timeout: "Không kiểm tra được cập nhật (quá thời gian)",
  network: "Không kết nối được tới máy chủ cập nhật (network)",
  "rate-limit": "GitHub giới hạn truy cập, vui lòng thử lại sau (rate-limit)",
  signature: "Bản cập nhật không hợp lệ (signature)",
  unknown: "Có lỗi khi kiểm tra cập nhật",
};

function formatSpeed(bps) {
  if (!bps) return "";
  const mbps = bps / (1024 * 1024);
  if (mbps >= 1) return `${mbps.toFixed(1)} MB/s`;
  const kbps = bps / 1024;
  return `${kbps.toFixed(0)} KB/s`;
}
```

(These are identical to the helpers in `electron/renderer/screens/updateCheck.js`. Spec explicitly accepts the duplication for now — 2 callers only.)

- [ ] **Step 3: Run the full test suite**

Run: `npm test`

Expected: 197 pass, 2 pre-existing failures (`buttonFeedback.test.js`). No new failures. (Renderer screens are not unit-tested in this project — this is a no-test change verified by build + manual.)

- [ ] **Step 4: Stop — review diff, do NOT commit**

Run: `git diff electron/renderer/screens/settings.js`

Verify changes are limited to:
- `renderAboutTab` function body rewritten.
- Two new module-scope helpers (`UPDATE_ERROR_MESSAGES`, `formatSpeed`) added right before `escapeAttr`.

Leave unstaged.

---

## Task 3: End-to-end verification

**Files:** none — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: 197 pass, 2 pre-existing failures.

- [ ] **Step 2: Build the app in unpacked mode**

Run: `npm run build:dir`

Expected: builds without errors; produces `dist/win-unpacked/VidMaster.exe`. (Note: `build:dir` does NOT trigger the `prebuild` hook, so version is not bumped.)

- [ ] **Step 3: Launch and verify all 9 acceptance criteria from the spec**

Run: `dist/win-unpacked/VidMaster.exe`

Walk through each criterion from [docs/specs/2026-05-18-vidmaster-manual-update-check-design.md](../specs/2026-05-18-vidmaster-manual-update-check-design.md) section 9. Check each one:

  1. [ ] Settings → About hiển thị section "📦 Phiên bản" với version + nút "🔄 Kiểm tra cập nhật" + dòng status.
  2. [ ] Click nút → status đổi sang "Đang kiểm tra...". Nút disabled.
  3. [ ] Khi không có update mới: status "✓ Bạn đang dùng bản mới nhất." (green), nút enabled lại.
  4. [ ] Khi có update (cần publish bản mới hơn version hiện tại lên GitHub Releases để test): status hiện "Có v\<X\> — đang tải..." → progress → "Đã tải xong... khởi động lại..." → app restart.
  5. [ ] Khi lỗi (ngắt mạng để mô phỏng): status hiện thông báo lỗi thân thiện (red), nút enabled lại.
  6. [ ] Splash check ở startup vẫn hoạt động bình thường (không bị regression bởi Task 1).
  7. [ ] Sau "Tiếp tục dùng app" từ splash (nếu có) → vào Settings → manual check vẫn hoạt động (không bị treo "Đang kiểm tra...").
  8. [ ] `npm test` baseline đạt (197 pass, 2 pre-existing fail). Đã làm ở Step 1.
  9. [ ] `npm run build:dir` thành công, manual check chạy được trong installer mode. Đã làm ở Step 2.

Note: Criterion 4 chỉ test được nếu có sẵn version mới hơn trên GitHub Releases. Nếu không có, chỉ verify criteria 1, 2, 3, 5, 6, 7, 8, 9 — criterion 4 chấp nhận là "tin tưởng logic đúng theo splash precedent" (splash flow đã chứng minh hoạt động lúc release v0.1.6 đầu tiên).

- [ ] **Step 4: Stop — review diff, do NOT commit**

Run: `git status`

Verify only `electron/ipc/updater.js` and `electron/renderer/screens/settings.js` are modified (plus the new spec/plan files under `docs/`). Leave all changes unstaged for the user to review.

---

## Notes for the implementer

- **Vietnamese UI + technical keywords inline** (per user memory): error messages and labels in Vietnamese, but keep `code`, `bytesPerSecond`, etc. inline for debuggability.
- **No auto-commit** (per user memory): every task ends with `git diff` review only.
- **No worktrees** (per user memory): work directly on the current checkout. The current branch is `feat/recolor-thumb` from the previous feature; ask the user if they want to either (a) continue on this branch and bundle both features, or (b) checkout a new branch `feat/manual-update-check` for isolation. Default to (b) if the user doesn't specify.
- The `.claude/worktrees/` directories in the repo are stale from earlier work — do not modify them.
- This is a small change (~50 lines net). The TDD ceremony is light because there is no algorithm to test — the value is in correctness of state transitions which renderer code surfaces.
