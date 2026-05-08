import { toast } from "./toast.js";

const root = () => document.getElementById("modal-root");

function errorKeyword(err) {
  return err?.code || err?.name || err?.message || String(err);
}

function safeBind(el, label, handler) {
  if (!el) return;
  el.addEventListener("click", async (e) => {
    try {
      await handler(e);
    } catch (err) {
      console.error(`[modal] ${label} handler failed:`, err);
      toast({ kind: "error", message: `⚠️ Không thực hiện được "${label}": ${errorKeyword(err)}` });
    }
  });
}

export function showModal({ title, body, footer }) {
  const r = root();
  r.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">${title}</div>
        <div class="modal-body">${body}</div>
        <div class="modal-footer">${footer ?? `<button class="primary" data-close>Đóng</button>`}</div>
      </div>
    </div>`;
  const close = () => { r.innerHTML = ""; };
  r.addEventListener("click", (e) => {
    if (e.target.matches(".modal-backdrop") || e.target.matches("[data-close]")) {
      close();
    }
  });
  return { close };
}

export async function showErrorModal({ summary, error, jobId }) {
  let logs = [];
  if (jobId) {
    try { logs = await window.api.log.getRecent(jobId); } catch {}
  }
  const stack = error?.stack || (error?.details ? JSON.stringify(error.details, null, 2) : "");
  const logLines = logs.map((l) => `[${l.level}] ${l.line}`).join("");
  showModal({
    title: `❌ ${summary}`,
    body: `<p>${escape(error?.message || "Có lỗi xảy ra.")}</p>
           <h4>Stack / details</h4><pre>${escape(stack)}</pre>
           ${logLines ? `<h4>Log gần nhất (${logs.length} dòng)</h4><pre>${escape(logLines)}</pre>` : ""}`,
    footer: `
      <button id="copy-log">Copy log</button>
      <button id="open-log-file">Mở file log</button>
      <button class="primary" data-close>Đóng</button>
    `,
  });
  safeBind(document.getElementById("copy-log"), "Copy log", async () => {
    await navigator.clipboard.writeText(stack + "\n\n" + logLines);
    toast({ kind: "success", message: "✅ Đã copy log vào clipboard" });
  });
  safeBind(document.getElementById("open-log-file"), "Mở file log", () => window.api.shell.openLogFile());
}

function escape(s) { return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }
function escapeAttr(s) { return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])); }

/**
 * Show a prompt modal. Resolves to the trimmed string value, or null on cancel.
 */
export function showPromptModal({ title, label, defaultValue = "", placeholder = "", okText = "OK", cancelText = "Huỷ" }) {
  return new Promise((resolve) => {
    const r = root();
    r.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal">
          <div class="modal-header">${escape(title)}</div>
          <div class="modal-body">
            <label style="display:block;margin-bottom:6px">${escape(label)}</label>
            <input id="prompt-input" type="text" value="${escapeAttr(defaultValue)}" placeholder="${escapeAttr(placeholder)}" style="width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:6px;font:inherit">
          </div>
          <div class="modal-footer">
            <button id="prompt-cancel">${escape(cancelText)}</button>
            <button id="prompt-ok" class="primary" style="margin-left:8px">${escape(okText)}</button>
          </div>
        </div>
      </div>`;
    const close = (value) => {
      r.innerHTML = "";
      resolve(value);
    };
    const input = r.querySelector("#prompt-input");
    input.focus();
    input.select();
    r.querySelector("#prompt-ok").addEventListener("click", () => {
      const v = input.value.trim();
      close(v || null);
    });
    r.querySelector("#prompt-cancel").addEventListener("click", () => close(null));
    r.querySelector(".modal-backdrop").addEventListener("click", (e) => {
      if (e.target.matches(".modal-backdrop")) close(null);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const v = input.value.trim();
        close(v || null);
      } else if (e.key === "Escape") {
        close(null);
      }
    });
  });
}
