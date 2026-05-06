const NAV_ITEMS = [
  { group: "Tasks", items: [
    { id: "render",  icon: "🎬", label: "Render Video" },
    { id: "snow",    icon: "❄️", label: "Tạo video từ ảnh" },
    { id: "trim",    icon: "✂️", label: "Cắt video 30s" },
    { id: "cutBg",   icon: "🎞️", label: "Cắt video background" },
    { id: "thumb",   icon: "🖼️", label: "Tạo ảnh thu nhỏ" },
    { id: "concat",  icon: "🔗", label: "Ghép video + thumbnail" },
    { id: "rename",  icon: "✏️", label: "Sửa tên thu nhỏ" },
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
    `).join("");

  el.addEventListener("click", (e) => {
    const item = e.target.closest(".nav-item");
    if (item) onNavigate(item.dataset.screen);
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
