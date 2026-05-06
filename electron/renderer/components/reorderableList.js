/**
 * Render an in-place reorderable, checkable list.
 * @param {HTMLElement} mountEl
 * @param {Array<{key:string,label:string,meta?:string,checked?:boolean}>} initialItems
 * @param {(items)=>void} onChange  fires after every reorder/check toggle
 * @returns {{ getItems(): Array }}
 */
export function mountReorderableList(mountEl, initialItems, onChange) {
  let items = initialItems.map((i) => ({ checked: true, ...i }));
  let dragKey = null;

  function render() {
    mountEl.innerHTML = items.map((it) => `
      <div class="rl-row" data-key="${escapeAttr(it.key)}" draggable="true" style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid #eee;cursor:move">
        <span class="rl-handle" style="user-select:none;color:#888">⋮⋮</span>
        <input type="checkbox" data-act="toggle" ${it.checked ? "checked" : ""}>
        <span style="flex:1">${escape(it.label)}</span>
        <span style="color:#888;font-size:12px">${escape(it.meta || "")}</span>
      </div>
    `).join("");
  }

  mountEl.addEventListener("change", (e) => {
    if (e.target.dataset.act === "toggle") {
      const row = e.target.closest(".rl-row");
      const k = row.dataset.key;
      const idx = items.findIndex((i) => i.key === k);
      if (idx >= 0) {
        items[idx].checked = e.target.checked;
        onChange?.(getItems());
      }
    }
  });

  mountEl.addEventListener("dragstart", (e) => {
    const row = e.target.closest(".rl-row");
    if (!row) return;
    dragKey = row.dataset.key;
    e.dataTransfer.effectAllowed = "move";
  });

  mountEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    const row = e.target.closest(".rl-row");
    if (!row || row.dataset.key === dragKey) return;
    const dropKey = row.dataset.key;
    const from = items.findIndex((i) => i.key === dragKey);
    const to = items.findIndex((i) => i.key === dropKey);
    if (from < 0 || to < 0) return;
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    render();
    onChange?.(getItems());
  });

  function getItems() { return items.slice(); }
  function escape(s) { return String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }
  function escapeAttr(s) { return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])); }

  render();
  return { getItems };
}
