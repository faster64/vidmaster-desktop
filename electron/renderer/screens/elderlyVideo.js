import { toast } from "../components/toast.js";

const ANCHORS = [
  ["top-left",     "↖", "Trên trái"],
  ["top",          "↑", "Trên"],
  ["top-right",    "↗", "Trên phải"],
  ["left",         "←", "Trái"],
  ["center",       "·", "Giữa"],
  ["right",        "→", "Phải"],
  ["bottom-left",  "↙", "Dưới trái"],
  ["bottom",       "↓", "Dưới"],
  ["bottom-right", "↘", "Dưới phải"],
];

export async function renderElderlyVideo(el) {
  const s = await window.api.settings.get();
  const ws = await window.api.app.getWorkspace();
  const last = s.lastConfig?.elderlyVideo ?? {};
  const lastImages = last.inputImages ?? `${ws}\\elderly\\images`;
  const lastVideos = last.inputVideos ?? `${ws}\\elderly\\videos`;
  const lastOutput = last.output ?? `${ws}\\elderly\\output`;
  const lastAnchor = last.anchor ?? "bottom-left";
  const lastW = last.overlayWidth ?? 480;
  const lastH = last.overlayHeight ?? 270;
  const lastOffsetX = last.offsetX ?? 0;
  const lastOffsetY = last.offsetY ?? 0;
  const lastUseGPU = s.render?.useGPU ?? false;

  el.innerHTML = `
    <div class="screen-header">🧓 Video nền người già</div>
    <p class="screen-subtitle">Ghép video overlay (.mp4) lên ảnh nền tĩnh (.jpg/.png). Output 1280×720, audio lấy từ video.</p>
    <form id="task-form">
      <div class="field">
        <label>📁 Folder ảnh nền (.jpg/.png)</label>
        <div class="field-row">
          <input id="input-images" type="text" value="${escapeAttr(lastImages)}" required>
          <button type="button" data-pick="input-images">📂 Chọn…</button>
          <button type="button" data-open-id="input-images" title="Mở folder">↗</button>
        </div>
      </div>
      <div class="field">
        <label>📁 Folder video overlay (.mp4)</label>
        <div class="field-row">
          <input id="input-videos" type="text" value="${escapeAttr(lastVideos)}" required>
          <button type="button" data-pick="input-videos">📂 Chọn…</button>
          <button type="button" data-open-id="input-videos" title="Mở folder">↗</button>
        </div>
      </div>
      <div class="field">
        <label>📁 Folder output</label>
        <div class="field-row">
          <input id="output" type="text" value="${escapeAttr(lastOutput)}" required>
          <button type="button" data-pick="output">📂 Chọn…</button>
          <button type="button" data-open-id="output" title="Mở folder">↗</button>
        </div>
        <div class="help">Mỗi lần chạy bỏ qua video đã có file output (theo <code>_processed.json</code>).</div>
      </div>

      <div class="field">
        <label>📍 Vị trí video overlay</label>
        <div class="anchor-grid">
          ${ANCHORS.map(([id, glyph, label]) => `
            <label class="anchor-cell" title="${label}">
              <input type="radio" name="anchor" value="${id}" ${id === lastAnchor ? "checked" : ""}>
              <span class="anchor-box"><span class="anchor-glyph">${glyph}</span></span>
            </label>
          `).join("")}
        </div>
        <div class="help">Tham chiếu trong khung output 1280×720. Offset tinh chỉnh ở phần Nâng cao.</div>
      </div>

      <div class="field">
        <label>🔢 Kích thước overlay (px)</label>
        <div class="field-row">
          <span style="min-width:24px">W</span>
          <input id="overlay-w" type="number" min="1" step="1" value="${lastW}" required style="max-width:120px">
          <span style="min-width:24px;margin-left:12px">H</span>
          <input id="overlay-h" type="number" min="1" step="1" value="${lastH}" required style="max-width:120px">
        </div>
        <div class="help">Output là 1280×720. Overlay mặc định 480×270 (~37,5% width).</div>
      </div>

      <details class="advanced">
        <summary>Tuỳ chọn nâng cao</summary>
        <div class="field">
          <label>↔ Offset (px) cộng vào anchor</label>
          <div class="field-row">
            <span style="min-width:24px">X</span>
            <input id="offset-x" type="number" step="1" value="${lastOffsetX}" style="max-width:120px">
            <span style="min-width:24px;margin-left:12px">Y</span>
            <input id="offset-y" type="number" step="1" value="${lastOffsetY}" style="max-width:120px">
          </div>
          <div class="help">Có thể âm. VD: anchor <em>bottom-right</em> + offset <code>(-20,-20)</code> = lùi vào trong 20px.</div>
        </div>
        <div class="field">
          <label><input id="use-gpu" type="checkbox" ${lastUseGPU ? "checked" : ""}> Dùng GPU (encoder: <code>${escapeAttr(s.ffmpeg?.encoder ?? "libx264")}</code>)</label>
          <div class="help">Bỏ chọn để dùng CPU libx264 ultrafast.</div>
        </div>
      </details>

      <button type="submit" class="primary">▶  Thực hiện</button>
    </form>

    <style>
      .anchor-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        max-width: 240px;
        gap: 6px;
        margin-top: 6px;
      }
      .anchor-cell { cursor: pointer; }
      .anchor-cell input[type="radio"] { display: none; }
      .anchor-box {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 56px;
        border: 1px solid var(--border, #ccc);
        border-radius: 4px;
        background: var(--bg-subtle, #f5f5f5);
        transition: all 0.15s;
      }
      .anchor-cell:hover .anchor-box {
        border-color: var(--accent, #4a90e2);
        background: var(--bg-hover, #ebf3fb);
      }
      .anchor-cell input[type="radio"]:checked + .anchor-box {
        border-color: var(--accent, #4a90e2);
        background: var(--accent-soft, #d6e7f7);
        box-shadow: inset 0 0 0 1px var(--accent, #4a90e2);
      }
      .anchor-glyph { font-size: 22px; line-height: 1; opacity: 0.75; }
      .anchor-cell input[type="radio"]:checked + .anchor-box .anchor-glyph { opacity: 1; font-weight: bold; }
    </style>
  `;

  // Folder pickers
  el.querySelectorAll("[data-pick]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.pick;
      const input = el.querySelector(`#${id}`);
      const chosen = await window.api.dialog.pickFolder(input.value);
      if (chosen) input.value = chosen;
    });
  });

  el.querySelectorAll("[data-open-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const value = el.querySelector(`#${btn.dataset.openId}`)?.value?.trim();
      if (value) await window.api.shell.openFolder(value);
    });
  });

  el.querySelector("#task-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!e.target.reportValidity()) return;

    const inputImages = el.querySelector("#input-images").value.trim();
    const inputVideos = el.querySelector("#input-videos").value.trim();
    const output = el.querySelector("#output").value.trim();
    const anchor = el.querySelector('input[name="anchor"]:checked')?.value;
    const overlayWidth = parseInt(el.querySelector("#overlay-w").value, 10);
    const overlayHeight = parseInt(el.querySelector("#overlay-h").value, 10);
    const offsetX = parseInt(el.querySelector("#offset-x").value, 10) || 0;
    const offsetY = parseInt(el.querySelector("#offset-y").value, 10) || 0;
    const useGPU = el.querySelector("#use-gpu").checked;

    if (!inputImages || !inputVideos || !output || !anchor) return;
    if (!Number.isInteger(overlayWidth) || overlayWidth <= 0
     || !Number.isInteger(overlayHeight) || overlayHeight <= 0) {
      toast({ kind: "error", message: "⚠️ Kích thước overlay phải là số nguyên > 0" });
      return;
    }

    const config = {
      inputImages, inputVideos, output,
      anchor,
      overlayWidth, overlayHeight,
      offsetX, offsetY,
      ffmpeg: {
        useGPU,
        encoder: s.ffmpeg?.encoder ?? "libx264",
      },
    };

    await window.api.queue.add({ type: "elderlyVideo", config });
    await window.api.settings.set({
      "lastConfig.elderlyVideo": {
        inputImages, inputVideos, output,
        anchor, overlayWidth, overlayHeight, offsetX, offsetY,
      },
    });
    toast({ kind: "success", message: "✅ Đã thêm vào hàng đợi" });
  });
}

function escapeAttr(s) {
  return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}
