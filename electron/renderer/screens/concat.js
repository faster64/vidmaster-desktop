import { taskFormShell, bindTaskForm } from "../components/taskForm.js";

export async function renderConcat(el) {
  const ws = await window.api.app.getWorkspace();
  const s = await window.api.settings.get();
  const defaults = {
    thumbsDir: `${ws}\\thumbs`,
    doneDir: `${ws}\\done`,
    output: `${ws}\\output`,
    tempDir: `${ws}\\temp`,
    chunkSize: 2,
    folderName: "",
  };
  const fields = [
    { type: "folder", path: "thumbsDir",  label: "Folder thumbs" },
    { type: "folder", path: "doneDir",    label: "Folder done (input)" },
    { type: "folder", path: "output",     label: "Folder output" },
    { type: "folder", path: "tempDir",    label: "Folder temp" },
    { type: "number", path: "chunkSize",  label: "Kích thước chunk", min: 1 },
    { type: "text",   path: "folderName", label: "Tên folder cụ thể (để trống = chạy tất cả)" },
  ];
  el.innerHTML = taskFormShell({
    icon: "🔗", title: "Ghép video + thumbnail",
    description: "Ghép videos trong từng folder con + thumbnail thành video cuối.",
    fields, advanced: [], taskType: "concat", lastConfig: s.lastConfig?.concat, defaults,
  });
  bindTaskForm(el.querySelector("#task-form"), { fields, taskType: "concat", defaults });
}
