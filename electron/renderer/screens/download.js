import { runWithFeedback } from "../components/buttonFeedback.js";

export async function renderDownload(el) {
  const s = await window.api.settings.get();
  const ws = await window.api.app.getWorkspace();
  const last = s.lastConfig?.download ?? {};
  const lastUrlsFile = last.urlsFile ?? "";
  const lastOutput = last.output ?? `${ws}\\downloads`;
  const lastConcurrent = last.maxConcurrent ?? s.download.maxConcurrent;

  el.innerHTML = `
    <div class="screen-header">⬇️ Tải video</div>
    <p class="screen-subtitle">Đọc file URLs (.txt) và tải video bằng yt-dlp.</p>
    <form id="task-form">
      <div class="field">
        <label>📄 File URLs (.txt)</label>
        <div class="field-row">
          <input id="urls-file" type="text" name="urlsFile" value="${escapeAttr(lastUrlsFile)}" required>
          <button type="button" id="pick-urls">📂 Chọn…</button>
        </div>
        <div class="help">Mặc định: file Get URLs gần nhất.</div>
      </div>
      <div class="field">
        <label>📁 Folder output</label>
        <div class="field-row">
          <input id="output" type="text" name="output" value="${escapeAttr(lastOutput)}" required>
          <button type="button" id="pick-output">📂 Chọn…</button>
        </div>
      </div>
      <div class="field">
        <label>🔢 Số tải song song <span id="cc-val">${lastConcurrent}</span></label>
        <input id="concurrent" type="range" min="1" max="5" value="${lastConcurrent}">
        <div class="help">Default từ Settings · range 1–5.</div>
      </div>
      <button type="submit" class="primary">▶ Thêm vào hàng đợi</button>
    </form>
  `;

  const cc = el.querySelector("#concurrent");
  cc.addEventListener("input", () => { el.querySelector("#cc-val").textContent = cc.value; });

  el.querySelector("#pick-urls").addEventListener("click", async () => {
    const r = await window.api.dialog.pickFile({
      filters: [{ name: "URL list", extensions: ["txt"] }],
    });
    if (r) el.querySelector("#urls-file").value = r;
  });
  el.querySelector("#pick-output").addEventListener("click", async () => {
    const cur = el.querySelector("#output").value;
    const p = await window.api.dialog.pickFolder(cur);
    if (p) el.querySelector("#output").value = p;
  });

  el.querySelector("#task-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const urlsFile = el.querySelector("#urls-file").value.trim();
    const output = el.querySelector("#output").value.trim();
    const maxConcurrent = parseInt(cc.value, 10);
    if (!urlsFile || !output) return;

    const config = {
      urlsFile, output, maxConcurrent,
      ytdlpPath: s.download.ytdlpPath,
    };
    const submitBtn = el.querySelector('button[type="submit"]');
    await runWithFeedback(submitBtn, async () => {
      await window.api.queue.add({ type: "download", config });
      await window.api.settings.set({ "lastConfig.download": { urlsFile, output, maxConcurrent } });
    });
  });
}

function escapeAttr(s) {
  return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}
