const ERROR_MESSAGES = {
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

export function mountUpdateCheck(root, { onProceed }) {
  root.innerHTML = `
    <div class="update-check">
      <div class="update-check__logo">VidMaster</div>
      <div class="update-check__status" data-status>Đang kiểm tra cập nhật...</div>
      <div class="update-check__spinner" data-spinner></div>
      <div class="update-check__progress" data-progress-wrap hidden>
        <div class="update-check__bar" data-bar></div>
      </div>
      <div class="update-check__sub" data-sub></div>
      <div class="update-check__actions" data-actions hidden>
        <button class="update-check__btn update-check__btn--primary" data-retry>Thử lại</button>
        <button class="update-check__btn" data-continue>Tiếp tục dùng app</button>
      </div>
    </div>
  `;

  const $status = root.querySelector("[data-status]");
  const $sub = root.querySelector("[data-sub]");
  const $spinner = root.querySelector("[data-spinner]");
  const $progressWrap = root.querySelector("[data-progress-wrap]");
  const $bar = root.querySelector("[data-bar]");
  const $actions = root.querySelector("[data-actions]");
  const $retry = root.querySelector("[data-retry]");
  const $continue = root.querySelector("[data-continue]");

  let unsubscribe = null;
  let proceeded = false;

  function showError(code, message) {
    $status.textContent = ERROR_MESSAGES[code] || ERROR_MESSAGES.unknown;
    $sub.textContent = message ? `(${code}) ${message}` : `(${code})`;
    $spinner.hidden = true;
    $progressWrap.hidden = true;
    $actions.hidden = false;
  }

  function showChecking() {
    $status.textContent = "Đang kiểm tra cập nhật...";
    $sub.textContent = "";
    $spinner.hidden = false;
    $progressWrap.hidden = true;
    $actions.hidden = true;
  }

  function showAvailable(currentVersion, nextVersion) {
    $status.textContent = `Đã có bản v${nextVersion}. Đang tải...`;
    $sub.textContent = `Hiện tại: v${currentVersion}`;
    $spinner.hidden = true;
    $progressWrap.hidden = false;
    $actions.hidden = true;
    $bar.style.width = "0%";
  }

  function showProgress(percent, bps) {
    const p = Math.max(0, Math.min(100, percent || 0));
    $bar.style.width = `${p}%`;
    $sub.textContent = `${p.toFixed(0)}%  ${formatSpeed(bps)}`;
  }

  function showDownloaded(nextVersion) {
    $status.textContent = `Đang cài đặt v${nextVersion}...`;
    $sub.textContent = "App sẽ khởi động lại sau khi cài xong.";
    $spinner.hidden = false;
    $progressWrap.hidden = true;
    $actions.hidden = true;
  }

  async function doProceed() {
    if (proceeded) return;
    proceeded = true;
    if (unsubscribe) unsubscribe();
    await window.api.updater.proceed();
    onProceed();
  }

  $retry.addEventListener("click", () => {
    showChecking();
    window.api.updater.check();
  });

  $continue.addEventListener("click", () => { doProceed(); });

  unsubscribe = window.api.updater.onEvent((event) => {
    switch (event.type) {
      case "checking": showChecking(); break;
      case "not-available": doProceed(); break;
      case "available": showAvailable(event.currentVersion, event.nextVersion); break;
      case "download-progress": showProgress(event.percent, event.bytesPerSecond); break;
      case "downloaded": showDownloaded(event.nextVersion); break;
      case "error": showError(event.code, event.message); break;
    }
  });

  window.api.updater.check();
}
