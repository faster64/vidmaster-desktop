import { progressBar } from "../components/progressBar.js";
import { showErrorModal } from "../components/modal.js";

const MAX_LOG_LINES = 200;

export async function renderQueue(el) {
  let unsub;
  const render = async (state) => {
    if (el.dataset.screen !== "queue") { unsub?.(); return; }
    el.innerHTML = `
      <div class="screen-header">📋 Hàng đợi</div>
      <p class="screen-subtitle">Mỗi lúc chỉ 1 task chạy. Có thể huỷ task đang chạy hoặc đang chờ.</p>
      <h3>⏳ Đang chạy</h3>
      ${state.running ? `
        <div class="queue-item">
          <span class="label">${labelFor(state.running.type)} <span style="color:var(--muted)">${state.running.message ?? ""}</span></span>
          ${progressBar(state.running.progress)}
          <button data-cancel="${state.running.id}" class="danger">✕ Huỷ</button>
        </div>
        ${logPanelHtml(state.running.logs)}` : `<p style="color:var(--muted)">Không có task nào đang chạy.</p>`}
      <h3>⏸ Đang chờ (${state.pending.length})</h3>
      ${state.pending.map((j) => `
        <div class="queue-item">
          <span class="label">${labelFor(j.type)}</span>
          <button data-cancel="${j.id}" class="danger">✕</button>
        </div>`).join("") || `<p style="color:var(--muted)">Không có task nào đang chờ.</p>`}
      <h3>✅ Đã hoàn thành (${state.completed.length}) <button id="queue-clear" style="font-weight:normal">Xoá lịch sử</button></h3>
      ${state.completed.map((j) => `
        <div class="queue-item">
          <span class="label">${statusIcon(j.status)} ${labelFor(j.type)} <span style="color:var(--muted)">${ago(j.createdAt)}</span></span>
          ${j.status === "done" && j.result?.outputs?.[0] ? `<button data-open="${escapeAttr(parentDir(j.result.outputs[0]))}">📂 Mở folder</button>` : ""}
          ${j.status === "error" ? `<button data-error="${j.id}">Chi tiết lỗi</button>` : ""}
        </div>`).join("") || `<p style="color:var(--muted)">Lịch sử trống.</p>`}
    `;

    el.querySelector("#queue-clear")?.addEventListener("click", () => window.api.queue.clear());
    const logBody = el.querySelector(".log-body");
    if (logBody) logBody.scrollTop = logBody.scrollHeight;
  };

  if (!el._queueClickAttached) {
    el.addEventListener("click", (e) => {
      if (el.dataset.screen !== "queue") return;
      const id = e.target.dataset?.cancel;
      if (id) window.api.queue.cancel(id);
      const folder = e.target.dataset?.open;
      if (folder) window.api.shell.openFolder(folder);
      const errId = e.target.dataset?.error;
      if (errId) {
        window.api.queue.getState().then((s) => {
          const job = s.completed.find((j) => j.id === errId);
          if (job?.error) showErrorModal({ summary: `Task ${labelFor(job.type)} thất bại`, error: job.error, jobId: job.id });
        });
      }
    });
    el._queueClickAttached = true;
  }

  const initial = await window.api.queue.getState();
  await render(initial);
  unsub = window.api.queue.onUpdate(render);
}

const LABELS = {
  render: "Render Video", snow: "Snow", trim: "Trim", cutBg: "Cut BG",
  getUrls: "Lấy link kênh", download: "Tải video", concat: "Nối video",
  _ytdlpUpdate: "Cập nhật yt-dlp",
};
function labelFor(t) { return LABELS[t] || t; }
function statusIcon(s) { return ({ done: "✅", error: "❌", cancelled: "🚫" })[s] || "•"; }
function ago(ts) {
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s trước`;
  if (sec < 3600) return `${Math.round(sec / 60)} phút trước`;
  return `${Math.round(sec / 3600)} giờ trước`;
}
function parentDir(filePath) {
  return filePath.replace(/[/\\][^/\\]+$/, "");
}
function escapeAttr(s) { return String(s).replace(/"/g, "&quot;"); }
function escapeHtml(s) { return String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }

function logPanelHtml(logs) {
  if (!logs || logs.length === 0) return "";
  const lines = logs.slice(-MAX_LOG_LINES);
  return `
    <div class="log-panel">
      <div class="log-panel-header"><strong>📜 Log</strong></div>
      <div class="log-body">${lines.map((l) => `<div class="log-line log-${l.level}"><span class="log-time">${fmtTime(l.ts)}</span>${escapeHtml(l.line)}</div>`).join("")}</div>
    </div>`;
}

function fmtTime(ts) {
  if (!ts) return "        ";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
