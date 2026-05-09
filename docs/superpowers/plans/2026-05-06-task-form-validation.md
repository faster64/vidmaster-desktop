# Task Form Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the silent-fail behavior of " Thực hiện" with real input validation (required fields + folder/file existence) and visible toast notifications.

**Architecture:** Add a pure async `validateConfig` function (testable in vitest) that walks field schemas and reports `{label, reason}` errors. Submit handler in `taskForm.js` calls it, opens collapsed `<details>` first, and shows a red toast on failure / green toast on success. New `fs:exists` IPC backs the disk-existence check. Toast helper is extracted to its own module so both `main.js` and `taskForm.js` can use it. Per-screen field schemas get `required` and `mustExist` markers.

**Tech Stack:** Electron 30 (ESM), vitest, contextBridge IPC, vanilla JS renderer.

**User instruction:** Do not commit. Each task ends with a verification command; the user reviews and commits manually at their cadence.

---

## Files Touched

| File | New/Modified | Responsibility |
|---|---|---|
| `electron/ipc/fs.js` | new | `fs:exists` IPC handler |
| `electron/main.js` | modified | register fs IPC |
| `electron/preload.mjs` | modified | expose `window.api.fs.exists` |
| `electron/renderer/components/validation.js` | new | pure `validateConfig` |
| `tests/electron/validation.test.js` | new | unit tests for `validateConfig` |
| `electron/renderer/components/toast.js` | new | shared toast helper |
| `electron/renderer/main.js` | modified | import toast from new module |
| `electron/renderer/components/taskForm.js` | modified | open `<details>`, run validation, toast feedback |
| `electron/renderer/screens/render.js` | modified | mark fields required/mustExist |
| `electron/renderer/screens/snow.js` | modified | mark fields required/mustExist |
| `electron/renderer/screens/trim.js` | modified | mark fields required/mustExist |
| `electron/renderer/screens/cutBg.js` | modified | mark fields required/mustExist |
| `electron/renderer/screens/thumb.js` | modified | mark fields required/mustExist |
| `electron/renderer/screens/concat.js` | modified | mark fields required/mustExist |
| `electron/renderer/screens/rename.js` | modified | mark fields required/mustExist |

---

## Task 1: `fs:exists` IPC

**Files:**
- Create: `electron/ipc/fs.js`
- Modify: `electron/main.js` (add import + `registerFsIpc()` call)
- Modify: `electron/preload.mjs` (add `fs` namespace)

- [ ] **Step 1: Create `electron/ipc/fs.js`**

```js
import { ipcMain } from "electron";
import { statSync } from "fs";

export function registerFsIpc() {
  ipcMain.handle("fs:exists", (_, p) => {
    if (!p) return { exists: false };
    try {
      const s = statSync(p);
      return { exists: true, isFolder: s.isDirectory(), isFile: s.isFile() };
    } catch {
      return { exists: false };
    }
  });
}
```

- [ ] **Step 2: Wire in `electron/main.js`**

Add to imports block (after `import { registerAppIpc } from "./ipc/app.js";`):

```js
import { registerFsIpc } from "./ipc/fs.js";
```

Add inside `app.whenReady().then(async () => { ... })`, immediately before `createWindow();`:

```js
  registerFsIpc();
```

- [ ] **Step 3: Expose in `electron/preload.mjs`**

Inside `contextBridge.exposeInMainWorld("api", { ... })`, add a new key after the existing `app: { ... },` block:

```js
    fs: {
      exists: (p) => ipcRenderer.invoke("fs:exists", p),
    },
```

- [ ] **Step 4: Verify the app still boots**

Run: `npm run dev`
Expected: Electron window opens, no errors in DevTools console at startup.

In DevTools console, run:
```js
await window.api.fs.exists("D:\\Programming\\projects\\vidmaster-desktop\\package.json")
```
Expected: `{ exists: true, isFolder: false, isFile: true }`

```js
await window.api.fs.exists("D:\\nope\\nope.txt")
```
Expected: `{ exists: false }`

Close the window after verifying.

---

## Task 2: Pure `validateConfig` (TDD)

**Files:**
- Create: `tests/electron/validation.test.js`
- Create: `electron/renderer/components/validation.js`

- [ ] **Step 1: Write failing tests**

Create `tests/electron/validation.test.js`:

```js
import { describe, it, expect } from "vitest";
import { validateConfig } from "../../electron/renderer/components/validation.js";

const ok = { exists: true, isFolder: true, isFile: false };
const okFile = { exists: true, isFolder: false, isFile: true };
const missing = { exists: false };

describe("validateConfig", () => {
  it("returns no errors when all required fields present and paths exist", async () => {
    const fields = [
      { path: "input",  label: "Folder input",  required: true, mustExist: "folder" },
      { path: "output", label: "Folder output", required: true },
    ];
    const config = { input: "C:/in", output: "C:/out" };
    const fsExists = async () => ok;
    expect(await validateConfig({ fields, config, fsExists })).toEqual([]);
  });

  it("flags empty required field with reason 'trống'", async () => {
    const fields = [{ path: "input", label: "Folder input", required: true, mustExist: "folder" }];
    const config = { input: "" };
    const fsExists = async () => ok;
    const errs = await validateConfig({ fields, config, fsExists });
    expect(errs).toEqual([{ label: "Folder input", reason: "trống" }]);
  });

  it("flags missing path with reason 'không tồn tại'", async () => {
    const fields = [{ path: "input", label: "Folder input", required: true, mustExist: "folder" }];
    const config = { input: "C:/nope" };
    const fsExists = async () => missing;
    const errs = await validateConfig({ fields, config, fsExists });
    expect(errs).toEqual([{ label: "Folder input", reason: "không tồn tại" }]);
  });

  it("flags wrong kind (file when folder expected) with reason 'sai loại'", async () => {
    const fields = [{ path: "input", label: "Folder input", mustExist: "folder" }];
    const config = { input: "C:/some.txt" };
    const fsExists = async () => okFile;
    const errs = await validateConfig({ fields, config, fsExists });
    expect(errs).toEqual([{ label: "Folder input", reason: "sai loại" }]);
  });

  it("flags wrong kind (folder when file expected) with reason 'sai loại'", async () => {
    const fields = [{ path: "snowAsset", label: "Snow", mustExist: "file" }];
    const config = { snowAsset: "C:/folder" };
    const fsExists = async () => ok;
    const errs = await validateConfig({ fields, config, fsExists });
    expect(errs).toEqual([{ label: "Snow", reason: "sai loại" }]);
  });

  it("skips mustExist check when value is empty (required handles that)", async () => {
    const fields = [{ path: "snowAsset", label: "Snow", mustExist: "file" }];
    const config = { snowAsset: "" };
    let called = false;
    const fsExists = async () => { called = true; return missing; };
    const errs = await validateConfig({ fields, config, fsExists });
    expect(errs).toEqual([]);
    expect(called).toBe(false);
  });

  it("supports nested paths (e.g. inputs.overlays)", async () => {
    const fields = [{ path: "inputs.overlays", label: "Overlays", required: true, mustExist: "folder" }];
    const config = { inputs: { overlays: "" } };
    const fsExists = async () => ok;
    const errs = await validateConfig({ fields, config, fsExists });
    expect(errs).toEqual([{ label: "Overlays", reason: "trống" }]);
  });

  it("ignores fields without required/mustExist markers", async () => {
    const fields = [{ path: "duration", label: "Duration", type: "number" }];
    const config = { duration: 5 };
    const fsExists = async () => missing;
    expect(await validateConfig({ fields, config, fsExists: async () => missing })).toEqual([]);
  });

  it("trims whitespace before treating value as empty", async () => {
    const fields = [{ path: "input", label: "Folder input", required: true }];
    const config = { input: "   " };
    const errs = await validateConfig({ fields, config, fsExists: async () => ok });
    expect(errs).toEqual([{ label: "Folder input", reason: "trống" }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/electron/validation.test.js`
Expected: All 9 tests fail with module-not-found error (`validation.js` does not exist).

- [ ] **Step 3: Implement `validation.js`**

Create `electron/renderer/components/validation.js`:

```js
function pickValue(p, obj) {
  if (!obj) return undefined;
  return p.split(".").reduce((acc, k) => acc?.[k], obj);
}

function isEmpty(v) {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

export async function validateConfig({ fields, config, fsExists }) {
  const errors = [];
  const checks = [];

  for (const f of fields) {
    const v = pickValue(f.path, config);

    if (f.required && isEmpty(v)) {
      errors.push({ label: f.label, reason: "trống" });
      continue;
    }

    if (f.mustExist && !isEmpty(v)) {
      checks.push(
        fsExists(v).then((r) => {
          if (!r.exists) {
            errors.push({ label: f.label, reason: "không tồn tại" });
          } else if (f.mustExist === "folder" && !r.isFolder) {
            errors.push({ label: f.label, reason: "sai loại" });
          } else if (f.mustExist === "file" && !r.isFile) {
            errors.push({ label: f.label, reason: "sai loại" });
          }
        })
      );
    }
  }

  await Promise.all(checks);
  return errors;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/electron/validation.test.js`
Expected: All 9 tests pass.

---

## Task 3: Extract toast helper

**Files:**
- Create: `electron/renderer/components/toast.js`
- Modify: `electron/renderer/main.js` (import + remove local helper)

- [ ] **Step 1: Create `electron/renderer/components/toast.js`**

```js
let container;

function ensureContainer() {
  if (container) return container;
  container = document.createElement("div");
  container.className = "toast-container";
  document.body.appendChild(container);
  return container;
}

export function toast({ message, kind = "success", onClick, durationMs = 5000 }) {
  const c = ensureContainer();
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  if (onClick) el.addEventListener("click", onClick);
  c.appendChild(el);
  setTimeout(() => el.remove(), durationMs);
  return el;
}
```

- [ ] **Step 2: Update `electron/renderer/main.js` to use the module**

Open `electron/renderer/main.js`. At the top of the file, add the import after the other component imports (around line 11):

```js
import { toast } from "./components/toast.js";
```

Then DELETE these lines (currently lines 14-25 — the local `toastContainer` setup and `toast` function):

```js
const toastContainer = document.createElement("div");
toastContainer.className = "toast-container";
document.body.appendChild(toastContainer);

function toast({ message, kind = "success", onClick }) {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  if (onClick) el.addEventListener("click", onClick);
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}
```

The rest of `main.js` (the `screens` object, `bootstrap`, the `queue.onUpdate` block calling `toast(...)`) stays unchanged — it now uses the imported `toast`.

- [ ] **Step 3: Verify renderer still works**

Run: `npm run dev`
Open DevTools console:
```js
import("./components/toast.js").then(m => m.toast({ message: "test", kind: "success" }))
```
Expected: a green toast appears bottom-right and disappears after 5s. No errors. Close the window after verifying.

---

## Task 4: Integrate validation in `taskForm.js`

**Files:**
- Modify: `electron/renderer/components/taskForm.js`

- [ ] **Step 1: Add imports at the top of `taskForm.js`**

Add to the top of the file (above `export function taskFormShell`):

```js
import { validateConfig } from "./validation.js";
import { toast } from "./toast.js";
```

- [ ] **Step 2: Replace the submit handler in `bindTaskForm`**

In `electron/renderer/components/taskForm.js`, the existing submit handler is:

```js
  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const config = {};
    for (const input of formEl.querySelectorAll("input")) {
      const name = input.name;
      if (!name) continue;
      let v;
      if (input.type === "checkbox") v = input.checked;
      else if (input.type === "number") v = parseFloat(input.value);
      else v = input.value;
      setValue(name, config, v);
    }
    await window.api.queue.add({ type: taskType, config });
    await window.api.settings.set({ [`lastConfig.${taskType}`]: config });
  });
```

Replace it with:

```js
  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();

    formEl.querySelectorAll("details").forEach((d) => { d.open = true; });

    if (!formEl.reportValidity()) return;

    const config = {};
    for (const input of formEl.querySelectorAll("input")) {
      const name = input.name;
      if (!name) continue;
      let v;
      if (input.type === "checkbox") v = input.checked;
      else if (input.type === "number") v = parseFloat(input.value);
      else v = input.value;
      setValue(name, config, v);
    }

    const errors = await validateConfig({
      fields,
      config,
      fsExists: (p) => window.api.fs.exists(p),
    });

    if (errors.length > 0) {
      const summary = errors.map((e) => `${e.label} (${e.reason})`).join(", ");
      toast({ kind: "error", message: `⚠️ Thiếu dữ liệu: ${summary}` });
      return;
    }

    await window.api.queue.add({ type: taskType, config });
    await window.api.settings.set({ [`lastConfig.${taskType}`]: config });
    toast({ kind: "success", message: "✅ Đã thêm vào hàng đợi" });
  });
```

- [ ] **Step 3: Verify nothing else regressed**

Run: `npx vitest run`
Expected: validation tests pass; pre-existing failures (missing `tests/fixtures/tiny.mp4`) are unchanged. No NEW failures from this task.

---

## Task 5: Mark fields in `render.js`

**Files:**
- Modify: `electron/renderer/screens/render.js`

- [ ] **Step 1: Replace the `fields` array**

Find the existing `fields` array in `render.js`:

```js
  const fields = [
    { type: "folder", path: "inputs.overlays",    label: "Folder overlays" },
    { type: "folder", path: "inputs.backgrounds", label: "Folder backgrounds" },
    { type: "folder", path: "output",             label: "Folder output" },
    { type: "number", path: "currentDay",         label: "Số ngày", min: 1 },
    { type: "number", path: "videosPerFolder",    label: "Số video / folder", min: 1 },
  ];
```

Replace with:

```js
  const fields = [
    { type: "folder", path: "inputs.overlays",    label: "Folder overlays",     required: true, mustExist: "folder" },
    { type: "folder", path: "inputs.backgrounds", label: "Folder backgrounds",  required: true, mustExist: "folder" },
    { type: "folder", path: "output",             label: "Folder output",       required: true },
    { type: "number", path: "currentDay",         label: "Số ngày", min: 1 },
    { type: "number", path: "videosPerFolder",    label: "Số video / folder", min: 1 },
  ];
```

(The `advanced` array stays as-is; opacity already has `min/max/step`.)

---

## Task 6: Mark fields in `snow.js`

**Files:**
- Modify: `electron/renderer/screens/snow.js`

- [ ] **Step 1: Replace the `fields` array**

Replace the existing `fields` array with:

```js
  const fields = [
    { type: "folder", path: "input",      label: "Folder ảnh đầu vào",          required: true, mustExist: "folder" },
    { type: "folder", path: "output",     label: "Folder video output",         required: true },
    { type: "text",   path: "snowAsset",  label: "Đường dẫn snow.mov", help: "File snow overlay (.mov hoặc .mp4)", required: true, mustExist: "file" },
    { type: "number", path: "duration",   label: "Thời lượng video (giây)", min: 1 },
  ];
```

---

## Task 7: Mark fields in `trim.js`

**Files:**
- Modify: `electron/renderer/screens/trim.js`

- [ ] **Step 1: Replace the `fields` array**

Replace the existing `fields` array with:

```js
  const fields = [
    { type: "folder",   path: "input",          label: "Folder input",  required: true, mustExist: "folder" },
    { type: "folder",   path: "output",         label: "Folder output", required: true },
    { type: "number",   path: "segmentSeconds", label: "Độ dài segment (giây)", min: 1 },
    { type: "checkbox", path: "replace",        label: "Xoá file gốc sau khi cắt" },
  ];
```

---

## Task 8: Mark fields in `cutBg.js`

**Files:**
- Modify: `electron/renderer/screens/cutBg.js`

- [ ] **Step 1: Replace the `fields` array**

Replace the existing `fields` array with:

```js
  const fields = [
    { type: "folder", path: "input",  label: "Folder background",            required: true, mustExist: "folder" },
    { type: "folder", path: "output", label: "Folder output (có thể trùng)", required: true },
  ];
```

---

## Task 9: Mark fields in `thumb.js`

**Files:**
- Modify: `electron/renderer/screens/thumb.js`

- [ ] **Step 1: Replace the `fields` array**

Replace the existing `fields` array with:

```js
  const fields = [
    { type: "folder", path: "input",    label: "Folder thumbnail gốc",   required: true, mustExist: "folder" },
    { type: "folder", path: "overlays", label: "Folder overlay images",  required: true, mustExist: "folder" },
    { type: "folder", path: "output",   label: "Folder thumbnail output", required: true },
  ];
```

---

## Task 10: Mark fields in `concat.js`

**Files:**
- Modify: `electron/renderer/screens/concat.js`

- [ ] **Step 1: Replace the `fields` array**

Replace the existing `fields` array with:

```js
  const fields = [
    { type: "folder", path: "thumbsDir",  label: "Folder thumbs",      required: true, mustExist: "folder" },
    { type: "folder", path: "doneDir",    label: "Folder done (input)", required: true, mustExist: "folder" },
    { type: "folder", path: "output",     label: "Folder output",      required: true },
    { type: "folder", path: "tempDir",    label: "Folder temp",        required: true },
    { type: "number", path: "chunkSize",  label: "Kích thước chunk", min: 1 },
    { type: "text",   path: "folderName", label: "Tên folder cụ thể (để trống = chạy tất cả)" },
  ];
```

(`folderName` stays optional — empty means "run all", per the existing label.)

---

## Task 11: Mark fields in `rename.js`

**Files:**
- Modify: `electron/renderer/screens/rename.js`

- [ ] **Step 1: Replace the `fields` array**

Replace the existing `fields` array with:

```js
  const fields = [
    { type: "folder", path: "folder", label: "Folder cần sửa tên (NFC normalize)", required: true, mustExist: "folder" },
  ];
```

---

## Task 12: End-to-end manual verification

**Files:** none (manual smoke test).

- [ ] **Step 1: Boot the app**

Run: `npm run dev`
Wait for the Electron window to open.

- [ ] **Step 2: Verify "trống" path**

Navigate to **Render Video** screen. Clear the "Folder overlays" input. Click **▶  Thực hiện**.
Expected: a red toast appears bottom-right with text starting `⚠️ Thiếu dữ liệu: Folder overlays (trống)`. No task is added (queue dock at bottom stays "Hàng đợi trống").

- [ ] **Step 3: Verify "không tồn tại" path**

Restore "Folder overlays" to a real folder, but type `D:\definitely-not-real\nope` into "Folder backgrounds". Click submit.
Expected: red toast: `⚠️ Thiếu dữ liệu: Folder backgrounds (không tồn tại)`.

- [ ] **Step 4: Verify "sai loại" path**

Navigate to **Tạo video từ ảnh** (snow). Set "Đường dẫn snow.mov" to a folder path (e.g. the workspace root). Fill the other required fields with real folders. Click submit.
Expected: red toast containing `Đường dẫn snow.mov (sai loại)`.

- [ ] **Step 5: Verify HTML5 numeric range still works**

Back on **Render Video**. Open the "Tuỳ chọn nâng cao" details panel. Set Opacity to `5`. Click submit.
Expected: native browser popup on the opacity input: "Value must be less than or equal to 1." Toast does NOT appear. (This proves Step 1 of the submit flow — opening details and `reportValidity()` — works.)

- [ ] **Step 6: Verify success path**

Reset opacity to `0.7`. Make sure all required folders exist. Click submit.
Expected: green toast `✅ Đã thêm vào hàng đợi`. The footer queue dock immediately shows `⏳ Render ...` with a progress bar.

- [ ] **Step 7: Stop the app**

Cancel the running task via the dock's "Huỷ" button (so we don't leave a render running). Close the Electron window.

---

## Verification commands summary

| When | Command | Expected |
|---|---|---|
| After Task 2 | `npx vitest run tests/electron/validation.test.js` | 9/9 pass |
| After Task 4 | `npx vitest run` | validation tests pass; pre-existing fixture-related failures unchanged |
| After Task 12 | manual | all 6 manual sub-steps pass |

## Done criteria

- All 9 unit tests in `validation.test.js` pass.
- Manual matrix in Task 12 passes (red toast for empty/missing, native popup for numeric, green toast on success, queued task visible in dock).
- No new vitest failures vs. baseline.
- No commits made — changes left unstaged for the user to review.
