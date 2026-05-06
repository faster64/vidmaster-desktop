export async function renderOnboarding(el, onWorkspaceChosen) {
  el.innerHTML = `
    <h1 class="screen-header">Chào mừng đến VidMaster</h1>
    <p class="screen-subtitle">Trước khi bắt đầu, hãy chọn 1 thư mục làm "Workspace".
       App sẽ tự tạo các thư mục con bên trong (overlays, backgrounds, done, …).</p>
    <div class="field-row">
      <input type="text" id="ws-path" readonly placeholder="Chưa chọn">
      <button id="ws-pick" class="primary">📂 Chọn thư mục…</button>
    </div>
    <div style="margin-top:24px">
      <button id="ws-confirm" class="primary" disabled>Bắt đầu</button>
    </div>
  `;

  const pathEl = el.querySelector("#ws-path");
  const pickBtn = el.querySelector("#ws-pick");
  const confirmBtn = el.querySelector("#ws-confirm");
  let chosen = "";

  pickBtn.addEventListener("click", async () => {
    const p = await window.api.dialog.pickFolder();
    if (p) {
      chosen = p;
      pathEl.value = p;
      confirmBtn.disabled = false;
    }
  });

  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Đang tạo thư mục…";
    await window.api.app.ensureWorkspace(chosen);
    await window.api.shell.openFolder(chosen);
    await onWorkspaceChosen(chosen);
  });
}
