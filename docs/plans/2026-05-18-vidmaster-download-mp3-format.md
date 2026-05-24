# VidMaster Download MP3/MP4 Format Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm tùy chọn format mp4 (default) / mp3 vào task "Tải video" — radio UI + branched yt-dlp args + persisted last config.

**Architecture:** Hai thay đổi tách biệt: (1) `src/download.js` accept `format` param, validate, branch yt-dlp args theo mp4/mp3, mở rộng `renameSanitized` xử lý cả `.mp3`. (2) `electron/renderer/screens/download.js` thêm radio "Định dạng" trước số tải song song + persist `lastConfig.download.format`.

**Tech Stack:** yt-dlp (Windows binary), ffmpeg-static (cho `--extract-audio`), vanilla JS renderer, Vitest 1.6 (mock spawn).

**Reference spec:** [docs/specs/2026-05-18-vidmaster-download-mp3-format-design.md](../specs/2026-05-18-vidmaster-download-mp3-format-design.md)

**Commit policy (user preference):** Do NOT auto-commit. Each task ends with `git diff` review only.

---

## File Structure

**Modify (2 files):**
- `src/download.js` — Accept `format` param trong `runDownload`, validate, branch `downloadOne` args theo mp4/mp3, `renameSanitized` xử lý cả `.mp3`.
- `electron/renderer/screens/download.js` — Field radio "📦 Định dạng" + persist.

**Modify (1 test file):**
- `tests/download.test.js` — Thêm 3 test cases (default mp4 args, mp3 args, invalid format).

**No new files.**

---

## Task 1: Add `format` param + validation in `runDownload` (TDD)

**Files:**
- Modify: `src/download.js`
- Modify: `tests/download.test.js`

- [ ] **Step 1: Append failing test for invalid format**

Open `tests/download.test.js`. Inside the existing `describe("runDownload", ...)` block (before the closing `});` on line 128), append this new test:

```js
  it("rejects invalid format", async () => {
    const urlsFile = path.join(tmpDir, "urls.txt");
    fs.writeFileSync(urlsFile, "u1\n", "utf8");
    await expect(runDownload({
      urlsFile, output: tmpDir, ytdlpPath: "/yt.exe", maxConcurrent: 1, format: "wav",
    })).rejects.toThrow(/Định dạng không hợp lệ/);
  });
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `npx vitest run tests/download.test.js -t "rejects invalid format"`

Expected: FAIL — current `runDownload` doesn't validate `format` (any value goes through).

- [ ] **Step 3: Apply minimal implementation — destructure + validate `format`**

Open `src/download.js`. Find the destructure block at lines 14-17:

```js
  const {
    urlsFile, output, ytdlpPath,
    maxConcurrent = 3,
  } = config;
```

Replace with:

```js
  const {
    urlsFile, output, ytdlpPath,
    maxConcurrent = 3,
    format = "mp4",
  } = config;
```

Then add a validation check right after the existing 3 `throw` statements (after `if (!ytdlpPath) throw new Error("Thiếu đường dẫn yt-dlp.");` on line 22). Insert this new line BEFORE `runner.checkAborted();`:

```js
  if (format !== "mp4" && format !== "mp3") throw new Error(`Định dạng không hợp lệ: ${format}`);
```

The validation order becomes: urlsFile, output, ytdlpPath, format, then `checkAborted`.

- [ ] **Step 4: Run the new test — expect PASS**

Run: `npx vitest run tests/download.test.js -t "rejects invalid format"`

Expected: PASS.

- [ ] **Step 5: Run the full download test file — expect all PASS**

Run: `npx vitest run tests/download.test.js`

Expected: 6/6 pass (5 existing + 1 new). Existing tests still pass because default `format = "mp4"` preserves prior behavior.

- [ ] **Step 6: Stop — review diff, do NOT commit**

Run: `git diff src/download.js tests/download.test.js`. Leave unstaged.

---

## Task 2: Branch yt-dlp args by format in `downloadOne` (TDD)

**Files:**
- Modify: `src/download.js`
- Modify: `tests/download.test.js`

- [ ] **Step 1: Append failing tests for args branching**

Open `tests/download.test.js`. Inside the existing `describe("runDownload", ...)` block, append these two tests right after the "rejects invalid format" test from Task 1:

```js
  it("uses mp4 args by default (no format param)", async () => {
    const urlsFile = path.join(tmpDir, "urls.txt");
    fs.writeFileSync(urlsFile, "u1\n", "utf8");
    const cp = await import("child_process");

    const promise = runDownload({
      urlsFile, output: tmpDir, ytdlpPath: "/yt.exe", maxConcurrent: 1,
    });
    await new Promise((r) => setImmediate(r));
    fakeChildren[0].emit("close", 0);
    await promise;

    const args = cp.spawn.mock.calls[0][1];
    expect(args).toContain("--merge-output-format");
    expect(args).toContain("mp4");
    expect(args).not.toContain("--extract-audio");
  });

  it("uses mp3 args when format=mp3", async () => {
    const urlsFile = path.join(tmpDir, "urls.txt");
    fs.writeFileSync(urlsFile, "u1\n", "utf8");
    const cp = await import("child_process");

    const promise = runDownload({
      urlsFile, output: tmpDir, ytdlpPath: "/yt.exe", maxConcurrent: 1, format: "mp3",
    });
    await new Promise((r) => setImmediate(r));
    fakeChildren[0].emit("close", 0);
    await promise;

    const args = cp.spawn.mock.calls[0][1];
    expect(args).toContain("--extract-audio");
    expect(args).toContain("--audio-format");
    expect(args).toContain("mp3");
    expect(args).not.toContain("--merge-output-format");
  });
```

- [ ] **Step 2: Run the new tests — first should PASS (current code is mp4), second should FAIL**

Run: `npx vitest run tests/download.test.js -t "format"`

Expected:
- "rejects invalid format" — PASS (from Task 1).
- "uses mp4 args by default" — PASS (current code IS mp4).
- "uses mp3 args when format=mp3" — FAIL (current code always emits mp4 args).

- [ ] **Step 3: Thread `format` from `runDownload` to `downloadOne`**

In `src/download.js`, find the `await Promise.allSettled(...)` block (around line 67):

```js
    const results = await Promise.allSettled(urls.map((url) => limit(() => downloadOne({
      url, output, ytdlpPath, archiveFile, signal,
      onPercent: (p) => { inflight.set(url, p); refreshProgress(); },
      onLog: (level, line) => runner.onLog?.(level, line),
      registerChild: (c) => liveChildren.add(c),
      unregisterChild: (c) => liveChildren.delete(c),
    }))));
```

Add `format` to the destructured object:

```js
    const results = await Promise.allSettled(urls.map((url) => limit(() => downloadOne({
      url, output, ytdlpPath, archiveFile, signal, format,
      onPercent: (p) => { inflight.set(url, p); refreshProgress(); },
      onLog: (level, line) => runner.onLog?.(level, line),
      registerChild: (c) => liveChildren.add(c),
      unregisterChild: (c) => liveChildren.delete(c),
    }))));
```

- [ ] **Step 4: Branch args inside `downloadOne`**

In `src/download.js`, find the `downloadOne` function signature (around line 98):

```js
function downloadOne({ url, output, ytdlpPath, archiveFile, signal, onPercent, onLog, registerChild, unregisterChild }) {
```

Add `format` to the destructure:

```js
function downloadOne({ url, output, ytdlpPath, archiveFile, signal, format, onPercent, onLog, registerChild, unregisterChild }) {
```

Then find the `const args = [...]` block (lines 102-111):

```js
    const args = [
      "-f", "bestvideo+bestaudio/best",
      "--merge-output-format", "mp4",
      "-o", path.join(output, "%(title)s.%(ext)s"),
      "--write-thumbnail",
      "--convert-thumbnails", "jpg",
      "--no-overwrites",
      "--download-archive", archiveFile,
      url,
    ];
```

Replace with:

```js
    const args = format === "mp3"
      ? [
          "-f", "bestaudio/best",
          "--extract-audio",
          "--audio-format", "mp3",
          "--audio-quality", "0",
          "-o", path.join(output, "%(title)s.%(ext)s"),
          "--write-thumbnail",
          "--convert-thumbnails", "jpg",
          "--no-overwrites",
          "--download-archive", archiveFile,
          url,
        ]
      : [
          "-f", "bestvideo+bestaudio/best",
          "--merge-output-format", "mp4",
          "-o", path.join(output, "%(title)s.%(ext)s"),
          "--write-thumbnail",
          "--convert-thumbnails", "jpg",
          "--no-overwrites",
          "--download-archive", archiveFile,
          url,
        ];
```

- [ ] **Step 5: Run all download tests — expect PASS**

Run: `npx vitest run tests/download.test.js`

Expected: 8/8 pass (5 existing + 3 new).

- [ ] **Step 6: Stop — review diff, do NOT commit**

---

## Task 3: Mở rộng `renameSanitized` xử lý cả `.mp3`

**Files:**
- Modify: `src/download.js`

(Không thêm test mới — function `renameSanitized` không có unit test riêng trong codebase; behavior verify qua acceptance check ở Task 5.)

- [ ] **Step 1: Update `renameSanitized` signature and logic**

Find `renameSanitized` at the bottom of `src/download.js` (around lines 172-192):

```js
function renameSanitized(folder) {
  const out = [];
  for (const ext of [".mp4", ".jpg"]) {
    const files = fs.readdirSync(folder).filter((n) => n.toLowerCase().endsWith(ext));
    for (const file of files) {
      const base = file.slice(0, file.length - ext.length);
      const safe = sanitizeFilename(base);
      if (safe === base) {
        if (ext === ".mp4") out.push(path.join(folder, file));
        continue;
      }
      const newName = safe + ext;
      const newPath = path.join(folder, newName);
      if (!fs.existsSync(newPath)) {
        fs.renameSync(path.join(folder, file), newPath);
      }
      if (ext === ".mp4") out.push(newPath);
    }
  }
  return out;
}
```

Replace with the format-aware version:

```js
function renameSanitized(folder, format) {
  const out = [];
  const mediaExt = format === "mp3" ? ".mp3" : ".mp4";
  for (const ext of [mediaExt, ".jpg"]) {
    const files = fs.readdirSync(folder).filter((n) => n.toLowerCase().endsWith(ext));
    for (const file of files) {
      const base = file.slice(0, file.length - ext.length);
      const safe = sanitizeFilename(base);
      if (safe === base) {
        if (ext === mediaExt) out.push(path.join(folder, file));
        continue;
      }
      const newName = safe + ext;
      const newPath = path.join(folder, newName);
      if (!fs.existsSync(newPath)) {
        fs.renameSync(path.join(folder, file), newPath);
      }
      if (ext === mediaExt) out.push(newPath);
    }
  }
  return out;
}
```

- [ ] **Step 2: Update caller to pass `format`**

In `src/download.js`, find the call site of `renameSanitized` (around line 92):

```js
  const outputs = renameSanitized(output);
```

Replace with:

```js
  const outputs = renameSanitized(output, format);
```

- [ ] **Step 3: Run all download tests — expect PASS**

Run: `npx vitest run tests/download.test.js`

Expected: 8/8 pass — existing test "calls ensureBinary then spawns one yt-dlp per URL" calls `renameSanitized` with the default `format=mp4` (no fixture .mp4 files in tmpDir, so output stays `[]` — same as before).

- [ ] **Step 4: Run full test suite**

Run: `npm test`

Expected: 200 pass (197 baseline + 3 new), 2 pre-existing failures in `tests/electron/buttonFeedback.test.js` (unchanged).

- [ ] **Step 5: Stop — review diff, do NOT commit**

---

## Task 4: Renderer UI — radio "📦 Định dạng" + persist

**Files:**
- Modify: `electron/renderer/screens/download.js`

- [ ] **Step 1: Read `lastFormat` and add field to HTML**

In `electron/renderer/screens/download.js`, find the `last*` destructure block (around lines 7-9):

```js
  const last = s.lastConfig?.download ?? {};
  const lastUrlsFile = last.urlsFile ?? "";
  const lastOutput = last.output ?? `${ws}\\downloads`;
  const lastConcurrent = last.maxConcurrent ?? s.download.maxConcurrent;
```

Add a new line for `lastFormat`:

```js
  const last = s.lastConfig?.download ?? {};
  const lastUrlsFile = last.urlsFile ?? "";
  const lastOutput = last.output ?? `${ws}\\downloads`;
  const lastConcurrent = last.maxConcurrent ?? s.download.maxConcurrent;
  const lastFormat = last.format ?? "mp4";
```

Then in the `el.innerHTML = ...` template literal, find the field for "Folder output" (ends at the `</div>` after `data-open-id="output"`). Insert a NEW field block right after that closing `</div>` and before the "Số tải song song" field:

```html
      <div class="field">
        <label>📦 Định dạng</label>
        <div style="display:flex;gap:16px;margin-top:4px">
          <label><input type="radio" name="format" value="mp4" ${lastFormat === "mp4" ? "checked" : ""}> 🎬 mp4 (video + audio)</label>
          <label><input type="radio" name="format" value="mp3" ${lastFormat === "mp3" ? "checked" : ""}> 🎵 mp3 (chỉ audio)</label>
        </div>
      </div>
```

- [ ] **Step 2: Read `format` on submit + include in config + persist**

In the same file, find the submit handler (around lines 61-77):

```js
  el.querySelector("#task-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const urlsFile = el.querySelector("#urls-file").value.trim();
    const output = el.querySelector("#output").value.trim();
    const maxConcurrent = parseInt(cc.value, 10);
    if (!urlsFile || !output) return;

    const config = {
      urlsFile, output, maxConcurrent,
      ytdlpPath: s.download.ytdlpPath,
    };
    const submitBtn = el.querySelector('button[type="submit"]');
    await runWithFeedback(submitBtn, async () => {
      await window.api.queue.add({ type: "download", config });
      await window.api.settings.set({ "lastConfig.download": { urlsFile, output, maxConcurrent } });
    });
  });
```

Replace with:

```js
  el.querySelector("#task-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const urlsFile = el.querySelector("#urls-file").value.trim();
    const output = el.querySelector("#output").value.trim();
    const maxConcurrent = parseInt(cc.value, 10);
    const format = el.querySelector('input[name="format"]:checked')?.value || "mp4";
    if (!urlsFile || !output) return;

    const config = {
      urlsFile, output, maxConcurrent, format,
      ytdlpPath: s.download.ytdlpPath,
    };
    const submitBtn = el.querySelector('button[type="submit"]');
    await runWithFeedback(submitBtn, async () => {
      await window.api.queue.add({ type: "download", config });
      await window.api.settings.set({ "lastConfig.download": { urlsFile, output, maxConcurrent, format } });
    });
  });
```

- [ ] **Step 3: Run full test suite for regression check**

Run: `npm test`

Expected: same as Task 3 — 200 pass, 2 pre-existing failures. (Renderer screens not unit-tested.)

- [ ] **Step 4: Stop — review diff, do NOT commit**

Run: `git diff electron/renderer/screens/download.js`. Verify only the additions described (lastFormat read, new field block, format in submit + persist).

---

## Task 5: End-to-end verification

**Files:** none — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: 200 pass, 2 pre-existing buttonFeedback failures.

- [ ] **Step 2: Build the app in unpacked mode**

Run: `npm run build:dir`

Expected: builds without errors; produces `dist/win-unpacked/VidMaster.exe`.

- [ ] **Step 3: Launch and verify all acceptance criteria from the spec**

Run: `dist/win-unpacked/VidMaster.exe`

Walk through each criterion from [docs/specs/2026-05-18-vidmaster-download-mp3-format-design.md](../specs/2026-05-18-vidmaster-download-mp3-format-design.md) section 11:

  1. [ ] Tab "⬇️ Tải video" hiển thị field "📦 Định dạng" với 2 radio: 🎬 mp4 (checked), 🎵 mp3 — ngay sau "Folder output", trước "Số tải song song".
  2. [ ] Đổi radio sang mp3, submit task → đóng app → mở lại → radio mp3 vẫn checked (persist).
  3. [ ] Submit mp4 với file URLs hợp lệ (vd: 1 video YouTube ngắn): output folder có `<title>.mp4` + `<title>.jpg`.
  4. [ ] Submit mp3 với cùng file URLs (xóa `downloaded.txt` trước nếu cùng video): output folder có `<title>.mp3` + `<title>.jpg`, KHÔNG có `<title>.mp4`.
  5. [ ] Toast "Hoàn thành" + queue dock click → mở folder output.
  6. [ ] `npm test` baseline đạt — done ở Step 1.
  7. [ ] `npm run build:dir` thành công — done ở Step 2.

- [ ] **Step 4: Stop — review diff, do NOT commit**

Run: `git status`. Confirm modified files: `src/download.js`, `tests/download.test.js`, `electron/renderer/screens/download.js`. Untracked: spec + plan docs under `docs/`. Leave unstaged.

---

## Notes for the implementer

- **Vietnamese UI + technical keywords inline** (per user memory): error message `"Định dạng không hợp lệ: <value>"` inline keeps debuggability.
- **No auto-commit**: every task ends with `git diff` review only.
- **No worktrees**: work directly on the current checkout. Current branch is `feat/recolor-thumb` from prior features — user has chosen to bundle features on this branch.
- TDD discipline: Tasks 1 and 2 strictly follow red→green. Task 3 (renameSanitized) is a defensive refactor without a dedicated unit test — verified by acceptance check; this is acceptable because the change is purely additive (mp3 path) without altering mp4 behavior (default param value).
- The `tests/download.test.js` mock framework uses `vi.mock("child_process", ...)` and inspects `cp.spawn.mock.calls[0][1]` (args array). The 3 new tests follow the same pattern.
