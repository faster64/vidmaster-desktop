import { taskFormShell, bindTaskForm } from "../components/taskForm.js";

export async function renderSnow(el) {
  const ws = await window.api.app.getWorkspace();
  const s = await window.api.settings.get();
  const defaults = { input: `${ws}\\input`, output: `${ws}\\output`, snowAsset: "", duration: 12 };
  const fields = [
    { type: "folder", path: "input",      label: "Folder ảnh đầu vào",          required: true, mustExist: "folder" },
    { type: "folder", path: "output",     label: "Folder video output",         required: true },
    { type: "text",   path: "snowAsset",  label: "Đường dẫn snow.mov", help: "File snow overlay (.mov hoặc .mp4)", required: true, mustExist: "file" },
    { type: "number", path: "duration",   label: "Thời lượng video (giây)", min: 1 },
  ];
  el.innerHTML = taskFormShell({
    icon: "❄️", title: "Tạo video từ ảnh",
    description: "Tạo video từ ảnh tĩnh + hiệu ứng snow overlay.",
    fields, advanced: [], taskType: "snow", lastConfig: s.lastConfig?.snow, defaults,
  });
  bindTaskForm(el.querySelector("#task-form"), { fields, taskType: "snow", defaults });
}
