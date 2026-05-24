# VidMaster — Manual Update Check trong Settings → About — Design

**Date**: 2026-05-18
**Status**: Approved, ready for implementation plan
**Owner**: cuongnguyen.ftdev

## 1. Mục tiêu

Cho phép user kiểm tra cập nhật **bằng tay** từ Settings → About sau khi đã vào main app. Hiện tại, splash khi khởi động là cách duy nhất để check update; sau khi user "Tiếp tục dùng app" thì không có cách nào re-check trong session.

Reuse cơ chế `electron-updater` đã có. Khi tìm thấy bản mới: auto-download + install + restart (giống splash flow).

## 2. Phạm vi

**In scope:**
- Section "📦 Phiên bản" trong tab About: số version + nút "🔄 Kiểm tra cập nhật" + dòng status.
- Status text phản ánh state machine: idle → checking → (not-available | available → downloading → downloaded) | error.
- Fix bug: `updater:proceed` IPC hiện gọi `updater.dispose()` → updater chết sau khi user rời splash → manual check sau đó không work. Bỏ `dispose()` để updater stay alive.
- Subscribe-during-check lifecycle: subscribe khi click nút, unsubscribe khi terminal event.

**Out of scope:**
- "Confirm trước khi download" dialog (đã loại trong brainstorm; auto-download giữ nhất quán với splash).
- Manual download link (vd: link tới GitHub Releases nếu auto-update fail).
- Background periodic check (vd: check 1 lần/ngày).
- Display dev-mode hint khác với production (dev cũng nhận `not-available`, hiển thị "✓ Bạn đang dùng bản mới nhất." — chấp nhận được).
- Disable nút trong dev mode (không cần — events vẫn fire bình thường).
- Cancel download mid-progress.

## 3. Architecture & file layout

**Files thay đổi (chỉ 2):**

| Path | Thay đổi |
|---|---|
| `electron/ipc/updater.js` | Xoá 1 dòng `if (updater) updater.dispose();` trong handler `updater:proceed`. |
| `electron/renderer/screens/settings.js` | Rewrite `renderAboutTab` thêm section update + handler + helpers (`ERROR_MESSAGES`, `formatSpeed` copy từ `updateCheck.js`). |

**Files không cần thay đổi:**
- `electron/updater.js` (createUpdater wrapper) — giữ nguyên, `dispose()` method vẫn tồn tại nhưng không còn caller. YAGNI: không xoá.
- `electron/preload.mjs` — `window.api.updater.check` / `onEvent` / `proceed` đã đầy đủ.
- `electron/renderer/screens/updateCheck.js` — splash UI giữ nguyên.

## 4. Fix `updater:proceed` không dispose

**Vấn đề:**

```js
// electron/ipc/updater.js — current
ipcMain.handle("updater:proceed", () => {
  if (proceedFired) return false;
  proceedFired = true;
  if (updater) updater.dispose();    // ← gây bug
  try { onProceed(); } catch (err) { log.error(`onProceed failed: ${err.message}`); }
  return true;
});
```

Sau `dispose()`:
- `disposed = true` trong updater instance.
- `autoUpdater.removeAllListeners()` đã gọi → mọi event mất.

Khi user vào Settings → check → IPC re-uses `updater` cũ (`if (!updater)` evaluate false) → `updater.check()` → early return vì `disposed === true` → không gì xảy ra → UI bị treo "Đang kiểm tra..." mãi.

**Fix:** Xoá dòng `if (updater) updater.dispose();`. Sau fix:

```js
ipcMain.handle("updater:proceed", () => {
  if (proceedFired) return false;
  proceedFired = true;
  try { onProceed(); } catch (err) { log.error(`onProceed failed: ${err.message}`); }
  return true;
});
```

**Side effects:**
- Listeners của `autoUpdater` vẫn attached. Khi check lần 2: listeners fire → `safeSend(...)` đẩy event tới renderer → preload bridge forward tới `subscribers["updater:event"]` Set → Settings tab (đã subscribe) nhận event.
- Splash đã `unsubscribe()` trong `doProceed()` của `updateCheck.js` → events tới renderer không tới handler của splash → không có double-handling.
- `proceedFired` flag vẫn dùng để chặn `onProceed` chạy 2 lần (giữ guarantee).
- `timeoutHandle` không bị dọn khi proceed. Trong flow hiện tại: splash chỉ render nút "Tiếp tục" khi có terminal event (error) → `clearPendingTimeout` đã chạy trong các listener trước đó. Hoặc khi check chưa kết thúc và user bấm "Tiếp tục" giữa chừng — currently splash chỉ hiển thị "Tiếp tục" sau `error`, không trong `checking`/`available`/`download-progress`. Nên `timeoutHandle` đã null. Safe.
- `dispose()` method còn lại trong `createUpdater` nhưng không caller. Không xoá (giảm rủi ro, có thể dùng cho test/future).

## 5. Settings → About UI

**Layout** (sau fix, vẫn dùng tab "about" trong Settings screen):

```
📦 Phiên bản
Phiên bản hiện tại: <strong>0.1.6</strong>
[🔄 Kiểm tra cập nhật]   <status text>

⚙️ Quản lý dữ liệu
[Reset settings về mặc định (giữ workspace + định danh)]
[🗑 Xoá toàn bộ dữ liệu — làm lại từ đầu]
"Xoá toàn bộ" sẽ xoá settings + workspace + định danh + lastConfig. App sẽ reload và yêu cầu onboarding lại. Files trong folder workspace KHÔNG bị xoá.
```

**`renderAboutTab(el, s, version, rerender)` implementation:**

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

  // Existing reset handlers preserved
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

  // Update check section
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
          // Don't unsubscribe — app is restarting immediately via autoUpdater.quitAndInstall().
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

// Module-scope helpers near other helpers in settings.js
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

**Status state machine:**

| Event | Status text | Color | Button |
|---|---|---|---|
| (idle / chưa click) | "" (trống) | — | enabled |
| `checking` | "Đang kiểm tra..." | grey | disabled |
| `not-available` | "✓ Bạn đang dùng bản mới nhất." | green | enabled |
| `available` | "Có v\<X\> — đang tải..." | blue | disabled |
| `download-progress` | "Đang tải \<%\> (\<speed\>)" | blue | disabled |
| `downloaded` | "✓ Đã tải xong v\<X\> — app sẽ khởi động lại..." | green | disabled |
| `error` | "❌ \<friendly message\>" | red | enabled (cho phép retry) |

**Subscribe-during-check lifecycle:**

- Subscribe khi click button → save reference vào `unsubscribe`.
- Unsubscribe khi terminal event (`not-available` hoặc `error`).
- Không unsubscribe khi `downloaded` — app sẽ restart ngay qua `autoUpdater.quitAndInstall()`.
- Re-click button khi đang ở terminal state: `if (unsubscribe) { unsubscribe(); unsubscribe = null; }` chạy đầu handler để dọn subscription cũ (case: subscription chưa kịp tự dọn vì event chưa tới — edge case rare nhưng defensive).
- User navigate đi giữa check: subscription còn sống, các DOM element (`$btn`, `$status`) bị thay thế bởi innerHTML mới của tab khác. Khi event đến, `setStatus`/`$btn.disabled` chạy trên DOM cũ (orphaned, không lỗi). Khi terminal event đến, subscription tự dọn. Acceptable — không leak vĩnh viễn.

## 6. Helpers duplicated

`UPDATE_ERROR_MESSAGES` và `formatSpeed` đã có trong [electron/renderer/screens/updateCheck.js](electron/renderer/screens/updateCheck.js). Spec này quyết định **copy** sang `settings.js` thay vì extract thành module mới.

**Lý do:**
- Chỉ 2 caller hiện tại (`updateCheck.js` splash + `settings.js` about tab).
- Module mới (`electron/renderer/_lib/updateMessages.js` hoặc tương tự) tạo thêm 1 file cho ~15 dòng helper — over-engineering.
- Nếu có caller thứ 3, refactor sau (YAGNI).

Nếu sau này thấy drift giữa 2 bản (vd thêm error code mới chỉ ở 1 nơi), trade-off đó được tính sau.

## 7. Error handling

Tất cả error tới qua event `updater:event` với `type: "error"`. Friendly message lookup theo `code` qua `UPDATE_ERROR_MESSAGES`. Fallback: `event.message || event.code || "Có lỗi khi kiểm tra cập nhật"`.

Nút enabled lại sau error để cho retry. Subscription bị tear-down → nếu user click lại, subscription mới được tạo.

## 8. Tests

**Không thêm test mới.**

- `electron/ipc/updater.js` không có unit test hiện tại (IPC layer không được test đơn vị trong project này — pattern consistent với `electron/ipc/queue.js`, `electron/ipc/fs.js`).
- `electron/updater.js` (createUpdater wrapper) đã có `tests/electron/updater.test.js` — không thay đổi nên test vẫn pass.
- Renderer screens không có unit test trong project.

**Smoke test thủ công** (E2E):
1. `npm test` — 197 pass, 2 pre-existing failures (`buttonFeedback.test.js`) không đổi.
2. `npm run build:dir` — build installer-mode thành công.
3. Mở `dist/win-unpacked/VidMaster.exe`:
   - Khi vào, splash chạy. Bấm "Tiếp tục dùng app" (nếu hiển thị).
   - Settings → About: thấy nút "🔄 Kiểm tra cập nhật" + status trống.
   - Click nút → status "Đang kiểm tra..." → terminal (most likely "✓ Bạn đang dùng bản mới nhất." nếu chưa publish version mới).
   - Click lại → status update lại (không bị treo).

## 9. Acceptance criteria

1. Settings → About hiển thị section "📦 Phiên bản" với version + nút "🔄 Kiểm tra cập nhật" + dòng status.
2. Click nút → status đổi sang "Đang kiểm tra...". Nút disabled.
3. Khi không có update mới: status "✓ Bạn đang dùng bản mới nhất.", nút enabled lại.
4. Khi có update: status hiện "Có v\<X\> — đang tải..." → progress → "Đã tải xong... khởi động lại..." → app restart.
5. Khi lỗi: status hiện thông báo lỗi thân thiện (red), nút enabled cho phép retry.
6. Splash check ở startup vẫn hoạt động bình thường.
7. Sau "Tiếp tục dùng app" → vào Settings → manual check vẫn hoạt động.
8. `npm test` baseline (197 pass, 2 pre-existing fail).
9. `npm run build:dir` thành công, manual check chạy được trong installer mode.

## 10. Non-goals / Future work

- Confirm dialog trước khi auto-download.
- Manual download link tới GitHub Releases.
- Background periodic check.
- Cancel download.
- Show dev-mode hint riêng biệt.
- Show release notes / changelog của bản mới.
