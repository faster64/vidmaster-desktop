const NAV_ITEMS = [
  { group: "Tasks", items: [
    { id: "render",   icon: "🎬", label: "Render Video" },
    { id: "cutBg",    icon: "🎞️", label: "Chia nhỏ video nền" },
    { id: "trimEnds", icon: "😘", label: "Cắt đầu/cuối" },
    { id: "concatHeadTail", icon: "😍", label: "Nối đầu/cuối" },
    { id: "getUrls",  icon: "🔗", label: "Lấy link kênh" },
    { id: "download", icon: "⬇️", label: "Tải video" },
    { id: "thumbAvatar", icon: "🪪", label: "Gắn avatar vào thumbnail" },
  ]},
  { group: "Hệ thống", items: [
    { id: "queue",    icon: "📋", label: "Hàng đợi" },
    { id: "settings", icon: "⚙️", label: "Cài đặt" },
  ]},
];

export function mountSidebar(el, onNavigate) {
  el.innerHTML = `<div class="sidebar-title">VidMaster</div>` +
    NAV_ITEMS.map((g) => `
      <div class="sidebar-section-label">${g.group}</div>
      ${g.items.map((it) => `
        <div class="nav-item" data-screen="${it.id}">
          <span class="icon">${it.icon}</span>${it.label}
          ${it.id === "queue" ? `<span class="badge" id="queue-badge" style="display:none">0</span>` : ""}
        </div>`).join("")}
    `).join("") +
    `<div class="sidebar-footer">
       <button id="open-workspace" class="sidebar-action" title="Mở folder workspace">📂 Mở workspace</button>
     </div>`;

  el.addEventListener("click", (e) => {
    const item = e.target.closest(".nav-item");
    if (item) onNavigate(item.dataset.screen);
  });

  el.querySelector("#open-workspace")?.addEventListener("click", async () => {
    const ws = await window.api.app.getWorkspace();
    if (ws) await window.api.shell.openFolder(ws);
  });

  window.api.queue.onUpdate((s) => {
    const count = (s.running ? 1 : 0) + s.pending.length;
    const badge = document.getElementById("queue-badge");
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? "" : "none";
    }
  });
}
