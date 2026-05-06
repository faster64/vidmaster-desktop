const root = () => document.getElementById("modal-root");

export function showModal({ title, body, footer }) {
  const r = root();
  r.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">${title}</div>
        <div class="modal-body">${body}</div>
        <div class="modal-footer">${footer ?? `<button class="primary" data-close>Đóng</button>`}</div>
      </div>
    </div>`;
  r.addEventListener("click", (e) => {
    if (e.target.matches(".modal-backdrop") || e.target.matches("[data-close]")) {
      r.innerHTML = "";
    }
  }, { once: true });
}

export async function showErrorModal({ summary, error, jobId }) {
  let logs = [];
  if (jobId) {
    try { logs = await window.api.log.getRecent(jobId); } catch {}
  }
  const stack = error?.stack || (error?.details ? JSON.stringify(error.details, null, 2) : "");
  const logLines = logs.map((l) => `[${l.level}] ${l.line}`).join("");
  showModal({
    title: `❌ ${summary}`,
    body: `<p>${escape(error?.message || "Có lỗi xảy ra.")}</p>
           <h4>Stack / details</h4><pre>${escape(stack)}</pre>
           ${logLines ? `<h4>Log gần nhất (${logs.length} dòng)</h4><pre>${escape(logLines)}</pre>` : ""}`,
    footer: `
      <button id="copy-log">Copy log</button>
      <button onclick="window.api.shell.openLogFile()">Mở file log</button>
      <button class="primary" data-close>Đóng</button>
    `,
  });
  document.getElementById("copy-log")?.addEventListener("click", () => {
    navigator.clipboard.writeText(stack + "\n\n" + logLines);
  });
}

function escape(s) { return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }
