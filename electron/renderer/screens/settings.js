export async function renderSettings(el) {
  const s = await window.api.settings.get();
  const version = await window.api.app.getVersion();

  el.innerHTML = `
    <div class="screen-header">⚙️ Cài đặt</div>
    <p class="screen-subtitle">Cấu hình mặc định cho mọi task. Có thể override per-task khi cần.</p>

    <div class="field">
      <label>Workspace</label>
      <div class="field-row">
        <input id="ws" type="text" readonly value="${s.workspace || ""}">
        <button id="ws-pick">📂 Đổi…</button>
      </div>
      <div class="help">Nơi chứa các thư mục input/output mặc định.</div>
    </div>

    <h3>FFmpeg</h3>
    <div class="field">
      <label>Encoder</label>
      <select id="encoder">
        ${["auto","libx264","h264_nvenc","h264_qsv","h264_amf"].map((v) =>
          `<option value="${v}" ${v === s.ffmpeg.encoder ? "selected" : ""}>${v}</option>`).join("")}
      </select>
    </div>
    <div class="field">
      <label>Số luồng tối đa</label>
      <input id="maxConcurrent" type="number" min="1" value="${s.ffmpeg.maxConcurrent}">
    </div>

    <h3>Render defaults</h3>
    <div class="field"><label><input id="useGPU" type="checkbox" ${s.render.useGPU ? "checked" : ""}> Dùng GPU mặc định</label></div>
    <div class="field"><label>ChromaKey color</label><input id="chromaColor" type="text" value="${s.render.chromaKey.color}"></div>
    <div class="field"><label>Opacity (0–1)</label><input id="opacity" type="number" step="0.05" min="0" max="1" value="${s.render.opacity}"></div>
    <div class="field"><label>Crop height</label><input id="cropHeight" type="number" min="1" value="${s.render.crop.height}"></div>
    <div class="field"><label>Crop yOffset</label><input id="cropYOffset" type="number" min="0" value="${s.render.crop.yOffset}"></div>

    <h3>Log</h3>
    <div class="field">
      <label>Mức log</label>
      <select id="logLevel">
        ${["error","warn","info","debug"].map((v) =>
          `<option value="${v}" ${v === s.ui.logLevel ? "selected" : ""}>${v}</option>`).join("")}
      </select>
    </div>
    <button id="open-log">Mở file log</button>

    <h3 style="margin-top:32px">About</h3>
    <p>Version: <strong>${version}</strong></p>
    <button id="reset" class="danger">Reset tất cả về mặc định</button>
  `;

  el.querySelector("#ws-pick").addEventListener("click", async () => {
    const p = await window.api.dialog.pickFolder(s.workspace);
    if (p) {
      await window.api.app.ensureWorkspace(p);
      await window.api.settings.set({ workspace: p });
      el.querySelector("#ws").value = p;
    }
  });
  el.querySelector("#encoder").addEventListener("change", (e) =>
    window.api.settings.set({ "ffmpeg.encoder": e.target.value }));
  el.querySelector("#maxConcurrent").addEventListener("change", (e) =>
    window.api.settings.set({ "ffmpeg.maxConcurrent": parseInt(e.target.value, 10) }));
  el.querySelector("#useGPU").addEventListener("change", (e) =>
    window.api.settings.set({ "render.useGPU": e.target.checked }));
  el.querySelector("#chromaColor").addEventListener("change", (e) =>
    window.api.settings.set({ "render.chromaKey.color": e.target.value }));
  el.querySelector("#opacity").addEventListener("change", (e) =>
    window.api.settings.set({ "render.opacity": parseFloat(e.target.value) }));
  el.querySelector("#cropHeight").addEventListener("change", (e) =>
    window.api.settings.set({ "render.crop.height": parseInt(e.target.value, 10) }));
  el.querySelector("#cropYOffset").addEventListener("change", (e) =>
    window.api.settings.set({ "render.crop.yOffset": parseInt(e.target.value, 10) }));
  el.querySelector("#logLevel").addEventListener("change", (e) =>
    window.api.settings.set({ "ui.logLevel": e.target.value }));
  el.querySelector("#open-log").addEventListener("click", () => window.api.shell.openLogFile());
  el.querySelector("#reset").addEventListener("click", async () => {
    if (confirm("Reset toàn bộ cài đặt về mặc định? (Workspace path sẽ giữ nguyên)")) {
      const ws = (await window.api.settings.get("workspace")) || "";
      await window.api.settings.set({
        ffmpeg: { encoder: "auto", maxConcurrent: 2 },
        render: {
          useGPU: false, chromaKey: { color: "#D4F9D7", similarity: 0.2 },
          opacity: 0.7, crop: { height: 220, yOffset: 490 },
          keepColor: { enabled: false, list: ["#FBFF02"] },
        },
        ui: { theme: "light", logLevel: "info", completedHistorySize: 50 },
        workspace: ws,
      });
      renderSettings(el);
    }
  });
}
