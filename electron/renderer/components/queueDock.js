import { progressBar } from "./progressBar.js";

export function mountQueueDock(el) {
  const render = (state) => {
    if (!state.running && state.pending.length === 0) {
      el.innerHTML = `<span style="color:var(--muted)">Hàng đợi trống.</span>`;
      return;
    }
    const r = state.running;
    el.innerHTML = `
      ${r ? `
        <div class="queue-item">
          <span class="label">⏳ ${labelFor(r.type)} <span style="color:var(--muted)">${r.message ?? ""}</span></span>
          ${progressBar(r.progress)}
          <button data-cancel="${r.id}" class="danger">Huỷ</button>
        </div>` : ""}
      ${state.pending.length > 0 ? `<div style="color:var(--muted);margin-top:4px">⏸ ${state.pending.length} task đang chờ</div>` : ""}
    `;
  };

  el.addEventListener("click", (e) => {
    const id = e.target.dataset?.cancel;
    if (id) window.api.queue.cancel(id);
  });

  window.api.queue.onUpdate(render);
  window.api.queue.getState().then(render);
}

const LABELS = { render: "Render", snow: "Snow", trim: "Trim", cutBg: "CutBg" };
function labelFor(type) { return LABELS[type] || type; }
