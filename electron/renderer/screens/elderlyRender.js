import { toast } from "../components/toast.js";

const DEFAULT_CROP = "in_w:205:0:480";
const DEFAULT_OVERLAY = "(main_w-overlay_w)/2:550";

export async function renderElderlyRender(el) {
  const s = await window.api.settings.get();
  const ws = await window.api.app.getWorkspace();
  const last = s.lastConfig?.elderlyRender ?? {};
  const lastInput = last.inputFolder ?? `${ws}\\elderly\\originals`;
  const lastBg = last.backgroundFolder ?? `${ws}\\elderly\\output`;
  const lastOutput = last.output ?? `${ws}\\elderly\\rendered`;
  const lastCrop = last.cropValue ?? DEFAULT_CROP;
  const lastOverlay = last.overlayValue ?? DEFAULT_OVERLAY;
  const lastUseGPU = s.render?.useGPU ?? false;

  el.innerHTML = `
    <div class="screen-header">🎬 Render video người già</div>
    <p class="screen-subtitle">Ghép .mp3 (audio) hoặc .mp4 (text overlay, Older mode) lên video nền. Output 1280×720.</p>
    <form id="task-form">
      <div class="field">
        <label>📁 Folder input (.mp3 + .mp4)</label>
        <div class="field-row">
          <input id="input-folder" type="text" value="${escapeAttr(lastInput)}" required>
          <button type="button" data-pick="input-folder">📂 Chọn…</button>
          <button type="button" data-open-id="input-folder" title="Mở folder">↗</button>
        </div>
      </div>
      <div class="field">
        <label>📁 Folder video nền (.mp4)</label>
        <div class="field-row">
          <input id="background-folder" type="text" value="${escapeAttr(lastBg)}" required>
          <button type="button" data-pick="background-folder">📂 Chọn…</button>
          <button type="button" data-open-id="background-folder" title="Mở folder">↗</button>
        </div>
        <div class="help">Mặc định = output task "Video nền người già".</div>
      </div>
      <div class="field">
        <label>📁 Folder output</label>
        <div class="field-row">
          <input id="output" type="text" value="${escapeAttr(lastOutput)}" required>
          <button type="button" data-pick="output">📂 Chọn…</button>
          <button type="button" data-open-id="output" title="Mở folder">↗</button>
        </div>
        <div class="help">Bỏ qua file đã render (theo <code>_rendered.json</code> + file đã có trong folder).</div>
      </div>

      <div class="field">
        <label>🎞️ Crop expression (cho .mp4)</label>
        <input id="crop-value" type="text" value="${escapeAttr(lastCrop)}" style="font-family:monospace">
        <div class="help">FFmpeg <code>crop=W:H:X:Y</code>. VD: <code>in_w:205:0:480</code> = full width, height 205px, từ y=480.</div>
      </div>

      <div class="field">
        <label>📍 Overlay position (cho .mp4)</label>
        <input id="overlay-value" type="text" value="${escapeAttr(lastOverlay)}" style="font-family:monospace">
        <div class="help">FFmpeg <code>overlay=X:Y</code>. VD: <code>(main_w-overlay_w)/2:550</code> = căn giữa ngang, y=550.</div>
      </div>

      <details class="advanced">
        <summary>Tuỳ chọn nâng cao</summary>
        <div class="field">
          <label><input id="use-gpu" type="checkbox" ${lastUseGPU ? "checked" : ""}> Dùng GPU (encoder: <code>${escapeAttr(s.ffmpeg?.encoder ?? "libx264")}</code>)</label>
          <div class="help">Bỏ chọn để dùng CPU libx264 ultrafast. mp3 input luôn dùng <code>-c:v copy</code> (không re-encode).</div>
        </div>
      </details>

      <button type="submit" class="primary">▶  Thực hiện</button>
    </form>
  `;

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

    const inputFolder = el.querySelector("#input-folder").value.trim();
    const backgroundFolder = el.querySelector("#background-folder").value.trim();
    const output = el.querySelector("#output").value.trim();
    const cropValue = el.querySelector("#crop-value").value.trim();
    const overlayValue = el.querySelector("#overlay-value").value.trim();
    const useGPU = el.querySelector("#use-gpu").checked;

    if (!inputFolder || !backgroundFolder || !output) return;

    const config = {
      inputFolder, backgroundFolder, output,
      cropValue, overlayValue,
      ffmpeg: {
        useGPU,
        encoder: s.ffmpeg?.encoder ?? "libx264",
      },
    };

    await window.api.queue.add({ type: "elderlyRender", config });
    await window.api.settings.set({
      "lastConfig.elderlyRender": {
        inputFolder, backgroundFolder, output, cropValue, overlayValue,
      },
    });
    toast({ kind: "success", message: "✅ Đã thêm vào hàng đợi" });
  });
}

function escapeAttr(s) {
  return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}
