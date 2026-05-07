import { taskFormShell, bindTaskForm } from "../components/taskForm.js";

const RENDER_TYPES = {
  ech:  { fields: ["chromaKey.color"], advanced: ["opacity"] },
  line: { fields: ["workspaceFiles.chromaKey"], advanced: [] },
};
const TYPE_FIELDS = ["chromaKey.color", "workspaceFiles.chromaKey", "opacity"];

export async function renderRender(el) {
  const ws = await window.api.app.getWorkspace();
  const settings = await window.api.settings.get();
  const defaults = {
    inputs: {
      overlays: `${ws}\\overlays`,
      backgrounds: `${ws}\\backgrounds`,
    },
    output: `${ws}\\done`,
    currentDay: 1,
    videosPerFolder: 5,
    renderType: "line",
    ffmpeg: { useGPU: settings.render.useGPU, encoder: settings.ffmpeg.encoder, maxConcurrent: settings.ffmpeg.maxConcurrent },
    chromaKey: settings.render.chromaKey,
    opacity: settings.render.opacity ?? 0.7,
    crop: settings.render.crop,
    keepColor: settings.render.keepColor,
    workspaceFiles: { chromaKey: `${ws}\\chromaKey.txt` },
  };
  const lastConfig = settings.lastConfig?.render;

  const fields = [
    { type: "select", path: "renderType", label: "Loại render",
      options: [
        { value: "ech",  label: "Ếch" },
        { value: "line", label: "Line" },
      ],
      help: "",
      default: "line",
    },
    { type: "folder", path: "inputs.overlays",    label: "Folder overlays",     required: true, mustExist: "folder" },
    { type: "folder", path: "inputs.backgrounds", label: "Folder backgrounds",  required: true, mustExist: "folder" },
    { type: "folder", path: "output",             label: "Folder output",       required: true },
    { type: "number", path: "currentDay",         label: "Số ngày", min: 1 },
    { type: "number", path: "videosPerFolder",    label: "Số video / folder", min: 1 },
    { type: "text",   path: "chromaKey.color",    label: "🎨 ChromaKey color (hex, vd D4F9D7)" },
    { type: "file",   path: "workspaceFiles.chromaKey",
      label: "File chromaKey.txt (mỗi dòng 1 mã hex 6 ký tự — dòng 1 áp cho overlay 1, dòng 2 áp cho overlay 2…)",
      filters: [{ name: "Text file", extensions: ["txt"] }, { name: "Tất cả", extensions: ["*"] }],
      mustExist: "file" },
  ];
  const advanced = [
    { type: "checkbox", path: "ffmpeg.useGPU", label: "Dùng GPU (NVIDIA/Intel/AMD)" },
    { type: "number",   path: "opacity",       label: "Opacity (0–1)", min: 0, max: 1, step: "any", default: 0.7 },
  ];

  el.innerHTML = taskFormShell({
    icon: "🎬", title: "Render Video",
    description: "Render video chính từ background + overlay với hiệu ứng chroma key.",
    fields, advanced, taskType: "render", lastConfig, defaults,
  });

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
}
