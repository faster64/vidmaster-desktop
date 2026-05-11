export async function renderOnboarding(el, { initialWorkspace = "", initialIdentifier = "" } = {}, onConfirmed) {
  el.innerHTML = `
    <h1 class="screen-header">Chào mừng đến VidMaster</h1>
    <p class="screen-subtitle">Trước khi bắt đầu, hãy chọn 1 thư mục làm "Workspace" và đặt mã định danh cho máy này.
       App sẽ tạo các thư mục con (overlays, backgrounds, done) bên trong workspace.</p>

    <div class="field">
      <label>📁 Workspace folder</label>
      <div class="field-row">
        <input type="text" id="ws-path" readonly placeholder="Chưa chọn" value="${escape(initialWorkspace)}">
        <button id="ws-pick" class="primary">📂 Chọn…</button>
      </div>
    </div>

    <div class="field">
      <label>🏷️ Mã định danh</label>
      <input type="text" id="identifier" placeholder="vd: PC-Cuong / Channel-A / Server-01" value="${escape(initialIdentifier)}">
      <div class="help">Dùng để phân biệt các máy / channel khi nhận thông báo Telegram. Có thể đổi sau ở Settings.</div>
    </div>

    <div style="margin-top:24px">
      <button id="confirm" class="primary" disabled>Bắt đầu</button>
    </div>
  `;

  const wsPath = el.querySelector("#ws-path");
  const identifierEl = el.querySelector("#identifier");
  const confirmBtn = el.querySelector("#confirm");

  function refresh() {
    confirmBtn.disabled = !(wsPath.value.trim() && identifierEl.value.trim());
  }
  refresh();

  el.querySelector("#ws-pick").addEventListener("click", async () => {
    const p = await window.api.dialog.pickFolder();
    if (p) { wsPath.value = p; refresh(); }
  });

  identifierEl.addEventListener("input", refresh);

  confirmBtn.addEventListener("click", async () => {
    const ws = wsPath.value.trim();
    const identifier = identifierEl.value.trim();
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Đang tạo thư mục…";
    await window.api.app.ensureWorkspace(ws);
    await window.api.shell.openFolder(ws);
    await onConfirmed({ workspace: ws, identifier });
  });
}

function escape(s) {
  return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}
