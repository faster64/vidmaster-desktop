import { toast } from "../components/toast.js";
import { recolorPixels, hexToRgb } from "../../../src/_lib/recolorImage.js";

const DEFAULTS = {
  sourceColor:       "#7A97C1",
  tolerance:         70,
  gradientStart:     "#FFC0CB",
  gradientEnd:       "#FF69B4",
  gradientDirection: "vertical",
};

export async function renderRecolorThumb(el) {
  const s = await window.api.settings.get();
  const ws = await window.api.app.getWorkspace();
  const last = s.lastConfig?.recolorThumb ?? {};
  const lastParams = s.recolor?.last ?? {};
  const inputDir = last.inputDir ?? `${ws}\\thumbs`;
  const output = last.output ?? `${ws}\\recolored`;
  const sourceColor = lastParams.sourceColor ?? DEFAULTS.sourceColor;
  const tolerance = lastParams.tolerance ?? DEFAULTS.tolerance;
  const gradientStart = lastParams.gradientStart ?? DEFAULTS.gradientStart;
  const gradientEnd = lastParams.gradientEnd ?? DEFAULTS.gradientEnd;
  const gradientDirection = lastParams.gradientDirection ?? DEFAULTS.gradientDirection;

  el.innerHTML = `
    <div class="screen-header">🎨 Đổi màu thumbnail</div>
    <p class="screen-subtitle">Thay vùng có 1 màu chủ đạo bằng gradient. Click ảnh để pick màu gốc.</p>
    <div class="recolor-layout" style="display:grid;grid-template-columns:minmax(360px,1fr) minmax(360px,1fr);gap:24px">
      <form id="task-form">
        <div class="field">
          <label>📁 Folder thumbnail (.jpg/.png)</label>
          <div class="field-row">
            <input id="input-dir" type="text" value="${escapeAttr(inputDir)}" required>
            <button type="button" id="pick-input">📂 Chọn…</button>
            <button type="button" data-open-id="input-dir" title="Mở folder">↗</button>
          </div>
        </div>
        <div class="field">
          <label>📁 Folder output</label>
          <div class="field-row">
            <input id="output" type="text" value="${escapeAttr(output)}" required>
            <button type="button" id="pick-output">📂 Chọn…</button>
            <button type="button" data-open-id="output" title="Mở folder">↗</button>
          </div>
        </div>

        <div class="field">
          <label>🖼️ Ảnh mẫu (preview)</label>
          <div class="field-row">
            <select id="sample-select"><option value="">(chưa có ảnh)</option></select>
            <button type="button" id="sample-random" title="Đổi ảnh khác">🔀</button>
          </div>
        </div>

        <div class="field">
          <label>🎯 Màu gốc</label>
          <div class="field-row">
            <span id="src-swatch" class="color-swatch" style="display:inline-block;width:32px;height:32px;border:1px solid #888;background:${sourceColor};vertical-align:middle"></span>
            <input id="src-hex" type="text" value="${escapeAttr(sourceColor)}" pattern="^#[0-9A-Fa-f]{6}$" style="width:110px">
            <button type="button" id="eyedropper" title="Click trên ảnh để pick màu">💧 Eyedropper</button>
          </div>
          <div class="field-row" style="margin-top:8px">
            <label style="flex:0 0 auto">Tolerance:</label>
            <input id="tolerance" type="range" min="0" max="255" step="1" value="${tolerance}" style="flex:1">
            <span id="tolerance-val" style="min-width:36px;text-align:right">${tolerance}</span>
          </div>
        </div>

        <div class="field">
          <label>🎨 Gradient thay thế</label>
          <div class="field-row" style="margin-top:4px">
            <span style="width:60px">Start:</span>
            <span id="start-swatch" class="color-swatch" style="display:inline-block;width:32px;height:32px;border:1px solid #888;background:${gradientStart};vertical-align:middle"></span>
            <input id="start-hex" type="text" value="${escapeAttr(gradientStart)}" pattern="^#[0-9A-Fa-f]{6}$" style="width:110px">
            <input id="start-color" type="color" value="${escapeAttr(gradientStart)}">
          </div>
          <div class="field-row" style="margin-top:4px">
            <span style="width:60px">End:</span>
            <span id="end-swatch" class="color-swatch" style="display:inline-block;width:32px;height:32px;border:1px solid #888;background:${gradientEnd};vertical-align:middle"></span>
            <input id="end-hex" type="text" value="${escapeAttr(gradientEnd)}" pattern="^#[0-9A-Fa-f]{6}$" style="width:110px">
            <input id="end-color" type="color" value="${escapeAttr(gradientEnd)}">
          </div>
          <div class="field-row" style="margin-top:8px">
            <label style="flex:0 0 auto">Hướng:</label>
            <label><input type="radio" name="dir" value="vertical" ${gradientDirection === "vertical" ? "checked" : ""}> Dọc</label>
            <label><input type="radio" name="dir" value="horizontal" ${gradientDirection === "horizontal" ? "checked" : ""}> Ngang</label>
          </div>
        </div>

        <div class="field-row" style="margin-top:16px">
          <button type="submit" class="primary">▶  Thực hiện</button>
          <button type="button" id="reset-params">↺ Reset</button>
        </div>
      </form>

      <div class="preview-pane">
        <canvas id="preview-canvas" style="max-width:100%;border:1px solid #444;display:block"></canvas>
        <div id="preview-info" style="margin-top:6px;font-size:12px;color:#aaa">Chọn folder để xem preview</div>
        <div style="margin-top:6px">
          <label><input type="radio" name="view" value="processed" checked> Sau xử lý</label>
          &nbsp;
          <label><input type="radio" name="view" value="original"> Gốc</label>
        </div>
      </div>
    </div>
  `;

  // ── Folder pickers ────────────────────────────────────────────────────────
  el.querySelector("#pick-input").addEventListener("click", async () => {
    const cur = el.querySelector("#input-dir").value;
    const p = await window.api.dialog.pickFolder(cur);
    if (p) { el.querySelector("#input-dir").value = p; await refreshSamples(); }
  });
  el.querySelector("#input-dir").addEventListener("change", async () => {
    await refreshSamples();
  });
  el.querySelector("#pick-output").addEventListener("click", async () => {
    const cur = el.querySelector("#output").value;
    const p = await window.api.dialog.pickFolder(cur);
    if (p) el.querySelector("#output").value = p;
  });
  el.querySelectorAll("[data-open-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const v = el.querySelector(`#${btn.dataset.openId}`)?.value?.trim();
      if (v) await window.api.shell.openFolder(v);
    });
  });

  // ── Color swatch ↔ hex ↔ native picker sync ───────────────────────────────
  function wireColorTrio(swatchId, hexId, colorId) {
    const swatch = el.querySelector(`#${swatchId}`);
    const hexEl = el.querySelector(`#${hexId}`);
    const colEl = colorId ? el.querySelector(`#${colorId}`) : null;
    hexEl.addEventListener("input", () => {
      if (/^#[0-9A-Fa-f]{6}$/.test(hexEl.value)) {
        swatch.style.background = hexEl.value;
        if (colEl) colEl.value = hexEl.value;
      }
    });
    if (colEl) {
      colEl.addEventListener("input", () => {
        hexEl.value = colEl.value.toUpperCase();
        swatch.style.background = colEl.value;
      });
    }
  }
  wireColorTrio("src-swatch", "src-hex", null);
  wireColorTrio("start-swatch", "start-hex", "start-color");
  wireColorTrio("end-swatch", "end-hex", "end-color");

  // ── Tolerance slider live label ───────────────────────────────────────────
  const tolEl = el.querySelector("#tolerance");
  const tolValEl = el.querySelector("#tolerance-val");
  tolEl.addEventListener("input", () => { tolValEl.textContent = tolEl.value; });

  // ── Canvas state ──────────────────────────────────────────────────────────
  const displayCanvas = el.querySelector("#preview-canvas");
  const dctx = displayCanvas.getContext("2d");
  const sourceCanvas = document.createElement("canvas");
  const sctx = sourceCanvas.getContext("2d");
  let originalImageData = null;
  let currentSampleName = "";
  let loadGeneration = 0;

  const MAX_PREVIEW_W = 720;
  const MAX_PREVIEW_H = 405;

  async function loadSample(name) {
    const gen = ++loadGeneration;
    currentSampleName = name;
    const infoEl = el.querySelector("#preview-info");
    if (!name) {
      originalImageData = null;
      dctx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
      infoEl.textContent = "Chọn folder để xem preview";
      return;
    }
    const folder = el.querySelector("#input-dir").value.trim();
    const fullPath = `${folder}\\${name}`;
    const dataUrl = await window.api.fs.readImageDataUrl(fullPath);
    if (gen !== loadGeneration) return;
    if (!dataUrl) {
      originalImageData = null;
      infoEl.textContent = `Không đọc được ${name}`;
      return;
    }
    const img = new Image();
    try {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("Image decode failed"));
        img.src = dataUrl;
      });
    } catch (err) {
      if (gen !== loadGeneration) return;
      originalImageData = null;
      infoEl.textContent = `Lỗi đọc ảnh: ${name} (${err.message})`;
      return;
    }
    if (gen !== loadGeneration) return;
    sourceCanvas.width = img.naturalWidth;
    sourceCanvas.height = img.naturalHeight;
    sctx.drawImage(img, 0, 0);
    originalImageData = sctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);

    const scale = Math.min(1, MAX_PREVIEW_W / sourceCanvas.width, MAX_PREVIEW_H / sourceCanvas.height);
    displayCanvas.width = Math.round(sourceCanvas.width * scale);
    displayCanvas.height = Math.round(sourceCanvas.height * scale);
    drawPreview();
    infoEl.textContent = `Đang xem: ${name} (${sourceCanvas.width}×${sourceCanvas.height})`;
  }

  async function refreshSamples() {
    const folder = el.querySelector("#input-dir").value.trim();
    const names = folder ? await window.api.fs.listImages(folder) : [];
    const select = el.querySelector("#sample-select");
    select.innerHTML = names.length === 0
      ? `<option value="">(folder rỗng)</option>`
      : names.map((n) => `<option value="${escapeAttr(n)}">${escapeAttr(n)}</option>`).join("");
    await loadSample(names[0] ?? "");
  }

  el.querySelector("#sample-select").addEventListener("change", (e) => loadSample(e.target.value));
  el.querySelector("#sample-random").addEventListener("click", () => {
    const select = el.querySelector("#sample-select");
    if (select.options.length === 0 || !select.options[0].value) return;
    const idx = Math.floor(Math.random() * select.options.length);
    select.selectedIndex = idx;
    loadSample(select.value);
  });

  // ── Eyedropper ────────────────────────────────────────────────────────────
  let eyedropperActive = false;
  const eyedropperBtn = el.querySelector("#eyedropper");

  function setEyedropper(active) {
    eyedropperActive = active;
    displayCanvas.style.cursor = active ? "crosshair" : "";
    eyedropperBtn.classList.toggle("active", active);
  }

  eyedropperBtn.addEventListener("click", () => setEyedropper(!eyedropperActive));

  displayCanvas.addEventListener("click", (e) => {
    if (!eyedropperActive || !originalImageData) return;
    const rect = displayCanvas.getBoundingClientRect();
    const dispX = (e.clientX - rect.left) * (displayCanvas.width / rect.width);
    const dispY = (e.clientY - rect.top) * (displayCanvas.height / rect.height);
    const srcX = Math.floor(dispX * (sourceCanvas.width / displayCanvas.width));
    const srcY = Math.floor(dispY * (sourceCanvas.height / displayCanvas.height));
    const idx = (srcY * sourceCanvas.width + srcX) * 4;
    const r = originalImageData.data[idx];
    const g = originalImageData.data[idx + 1];
    const b = originalImageData.data[idx + 2];
    const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0").toUpperCase()).join("")}`;
    el.querySelector("#src-hex").value = hex;
    el.querySelector("#src-swatch").style.background = hex;
    setEyedropper(false);
    schedulePreview();
  });

  const onKeydown = (e) => {
    if (e.key === "Escape" && eyedropperActive) setEyedropper(false);
  };
  document.addEventListener("keydown", onKeydown);
  const obs = new MutationObserver(() => {
    if (!document.body.contains(el)) {
      document.removeEventListener("keydown", onKeydown);
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  // ── Live preview with debounce ────────────────────────────────────────────
  function getViewMode() {
    return el.querySelector('input[name="view"]:checked')?.value || "processed";
  }

  function readParams() {
    return {
      sourceColor:       hexToRgb(el.querySelector("#src-hex").value),
      tolerance:         Number(el.querySelector("#tolerance").value),
      gradientStart:     hexToRgb(el.querySelector("#start-hex").value),
      gradientEnd:       hexToRgb(el.querySelector("#end-hex").value),
      gradientDirection: el.querySelector('input[name="dir"]:checked')?.value || "vertical",
    };
  }

  function drawPreview() {
    if (!originalImageData) return;
    if (getViewMode() === "original") {
      sctx.putImageData(originalImageData, 0, 0);
      dctx.drawImage(sourceCanvas, 0, 0, displayCanvas.width, displayCanvas.height);
      return;
    }
    let params;
    try { params = readParams(); }
    catch { dctx.drawImage(sourceCanvas, 0, 0, displayCanvas.width, displayCanvas.height); return; }
    const processed = new ImageData(
      new Uint8ClampedArray(originalImageData.data),
      originalImageData.width, originalImageData.height,
    );
    recolorPixels(processed.data, processed.width, processed.height, params);
    sctx.putImageData(processed, 0, 0);
    dctx.drawImage(sourceCanvas, 0, 0, displayCanvas.width, displayCanvas.height);
  }

  let previewTimer = null;
  function schedulePreview() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => { previewTimer = null; drawPreview(); }, 200);
  }

  for (const id of ["src-hex", "tolerance", "start-hex", "end-hex", "start-color", "end-color"]) {
    el.querySelector(`#${id}`).addEventListener("input", schedulePreview);
  }
  el.querySelectorAll('input[name="dir"]').forEach((r) => r.addEventListener("change", schedulePreview));
  el.querySelectorAll('input[name="view"]').forEach((r) => r.addEventListener("change", () => drawPreview()));

  // ── Reset ─────────────────────────────────────────────────────────────────
  el.querySelector("#reset-params").addEventListener("click", () => {
    el.querySelector("#src-hex").value = DEFAULTS.sourceColor;
    el.querySelector("#src-swatch").style.background = DEFAULTS.sourceColor;
    el.querySelector("#tolerance").value = DEFAULTS.tolerance;
    el.querySelector("#tolerance-val").textContent = DEFAULTS.tolerance;
    el.querySelector("#start-hex").value = DEFAULTS.gradientStart;
    el.querySelector("#start-swatch").style.background = DEFAULTS.gradientStart;
    el.querySelector("#start-color").value = DEFAULTS.gradientStart;
    el.querySelector("#end-hex").value = DEFAULTS.gradientEnd;
    el.querySelector("#end-swatch").style.background = DEFAULTS.gradientEnd;
    el.querySelector("#end-color").value = DEFAULTS.gradientEnd;
    el.querySelector(`input[name="dir"][value="${DEFAULTS.gradientDirection}"]`).checked = true;
    schedulePreview();
  });

  // ── Submit ────────────────────────────────────────────────────────────────
  el.querySelector("#task-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const inputDir = el.querySelector("#input-dir").value.trim();
    const output = el.querySelector("#output").value.trim();
    const sourceColor = el.querySelector("#src-hex").value.trim();
    const tolerance = Number(el.querySelector("#tolerance").value);
    const gradientStart = el.querySelector("#start-hex").value.trim();
    const gradientEnd = el.querySelector("#end-hex").value.trim();
    const gradientDirection = el.querySelector('input[name="dir"]:checked')?.value;
    if (!inputDir || !output) return;

    const config = { inputDir, output, sourceColor, tolerance, gradientStart, gradientEnd, gradientDirection };
    await window.api.queue.add({ type: "recolorThumb", config });
    await window.api.settings.set({
      "lastConfig.recolorThumb": { inputDir, output },
      "recolor.last": { sourceColor, tolerance, gradientStart, gradientEnd, gradientDirection },
    });
    toast({ kind: "success", message: "✅ Đã thêm vào hàng đợi" });
  });

  // ── Final: load initial samples now that canvas state is initialized ──────
  await refreshSamples();
}

function escapeAttr(s) {
  return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}
