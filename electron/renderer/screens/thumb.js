import { taskFormShell, bindTaskForm } from "../components/taskForm.js";

export async function renderThumb(el) {
  const ws = await window.api.app.getWorkspace();
  const s = await window.api.settings.get();
  const defaults = { input: `${ws}\\overlays`, overlays: `${ws}\\overlays_convert`, output: `${ws}\\thumbs` };
  const fields = [
    { type: "folder", path: "input",    label: "Folder thumbnail gốc" },
    { type: "folder", path: "overlays", label: "Folder overlay images" },
    { type: "folder", path: "output",   label: "Folder thumbnail output" },
  ];
  el.innerHTML = taskFormShell({
    icon: "🖼️", title: "Tạo ảnh thu nhỏ",
    description: "Overlay nhiều ảnh lên thumbnail gốc.",
    fields, advanced: [], taskType: "thumb", lastConfig: s.lastConfig?.thumb, defaults,
  });
  bindTaskForm(el.querySelector("#task-form"), { fields, taskType: "thumb", defaults });
}
