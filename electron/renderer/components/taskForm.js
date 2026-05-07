import { validateConfig } from "./validation.js";
import { toast } from "./toast.js";
import { runWithFeedback } from "./buttonFeedback.js";

export function taskFormShell({ icon, title, description, fields, advanced, taskType, lastConfig, defaults }) {
  return `
    <div class="screen-header">${icon} ${title}</div>
    <p class="screen-subtitle">${description}</p>
    <form id="task-form">
      ${fields.map((f) => fieldHtml(f, lastConfig, defaults)).join("")}
      ${advanced && advanced.length ? `
        <details class="advanced">
          <summary>Tuỳ chọn nâng cao</summary>
          ${advanced.map((f) => fieldHtml(f, lastConfig, defaults)).join("")}
        </details>` : ""}
      <button type="submit" class="primary">▶ Thêm vào hàng đợi</button>
      <button type="button" id="task-reset" style="margin-left:8px">Reset mặc định</button>
    </form>
  `;
}

function fieldHtml(f, lastConfig, defaults) {
  const v = pickValue(f.path, lastConfig) ?? pickValue(f.path, defaults) ?? f.default ?? "";
  if (f.type === "folder") {
    return `
      <div class="field" data-path="${f.path}" data-kind="folder">
        <label>📁 ${f.label}</label>
        <div class="field-row">
          <input type="text" name="${f.path}" value="${escape(v)}">
          <button type="button" data-pick="${f.path}" data-pick-kind="folder">📂 Chọn…</button>
          <button type="button" data-open="${f.path}" title="Mở folder">↗</button>
        </div>
        ${f.help ? `<div class="help">${f.help}</div>` : ""}
      </div>`;
  }
  if (f.type === "file") {
    const filtersAttr = f.filters ? ` data-pick-filters="${escape(JSON.stringify(f.filters))}"` : "";
    return `
      <div class="field" data-path="${f.path}" data-kind="file">
        <label>📄 ${f.label}</label>
        <div class="field-row">
          <input type="text" name="${f.path}" value="${escape(v)}">
          <button type="button" data-pick="${f.path}" data-pick-kind="file"${filtersAttr}>📂 Chọn…</button>
        </div>
        ${f.help ? `<div class="help">${f.help}</div>` : ""}
      </div>`;
  }
  if (f.type === "number") {
    return `
      <div class="field" data-path="${f.path}" data-kind="number">
        <label>🔢 ${f.label}</label>
        <input type="number" name="${f.path}" value="${escape(v)}" ${f.min != null ? `min="${f.min}"` : ""} ${f.max != null ? `max="${f.max}"` : ""} ${f.step != null ? `step="${f.step}"` : ""}>
        ${f.help ? `<div class="help">${f.help}</div>` : ""}
      </div>`;
  }
  if (f.type === "checkbox") {
    return `
      <div class="field" data-path="${f.path}" data-kind="checkbox">
        <label><input type="checkbox" name="${f.path}" ${v ? "checked" : ""}> ${f.label}</label>
        ${f.help ? `<div class="help">${f.help}</div>` : ""}
      </div>`;
  }
  if (f.type === "text") {
    return `
      <div class="field" data-path="${f.path}" data-kind="text">
        <label>${f.label}</label>
        <input type="text" name="${f.path}" value="${escape(v)}">
        ${f.help ? `<div class="help">${f.help}</div>` : ""}
      </div>`;
  }
  if (f.type === "select") {
    const options = (f.options || []).map((o) =>
      `<option value="${escape(o.value)}" ${String(v) === String(o.value) ? "selected" : ""}>${escape(o.label)}</option>`
    ).join("");
    return `
      <div class="field" data-path="${f.path}" data-kind="select">
        <label>${f.label}</label>
        <select name="${f.path}">${options}</select>
        ${f.help ? `<div class="help">${f.help}</div>` : ""}
      </div>`;
  }
  return "";
}

function escape(s) { return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])); }

function pickValue(p, obj) {
  if (!obj) return undefined;
  return p.split(".").reduce((acc, k) => acc?.[k], obj);
}

function setValue(p, obj, value) {
  const keys = p.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    o[keys[i]] = o[keys[i]] || {};
    o = o[keys[i]];
  }
  o[keys.at(-1)] = value;
}

export function bindTaskForm(formEl, { fields, taskType, defaults }) {
  formEl.addEventListener("click", async (e) => {
    const openPath = e.target.dataset?.open;
    if (openPath) {
      const value = formEl.querySelector(`[name="${openPath}"]`)?.value?.trim();
      if (value) await window.api.shell.openFolder(value);
      return;
    }
    const pickPath = e.target.dataset?.pick;
    if (!pickPath) return;
    const kind = e.target.dataset?.pickKind || "folder";
    const input = formEl.querySelector(`[name="${pickPath}"]`);
    let chosen;
    if (kind === "file") {
      const filters = e.target.dataset?.pickFilters ? JSON.parse(e.target.dataset.pickFilters) : [];
      chosen = await window.api.dialog.pickFile({ filters });
    } else {
      chosen = await window.api.dialog.pickFolder(input.value);
    }
    if (chosen) input.value = chosen;
  });

  formEl.querySelector("#task-reset")?.addEventListener("click", () => {
    for (const f of fields) {
      const def = pickValue(f.path, defaults) ?? f.default ?? "";
      const input = formEl.querySelector(`[name="${f.path}"]`);
      if (input) {
        if (input.type === "checkbox") input.checked = !!def;
        else input.value = def;
      }
    }
  });

  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();

    formEl.querySelectorAll("details").forEach((d) => { d.open = true; });

    if (!formEl.reportValidity()) return;

    const config = {};
    for (const input of formEl.querySelectorAll("input, select")) {
      const name = input.name;
      if (!name) continue;
      let v;
      if (input.type === "checkbox") v = input.checked;
      else if (input.type === "number") v = parseFloat(input.value);
      else v = input.value;
      setValue(name, config, v);
    }

    const errors = await validateConfig({
      fields,
      config,
      fsExists: (p) => window.api.fs.exists(p),
    });

    if (errors.length > 0) {
      const summary = errors.map((e) => `${e.label} (${e.reason})`).join(", ");
      toast({ kind: "error", message: `⚠️ Thiếu dữ liệu: ${summary}` });
      return;
    }

    const submitBtn = formEl.querySelector('button[type="submit"]');
    await runWithFeedback(submitBtn, async () => {
      await window.api.queue.add({ type: taskType, config });
      await window.api.settings.set({ [`lastConfig.${taskType}`]: config });
    });
  });
}
