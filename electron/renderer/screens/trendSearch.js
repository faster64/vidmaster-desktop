// electron/renderer/screens/trendSearch.js
import { runWithFeedback } from "../components/buttonFeedback.js";

export async function renderTrendSearch(el) {
  const s = await window.api.settings.get();
  const ws = await window.api.app.getWorkspace();
  const cfg = s.trendSearch || {};

  el.innerHTML = `
    <div class="screen-header">🔍 Tìm trend</div>
    <p class="screen-subtitle">Nhập keyword (đa ngôn ngữ) để tìm video hot + kênh nổi bật.</p>
    <form id="trend-form">
      <div class="field">
        <label>Keyword</label>
        <input id="kw" type="text" required placeholder="vd: cat, công nghệ, K-pop">
      </div>
      <div class="row" style="display:flex;gap:12px;flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:140px">
          <label>Region</label>
          <select id="region">
            <option value="VN" ${cfg.regionCode === "VN" ? "selected" : ""}>Việt Nam</option>
            <option value="US" ${cfg.regionCode === "US" ? "selected" : ""}>United States</option>
            <option value="JP" ${cfg.regionCode === "JP" ? "selected" : ""}>Japan</option>
            <option value="KR" ${cfg.regionCode === "KR" ? "selected" : ""}>Korea</option>
            <option value="" ${!cfg.regionCode ? "selected" : ""}>(Toàn cầu)</option>
          </select>
        </div>
        <div class="field" style="flex:1;min-width:140px">
          <label>Language</label>
          <select id="lang">
            <option value="vi" ${cfg.relevanceLanguage === "vi" ? "selected" : ""}>vi</option>
            <option value="en" ${cfg.relevanceLanguage === "en" ? "selected" : ""}>en</option>
            <option value="ja" ${cfg.relevanceLanguage === "ja" ? "selected" : ""}>ja</option>
            <option value="ko" ${cfg.relevanceLanguage === "ko" ? "selected" : ""}>ko</option>
            <option value="" ${!cfg.relevanceLanguage ? "selected" : ""}>(Auto)</option>
          </select>
        </div>
        <div class="field" style="flex:1;min-width:120px">
          <label>Window (ngày)</label>
          <input id="window" type="number" min="1" max="365" value="${cfg.timeWindowDays ?? 7}">
        </div>
        <div class="field" style="flex:1;min-width:120px">
          <label>Min views</label>
          <input id="minViews" type="number" min="0" value="${cfg.minViews ?? 1000}">
        </div>
        <div class="field" style="flex:1;min-width:140px">
          <label>Sort by</label>
          <select id="sortBy">
            <option value="velocity" ${cfg.sortBy === "velocity" ? "selected" : ""}>Views/ngày</option>
            <option value="totalViews" ${cfg.sortBy === "totalViews" ? "selected" : ""}>Tổng views</option>
            <option value="date" ${cfg.sortBy === "date" ? "selected" : ""}>Mới nhất</option>
          </select>
        </div>
        <div class="field" style="flex:1;min-width:120px">
          <label>Analyze top N</label>
          <input id="topN" type="number" min="0" max="50" value="${cfg.analyzeTopN ?? 10}">
        </div>
      </div>
      <button type="submit" class="primary">▶ Thêm vào hàng đợi</button>
    </form>
    <div id="trend-banner" style="margin-top:12px"></div>
    <div id="trend-result" style="margin-top:24px"></div>
  `;

  if (!s.youtube?.apiKey) {
    el.querySelector("#trend-banner").innerHTML =
      `<div class="banner banner-warn">Thiếu YouTube API key. <a href="#settings">Mở Settings</a></div>`;
  }
  if (!s.gemini?.apiKeys?.length) {
    el.querySelector("#trend-banner").innerHTML +=
      `<div class="banner banner-info">Chưa có Gemini API key — sẽ bỏ qua phân tích AI. <a href="#settings">Thêm key</a></div>`;
  }

  el.querySelector("#trend-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const keyword = el.querySelector("#kw").value.trim();
    if (!keyword) return;
    const config = {
      keyword,
      regionCode: el.querySelector("#region").value,
      relevanceLanguage: el.querySelector("#lang").value,
      timeWindowDays: parseInt(el.querySelector("#window").value, 10) || 7,
      minViews: parseInt(el.querySelector("#minViews").value, 10) || 0,
      sortBy: el.querySelector("#sortBy").value,
      analyzeTopN: parseInt(el.querySelector("#topN").value, 10) || 0,
      apiKey: s.youtube?.apiKey || "",
      geminiKeys: s.gemini?.apiKeys || [],
    };
    const submitBtn = el.querySelector('button[type="submit"]');
    await runWithFeedback(submitBtn, async () => {
      await window.api.queue.add({ type: "trendSearch", config });
      await window.api.settings.set({
        "trendSearch": {
          regionCode: config.regionCode,
          relevanceLanguage: config.relevanceLanguage,
          timeWindowDays: config.timeWindowDays,
          minViews: config.minViews,
          sortBy: config.sortBy,
          analyzeTopN: config.analyzeTopN,
        },
      });
    });
  });

  const unsub = window.api.queue.onUpdate((state) => {
    if (el.dataset.screen !== "trendSearch") { unsub?.(); return; }
    const last = state.completed.find((j) => j.type === "trendSearch" && j.status === "done");
    if (!last) return;
    const viewer = el.querySelector("#trend-result");
    if (!viewer || viewer.dataset.jobId === last.id) return;
    viewer.dataset.jobId = last.id;
    renderResults(viewer, last.result, ws);
  });
}

function renderResults(el, result, workspace) {
  const { videos = [], channels = [] } = result || {};
  el.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <h3 style="margin:0">Kết quả</h3>
      <button id="dl-selected" class="primary" disabled>⬇ Tải về đã chọn (0)</button>
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">
      <div>
        <h4>Videos (${videos.length})</h4>
        <div id="videos">${videos.map((v, i) => videoCard(v, i)).join("")}</div>
      </div>
      <div>
        <h4>Channels (${channels.length})</h4>
        <div id="channels">${channels.map((c) => channelCard(c)).join("")}</div>
      </div>
    </div>
  `;

  const selected = new Set();
  const dlBtn = el.querySelector("#dl-selected");
  el.querySelectorAll(".vc-check").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) selected.add(id); else selected.delete(id);
      dlBtn.disabled = selected.size === 0;
      dlBtn.textContent = `⬇ Tải về đã chọn (${selected.size})`;
    });
  });

  dlBtn.addEventListener("click", () => pushToDownload([...selected], workspace));

  el.querySelectorAll(".ch-getUrls").forEach((b) => {
    b.addEventListener("click", async () => {
      const handle = b.dataset.handle;
      const prev = (await window.api.settings.get("lastConfig.getUrls")) || {};
      await window.api.settings.set({ "lastConfig.getUrls": { ...prev, handle } });
      window.location.hash = "getUrls";
    });
  });
}

function videoCard(v, i) {
  const ana = v.analysis;
  const why = ana && !ana.error ? `<div class="vc-why"><b>Vì sao hot:</b> ${escape(ana.reason)}<ul>${(ana.factors || []).map((f) => `<li>${escape(f)}</li>`).join("")}</ul></div>`
    : ana?.error ? `<div class="vc-why"><i>Phân tích lỗi: ${escape(ana.error)}</i></div>` : "";
  return `<div class="vc-card" style="display:flex;gap:8px;padding:8px;border-bottom:1px solid #eee">
    <input type="checkbox" class="vc-check" data-id="${escapeAttr(v.id)}">
    <img src="${escapeAttr(v.thumbnailUrl)}" style="width:120px;height:auto" loading="lazy">
    <div style="flex:1;min-width:0">
      <div><a href="https://www.youtube.com/watch?v=${escapeAttr(v.id)}" target="_blank">${escape(v.title)}</a></div>
      <div style="color:#666;font-size:12px">${escape(v.channelTitle)} · ${v.velocity.toLocaleString()}/ngày · ${v.viewCount.toLocaleString()} views · ${formatAge(v.publishedAt)}</div>
      ${why}
    </div>
  </div>`;
}

function channelCard(c) {
  return `<div class="ch-card" style="display:flex;gap:8px;padding:8px;border-bottom:1px solid #eee">
    <img src="${escapeAttr(c.thumbnailUrl)}" style="width:48px;height:48px;border-radius:50%" loading="lazy">
    <div style="flex:1;min-width:0">
      <div><b>${escape(c.title)}</b></div>
      <div style="color:#666;font-size:12px">${c.subscriberCount.toLocaleString()} subs · ${c.matchedVideoIds.length} video</div>
      <button class="ch-getUrls" data-handle="${escapeAttr(c.title)}">📥 Get all uploads</button>
    </div>
  </div>`;
}

async function pushToDownload(videoIds, workspace) {
  if (!workspace) { alert("Chưa có workspace."); return; }
  const urls = videoIds.map((id) => `https://www.youtube.com/watch?v=${id}`).join("\n") + "\n";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = await window.api.fs.writeTrendUrls({ workspace, stamp, content: urls });
  if (!dir) { alert("Không ghi được file URLs."); return; }
  const s = await window.api.settings.get();
  const ytdlpPath = s.download?.ytdlpPath;
  await window.api.queue.add({
    type: "download",
    config: {
      urlsFile: dir.urlsFile,
      output: dir.output,
      ytdlpPath,
      maxConcurrent: s.download?.maxConcurrent ?? 3,
    },
  });
  window.location.hash = "queue";
}

function formatAge(iso) {
  const days = Math.max(1, Math.floor((Date.now() - Date.parse(iso)) / (24 * 60 * 60 * 1000)));
  return `${days} ngày trước`;
}

function escape(s) {
  return String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}
function escapeAttr(s) {
  return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}
