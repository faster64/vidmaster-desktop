import { taskFormShell, bindTaskForm } from "../components/taskForm.js";

export async function renderRename(el) {
  const ws = await window.api.app.getWorkspace();
  const s = await window.api.settings.get();
  const defaults = { folder: `${ws}\\thumbs` };
  const fields = [
    { type: "folder", path: "folder", label: "Folder cần sửa tên (NFC normalize)" },
  ];
  el.innerHTML = taskFormShell({
    icon: "✏️", title: "Sửa tên thu nhỏ",
    description: "Chuẩn hoá tên file unicode về dạng NFC trên toàn folder (đệ quy).",
    fields, advanced: [], taskType: "rename", lastConfig: s.lastConfig?.rename, defaults,
  });
  bindTaskForm(el.querySelector("#task-form"), { fields, taskType: "rename", defaults });
}
