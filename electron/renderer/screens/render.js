import { taskFormShell, bindTaskForm } from "../components/taskForm.js";

export async function renderRender(el) {
  const ws = await window.api.app.getWorkspace();
  const settings = await window.api.settings.get();
  const defaults = {
    inputs: {
      overlays: `${ws}\\overlays`,
      backgrounds: `${ws}\\backgrounds`,
      combined: `${ws}\\combined_videos`,
    },
    output: `${ws}\\done`,
    currentDay: 1,
    videosPerFolder: 5,
    ffmpeg: { useGPU: settings.render.useGPU, encoder: settings.ffmpeg.encoder, maxConcurrent: settings.ffmpeg.maxConcurrent },
    chromaKey: settings.render.chromaKey,
    opacity: settings.render.opacity,
    crop: settings.render.crop,
    keepColor: settings.render.keepColor,
  };
  const lastConfig = settings.lastConfig?.render;

  const fields = [
    { type: "folder", path: "inputs.overlays",    label: "Folder overlays" },
    { type: "folder", path: "inputs.backgrounds", label: "Folder backgrounds" },
    { type: "folder", path: "output",             label: "Folder output" },
    { type: "number", path: "currentDay",         label: "Số ngày", min: 1 },
    { type: "number", path: "videosPerFolder",    label: "Số video / folder", min: 1 },
  ];
  const advanced = [
    { type: "checkbox", path: "ffmpeg.useGPU",      label: "Dùng GPU (NVIDIA/Intel/AMD)" },
    { type: "text",     path: "chromaKey.color",    label: "🎨 ChromaKey color (hex, vd #D4F9D7)" },
    { type: "number",   path: "opacity",            label: "Opacity (0–1)", min: 0 },
  ];

  el.innerHTML = taskFormShell({
    icon: "🎬", title: "Render Video",
    description: "Render video chính từ background + overlay với hiệu ứng chroma key.",
    fields, advanced, taskType: "render", lastConfig, defaults,
  });
  bindTaskForm(el.querySelector("#task-form"), { fields: [...fields, ...advanced], taskType: "render", defaults });
}
