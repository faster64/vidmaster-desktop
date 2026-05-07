import { mountTabs } from "../components/tabs.js";

export async function renderSettings(el) {
  const s = await window.api.settings.get();
  const version = await window.api.app.getVersion();

  el.innerHTML = `
    <div class="screen-header">⚙️ Cài đặt</div>
    <p class="screen-subtitle">Cấu hình mặc định cho mọi task. Có thể override per-task khi cần.</p>
    <div id="settings-tabs"></div>
  `;

  const mountEl = el.querySelector("#settings-tabs");
  const initialTab = s.ui?.lastSettingsTab ?? "workspace";

  mountTabs(mountEl, [
    { id: "workspace", label: "Workspace", render: (b) => renderWorkspaceTab(b, s) },
    { id: "ffmpeg",    label: "FFmpeg",    render: (b) => renderFfmpegTab(b, s) },
    { id: "render",    label: "Render",    render: (b) => renderRenderTab(b, s) },
    { id: "youtube",   label: "YouTube",   render: (b) => renderYoutubeTab(b, s) },
    { id: "download",  label: "Download",  render: (b) => renderDownloadTab(b, s) },
    { id: "telegram",  label: "Telegram",  render: (b) => renderTelegramTab(b, s) },
    { id: "avatar",    label: "Avatar",    render: (b) => renderAvatarTab(b, s) },
    { id: "log",       label: "Log",       render: (b) => renderLogTab(b, s) },
    { id: "about",     label: "About",     render: (b) => renderAboutTab(b, s, version, () => renderSettings(el)) },
  ], {
    activeId: initialTab,
    onChange: (id) => { window.api.settings.set({ "ui.lastSettingsTab": id }); },
  });
}

function renderWorkspaceTab(el, s) {
  el.innerHTML = `
    <div class="field">
      <label>Workspace</label>
      <div class="field-row">
        <input id="ws" type="text" readonly value="${escapeAttr(s.workspace || "")}">
        <button id="ws-pick">📂 Đổi…</button>
      </div>
      <div class="help">Nơi chứa các thư mục input/output mặc định.</div>
    </div>
    <div class="field">
      <label>🏷️ Mã định danh</label>
      <input id="identifier" type="text" value="${escapeAttr(s.tracking?.identifier ?? "")}">
      <div class="help">Hiện trong tin nhắn Telegram để phân biệt máy / channel. Để trống = fallback theo tên workspace.</div>
    </div>
  `;
  el.querySelector("#ws-pick").addEventListener("click", async () => {
    const p = await window.api.dialog.pickFolder(s.workspace);
    if (p) {
      await window.api.app.ensureWorkspace(p);
      await window.api.settings.set({ workspace: p });
      el.querySelector("#ws").value = p;
    }
  });
  el.querySelector("#identifier").addEventListener("change", (e) =>
    window.api.settings.set({ "tracking.identifier": e.target.value.trim() }));
}

function renderFfmpegTab(el, s) {
  el.innerHTML = `
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
  `;
  el.querySelector("#encoder").addEventListener("change", (e) =>
    window.api.settings.set({ "ffmpeg.encoder": e.target.value }));
  el.querySelector("#maxConcurrent").addEventListener("change", (e) =>
    window.api.settings.set({ "ffmpeg.maxConcurrent": parseInt(e.target.value, 10) }));
}

function renderRenderTab(el, s) {
  el.innerHTML = `
    <div class="field"><label><input id="useGPU" type="checkbox" ${s.render.useGPU ? "checked" : ""}> Dùng GPU mặc định</label></div>
    <div class="field"><label>ChromaKey color</label><input id="chromaColor" type="text" value="${escapeAttr(s.render.chromaKey.color)}"></div>
    <div class="field"><label>Opacity (0–1)</label><input id="opacity" type="number" step="0.05" min="0" max="1" value="${s.render.opacity}"></div>
    <div class="field"><label>Crop height</label><input id="cropHeight" type="number" min="1" value="${s.render.crop.height}"></div>
    <div class="field"><label>Crop yOffset</label><input id="cropYOffset" type="number" min="0" value="${s.render.crop.yOffset}"></div>
  `;
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
}

function renderYoutubeTab(el, s) {
  el.innerHTML = `
    <div class="field">
      <label>API key</label>
      <div class="field-row">
        <input id="yt-key" type="password" value="${escapeAttr(s.youtube.apiKey)}">
        <button type="button" id="yt-key-show">👁</button>
      </div>
      <div class="help">Default từ project tham chiếu. Tạo key riêng tại console.cloud.google.com nếu hết quota.</div>
    </div>
    <div class="field">
      <label>Min duration (phút)</label>
      <input id="yt-min" type="number" min="0" value="${s.youtube.minDurationMinutes}">
    </div>
    <div class="field">
      <label>Sort order</label>
      <select id="yt-sort">
        ${["LATEST","VIEW","MIX"].map((v) =>
          `<option value="${v}" ${v === s.youtube.sortOrder ? "selected" : ""}>${v}</option>`).join("")}
      </select>
    </div>
  `;
  el.querySelector("#yt-key").addEventListener("change", (e) =>
    window.api.settings.set({ "youtube.apiKey": e.target.value }));
  el.querySelector("#yt-min").addEventListener("change", (e) =>
    window.api.settings.set({ "youtube.minDurationMinutes": parseInt(e.target.value, 10) }));
  el.querySelector("#yt-sort").addEventListener("change", (e) =>
    window.api.settings.set({ "youtube.sortOrder": e.target.value }));
  el.querySelector("#yt-key-show").addEventListener("click", () => {
    const i = el.querySelector("#yt-key");
    i.type = i.type === "password" ? "text" : "password";
  });
}

function renderDownloadTab(el, s) {
  el.innerHTML = `
    <div class="field">
      <label>yt-dlp path</label>
      <div class="field-row">
        <input id="yt-path" type="text" value="${escapeAttr(s.download.ytdlpPath)}">
        <button type="button" id="yt-path-pick">📂 Đổi…</button>
      </div>
    </div>
    <div class="field"><label><input id="yt-auto" type="checkbox" ${s.download.autoUpdateYtDlp ? "checked" : ""}> Tự cập nhật yt-dlp khi mở app</label></div>
    <div class="field">
      <label>Max parallel downloads <span id="dl-cc-val">${s.download.maxConcurrent}</span></label>
      <input id="dl-cc" type="range" min="1" max="5" value="${s.download.maxConcurrent}">
    </div>
    <div class="field">
      <label>yt-dlp status</label>
      <div id="yt-status" class="help">Đang kiểm tra...</div>
      <button type="button" id="yt-update">⬇️ Cập nhật ngay</button>
    </div>
  `;
  el.querySelector("#yt-path").addEventListener("change", (e) =>
    window.api.settings.set({ "download.ytdlpPath": e.target.value }));
  el.querySelector("#yt-auto").addEventListener("change", (e) =>
    window.api.settings.set({ "download.autoUpdateYtDlp": e.target.checked }));
  el.querySelector("#yt-path-pick").addEventListener("click", async () => {
    const p = await window.api.dialog.pickFile({
      filters: [{ name: "yt-dlp", extensions: ["exe"] }],
    });
    if (p) {
      el.querySelector("#yt-path").value = p;
      await window.api.settings.set({ "download.ytdlpPath": p });
      refreshYtdlpStatus();
    }
  });
  const ccSlider = el.querySelector("#dl-cc");
  ccSlider.addEventListener("input", () => {
    el.querySelector("#dl-cc-val").textContent = ccSlider.value;
    window.api.settings.set({ "download.maxConcurrent": parseInt(ccSlider.value, 10) });
  });
  el.querySelector("#yt-update").addEventListener("click", async () => {
    await window.api.ytdlp.update();
    setTimeout(refreshYtdlpStatus, 500);
  });
  async function refreshYtdlpStatus() {
    const st = await window.api.ytdlp.getStatus();
    const txt = st.exists
      ? `Đã cài (version ${st.version ?? "?"}, cập nhật ${st.lastModified ? new Date(st.lastModified).toLocaleString("vi-VN") : "?"})`
      : `Chưa cài tại ${st.path}`;
    const node = el.querySelector("#yt-status");
    if (node) node.textContent = txt;
  }
  refreshYtdlpStatus();
}

function renderTelegramTab(el, s) {
  el.innerHTML = `
    <div class="field">
      <label>Bot token</label>
      <div class="field-row">
        <input id="tg-token" type="password" value="${escapeAttr(s.telegram?.token ?? "")}">
        <button type="button" id="tg-token-show">👁</button>
      </div>
    </div>
    <div id="tg-secret" style="display:none">
      <div class="field">
        <label>Group ID</label>
        <input id="tg-group" type="number" value="${s.telegram?.groupId ?? ""}">
      </div>
      <div class="field">
        <label>Tracking chat ID</label>
        <input id="tg-tracking" type="number" value="${s.telegram?.trackingChatId ?? ""}">
      </div>
    </div>
    <div class="help">Nhấn Ctrl+Q để hiện/ẩn Group ID và Tracking chat ID.</div>
  `;
  el.querySelector("#tg-token").addEventListener("change", (e) =>
    window.api.settings.set({ "telegram.token": e.target.value }));
  el.querySelector("#tg-group").addEventListener("change", (e) =>
    window.api.settings.set({ "telegram.groupId": parseInt(e.target.value, 10) }));
  el.querySelector("#tg-tracking").addEventListener("change", (e) =>
    window.api.settings.set({ "telegram.trackingChatId": parseInt(e.target.value, 10) }));
  el.querySelector("#tg-token-show").addEventListener("click", () => {
    const i = el.querySelector("#tg-token");
    i.type = i.type === "password" ? "text" : "password";
  });

  const onKeydown = (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === "q") {
      e.preventDefault();
      const secret = el.querySelector("#tg-secret");
      if (secret) secret.style.display = secret.style.display === "none" ? "" : "none";
    }
  };
  document.addEventListener("keydown", onKeydown);
  const obs = new MutationObserver(() => {
    if (!document.body.contains(el)) {
      document.removeEventListener("keydown", onKeydown);
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

function renderAvatarTab(el, s) {
  el.innerHTML = `
    <div class="field">
      <label>Avatar size (px)</label>
      <input id="av-size" type="number" min="16" max="512" value="${s.avatar?.size ?? 80}">
    </div>
    <div class="field">
      <label>Margin từ mép (px)</label>
      <input id="av-margin" type="number" min="0" max="256" value="${s.avatar?.margin ?? 16}">
      <div class="help">Khoảng cách từ avatar đến mép thumbnail (chỉ áp dụng với 4 góc, không áp dụng vị trí giữa).</div>
    </div>
  `;
  el.querySelector("#av-size").addEventListener("change", (e) =>
    window.api.settings.set({ "avatar.size": parseInt(e.target.value, 10) }));
  el.querySelector("#av-margin").addEventListener("change", (e) =>
    window.api.settings.set({ "avatar.margin": parseInt(e.target.value, 10) }));
}

function renderLogTab(el, s) {
  el.innerHTML = `
    <div class="field">
      <label>Mức log</label>
      <select id="logLevel">
        ${["error","warn","info","debug"].map((v) =>
          `<option value="${v}" ${v === s.ui.logLevel ? "selected" : ""}>${v}</option>`).join("")}
      </select>
    </div>
    <button id="open-log">Mở file log</button>
  `;
  el.querySelector("#logLevel").addEventListener("change", (e) =>
    window.api.settings.set({ "ui.logLevel": e.target.value }));
  el.querySelector("#open-log").addEventListener("click", () => window.api.shell.openLogFile());
}

function renderAboutTab(el, s, version, rerender) {
  el.innerHTML = `
    <p>Version: <strong>${version}</strong></p>
    <button id="reset" class="danger">Reset settings về mặc định (giữ workspace + định danh)</button>
    <button id="reset-all" class="danger" style="margin-left:8px">🗑 Xoá toàn bộ dữ liệu — làm lại từ đầu</button>
    <div class="help" style="margin-top:6px">"Xoá toàn bộ" sẽ xoá settings + workspace + định danh + lastConfig. App sẽ reload và yêu cầu onboarding lại. Files trong folder workspace KHÔNG bị xoá.</div>
  `;
  el.querySelector("#reset").addEventListener("click", async () => {
    if (!confirm("Reset toàn bộ cài đặt về mặc định? (Workspace path sẽ giữ nguyên)")) return;
    const ws = (await window.api.settings.get("workspace")) || "";
    const ytdlpPath = (await window.api.settings.get("download.ytdlpPath")) || "";
    await window.api.settings.set({
      ffmpeg: { encoder: "auto", maxConcurrent: 2 },
      render: {
        useGPU: false, chromaKey: { color: "#D4F9D7", similarity: 0.2 },
        opacity: 0.7, crop: { height: 220, yOffset: 490 },
        keepColor: { enabled: false, list: ["#FBFF02"] },
      },
      youtube: {
        apiKey: "AIzaSyDZTsPGvG0u5du3t7YGueGgnNi7IiulMus",
        minDurationMinutes: 8,
        sortOrder: "VIEW",
      },
      download: { ytdlpPath, autoUpdateYtDlp: false, maxConcurrent: 3 },
      telegram: {
        token: "8001545106:AAGRfvKJx1Rq1WFENtjAbXe9eCOSEINVdK0",
        groupId: -5227711965,
        trackingChatId: 8335894661,
      },
      avatar: { size: 80, margin: 16, lastPosition: "bottom-right" },
      ui: { theme: "light", logLevel: "info", completedHistorySize: 50, lastSettingsTab: "about" },
      workspace: ws,
    });
    rerender();
  });
  el.querySelector("#reset-all").addEventListener("click", async () => {
    const confirmed = confirm(
      "Bạn chắc chắn muốn XOÁ TOÀN BỘ DỮ LIỆU?\n\n" +
      "- Settings, workspace path, định danh, lastConfig sẽ bị xoá.\n" +
      "- App sẽ reload và yêu cầu onboarding lại.\n" +
      "- Files trong folder workspace KHÔNG bị xoá.\n\n" +
      "Hành động này không thể hoàn tác."
    );
    if (!confirmed) return;
    await window.api.settings.resetAll();
    location.reload();
  });
}

function escapeAttr(s) {
  return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}
