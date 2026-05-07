import { taskFormShell, bindTaskForm } from "../components/taskForm.js";

export async function renderConcatHeadTail(el) {
  const ws = await window.api.app.getWorkspace();
  const s = await window.api.settings.get();
  const defaults = { folderA: "", folderB: "", folderC: "", output: `${ws}\\done` };
  const fields = [
    { type: "folder", path: "folderA", label: "Folder A — video gốc",  required: true, mustExist: "folder" },
    { type: "folder", path: "folderB", label: "Folder B — nối đầu (optional)", mustExist: "folder",
      help: "Để trống nếu không nối đầu" },
    { type: "folder", path: "folderC", label: "Folder C — nối cuối (optional)", mustExist: "folder",
      help: "Để trống nếu không nối cuối" },
    { type: "folder", path: "output",  label: "Folder output", required: true },
  ];
  el.innerHTML = taskFormShell({
    icon: "🪡", title: "Nối video đầu/cuối",
    description: "Mỗi video A[i] → ghép thành B[i]+A[i]+C[i] (sort theo tên, B/C wrap nếu ít hơn A). Cần ít nhất 1 trong 2 folder B hoặc C. Giữ nguyên audio.",
    fields, advanced: [], taskType: "concatHeadTail", lastConfig: s.lastConfig?.concatHeadTail, defaults,
  });
  bindTaskForm(el.querySelector("#task-form"), { fields, taskType: "concatHeadTail", defaults });
}
