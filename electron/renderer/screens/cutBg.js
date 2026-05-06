import { taskFormShell, bindTaskForm } from "../components/taskForm.js";

export async function renderCutBg(el) {
  const ws = await window.api.app.getWorkspace();
  const s = await window.api.settings.get();
  const defaults = { input: `${ws}\\backgrounds`, output: `${ws}\\backgrounds` };
  const fields = [
    { type: "folder", path: "input",  label: "Folder background",            required: true, mustExist: "folder" },
    { type: "folder", path: "output", label: "Folder output (có thể trùng)", required: true },
  ];
  el.innerHTML = taskFormShell({
    icon: "🎞️", title: "Cắt video background",
    description: "Cắt video background dài thành các segment.",
    fields, advanced: [], taskType: "cutBg", lastConfig: s.lastConfig?.cutBg, defaults,
  });
  bindTaskForm(el.querySelector("#task-form"), { fields, taskType: "cutBg", defaults });
}
