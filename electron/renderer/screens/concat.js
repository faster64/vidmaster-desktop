import { mountReorderableList } from "../components/reorderableList.js";
import { runWithFeedback } from "../components/buttonFeedback.js";

export async function renderConcat(el) {
  const s = await window.api.settings.get();
  const ws = await window.api.app.getWorkspace();
  const last = s.lastConfig?.concat ?? {};
  const lastFolder = last.folder ?? `${ws}\\done`;
  const lastName = last.outputName ?? "output";

  el.innerHTML = `
    <div class="screen-header">🪡 Nối video</div>
    <p class="screen-subtitle">Nối các .mp4 trong một folder thành một video duy nhất, giữ nguyên audio.</p>
    <form id="task-form">
      <div class="field">
        <label>📁 Folder input</label>
        <div class="field-row">
          <input id="folder" type="text" value="${escapeAttr(lastFolder)}" required>
          <button type="button" id="pick-folder">📂 Chọn…</button>
          <button type="button" id="reload">↻</button>
        </div>
      </div>

      <div class="field">
        <label>Danh sách video <span id="count">(0/0 chọn)</span></label>
        <div id="rl" style="border:1px solid #ccc;border-radius:4px;max-height:360px;overflow:auto"></div>
        <div class="help">Kéo ⋮⋮ để đổi thứ tự. Bỏ check để loại trừ.</div>
      </div>

      <div class="field">
        <label>📝 Tên file output</label>
        <div class="field-row">
          <input id="output-name" type="text" value="${escapeAttr(lastName)}" required>
          <span>.mp4</span>
        </div>
        <div class="help" id="output-preview"></div>
      </div>

      <button type="submit" class="primary" id="submit" disabled>▶ Thêm vào hàng đợi</button>
    </form>
  `;

  const folderInput = el.querySelector("#folder");
  const rlMount = el.querySelector("#rl");
  const countLabel = el.querySelector("#count");
  const submitBtn = el.querySelector("#submit");
  const outputNameInput = el.querySelector("#output-name");
  const outputPreview = el.querySelector("#output-preview");

  let rl = null;

  function refreshOutputPreview() {
    const folder = folderInput.value.trim();
    const name = outputNameInput.value.trim() || "output";
    outputPreview.textContent = `→ ${folder}\\${name}.mp4`;
  }

  function refreshSubmitState() {
    const items = rl?.getItems() ?? [];
    const checked = items.filter((i) => i.checked).length;
    countLabel.textContent = `(${checked}/${items.length} chọn)`;
    submitBtn.disabled = checked < 2;
  }

  async function reload() {
    const folder = folderInput.value.trim();
    if (!folder) return;
    const files = await window.api.fs.listMp4(folder);
    rl = mountReorderableList(rlMount, files.map((f) => ({
      key: f.fullPath,
      label: f.name,
      meta: `${(f.sizeBytes / (1024 * 1024)).toFixed(1)} MB · ${formatDur(f.durationSec)}`,
      checked: true,
    })), refreshSubmitState);
    refreshSubmitState();
    refreshOutputPreview();
  }

  el.querySelector("#pick-folder").addEventListener("click", async () => {
    const p = await window.api.dialog.pickFolder(folderInput.value);
    if (p) { folderInput.value = p; await reload(); }
  });
  el.querySelector("#reload").addEventListener("click", reload);
  outputNameInput.addEventListener("input", refreshOutputPreview);
  folderInput.addEventListener("change", refreshOutputPreview);

  el.querySelector("#task-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const folder = folderInput.value.trim();
    const items = rl.getItems().filter((i) => i.checked);
    if (items.length < 2) return;
    const name = outputNameInput.value.trim() || "output";
    const output = `${folder}\\${name}.mp4`;
    const exists = (await window.api.fs.exists(output)).exists;
    if (exists) {
      if (!confirm(`File ${output} đã tồn tại. Ghi đè?`)) return;
    }

    const submitBtn = el.querySelector('button[type="submit"]');
    await runWithFeedback(submitBtn, async () => {
      await window.api.queue.add({
        type: "concat",
        config: { inputs: items.map((i) => i.key), output },
      });
      await window.api.settings.set({ "lastConfig.concat": { folder, outputName: name } });
    });
  });

  await reload();
}

function formatDur(sec) {
  if (!sec) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
function escapeAttr(s) {
  return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}
