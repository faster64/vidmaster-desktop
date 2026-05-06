import { toast } from "../components/toast.js";

export async function renderGetUrls(el) {
  const s = await window.api.settings.get();
  const ws = await window.api.app.getWorkspace();
  const handleLast = s.lastConfig?.getUrls?.handle ?? "";

  el.innerHTML = `
    <div class="screen-header">🔗 Lấy link kênh</div>
    <p class="screen-subtitle">Lấy danh sách video từ một YouTube channel theo handle.</p>
    <form id="task-form">
      <div class="field" data-path="handle" data-kind="text">
        <label>Handle YouTube</label>
        <input id="handle" type="text" name="handle" placeholder="@MrBeast" value="${escape(handleLast)}" required>
        <div class="help">Bắt buộc. Bắt đầu bằng @ hoặc tên handle thuần.</div>
      </div>
      <div class="field">
        <div class="help">ⓘ Min duration: <strong>${s.youtube.minDurationMinutes}</strong> phút · Sort: <strong>${s.youtube.sortOrder}</strong> (đổi trong Settings → YouTube)</div>
      </div>
      <button type="submit" class="primary">▶ Thêm vào hàng đợi</button>
    </form>
    <div id="viewer" style="margin-top:24px"></div>
  `;

  el.querySelector("#task-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    let handle = el.querySelector("#handle").value.trim();
    if (!handle) return;
    if (!handle.startsWith("@")) handle = "@" + handle;

    const config = {
      handle,
      apiKey: s.youtube.apiKey,
      minDurationMinutes: s.youtube.minDurationMinutes,
      sortOrder: s.youtube.sortOrder,
      workspace: ws,
    };
    await window.api.queue.add({ type: "getUrls", config });
    await window.api.settings.set({ "lastConfig.getUrls": { handle } });
    toast({ kind: "success", message: "✅ Đã thêm vào hàng đợi" });
  });

  window.api.queue.onUpdate(async (state) => {
    const last = state.completed.find((j) => j.type === "getUrls" && j.status === "done");
    if (!last) return;
    const infosPath = last.result?.outputs?.[1];
    if (!infosPath) return;
    const viewer = el.querySelector("#viewer");
    if (!viewer || viewer.dataset.jobId === last.id) return;
    viewer.dataset.jobId = last.id;
    const infos = await window.api.fs.readVideoInfos(infosPath);
    const urlsPath = last.result?.outputs?.[0];
    const folder = urlsPath?.replace(/[/\\][^/\\]+$/, "");
    if (urlsPath) {
      const prev = (await window.api.settings.get("lastConfig.download")) || {};
      await window.api.settings.set({ "lastConfig.download": { ...prev, urlsFile: urlsPath } });
    }
    viewer.innerHTML = `
      <h3>Kết quả (${infos.length} video)</h3>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button id="vw-open-folder">📂 Mở folder</button>
        <button id="vw-open-urls">📄 Mở file urls.txt</button>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="text-align:left;border-bottom:2px solid #ccc">
          <th>Title</th><th>Duration</th><th>Views</th><th>URL</th>
        </tr></thead>
        <tbody>${infos.map((i) => `<tr style="border-bottom:1px solid #eee">
          <td>${escape(i.title)}</td>
          <td>${escape(i.duration)}</td>
          <td>${escape(i.viewCount)}</td>
          <td><a href="${escapeAttr(i.url)}" target="_blank">${escape(i.url)}</a></td>
        </tr>`).join("")}</tbody>
      </table>
    `;
    viewer.querySelector("#vw-open-folder")?.addEventListener("click", () => folder && window.api.shell.openFolder(folder));
    viewer.querySelector("#vw-open-urls")?.addEventListener("click", () => urlsPath && window.api.shell.openFolder(urlsPath));
  });
}

function escape(s) {
  return String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}
function escapeAttr(s) {
  return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}
