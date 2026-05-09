# VidMaster Thumb-Avatar + Settings Tabs Implementation Plan

> **For agentic workers:** This plan has NO commit steps per the user's standing instruction "không auto-commit". Run TDD cycles (failing test → implementation → tests pass) but leave the working tree as an unstaged diff. The user commits manually after review.

**Goal:** Add `thumbAvatar` task module + refactor Settings screen into tabs.

**Architecture:** Task module follows existing `runX(config) → { ok, outputs, errors }` pattern. Sharp does in-Node image compositing (no FFmpeg needed for this task). Settings UI splits into a thin `tabs.js` component + 9 small render functions; schema bumps v4→v5 with additive migration. No new IPC handlers, no new npm deps.

**Tech Stack:** Node 20, sharp (already in deps), vitest, Electron 30. Reuses existing `_lib/sanitize.js`, `_lib/runner.js`, `_lib/abortError.js`.

**Reference docs:**
- Spec: `docs/specs/2026-05-07-vidmaster-thumb-avatar-design.md`
- Master spec (original architecture): `docs/specs/2026-05-06-vidmaster-desktop-app-design.md`

---

## File map

**Create:**
- `src/_lib/circleCrop.js`
- `src/thumbAvatar.js`
- `electron/renderer/components/tabs.js`
- `electron/renderer/screens/thumbAvatar.js`
- `tests/_lib/circleCrop.test.js`
- `tests/thumbAvatar.test.js`

**Modify:**
- `electron/settings.js` — bump SCHEMA_VERSION 4→5, add `avatar` block to defaults, add `ui.lastSettingsTab`, append `if (v < 5)` migration branch
- `electron/ipc/queue.js` — register `thumbAvatar` runner
- `electron/renderer/components/sidebar.js` — add 7th nav item
- `electron/renderer/main.js` — register `renderThumbAvatar` screen + label
- `electron/renderer/screens/settings.js` — refactor body into tabs (9 sections); add Avatar tab
- `tests/fixtures/generate.js` — add `tiny-avatar-square.png` (red) + `tiny-avatar-square.jpg` (blue), both 100×100

**Conventions:**
- No `git commit` step per standing rule.
- TDD: write failing test → run to confirm fail → implement → run to confirm pass.
- All file paths absolute on disk; module imports stay relative within the project.

---

## Task 1: Audio fixture additions

**Files:**
- Modify: `tests/fixtures/generate.js`

- [ ] **Step 1: Append fixture generation**

Add to the end of `tests/fixtures/generate.js`:

```js
// 5. tiny-avatar-square.png — 100×100 solid red (avatar fixture)
const avatarPng = path.join(__dirname, "tiny-avatar-square.png");
await sharp({
  create: { width: 100, height: 100, channels: 4, background: { r: 220, g: 30, b: 30, alpha: 1 } },
}).png().toFile(avatarPng);
console.log("✓ tiny-avatar-square.png");

// 6. tiny-avatar-square.jpg — 100×100 solid blue (avatar fixture, JPG variant)
const avatarJpg = path.join(__dirname, "tiny-avatar-square.jpg");
await sharp({
  create: { width: 100, height: 100, channels: 3, background: { r: 30, g: 30, b: 220 } },
}).jpeg({ quality: 90 }).toFile(avatarJpg);
console.log("✓ tiny-avatar-square.jpg");
```

- [ ] **Step 2: Run generator**

```bash
node tests/fixtures/generate.js
```

Expected output: existing 4 fixtures + the 2 new ones, all printing `✓`.

Verify files exist:
```bash
ls tests/fixtures/tiny-avatar-square.png tests/fixtures/tiny-avatar-square.jpg
```

---

## Task 2: `_lib/circleCrop.js` — sharp helper

**Files:**
- Create: `src/_lib/circleCrop.js`
- Test: `tests/_lib/circleCrop.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/_lib/circleCrop.test.js`:

```js
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";
import { circleCrop } from "../../src/_lib/circleCrop.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const avatarPng = path.join(__dirname, "..", "fixtures", "tiny-avatar-square.png");

describe("circleCrop", () => {
  it("returns an 80×80 PNG buffer", async () => {
    const buf = await circleCrop(avatarPng, 80);
    const meta = await sharp(buf).metadata();
    expect(meta.width).toBe(80);
    expect(meta.height).toBe(80);
    expect(meta.format).toBe("png");
    expect(meta.channels).toBe(4); // RGBA
  });

  it("makes the four corners transparent (alpha = 0)", async () => {
    const buf = await circleCrop(avatarPng, 80);
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    // info.channels = 4 (RGBA). Pixel at (x,y) starts at offset (y * width + x) * 4. Alpha is byte +3.
    const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];
    expect(alphaAt(0, 0)).toBe(0);                            // top-left corner
    expect(alphaAt(info.width - 1, 0)).toBe(0);               // top-right corner
    expect(alphaAt(0, info.height - 1)).toBe(0);              // bottom-left corner
    expect(alphaAt(info.width - 1, info.height - 1)).toBe(0); // bottom-right corner
  });

  it("keeps the centre opaque (alpha > 200)", async () => {
    const buf = await circleCrop(avatarPng, 80);
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const cx = Math.floor(info.width / 2);
    const cy = Math.floor(info.height / 2);
    const alpha = data[(cy * info.width + cx) * 4 + 3];
    expect(alpha).toBeGreaterThan(200);
  });

  it("respects a custom size argument", async () => {
    const buf = await circleCrop(avatarPng, 32);
    const meta = await sharp(buf).metadata();
    expect(meta.width).toBe(32);
    expect(meta.height).toBe(32);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
npx vitest run tests/_lib/circleCrop.test.js
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/_lib/circleCrop.js`**

```js
import sharp from "sharp";

/**
 * Resize an image to a square `size` × `size`, then mask to a circle (alpha 0 outside).
 * Returns a PNG buffer (preserves alpha).
 *
 * @param {string|Buffer} input  Path or buffer accepted by sharp.
 * @param {number} size          Output dimensions in pixels.
 * @returns {Promise<Buffer>}    PNG buffer with circular alpha mask applied.
 */
export async function circleCrop(input, size) {
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`
  );
  return sharp(input)
    .resize(size, size, { fit: "cover" })
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
npx vitest run tests/_lib/circleCrop.test.js
```

Expected: PASS all 4 tests.

---

## Task 3: `src/thumbAvatar.js` — task module

**Files:**
- Create: `src/thumbAvatar.js`
- Test: `tests/thumbAvatar.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/thumbAvatar.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";
import { runThumbAvatar } from "../src/thumbAvatar.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, "fixtures");
const avatarPng = path.join(fixtures, "tiny-avatar-square.png");
const avatarJpg = path.join(fixtures, "tiny-avatar-square.jpg");

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-thumbAvatar-")); });
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

async function makeThumb(p, w, h, color) {
  await sharp({ create: { width: w, height: h, channels: 3, background: color } })
    .jpeg({ quality: 90 })
    .toFile(p);
}

describe("runThumbAvatar", () => {
  it("produces n × m output files in m folders, named by thumbnail", async () => {
    const thumbDir = path.join(tmpDir, "thumbs");
    const avatarDir = path.join(tmpDir, "avatars");
    const output = path.join(tmpDir, "out");
    fs.mkdirSync(thumbDir); fs.mkdirSync(avatarDir);
    await makeThumb(path.join(thumbDir, "thumb1.jpg"), 640, 360, { r: 200, g: 200, b: 50 });
    await makeThumb(path.join(thumbDir, "thumb2.jpg"), 640, 360, { r: 50, g: 200, b: 200 });
    fs.copyFileSync(avatarPng, path.join(avatarDir, "channelA.png"));
    fs.copyFileSync(avatarJpg, path.join(avatarDir, "channelB.jpg"));

    const r = await runThumbAvatar({
      thumbDir, avatarDir, output, position: "bottom-right", size: 80, margin: 16,
    });

    expect(r.ok).toBe(true);
    expect(fs.existsSync(path.join(output, "channelA", "thumb1.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(output, "channelA", "thumb2.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(output, "channelB", "thumb1.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(output, "channelB", "thumb2.jpg"))).toBe(true);
    expect(r.outputs).toHaveLength(4);
  }, 30_000);

  it("places avatar at top-left when position=top-left", async () => {
    const thumbDir = path.join(tmpDir, "thumbs");
    const avatarDir = path.join(tmpDir, "avatars");
    const output = path.join(tmpDir, "out");
    fs.mkdirSync(thumbDir); fs.mkdirSync(avatarDir);
    await makeThumb(path.join(thumbDir, "t.jpg"), 320, 320, { r: 255, g: 255, b: 255 });
    fs.copyFileSync(avatarPng, path.join(avatarDir, "a.png"));

    await runThumbAvatar({
      thumbDir, avatarDir, output, position: "top-left", size: 80, margin: 16,
    });

    const out = path.join(output, "a", "t.jpg");
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    // At (16+40, 16+40) — centre of avatar — should NOT be pure white (because avatar is red).
    const r = data[((16 + 40) * info.width + (16 + 40)) * 3];
    expect(r).toBeGreaterThan(150); // red channel of avatar shows
  }, 30_000);

  it("places avatar at center when position=center", async () => {
    const thumbDir = path.join(tmpDir, "thumbs");
    const avatarDir = path.join(tmpDir, "avatars");
    const output = path.join(tmpDir, "out");
    fs.mkdirSync(thumbDir); fs.mkdirSync(avatarDir);
    await makeThumb(path.join(thumbDir, "t.jpg"), 320, 320, { r: 255, g: 255, b: 255 });
    fs.copyFileSync(avatarPng, path.join(avatarDir, "a.png"));

    await runThumbAvatar({
      thumbDir, avatarDir, output, position: "center", size: 80, margin: 16,
    });

    const out = path.join(output, "a", "t.jpg");
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const cx = Math.floor(info.width / 2);
    const cy = Math.floor(info.height / 2);
    const r = data[(cy * info.width + cx) * 3];
    expect(r).toBeGreaterThan(150);
  }, 30_000);

  it("rejects when thumbDir is empty", async () => {
    const thumbDir = path.join(tmpDir, "thumbs");
    const avatarDir = path.join(tmpDir, "avatars");
    fs.mkdirSync(thumbDir); fs.mkdirSync(avatarDir);
    fs.copyFileSync(avatarPng, path.join(avatarDir, "a.png"));
    await expect(runThumbAvatar({
      thumbDir, avatarDir, output: tmpDir, position: "bottom-right", size: 80, margin: 16,
    })).rejects.toThrow(/thumbnail/i);
  });

  it("rejects when avatarDir is empty", async () => {
    const thumbDir = path.join(tmpDir, "thumbs");
    const avatarDir = path.join(tmpDir, "avatars");
    fs.mkdirSync(thumbDir); fs.mkdirSync(avatarDir);
    await makeThumb(path.join(thumbDir, "t.jpg"), 320, 320, { r: 255, g: 255, b: 255 });
    await expect(runThumbAvatar({
      thumbDir, avatarDir, output: tmpDir, position: "bottom-right", size: 80, margin: 16,
    })).rejects.toThrow(/avatar/i);
  });

  it("skips pairs where avatar would not fit, records error, continues other pairs", async () => {
    const thumbDir = path.join(tmpDir, "thumbs");
    const avatarDir = path.join(tmpDir, "avatars");
    const output = path.join(tmpDir, "out");
    fs.mkdirSync(thumbDir); fs.mkdirSync(avatarDir);
    // First thumb is too small (50×50 cannot fit 80+2*16 = 112)
    await makeThumb(path.join(thumbDir, "small.jpg"), 50, 50, { r: 0, g: 0, b: 0 });
    await makeThumb(path.join(thumbDir, "ok.jpg"), 320, 320, { r: 0, g: 0, b: 0 });
    fs.copyFileSync(avatarPng, path.join(avatarDir, "a.png"));

    const r = await runThumbAvatar({
      thumbDir, avatarDir, output, position: "bottom-right", size: 80, margin: 16,
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].thumb).toContain("small.jpg");
    expect(fs.existsSync(path.join(output, "a", "ok.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(output, "a", "small.jpg"))).toBe(false);
  }, 30_000);

  it("aborts when signal already fired", async () => {
    const thumbDir = path.join(tmpDir, "thumbs");
    const avatarDir = path.join(tmpDir, "avatars");
    fs.mkdirSync(thumbDir); fs.mkdirSync(avatarDir);
    await makeThumb(path.join(thumbDir, "t.jpg"), 320, 320, { r: 0, g: 0, b: 0 });
    fs.copyFileSync(avatarPng, path.join(avatarDir, "a.png"));
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(runThumbAvatar({
      thumbDir, avatarDir, output: tmpDir, position: "bottom-right", size: 80, margin: 16,
      signal: ctrl.signal,
    })).rejects.toThrow(/Aborted/);
  });

  it("overwrites existing output files", async () => {
    const thumbDir = path.join(tmpDir, "thumbs");
    const avatarDir = path.join(tmpDir, "avatars");
    const output = path.join(tmpDir, "out");
    fs.mkdirSync(thumbDir); fs.mkdirSync(avatarDir);
    await makeThumb(path.join(thumbDir, "t.jpg"), 320, 320, { r: 0, g: 0, b: 0 });
    fs.copyFileSync(avatarPng, path.join(avatarDir, "a.png"));
    // Pre-create the output file with junk
    fs.mkdirSync(path.join(output, "a"), { recursive: true });
    fs.writeFileSync(path.join(output, "a", "t.jpg"), "OLD");

    await runThumbAvatar({
      thumbDir, avatarDir, output, position: "bottom-right", size: 80, margin: 16,
    });
    const stats = fs.statSync(path.join(output, "a", "t.jpg"));
    expect(stats.size).toBeGreaterThan(100); // real JPG, not the 3-byte "OLD"
  }, 30_000);
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npx vitest run tests/thumbAvatar.test.js
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/thumbAvatar.js`**

```js
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { TaskRunner } from "./_lib/runner.js";
import { circleCrop } from "./_lib/circleCrop.js";
import { sanitizeFilename } from "./_lib/sanitize.js";

const POSITIONS = new Set(["top-left", "top-right", "bottom-left", "bottom-right", "center"]);

export async function runThumbAvatar(config) {
  const runner = new TaskRunner(config);
  const {
    thumbDir, avatarDir, output,
    position = "bottom-right",
    size = 80,
    margin = 16,
  } = config;

  if (!thumbDir || !fs.existsSync(thumbDir)) throw new Error("Folder thumbnail không tồn tại.");
  if (!avatarDir || !fs.existsSync(avatarDir)) throw new Error("Folder avatar không tồn tại.");
  if (!output) throw new Error("Thiếu folder output.");
  if (!POSITIONS.has(position)) throw new Error(`Vị trí không hợp lệ: ${position}`);

  const thumbs = fs.readdirSync(thumbDir).filter((n) => /\.jpe?g$/i.test(n)).sort();
  if (thumbs.length === 0) throw new Error("Folder không có file thumbnail (.jpg).");

  const avatars = fs.readdirSync(avatarDir).filter((n) => /\.(jpe?g|png)$/i.test(n)).sort();
  if (avatars.length === 0) throw new Error("Folder không có file avatar (.jpg/.png).");

  runner.checkAborted();
  fs.mkdirSync(output, { recursive: true });

  const n = thumbs.length;
  const m = avatars.length;
  const outputs = [];
  const errors = [];

  for (let j = 0; j < m; j++) {
    runner.checkAborted();
    const avatarName = avatars[j];
    const avatarPath = path.join(avatarDir, avatarName);
    const avatarBase = sanitizeFilename(path.parse(avatarName).name);

    let avatarBuffer;
    try {
      avatarBuffer = await circleCrop(avatarPath, size);
    } catch (err) {
      errors.push({ avatar: avatarName, message: `Lỗi xử lý avatar: ${err.message}` });
      runner.log("error", `Avatar ${avatarName} failed: ${err.message}`);
      continue;
    }
    runner.setProgress(((j + 1) / m) * 5, `Pre-process avatar ${j + 1}/${m}`);

    const avatarOut = path.join(output, avatarBase);
    fs.mkdirSync(avatarOut, { recursive: true });

    for (let i = 0; i < n; i++) {
      runner.checkAborted();
      const thumbName = thumbs[i];
      const thumbPath = path.join(thumbDir, thumbName);
      const thumbBase = sanitizeFilename(path.parse(thumbName).name);
      const outPath = path.join(avatarOut, `${thumbBase}.jpg`);

      try {
        const meta = await sharp(thumbPath).rotate().metadata();
        const W = meta.width ?? 0;
        const H = meta.height ?? 0;
        if (size + 2 * margin > Math.min(W, H)) {
          errors.push({
            thumb: thumbName, avatar: avatarName,
            message: `Avatar quá lớn so với thumbnail (${W}×${H}, cần ≥ ${size + 2 * margin}px)`,
          });
          runner.log("warn", `Skip ${thumbName} × ${avatarName}: too small`);
          continue;
        }
        const [left, top] = positionXY(position, W, H, size, margin);
        await sharp(thumbPath)
          .rotate()
          .composite([{ input: avatarBuffer, left, top }])
          .jpeg({ quality: 90 })
          .toFile(outPath);
        outputs.push(outPath);
      } catch (err) {
        errors.push({
          thumb: thumbName, avatar: avatarName,
          message: `Lỗi xử lý ảnh: ${err.message}`,
        });
        runner.log("error", `${thumbName} × ${avatarName} failed: ${err.message}`);
      }

      const done = j * n + i + 1;
      runner.setProgress(5 + (done / (n * m)) * 95, `${done}/${n * m}`);
    }
  }

  runner.setProgress(100, `Đã ghi ${outputs.length}/${n * m}`);
  return { ok: errors.length === 0, outputs, errors };
}

function positionXY(position, W, H, size, margin) {
  switch (position) {
    case "top-left":     return [margin, margin];
    case "top-right":    return [W - size - margin, margin];
    case "bottom-left":  return [margin, H - size - margin];
    case "bottom-right": return [W - size - margin, H - size - margin];
    case "center":       return [Math.round((W - size) / 2), Math.round((H - size) / 2)];
    default: throw new Error(`Unknown position: ${position}`);
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npx vitest run tests/thumbAvatar.test.js
```

Expected: PASS all 8 tests (some may take 5–10 sec each due to real sharp work).

---

## Task 4: Settings v5 — schema migration

**Files:**
- Modify: `electron/settings.js`
- Modify: `tests/electron/settings.test.js`

- [ ] **Step 1: Write failing test**

Append to existing `describe` block in `tests/electron/settings.test.js`:

```js
  it("migrates v4 store to v5 with default avatar/lastSettingsTab keys", () => {
    const s = createSettings();
    s.set({ workspace: "D:\\Test", version: 4 });
    const s2 = createSettings();
    expect(s2.get("version")).toBe(5);
    expect(s2.get("avatar.size")).toBe(80);
    expect(s2.get("avatar.margin")).toBe(16);
    expect(s2.get("avatar.lastPosition")).toBe("bottom-right");
    expect(s2.get("ui.lastSettingsTab")).toBe("workspace");
    expect(s2.get("workspace")).toBe("D:\\Test"); // preserved
  });

  it("returns avatar defaults on a fresh install", () => {
    const s = createSettings();
    expect(s.get("avatar.size")).toBe(80);
    expect(s.get("avatar.lastPosition")).toBe("bottom-right");
  });
```

Update the existing `"returns full snapshot..."` test's `version` assertion from `4` to `5` if it exists (master may already have it).

- [ ] **Step 2: Run tests to verify failure**

```bash
npx vitest run tests/electron/settings.test.js
```

Expected: FAIL on the new migration assertion (version is 4, not 5).

- [ ] **Step 3: Update `electron/settings.js`**

Three edits:

1. Bump `SCHEMA_VERSION` from `4` to `5`:

```js
const SCHEMA_VERSION = 5;
```

2. Inside `buildDefaults()`, before the `ui:` line, add the `avatar` block. Then update `ui:` to include `lastSettingsTab`:

```js
    avatar: { size: 80, margin: 16, lastPosition: "bottom-right" },
    ui: { theme: "light", logLevel: "info", completedHistorySize: 50, lastSettingsTab: "workspace" },
```

3. Inside `migrate(store)`, append a fourth branch after the `if (v < 4)` block, before the final `store.set("version", SCHEMA_VERSION);`:

```js
  if (v < 5) {
    store.set("avatar", {
      size: store.get("avatar.size") ?? 80,
      margin: store.get("avatar.margin") ?? 16,
      lastPosition: store.get("avatar.lastPosition") ?? "bottom-right",
    });
    store.set("ui.lastSettingsTab", store.get("ui.lastSettingsTab") ?? "workspace");
  }
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npx vitest run tests/electron/settings.test.js
```

Expected: PASS all tests.

---

## Task 5: `tabs.js` — reusable tab strip component

**Files:**
- Create: `electron/renderer/components/tabs.js`

- [ ] **Step 1: Write file**

```js
/**
 * Mount a horizontal tab strip with a body container.
 *
 * @param {HTMLElement} mountEl
 * @param {Array<{id:string,label:string,render:(bodyEl:HTMLElement)=>void|Promise<void>}>} tabs
 * @param {{activeId?:string,onChange?:(id:string)=>void}} opts
 * @returns {{ activate(id:string): void }}
 */
export function mountTabs(mountEl, tabs, opts = {}) {
  let activeId = opts.activeId && tabs.some((t) => t.id === opts.activeId)
    ? opts.activeId
    : tabs[0]?.id;

  mountEl.innerHTML = `
    <div class="tabs-strip" style="display:flex;gap:4px;border-bottom:1px solid #ccc;margin-bottom:16px"></div>
    <div class="tabs-body"></div>
  `;
  const stripEl = mountEl.querySelector(".tabs-strip");
  const bodyEl = mountEl.querySelector(".tabs-body");

  for (const t of tabs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tab-btn";
    btn.dataset.tabId = t.id;
    btn.textContent = t.label;
    btn.style.cssText = "padding:6px 12px;border:none;background:transparent;cursor:pointer;border-bottom:2px solid transparent";
    stripEl.appendChild(btn);
  }

  function activate(id) {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    activeId = id;
    for (const btn of stripEl.querySelectorAll(".tab-btn")) {
      const isActive = btn.dataset.tabId === id;
      btn.style.borderBottomColor = isActive ? "#3b82f6" : "transparent";
      btn.style.fontWeight = isActive ? "600" : "400";
    }
    bodyEl.innerHTML = "";
    Promise.resolve(tab.render(bodyEl)).catch((err) => {
      bodyEl.innerHTML = `<div style="color:red">Lỗi render tab: ${escape(err.message)}</div>`;
    });
    opts.onChange?.(id);
  }

  stripEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (btn) activate(btn.dataset.tabId);
  });

  activate(activeId);
  return { activate };
}

function escape(s) {
  return String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}
```

(No tests — DOM-only component, covered by manual smoke + the settings refactor in Task 6.)

---

## Task 6: Refactor `screens/settings.js` into tabs (incl. new Avatar tab)

**Files:**
- Modify: `electron/renderer/screens/settings.js`

This is the largest single change. The existing single-page implementation (~265 lines) is split into 9 small render functions wired through `mountTabs`. Each render function uses the same `window.api.settings.set(...)` calls — no behaviour changes.

**Strategy:**

- The outer `renderSettings(el)` now sets up the `mountTabs(...)` call.
- Each section becomes a function: `renderWorkspaceTab(el, settings)`, `renderFfmpegTab(...)`, etc.
- The Workspace tab includes both Workspace path + Identifier (per spec §5.5).
- The Telegram tab keeps Ctrl+Q toggle for hidden fields, but only attaches the keydown listener while that tab is active (cleanup on tab switch via the `onChange` callback or tab-local cleanup).
- Reset / Reset-all live in the About tab.

- [ ] **Step 1: Replace `electron/renderer/screens/settings.js`**

```js
import { mountTabs } from "../components/tabs.js";

export async function renderSettings(el) {
  const s = await window.api.settings.get();
  const version = await window.api.app.getVersion();

  el.innerHTML = `
    <div class="screen-header">⚙️ Cài đặt</div>
    <div id="settings-tabs"></div>
  `;

  const mountEl = el.querySelector("#settings-tabs");
  const initialTab = s.ui?.lastSettingsTab ?? "workspace";

  mountTabs(mountEl, [
    { id: "workspace", label: "Workspace", render: (b) => renderWorkspaceTab(b, s) },
    { id: "ffmpeg",    label: "FFmpeg",    render: (b) => renderFfmpegTab(b, s) },
    { id: "render",    label: "Render",    render: (b) => renderRenderTab(b, s) },
    { id: "youtube",   label: "YouTube",   render: (b) => renderYoutubeTab(b, s) },
    { id: "download",  label: "Download",  render: (b) => renderDownloadTab(b, s) },
    { id: "telegram",  label: "Telegram",  render: (b) => renderTelegramTab(b, s) },
    { id: "avatar",    label: "Avatar",    render: (b) => renderAvatarTab(b, s) },
    { id: "log",       label: "Log",       render: (b) => renderLogTab(b, s) },
    { id: "about",     label: "About",     render: (b) => renderAboutTab(b, s, version, () => renderSettings(el)) },
  ], {
    activeId: initialTab,
    onChange: (id) => { window.api.settings.set({ "ui.lastSettingsTab": id }); },
  });
}

function renderWorkspaceTab(el, s) {
  el.innerHTML = `
    <div class="field">
      <label>Workspace</label>
      <div class="field-row">
        <input id="ws" type="text" readonly value="${escapeAttr(s.workspace || "")}">
        <button id="ws-pick">📂 Đổi…</button>
      </div>
      <div class="help">Nơi chứa các thư mục input/output mặc định.</div>
    </div>
    <div class="field">
      <label>🏷️ Mã định danh</label>
      <input id="identifier" type="text" value="${escapeAttr(s.tracking?.identifier ?? "")}">
      <div class="help">Hiện trong tin nhắn Telegram để phân biệt máy / channel. Để trống = fallback theo tên workspace.</div>
    </div>
  `;
  el.querySelector("#ws-pick").addEventListener("click", async () => {
    const p = await window.api.dialog.pickFolder(s.workspace);
    if (p) {
      await window.api.app.ensureWorkspace(p);
      await window.api.settings.set({ workspace: p });
      el.querySelector("#ws").value = p;
    }
  });
  el.querySelector("#identifier").addEventListener("change", (e) =>
    window.api.settings.set({ "tracking.identifier": e.target.value.trim() }));
}

function renderFfmpegTab(el, s) {
  el.innerHTML = `
    <div class="field">
      <label>Encoder</label>
      <select id="encoder">
        ${["auto","libx264","h264_nvenc","h264_qsv","h264_amf"].map((v) =>
          `<option value="${v}" ${v === s.ffmpeg.encoder ? "selected" : ""}>${v}</option>`).join("")}
      </select>
    </div>
    <div class="field">
      <label>Số luồng tối đa</label>
      <input id="maxConcurrent" type="number" min="1" value="${s.ffmpeg.maxConcurrent}">
    </div>
  `;
  el.querySelector("#encoder").addEventListener("change", (e) =>
    window.api.settings.set({ "ffmpeg.encoder": e.target.value }));
  el.querySelector("#maxConcurrent").addEventListener("change", (e) =>
    window.api.settings.set({ "ffmpeg.maxConcurrent": parseInt(e.target.value, 10) }));
}

function renderRenderTab(el, s) {
  el.innerHTML = `
    <div class="field"><label><input id="useGPU" type="checkbox" ${s.render.useGPU ? "checked" : ""}> Dùng GPU mặc định</label></div>
    <div class="field"><label>ChromaKey color</label><input id="chromaColor" type="text" value="${escapeAttr(s.render.chromaKey.color)}"></div>
    <div class="field"><label>Opacity (0–1)</label><input id="opacity" type="number" step="0.05" min="0" max="1" value="${s.render.opacity}"></div>
    <div class="field"><label>Crop height</label><input id="cropHeight" type="number" min="1" value="${s.render.crop.height}"></div>
    <div class="field"><label>Crop yOffset</label><input id="cropYOffset" type="number" min="0" value="${s.render.crop.yOffset}"></div>
  `;
  el.querySelector("#useGPU").addEventListener("change", (e) =>
    window.api.settings.set({ "render.useGPU": e.target.checked }));
  el.querySelector("#chromaColor").addEventListener("change", (e) =>
    window.api.settings.set({ "render.chromaKey.color": e.target.value }));
  el.querySelector("#opacity").addEventListener("change", (e) =>
    window.api.settings.set({ "render.opacity": parseFloat(e.target.value) }));
  el.querySelector("#cropHeight").addEventListener("change", (e) =>
    window.api.settings.set({ "render.crop.height": parseInt(e.target.value, 10) }));
  el.querySelector("#cropYOffset").addEventListener("change", (e) =>
    window.api.settings.set({ "render.crop.yOffset": parseInt(e.target.value, 10) }));
}

function renderYoutubeTab(el, s) {
  el.innerHTML = `
    <div class="field">
      <label>API key</label>
      <div class="field-row">
        <input id="yt-key" type="password" value="${escapeAttr(s.youtube.apiKey)}">
        <button type="button" id="yt-key-show">👁</button>
      </div>
    </div>
    <div class="field">
      <label>Min duration (phút)</label>
      <input id="yt-min" type="number" min="0" value="${s.youtube.minDurationMinutes}">
    </div>
    <div class="field">
      <label>Sort order</label>
      <select id="yt-sort">
        ${["LATEST","VIEW","MIX"].map((v) =>
          `<option value="${v}" ${v === s.youtube.sortOrder ? "selected" : ""}>${v}</option>`).join("")}
      </select>
    </div>
  `;
  el.querySelector("#yt-key").addEventListener("change", (e) =>
    window.api.settings.set({ "youtube.apiKey": e.target.value }));
  el.querySelector("#yt-min").addEventListener("change", (e) =>
    window.api.settings.set({ "youtube.minDurationMinutes": parseInt(e.target.value, 10) }));
  el.querySelector("#yt-sort").addEventListener("change", (e) =>
    window.api.settings.set({ "youtube.sortOrder": e.target.value }));
  el.querySelector("#yt-key-show").addEventListener("click", () => {
    const i = el.querySelector("#yt-key");
    i.type = i.type === "password" ? "text" : "password";
  });
}

function renderDownloadTab(el, s) {
  el.innerHTML = `
    <div class="field">
      <label>yt-dlp path</label>
      <div class="field-row">
        <input id="yt-path" type="text" value="${escapeAttr(s.download.ytdlpPath)}">
        <button type="button" id="yt-path-pick">📂 Đổi…</button>
      </div>
    </div>
    <div class="field"><label><input id="yt-auto" type="checkbox" ${s.download.autoUpdateYtDlp ? "checked" : ""}> Tự cập nhật yt-dlp khi mở app</label></div>
    <div class="field">
      <label>Max parallel downloads <span id="dl-cc-val">${s.download.maxConcurrent}</span></label>
      <input id="dl-cc" type="range" min="1" max="5" value="${s.download.maxConcurrent}">
    </div>
    <div class="field">
      <label>yt-dlp status</label>
      <div id="yt-status" class="help">Đang kiểm tra...</div>
      <button type="button" id="yt-update">⬇️ Cập nhật ngay</button>
    </div>
  `;
  el.querySelector("#yt-path").addEventListener("change", (e) =>
    window.api.settings.set({ "download.ytdlpPath": e.target.value }));
  el.querySelector("#yt-auto").addEventListener("change", (e) =>
    window.api.settings.set({ "download.autoUpdateYtDlp": e.target.checked }));
  el.querySelector("#yt-path-pick").addEventListener("click", async () => {
    const p = await window.api.dialog.pickFile({
      filters: [{ name: "yt-dlp", extensions: ["exe"] }],
    });
    if (p) {
      el.querySelector("#yt-path").value = p;
      await window.api.settings.set({ "download.ytdlpPath": p });
      refreshYtdlpStatus();
    }
  });
  const ccSlider = el.querySelector("#dl-cc");
  ccSlider.addEventListener("input", () => {
    el.querySelector("#dl-cc-val").textContent = ccSlider.value;
    window.api.settings.set({ "download.maxConcurrent": parseInt(ccSlider.value, 10) });
  });
  el.querySelector("#yt-update").addEventListener("click", async () => {
    await window.api.ytdlp.update();
    setTimeout(refreshYtdlpStatus, 500);
  });
  async function refreshYtdlpStatus() {
    const st = await window.api.ytdlp.getStatus();
    const txt = st.exists
      ? `Đã cài (version ${st.version ?? "?"}, cập nhật ${st.lastModified ? new Date(st.lastModified).toLocaleString("vi-VN") : "?"})`
      : `Chưa cài tại ${st.path}`;
    const node = el.querySelector("#yt-status");
    if (node) node.textContent = txt;
  }
  refreshYtdlpStatus();
}

function renderTelegramTab(el, s) {
  el.innerHTML = `
    <div class="field">
      <label>Bot token</label>
      <div class="field-row">
        <input id="tg-token" type="password" value="${escapeAttr(s.telegram?.token ?? "")}">
        <button type="button" id="tg-token-show">👁</button>
      </div>
    </div>
    <div id="tg-secret" style="display:none">
      <div class="field">
        <label>Group ID</label>
        <input id="tg-group" type="number" value="${s.telegram?.groupId ?? ""}">
      </div>
      <div class="field">
        <label>Tracking chat ID</label>
        <input id="tg-tracking" type="number" value="${s.telegram?.trackingChatId ?? ""}">
      </div>
    </div>
    <div class="help">Nhấn Ctrl+Q để hiện/ẩn Group ID và Tracking chat ID.</div>
  `;
  el.querySelector("#tg-token").addEventListener("change", (e) =>
    window.api.settings.set({ "telegram.token": e.target.value }));
  el.querySelector("#tg-group").addEventListener("change", (e) =>
    window.api.settings.set({ "telegram.groupId": parseInt(e.target.value, 10) }));
  el.querySelector("#tg-tracking").addEventListener("change", (e) =>
    window.api.settings.set({ "telegram.trackingChatId": parseInt(e.target.value, 10) }));
  el.querySelector("#tg-token-show").addEventListener("click", () => {
    const i = el.querySelector("#tg-token");
    i.type = i.type === "password" ? "text" : "password";
  });

  const onKeydown = (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === "q") {
      e.preventDefault();
      const secret = el.querySelector("#tg-secret");
      if (secret) secret.style.display = secret.style.display === "none" ? "" : "none";
    }
  };
  document.addEventListener("keydown", onKeydown);
  // Best-effort cleanup: when the tab body is replaced, remove listener.
  const obs = new MutationObserver(() => {
    if (!document.body.contains(el)) {
      document.removeEventListener("keydown", onKeydown);
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

function renderAvatarTab(el, s) {
  el.innerHTML = `
    <div class="field">
      <label>Avatar size (px)</label>
      <input id="av-size" type="number" min="16" max="512" value="${s.avatar?.size ?? 80}">
    </div>
    <div class="field">
      <label>Margin từ mép (px)</label>
      <input id="av-margin" type="number" min="0" max="256" value="${s.avatar?.margin ?? 16}">
      <div class="help">Khoảng cách từ avatar đến mép thumbnail (chỉ áp dụng với 4 góc, không áp dụng vị trí giữa).</div>
    </div>
  `;
  el.querySelector("#av-size").addEventListener("change", (e) =>
    window.api.settings.set({ "avatar.size": parseInt(e.target.value, 10) }));
  el.querySelector("#av-margin").addEventListener("change", (e) =>
    window.api.settings.set({ "avatar.margin": parseInt(e.target.value, 10) }));
}

function renderLogTab(el, s) {
  el.innerHTML = `
    <div class="field">
      <label>Mức log</label>
      <select id="logLevel">
        ${["error","warn","info","debug"].map((v) =>
          `<option value="${v}" ${v === s.ui.logLevel ? "selected" : ""}>${v}</option>`).join("")}
      </select>
    </div>
    <button id="open-log">Mở file log</button>
  `;
  el.querySelector("#logLevel").addEventListener("change", (e) =>
    window.api.settings.set({ "ui.logLevel": e.target.value }));
  el.querySelector("#open-log").addEventListener("click", () => window.api.shell.openLogFile());
}

function renderAboutTab(el, s, version, rerender) {
  el.innerHTML = `
    <p>Version: <strong>${version}</strong></p>
    <button id="reset" class="danger">Reset settings về mặc định (giữ workspace + định danh)</button>
    <button id="reset-all" class="danger" style="margin-left:8px">🗑 Xoá toàn bộ dữ liệu — làm lại từ đầu</button>
    <div class="help" style="margin-top:6px">"Xoá toàn bộ" sẽ xoá settings + workspace + định danh + lastConfig. App sẽ reload và yêu cầu onboarding lại. Files trong folder workspace KHÔNG bị xoá.</div>
  `;
  el.querySelector("#reset").addEventListener("click", async () => {
    if (!confirm("Reset toàn bộ cài đặt về mặc định? (Workspace path sẽ giữ nguyên)")) return;
    const ws = (await window.api.settings.get("workspace")) || "";
    const ytdlpPath = (await window.api.settings.get("download.ytdlpPath")) || "";
    await window.api.settings.set({
      ffmpeg: { encoder: "auto", maxConcurrent: 2 },
      render: {
        useGPU: false, chromaKey: { color: "#D4F9D7", similarity: 0.2 },
        opacity: 0.7, crop: { height: 220, yOffset: 490 },
        keepColor: { enabled: false, list: ["#FBFF02"] },
      },
      youtube: {
        apiKey: "AIzaSyDZTsPGvG0u5du3t7YGueGgnNi7IiulMus",
        minDurationMinutes: 8,
        sortOrder: "VIEW",
      },
      download: { ytdlpPath, autoUpdateYtDlp: false, maxConcurrent: 3 },
      telegram: {
        token: "8001545106:AAGRfvKJx1Rq1WFENtjAbXe9eCOSEINVdK0",
        groupId: -5227711965,
        trackingChatId: 8335894661,
      },
      avatar: { size: 80, margin: 16, lastPosition: "bottom-right" },
      ui: { theme: "light", logLevel: "info", completedHistorySize: 50, lastSettingsTab: "about" },
      workspace: ws,
    });
    rerender();
  });
  el.querySelector("#reset-all").addEventListener("click", async () => {
    const confirmed = confirm(
      "Bạn chắc chắn muốn XOÁ TOÀN BỘ DỮ LIỆU?\n\n" +
      "- Settings, workspace path, định danh, lastConfig sẽ bị xoá.\n" +
      "- App sẽ reload và yêu cầu onboarding lại.\n" +
      "- Files trong folder workspace KHÔNG bị xoá.\n\n" +
      "Hành động này không thể hoàn tác."
    );
    if (!confirmed) return;
    await window.api.settings.resetAll();
    location.reload();
  });
}

function escapeAttr(s) {
  return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}
```

- [ ] **Step 2: Manual smoke**

```bash
npm run dev
```

Click each tab and verify:
- All form controls render with correct values from settings.
- Changing a value persists (close and reopen the screen, value sticks).
- Telegram tab Ctrl+Q toggle works.
- Workspace tab still triggers ensureWorkspace dialog.
- About tab Reset and Reset-all both work as before.
- Active tab persists across app restart (check `ui.lastSettingsTab` in `%APPDATA%\VidMaster\config.json`).

---

## Task 7: Sidebar — add 7th nav item

**Files:**
- Modify: `electron/renderer/components/sidebar.js`

- [ ] **Step 1: Add nav item**

In `NAV_ITEMS[0].items`, after the existing `download` entry:

```js
    { id: "thumbAvatar", icon: "😂", label: "Gắn avatar vào thumbnail" },
```

---

## Task 8: `screens/thumbAvatar.js` — task form

**Files:**
- Create: `electron/renderer/screens/thumbAvatar.js`

- [ ] **Step 1: Write file**

```js
import { toast } from "../components/toast.js";

const POSITIONS = [
  { id: "top-left",     label: "Trên trái" },
  { id: "top-right",    label: "Trên phải" },
  { id: "bottom-left",  label: "Dưới trái" },
  { id: "bottom-right", label: "Dưới phải" },
  { id: "center",       label: "Giữa" },
];

export async function renderThumbAvatar(el) {
  const s = await window.api.settings.get();
  const ws = await window.api.app.getWorkspace();
  const last = s.lastConfig?.thumbAvatar ?? {};
  const lastThumb = last.thumbDir ?? `${ws}\\thumbs`;
  const lastAvatar = last.avatarDir ?? `${ws}\\avatars`;
  const lastOutput = last.output ?? `${ws}\\thumb_output`;
  const lastPosition = s.avatar?.lastPosition ?? "bottom-right";
  const size = s.avatar?.size ?? 80;

  el.innerHTML = `
    <div class="screen-header">😂 Gắn avatar vào thumbnail</div>
    <p class="screen-subtitle">Mỗi avatar sinh ra 1 folder chứa các thumbnail đã chèn avatar đó.</p>
    <form id="task-form">
      <div class="field">
        <label>📁 Folder thumbnail (.jpg)</label>
        <div class="field-row">
          <input id="thumb-dir" type="text" value="${escapeAttr(lastThumb)}" required>
          <button type="button" id="pick-thumb">📂 Chọn…</button>
        </div>
      </div>
      <div class="field">
        <label>📁 Folder avatar (.jpg/.png)</label>
        <div class="field-row">
          <input id="avatar-dir" type="text" value="${escapeAttr(lastAvatar)}" required>
          <button type="button" id="pick-avatar">📂 Chọn…</button>
        </div>
      </div>
      <div class="field">
        <label>📁 Folder output</label>
        <div class="field-row">
          <input id="output" type="text" value="${escapeAttr(lastOutput)}" required>
          <button type="button" id="pick-output">📂 Chọn…</button>
        </div>
      </div>
      <div class="field">
        <label>📍 Vị trí avatar</label>
        <div style="display:flex;flex-direction:column;gap:4px;margin-top:4px">
          ${POSITIONS.map((p) => `
            <label><input type="radio" name="position" value="${p.id}" ${p.id === lastPosition ? "checked" : ""}> ${p.label}</label>
          `).join("")}
        </div>
        <div class="help">Avatar size: <strong>${size}×${size} px</strong> (đổi trong Settings → Avatar)</div>
      </div>
      <button type="submit" class="primary">▶  Thực hiện</button>
    </form>
  `;

  el.querySelector("#pick-thumb").addEventListener("click", async () => {
    const cur = el.querySelector("#thumb-dir").value;
    const p = await window.api.dialog.pickFolder(cur);
    if (p) el.querySelector("#thumb-dir").value = p;
  });
  el.querySelector("#pick-avatar").addEventListener("click", async () => {
    const cur = el.querySelector("#avatar-dir").value;
    const p = await window.api.dialog.pickFolder(cur);
    if (p) el.querySelector("#avatar-dir").value = p;
  });
  el.querySelector("#pick-output").addEventListener("click", async () => {
    const cur = el.querySelector("#output").value;
    const p = await window.api.dialog.pickFolder(cur);
    if (p) el.querySelector("#output").value = p;
  });

  el.querySelector("#task-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const thumbDir = el.querySelector("#thumb-dir").value.trim();
    const avatarDir = el.querySelector("#avatar-dir").value.trim();
    const output = el.querySelector("#output").value.trim();
    const position = el.querySelector('input[name="position"]:checked')?.value;
    if (!thumbDir || !avatarDir || !output || !position) return;

    const config = {
      thumbDir, avatarDir, output, position,
      size: s.avatar?.size ?? 80,
      margin: s.avatar?.margin ?? 16,
    };
    await window.api.queue.add({ type: "thumbAvatar", config });
    await window.api.settings.set({
      "lastConfig.thumbAvatar": { thumbDir, avatarDir, output },
      "avatar.lastPosition": position,
    });
    toast({ kind: "success", message: "✅ Đã thêm vào hàng đợi" });
  });
}

function escapeAttr(s) {
  return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}
```

---

## Task 9: Wire runner + label

**Files:**
- Modify: `electron/ipc/queue.js`
- Modify: `electron/renderer/main.js`

- [ ] **Step 1: Update queue.js**

Add import at the top of `electron/ipc/queue.js`:

```js
import { runThumbAvatar } from "../../src/thumbAvatar.js";
```

Add to the `runners` object:

```js
  thumbAvatar: runThumbAvatar,
```

- [ ] **Step 2: Update renderer/main.js**

Add import:

```js
import { renderThumbAvatar } from "./screens/thumbAvatar.js";
```

Add to `screens` object:

```js
  thumbAvatar: renderThumbAvatar,
```

Add to `TASK_LABELS` object:

```js
  thumbAvatar: "Gắn avatar",
```

---

## Task 10: Final verification (no commit)

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass (existing baseline + 4 new from circleCrop + 8 new from thumbAvatar + 2 new settings migration tests).

- [ ] **Step 2: Manual smoke**

```bash
npm run dev
```

Run through the spec §10 checklist:
- Settings opens on last-selected tab; tab switching works.
- Avatar tab persists size/margin changes across restart.
- thumbAvatar task with 2 thumbs × 3 avatars → 6 outputs in 3 folders.
- All 5 positions visually correct on a 1280×720 thumbnail.
- Cancel mid-run; status = "cancelled".
- Telegram tab Ctrl+Q reveal still works.

- [ ] **Step 3: Leave changes as unstaged diff**

Per standing rule: do NOT commit. Show user the working-tree summary:

```bash
git status --short
git diff --stat
```

User reviews and decides commit strategy.

---

## Self-Review

After implementation, verify against the spec:

1. **Spec coverage**:
   - §3 task flow → Tasks 2 (circleCrop) + 3 (thumbAvatar)
   - §4 form + sidebar → Tasks 7 + 8
   - §5 tabs refactor → Tasks 5 + 6
   - §6 schema migration → Task 4
   - §7 IPC (no new handlers) → Task 9 only adds runner registration
   - §8 errors → covered in module (Task 3)
   - §9 tests → Tasks 1 + 2 + 3 + 4
   - §10 manual smoke → Task 10

2. **Placeholder scan**: no TBD/TODO/"add appropriate".

3. **Type consistency**: `runThumbAvatar` returns `{ ok, outputs, errors }` — matches QueueManager. `circleCrop(input, size)` returns `Buffer` — matches caller in thumbAvatar.

4. **Branch hygiene**: implementation on `worktree-feat-thumb-avatar`. No commits per standing rule. All changes staged for user review at the end.
