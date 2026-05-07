import { taskFormShell, bindTaskForm } from "../components/taskForm.js";

const RENDER_TYPES = {
  ech: { fields: ["chromaKey.color"], advanced: ["opacity"] },
  line: { fields: ["workspaceFiles.chromaKey"], advanced: [] },
};
const TYPE_FIELDS = ["chromaKey.color", "workspaceFiles.chromaKey", "opacity"];
const MAX_LOG_LINES = 200;

export async function renderRender(el) {
  const ws = await window.api.app.getWorkspace();
  const settings = await window.api.settings.get();
  const wsChromaKeyPath = `${ws}\\chromaKey.txt`;
  const wsChromaKeyExists = (await window.api.fs.exists(wsChromaKeyPath)).exists;
  const defaults = {
    inputs: {
      overlays: `${ws}\\overlays`,
      backgrounds: `${ws}\\backgrounds`,
    },
    output: `${ws}\\done`,
    videosPerFolder: 5,
    renderType: "line",
    ffmpeg: { useGPU: settings.render.useGPU, encoder: settings.ffmpeg.encoder, maxConcurrent: settings.ffmpeg.maxConcurrent },
    chromaKey: settings.render.chromaKey,
    opacity: settings.render.opacity ?? 0.7,
    crop: settings.render.crop,
    keepColor: settings.render.keepColor,
    workspaceFiles: { chromaKey: wsChromaKeyExists ? wsChromaKeyPath : "" },
  };
  const lastConfig = settings.lastConfig?.render;

  const fields = [
    {
      type: "select", path: "renderType", label: "Loại render",
      options: [
        { value: "ech", label: "Ếch" },
        { value: "line", label: "Line" },
      ],
      help: "",
      default: "line",
    },
    { type: "folder", path: "inputs.overlays", label: "Folder overlays", required: true, mustExist: "folder" },
    { type: "folder", path: "inputs.backgrounds", label: "Folder backgrounds", required: true, mustExist: "folder" },
    { type: "folder", path: "output", label: "Folder output", required: true },
    {
      type: "file", path: "workspaceFiles.chromaKey",
      label: "File chromaKey.txt",
      filters: [{ name: "Text file", extensions: ["txt"] }, { name: "Tất cả", extensions: ["*"] }],
      mustExist: "file"
    },
    { type: "number", path: "videosPerFolder", label: "Số video render mỗi lượt", min: 1, help: "" },
    { type: "text", path: "chromaKey.color", label: "🎨 ChromaKey color (hex, vd D4F9D7)" },
  ];
  const advanced = [
    { type: "checkbox", path: "ffmpeg.useGPU", label: "Dùng GPU (NVIDIA/Intel/AMD)" },
    { type: "number", path: "opacity", label: "Opacity (0–1)", min: 0, max: 1, step: "any", default: 0.7 },
  ];

  el.innerHTML = taskFormShell({
    icon: "🎬", title: "Render Video",
    description: "Render video chính từ background + overlay với hiệu ứng chroma key.",
    fields, advanced, taskType: "render", lastConfig, defaults,
  }) + `
    <div id="render-log-panel" class="log-panel" style="display:none">
      <div class="log-panel-header">
        <strong>📜 Log render</strong>
        <span id="render-log-status" class="log-status"></span>
      </div>
      <div class="log-body" id="render-log-body"></div>
    </div>
  `;

  const form = el.querySelector("#task-form");
  bindTaskForm(form, { fields: [...fields, ...advanced], taskType: "render", defaults });

  // Toggle visibility + native required based on render type
  const typeSel = form.querySelector('select[name="renderType"]');
  const fieldEl = (path) => form.querySelector(`[data-path="${CSS.escape(path)}"]`);
  const inputEl = (path) => form.querySelector(`[name="${CSS.escape(path)}"]`);

  function applyType() {
    const t = typeSel.value;
    const visible = new Set([...(RENDER_TYPES[t]?.fields ?? []), ...(RENDER_TYPES[t]?.advanced ?? [])]);
    for (const p of TYPE_FIELDS) {
      const fld = fieldEl(p);
      if (!fld) continue;
      fld.style.display = visible.has(p) ? "" : "none";
      const inp = inputEl(p);
      if (inp) {
        if (visible.has(p) && (p === "chromaKey.color" || p === "workspaceFiles.chromaKey")) inp.setAttribute("required", "");
        else inp.removeAttribute("required");
      }
    }
  }

  typeSel.addEventListener("change", applyType);
  applyType();

  // Live log panel — only visible when a render task is running
  const logPanel = el.querySelector("#render-log-panel");
  const logBody = el.querySelector("#render-log-body");
  const logStatus = el.querySelector("#render-log-status");

  const unsubLog = window.api.queue.onUpdate((state) => {
    if (el.dataset.screen !== "render") { unsubLog?.(); return; }
    const r = state.running;
    if (!r || r.type !== "render") {
      logPanel.style.display = "none";
      return;
    }
    logPanel.style.display = "";
    logStatus.textContent = `${r.progress}% — ${r.message ?? ""}`;
    renderLogs(logBody, r.logs);
  });
}

function renderLogs(container, logs) {
  if (!logs) { container.innerHTML = ""; return; }
  const lines = logs.slice(-MAX_LOG_LINES);
  const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 24;
  container.innerHTML = lines.map((l) => `<div class="log-line log-${l.level}"><span class="log-time">${fmtTime(l.ts)}</span>${escape(l.line)}</div>`).join("");
  if (wasAtBottom) container.scrollTop = container.scrollHeight;
}

function fmtTime(ts) {
  if (!ts) return "        ";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function escape(s) {
  return String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}
