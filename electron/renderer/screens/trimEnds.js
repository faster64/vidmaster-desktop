import { taskFormShell, bindTaskForm } from "../components/taskForm.js";

export async function renderTrimEnds(el) {
  const ws = await window.api.app.getWorkspace();
  const s = await window.api.settings.get();
  const defaults = { input: "", output: `${ws}\\done`, trimStart: 0, trimEnd: 0, replace: false };
  const fields = [
    { type: "folder",   path: "input",     label: "Folder input",  required: true, mustExist: "folder" },
    { type: "folder",   path: "output",    label: "Folder output", required: true },
    { type: "number",   path: "trimStart", label: "Cắt đầu (giây)", min: 0, step: "any", help: "0 = không cắt đầu" },
    { type: "number",   path: "trimEnd",   label: "Cắt cuối (giây)", min: 0, step: "any", help: "0 = không cắt cuối" },
    { type: "checkbox", path: "replace",   label: "Xoá file gốc sau khi cắt" },
  ];
  el.innerHTML = taskFormShell({
    icon: "⏱️", title: "Cắt đầu / cuối",
    description: "Cắt N giây đầu và/hoặc M giây cuối của mỗi video trong folder. Giữ nguyên audio.",
    fields, advanced: [], taskType: "trimEnds", lastConfig: s.lastConfig?.trimEnds, defaults,
  });
  bindTaskForm(el.querySelector("#task-form"), { fields, taskType: "trimEnds", defaults });
}
