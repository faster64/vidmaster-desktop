import { toast } from "../components/toast.js";

const POSITIONS = [
  { id: "top-left",     label: "Trên trái" },
  { id: "top-right",    label: "Trên phải" },
  { id: "bottom-left",  label: "Dưới trái" },
  { id: "bottom-right", label: "Dưới phải" },
  { id: "center",       label: "Giữa" },
];

export async function renderThumbAvatar(el) {
  const s = await window.api.settings.get();
  const ws = await window.api.app.getWorkspace();
  const last = s.lastConfig?.thumbAvatar ?? {};
  const lastThumb = last.thumbDir ?? `${ws}\\thumbs`;
  const lastAvatar = last.avatarDir ?? `${ws}\\avatars`;
  const lastOutput = last.output ?? `${ws}\\thumb_output`;
  const lastPosition = s.avatar?.lastPosition ?? "bottom-right";
  const size = s.avatar?.size ?? 80;

  el.innerHTML = `
    <div class="screen-header">😂 Gắn avatar vào thumbnail</div>
    <p class="screen-subtitle">Mỗi avatar sinh ra 1 folder chứa các thumbnail đã chèn avatar đó.</p>
    <form id="task-form">
      <div class="field">
        <label>📁 Folder thumbnail (.jpg)</label>
        <div class="field-row">
          <input id="thumb-dir" type="text" value="${escapeAttr(lastThumb)}" required>
          <button type="button" id="pick-thumb">📂 Chọn…</button>
          <button type="button" data-open-id="thumb-dir" title="Mở folder">↗</button>
        </div>
      </div>
      <div class="field">
        <label>📁 Folder avatar (.jpg/.png)</label>
        <div class="field-row">
          <input id="avatar-dir" type="text" value="${escapeAttr(lastAvatar)}" required>
          <button type="button" id="pick-avatar">📂 Chọn…</button>
          <button type="button" data-open-id="avatar-dir" title="Mở folder">↗</button>
        </div>
      </div>
      <div class="field">
        <label>📁 Folder output</label>
        <div class="field-row">
          <input id="output" type="text" value="${escapeAttr(lastOutput)}" required>
          <button type="button" id="pick-output">📂 Chọn…</button>
          <button type="button" data-open-id="output" title="Mở folder">↗</button>
        </div>
      </div>
      <div class="field">
        <label>📍 Vị trí avatar</label>
        <div style="display:flex;flex-direction:column;gap:4px;margin-top:4px">
          ${POSITIONS.map((p) => `
            <label><input type="radio" name="position" value="${p.id}" ${p.id === lastPosition ? "checked" : ""}> ${p.label}</label>
          `).join("")}
        </div>
        <div class="help">Avatar size: <strong>${size}×${size} px</strong> (đổi trong Settings → Avatar)</div>
      </div>
      <button type="submit" class="primary">▶  Thực hiện</button>
    </form>
  `;

  el.querySelector("#pick-thumb").addEventListener("click", async () => {
    const cur = el.querySelector("#thumb-dir").value;
    const p = await window.api.dialog.pickFolder(cur);
    if (p) el.querySelector("#thumb-dir").value = p;
  });
  el.querySelector("#pick-avatar").addEventListener("click", async () => {
    const cur = el.querySelector("#avatar-dir").value;
    const p = await window.api.dialog.pickFolder(cur);
    if (p) el.querySelector("#avatar-dir").value = p;
  });
  el.querySelector("#pick-output").addEventListener("click", async () => {
    const cur = el.querySelector("#output").value;
    const p = await window.api.dialog.pickFolder(cur);
    if (p) el.querySelector("#output").value = p;
  });
  el.querySelectorAll("[data-open-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const value = el.querySelector(`#${btn.dataset.openId}`)?.value?.trim();
      if (value) await window.api.shell.openFolder(value);
    });
  });

  el.querySelector("#task-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const thumbDir = el.querySelector("#thumb-dir").value.trim();
    const avatarDir = el.querySelector("#avatar-dir").value.trim();
    const output = el.querySelector("#output").value.trim();
    const position = el.querySelector('input[name="position"]:checked')?.value;
    if (!thumbDir || !avatarDir || !output || !position) return;

    const config = {
      thumbDir, avatarDir, output, position,
      size: s.avatar?.size ?? 80,
      margin: s.avatar?.margin ?? 16,
    };
    await window.api.queue.add({ type: "thumbAvatar", config });
    await window.api.settings.set({
      "lastConfig.thumbAvatar": { thumbDir, avatarDir, output },
      "avatar.lastPosition": position,
    });
    toast({ kind: "success", message: "✅ Đã thêm vào hàng đợi" });
  });
}

function escapeAttr(s) {
  return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}
