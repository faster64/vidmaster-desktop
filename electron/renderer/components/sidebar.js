const NAV_ITEMS = [
  {
    group: "Tasks", items: [
      { id: "render", icon: "🤩", label: "Render Video" },
      { id: "cutBg", icon: "😋", label: "Chia nhỏ video nền" },
      { id: "trimEnds", icon: "😘", label: "Cắt đầu/cuối" },
      { id: "concatHeadTail", icon: "😍", label: "Nối đầu/cuối" },
      { id: "thumbAvatar", icon: "😂", label: "Gắn avatar vào thumbnail" },
      { id: "recolorThumb", icon: "🎨", label: "Đổi màu thumbnail" },
      { id: "elderlyVideo", icon: "🧓", label: "Video nền người già" },
      { id: "elderlyRender", icon: "🎬", label: "Render video người già" },
      { id: "trendSearch", icon: "🔍", label: "Tìm trend" },
      { id: "getUrls", icon: "😅", label: "Lấy link kênh" },
      { id: "download", icon: "🤣", label: "Tải video" },
    ]
  },
  {
    group: "Hệ thống", items: [
      { id: "queue", icon: "📋", label: "Hàng đợi" },
      { id: "settings", icon: "⚙️", label: "Cài đặt" },
    ]
  },
];

export async function mountSidebar(el, onNavigate) {
  await renderSidebar(el, onNavigate);
}

async function renderSidebar(el, onNavigate) {
  const workspaces = await window.api.workspace.list();
  const active = await window.api.workspace.getActive();
  const activeName = (active?.identifier || "").trim() || (active?.path?.split(/[\\/]/).pop() ?? "(no workspace)");

  el.innerHTML = `
    <div class="sidebar-title">VidMaster</div>
    <div class="ws-switcher">
      <button class="ws-current" id="ws-current">
        <span class="ws-name">🏷️ ${escape(activeName)}</span>
        <span class="ws-arrow">▾</span>
      </button>
      <div class="ws-menu" id="ws-menu" style="display:none">
        ${workspaces.map((w) => `
          <div class="ws-item ${w.id === active?.id ? "active" : ""}" data-id="${w.id}">
            ${w.id === active?.id ? "✓ " : ""}${escape((w.identifier || "").trim() || (w.path.split(/[\\/]/).pop() || w.path))}
            <div class="ws-path">${escape(w.path)}</div>
          </div>`).join("")}
        <div class="ws-divider"></div>
        <div class="ws-item ws-add" id="ws-add">＋ Thêm workspace…</div>
        <div class="ws-item ws-manage" id="ws-manage">⚙ Quản lý…</div>
      </div>
    </div>
  ` +
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

  // Sidebar nav clicks (already wired). Re-bind every render is fine since innerHTML replace clears listeners.
  el.addEventListener("click", (e) => {
    const navItem = e.target.closest(".nav-item");
    if (navItem) { onNavigate(navItem.dataset.screen); return; }
  });

  // Workspace dropdown
  const menu = el.querySelector("#ws-menu");
  el.querySelector("#ws-current")?.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.style.display = menu.style.display === "none" ? "" : "none";
  });

  document.addEventListener("click", () => { if (menu) menu.style.display = "none"; }, { once: true });

  el.querySelectorAll(".ws-item[data-id]").forEach((row) => {
    row.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = row.dataset.id;
      if (id === active?.id) { menu.style.display = "none"; return; }
      await window.api.workspace.setActive(id);
      location.reload();
    });
  });

  el.querySelector("#ws-add")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    menu.style.display = "none";
    await addWorkspaceFlow();
  });

  el.querySelector("#ws-manage")?.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.style.display = "none";
    onNavigate("settings");
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

async function addWorkspaceFlow() {
  const path = await window.api.dialog.pickFolder();
  if (!path) return;
  const { showPromptModal } = await import("./modal.js");
  const identifier = await showPromptModal({
    title: "Workspace mới",
    label: `Mã định danh cho workspace tại:\n${path}`,
    placeholder: "vd: Channel-A",
  });
  if (!identifier) return;
  try {
    await window.api.app.ensureWorkspace(path);
    const ws = await window.api.workspace.create({ path, identifier });
    await window.api.workspace.setActive(ws.id);
    await window.api.app.trackingPing();
    location.reload();
  } catch (err) {
    alert(`Lỗi: ${err.message}`);
  }
}

function escape(s) {
  return String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}
