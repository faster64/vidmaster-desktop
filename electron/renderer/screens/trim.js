import { taskFormShell, bindTaskForm } from "../components/taskForm.js";

export async function renderTrim(el) {
  const ws = await window.api.app.getWorkspace();
  const s = await window.api.settings.get();
  const defaults = { input: `${ws}\\input`, output: `${ws}\\done`, segmentSeconds: 30, replace: false };
  const fields = [
    { type: "folder",   path: "input",          label: "Folder input",  required: true, mustExist: "folder" },
    { type: "folder",   path: "output",         label: "Folder output", required: true },
    { type: "number",   path: "segmentSeconds", label: "Độ dài segment (giây)", min: 1 },
    { type: "checkbox", path: "replace",        label: "Xoá file gốc sau khi cắt" },
  ];
  el.innerHTML = taskFormShell({
    icon: "✂️", title: "Cắt video 30s",
    description: "Cắt mỗi video trong folder thành các đoạn ngắn (mặc định 30s).",
    fields, advanced: [], taskType: "trim", lastConfig: s.lastConfig?.trim, defaults,
  });
  bindTaskForm(el.querySelector("#task-form"), { fields, taskType: "trim", defaults });
}
