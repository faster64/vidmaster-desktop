---
name: task-form-component
description: Shared per-task UI form pattern — folder/number/checkbox/text fields, advanced collapsible, last-config persistence, native folder picker integration.
---

# Task form component

## When to use

When adding a new task screen or changing a field on an existing one in `electron/renderer/screens/`. The shared component is `electron/renderer/components/taskForm.js`.

## Process

1. **Define `defaults`**: a plain object whose keys mirror the task's runner config. Values come from workspace defaults + settings (e.g. `${ws}\\overlays`).

2. **Define `fields`**: an array describing top-level form fields. Each entry: `{ type, path, label, help?, min?, default? }`.
   - `type`: `"folder" | "number" | "checkbox" | "text"`.
   - `path`: dotted path into the config (e.g., `"inputs.overlays"`, `"chromaKey.color"`).
   - `label`: Vietnamese label shown above the input.

3. **Define `advanced`** (optional): same shape as `fields`, rendered inside `<details class="advanced">`. Use this for params that have sensible defaults most users won't change (chroma color, opacity, GPU toggle).

4. **Render via `taskFormShell({...})`** — returns the HTML string. Mount with `el.innerHTML = ...`.

5. **Bind via `bindTaskForm(formEl, { fields: [...fields, ...advanced], taskType, defaults })`**. This wires:
   - Folder picker buttons → `window.api.dialog.pickFolder()`.
   - "Reset to defaults" button.
   - Submit → `window.api.queue.add({ type: taskType, config })` then `settings.set({ \`lastConfig.${taskType}\`: config })`.

6. **Pre-fill order:** `lastConfig.<type>` (per-task storage) > `defaults` (workspace + settings) > `field.default` > `""`.

## Examples

`electron/renderer/screens/trim.js`:

```js
import { taskFormShell, bindTaskForm } from "../components/taskForm.js";

export async function renderTrim(el) {
  const ws = await window.api.app.getWorkspace();
  const s = await window.api.settings.get();
  const defaults = { input: `${ws}\\input`, output: `${ws}\\done`, segmentSeconds: 30, replace: false };
  const fields = [
    { type: "folder",   path: "input",          label: "Folder input" },
    { type: "folder",   path: "output",         label: "Folder output" },
    { type: "number",   path: "segmentSeconds", label: "Độ dài segment (giây)", min: 1 },
    { type: "checkbox", path: "replace",        label: "Xoá file gốc sau khi cắt" },
  ];
  el.innerHTML = taskFormShell({
    icon: "✂️", title: "Cắt video 30s",
    description: "Cắt mỗi video trong folder thành các đoạn ngắn.",
    fields, advanced: [], taskType: "trim", lastConfig: s.lastConfig?.trim, defaults,
  });
  bindTaskForm(el.querySelector("#task-form"), { fields, taskType: "trim", defaults });
}
```

## Pitfalls

- **Forgetting to include `advanced` fields in the bind call.** They render but won't be picked up by submit. Always pass `[...fields, ...advanced]` to `bindTaskForm`.
- **Using the same `path` twice.** Form serialisation overwrites. Each path must be unique within the screen.
- **Storing absolute paths in `lastConfig`** without considering workspace changes. If the user moves their workspace, prior `lastConfig` paths still point to the old location — this is acceptable in v1 (user re-picks via "Reset"), but flag if it becomes painful.
- **Not escaping the field value when rendering.** `taskFormShell` already escapes via the internal `escape()` helper; don't bypass it with raw template strings.
