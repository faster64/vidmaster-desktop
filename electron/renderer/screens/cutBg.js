import { taskFormShell, bindTaskForm } from "../components/taskForm.js";

export async function renderCutBg(el) {
  const ws = await window.api.app.getWorkspace();
  const s = await window.api.settings.get();
  const defaults = { input: `${ws}\\backgrounds`, output: `${ws}\\backgrounds`, segmentSeconds: 3600 };
  const fields = [
    { type: "folder", path: "input",  label: "Folder background",            required: true, mustExist: "folder" },
    { type: "folder", path: "output", label: "Folder output (có thể trùng)", required: true },
    { type: "number", path: "segmentSeconds", label: "Độ dài mỗi segment (giây)", min: 1, help: "3600 = 1 giờ · 1800 = 30 phút · 600 = 10 phút" },
  ];
  el.innerHTML = taskFormShell({
    icon: "🎞️", title: "Chia nhỏ video nền",
    description: "Chia nhỏ video nền dài thành các segment.",
    fields, advanced: [], taskType: "cutBg", lastConfig: s.lastConfig?.cutBg, defaults,
  });
  bindTaskForm(el.querySelector("#task-form"), { fields, taskType: "cutBg", defaults });
}
