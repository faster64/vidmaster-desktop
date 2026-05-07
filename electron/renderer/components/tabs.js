/**
 * Mount a horizontal tab strip with a body container.
 *
 * @param {HTMLElement} mountEl
 * @param {Array<{id:string,label:string,render:(bodyEl:HTMLElement)=>void|Promise<void>}>} tabs
 * @param {{activeId?:string,onChange?:(id:string)=>void}} opts
 * @returns {{ activate(id:string): void }}
 */
export function mountTabs(mountEl, tabs, opts = {}) {
  let activeId = opts.activeId && tabs.some((t) => t.id === opts.activeId)
    ? opts.activeId
    : tabs[0]?.id;

  mountEl.innerHTML = `
    <div class="tabs-strip" style="display:flex;gap:4px;border-bottom:1px solid #ccc;margin-bottom:16px;flex-wrap:wrap"></div>
    <div class="tabs-body"></div>
  `;
  const stripEl = mountEl.querySelector(".tabs-strip");
  const bodyEl = mountEl.querySelector(".tabs-body");

  for (const t of tabs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tab-btn";
    btn.dataset.tabId = t.id;
    btn.textContent = t.label;
    btn.style.cssText = "padding:6px 12px;border:none;background:transparent;cursor:pointer;border-bottom:2px solid transparent";
    stripEl.appendChild(btn);
  }

  function activate(id) {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    activeId = id;
    for (const btn of stripEl.querySelectorAll(".tab-btn")) {
      const isActive = btn.dataset.tabId === id;
      btn.style.borderBottomColor = isActive ? "#3b82f6" : "transparent";
      btn.style.fontWeight = isActive ? "600" : "400";
    }
    bodyEl.innerHTML = "";
    Promise.resolve(tab.render(bodyEl)).catch((err) => {
      bodyEl.innerHTML = `<div style="color:red">Lỗi render tab: ${escape(err.message)}</div>`;
    });
    opts.onChange?.(id);
  }

  stripEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (btn) activate(btn.dataset.tabId);
  });

  activate(activeId);
  return { activate };
}

function escape(s) {
  return String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}
