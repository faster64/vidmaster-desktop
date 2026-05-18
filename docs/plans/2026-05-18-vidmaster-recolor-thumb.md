# VidMaster Recolor Thumbnail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm task thứ 9 vào VidMaster — "🎨 Đổi màu thumbnail": batch thay vùng có một màu chủ đạo (Chebyshev tolerance) trong ảnh `.jpg/.png` bằng gradient theo trục dọc/ngang. Hỗ trợ eyedropper trên ảnh mẫu và live preview trước khi chạy batch.

**Architecture:** Pure ESM module `src/_lib/recolorImage.js` xử lý buffer RGBA dùng được cả trong renderer (preview qua canvas) lẫn main (batch qua `sharp.raw()`). Renderer screen có form + canvas preview + eyedropper. Main process đăng ký task type `recolorThumb` trong queue; thêm 2 IPC `fs:listImages` và `fs:readImageDataUrl` để renderer load ảnh mẫu.

**Tech Stack:** Electron 30, sharp 0.33, vanilla JS (renderer), Vitest 1.6, electron-store.

**Reference spec:** [docs/specs/2026-05-18-vidmaster-recolor-thumb-design.md](../specs/2026-05-18-vidmaster-recolor-thumb-design.md)

**Commit policy (user preference):** Do NOT auto-commit. Each task ends with `git diff` review only — leave changes unstaged.

---

## File Structure

**Create:**
- `src/_lib/recolorImage.js` — pure module: `recolorPixels`, `hexToRgb`, `rgbToHex`.
- `src/recolorThumb.js` — task module: `runRecolorThumb(config)`.
- `electron/renderer/screens/recolorThumb.js` — UI screen: `renderRecolorThumb(el)`.
- `tests/_lib/recolorImage.test.js` — unit tests for algorithm + helpers.
- `tests/recolorThumb.test.js` — task validation + abort + happy-path tests.

**Modify:**
- `electron/ipc/fs.js` — register `fs:listImages` and `fs:readImageDataUrl` IPC handlers.
- `electron/preload.mjs` — expose `window.api.fs.listImages` and `window.api.fs.readImageDataUrl`.
- `electron/ipc/queue.js` — register `recolorThumb: runRecolorThumb` runner.
- `electron/renderer/main.js` — import `renderRecolorThumb`, register in `screens`, add label.
- `electron/renderer/components/sidebar.js` — insert nav item `recolorThumb` after `thumbAvatar`.

---

## Task 1: Pure helpers `hexToRgb` / `rgbToHex` (TDD)

**Files:**
- Create: `src/_lib/recolorImage.js`
- Create: `tests/_lib/recolorImage.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/_lib/recolorImage.test.js`:

```js
import { describe, it, expect } from "vitest";
import { hexToRgb, rgbToHex } from "../../src/_lib/recolorImage.js";

describe("hexToRgb", () => {
  it("parses #RRGGBB into {r,g,b}", () => {
    expect(hexToRgb("#7A97C1")).toEqual({ r: 0x7A, g: 0x97, b: 0xC1 });
    expect(hexToRgb("#FFC0CB")).toEqual({ r: 0xFF, g: 0xC0, b: 0xCB });
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb("#FFFFFF")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("is case-insensitive on hex digits", () => {
    expect(hexToRgb("#abcdef")).toEqual({ r: 0xAB, g: 0xCD, b: 0xEF });
  });

  it("throws on invalid input", () => {
    expect(() => hexToRgb("")).toThrow(/sai format/);
    expect(() => hexToRgb("abc")).toThrow(/sai format/);
    expect(() => hexToRgb("#GGG")).toThrow(/sai format/);
    expect(() => hexToRgb("#7A97C")).toThrow(/sai format/);
    expect(() => hexToRgb("7A97C1")).toThrow(/sai format/);
    expect(() => hexToRgb("#7A97C1F")).toThrow(/sai format/);
  });
});

describe("rgbToHex", () => {
  it("formats {r,g,b} into uppercase #RRGGBB", () => {
    expect(rgbToHex({ r: 0x7A, g: 0x97, b: 0xC1 })).toBe("#7A97C1");
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
    expect(rgbToHex({ r: 255, g: 255, b: 255 })).toBe("#FFFFFF");
  });

  it("round-trips with hexToRgb", () => {
    for (const hex of ["#7A97C1", "#FFC0CB", "#FF69B4", "#012345", "#ABCDEF"]) {
      expect(rgbToHex(hexToRgb(hex))).toBe(hex.toUpperCase());
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/_lib/recolorImage.test.js`
Expected: FAIL — module `src/_lib/recolorImage.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/_lib/recolorImage.js`:

```js
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export function hexToRgb(hex) {
  if (typeof hex !== "string" || !HEX_RE.test(hex)) {
    throw new Error("Màu sai format (cần #RRGGBB)");
  }
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

export function rgbToHex({ r, g, b }) {
  const h = (n) => n.toString(16).padStart(2, "0").toUpperCase();
  return `#${h(r)}${h(g)}${h(b)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/_lib/recolorImage.test.js`
Expected: PASS — 4 tests in 2 describe blocks.

- [ ] **Step 5: Stop — review diff, do NOT commit**

Run: `git status` then `git diff src/_lib/recolorImage.js tests/_lib/recolorImage.test.js`
Leave changes unstaged.

---

## Task 2: `recolorPixels` core algorithm (TDD)

**Files:**
- Modify: `src/_lib/recolorImage.js`
- Modify: `tests/_lib/recolorImage.test.js`

- [ ] **Step 1: Append failing tests**

Append to `tests/_lib/recolorImage.test.js` (after the existing describe blocks):

```js
import { recolorPixels } from "../../src/_lib/recolorImage.js";

/**
 * Build an RGBA buffer of size (w*h) and fill every pixel with the same color.
 */
function makeBuffer(w, h, { r, g, b, a = 255 }) {
  const buf = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  }
  return buf;
}

function pixelAt(buf, w, x, y) {
  const i = (y * w + x) * 4;
  return { r: buf[i], g: buf[i + 1], b: buf[i + 2], a: buf[i + 3] };
}

const PARAMS_VERTICAL = {
  sourceColor:       { r: 0x7A, g: 0x97, b: 0xC1 },
  tolerance:         20,
  gradientStart:     { r: 0xFF, g: 0xC0, b: 0xCB },
  gradientEnd:       { r: 0xFF, g: 0x69, b: 0xB4 },
  gradientDirection: "vertical",
};

describe("recolorPixels", () => {
  it("replaces pixel exactly matching source with gradient start at y=0", () => {
    const buf = makeBuffer(1, 4, { r: 0x7A, g: 0x97, b: 0xC1 });
    recolorPixels(buf, 1, 4, PARAMS_VERTICAL);
    expect(pixelAt(buf, 1, 0, 0)).toEqual({ r: 0xFF, g: 0xC0, b: 0xCB, a: 255 });
  });

  it("replaces pixel at y=h-1 with ≈ gradient end (within ±1 due to rounding)", () => {
    const buf = makeBuffer(1, 4, { r: 0x7A, g: 0x97, b: 0xC1 });
    recolorPixels(buf, 1, 4, PARAMS_VERTICAL);
    // ratio at y=3 is 3/4 = 0.75; gradient lerp from #FFC0CB to #FF69B4
    // expected R=255, G=round(0xC0 + (0x69-0xC0)*0.75)=round(192-65.25)=127, B=round(0xCB + (0xB4-0xCB)*0.75)=round(203-17.25)=186
    const p = pixelAt(buf, 1, 0, 3);
    expect(p.r).toBe(255);
    expect(p.g).toBeGreaterThanOrEqual(126);
    expect(p.g).toBeLessThanOrEqual(128);
    expect(p.b).toBeGreaterThanOrEqual(185);
    expect(p.b).toBeLessThanOrEqual(187);
    expect(p.a).toBe(255);
  });

  it("leaves pixels outside tolerance untouched", () => {
    const buf = makeBuffer(1, 1, { r: 10, g: 10, b: 10 });
    recolorPixels(buf, 1, 1, PARAMS_VERTICAL);
    expect(pixelAt(buf, 1, 0, 0)).toEqual({ r: 10, g: 10, b: 10, a: 255 });
  });

  it("treats |delta|=tolerance as inclusive (matches C# <=)", () => {
    // source #7A97C1, tolerance 20 → R can be 0x7A+20=0x8E and still match
    const buf = makeBuffer(1, 1, { r: 0x7A + 20, g: 0x97, b: 0xC1 });
    recolorPixels(buf, 1, 1, PARAMS_VERTICAL);
    // At y=0/h=1 ratio=0 → gradient start
    expect(pixelAt(buf, 1, 0, 0)).toEqual({ r: 0xFF, g: 0xC0, b: 0xCB, a: 255 });
  });

  it("tolerance=0 only changes pixels exactly equal to source", () => {
    const params = { ...PARAMS_VERTICAL, tolerance: 0 };
    const buf = new Uint8ClampedArray([
      0x7A, 0x97, 0xC1, 255,   // exact match
      0x7B, 0x97, 0xC1, 255,   // one channel off by 1
    ]);
    recolorPixels(buf, 2, 1, params);
    // pixel 0 changed (gradient start, ratio x/2 = 0)
    expect([buf[0], buf[1], buf[2]]).toEqual([0xFF, 0xC0, 0xCB]);
    // pixel 1 unchanged
    expect([buf[4], buf[5], buf[6]]).toEqual([0x7B, 0x97, 0xC1]);
  });

  it("horizontal direction uses x/width instead of y/height", () => {
    const params = { ...PARAMS_VERTICAL, gradientDirection: "horizontal" };
    const buf = makeBuffer(4, 1, { r: 0x7A, g: 0x97, b: 0xC1 });
    recolorPixels(buf, 4, 1, params);
    // pixel x=0 → ratio 0 → start
    expect(pixelAt(buf, 4, 0, 0)).toEqual({ r: 0xFF, g: 0xC0, b: 0xCB, a: 255 });
    // pixel x=3 → ratio 3/4 = 0.75 → close to end (same expected as vertical y=3 test)
    const p = pixelAt(buf, 4, 3, 0);
    expect(p.r).toBe(255);
    expect(p.g).toBeGreaterThanOrEqual(126);
    expect(p.g).toBeLessThanOrEqual(128);
  });

  it("preserves alpha channel", () => {
    const buf = makeBuffer(1, 1, { r: 0x7A, g: 0x97, b: 0xC1, a: 128 });
    recolorPixels(buf, 1, 1, PARAMS_VERTICAL);
    expect(pixelAt(buf, 1, 0, 0).a).toBe(128);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/_lib/recolorImage.test.js`
Expected: FAIL — `recolorPixels` is not exported.

- [ ] **Step 3: Append the implementation**

Append to `src/_lib/recolorImage.js`:

```js
export function recolorPixels(rgba, width, height, params) {
  const { sourceColor, tolerance, gradientStart, gradientEnd, gradientDirection } = params;
  const sR = sourceColor.r, sG = sourceColor.g, sB = sourceColor.b;
  const t = tolerance;
  const rMin = sR - t, rMax = sR + t;
  const gMin = sG - t, gMax = sG + t;
  const bMin = sB - t, bMax = sB + t;
  const startR = gradientStart.r, startG = gradientStart.g, startB = gradientStart.b;
  const deltaR = gradientEnd.r - startR;
  const deltaG = gradientEnd.g - startG;
  const deltaB = gradientEnd.b - startB;
  const horizontal = gradientDirection === "horizontal";

  for (let y = 0; y < height; y++) {
    const ratioY = horizontal ? 0 : y / height;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const R = rgba[i], G = rgba[i + 1], B = rgba[i + 2];
      if (R >= rMin && R <= rMax && G >= gMin && G <= gMax && B >= bMin && B <= bMax) {
        const ratio = horizontal ? x / width : ratioY;
        rgba[i]     = Math.round(startR + deltaR * ratio);
        rgba[i + 1] = Math.round(startG + deltaG * ratio);
        rgba[i + 2] = Math.round(startB + deltaB * ratio);
        // alpha rgba[i+3] preserved
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/_lib/recolorImage.test.js`
Expected: PASS — 7 tests in the `recolorPixels` describe block (plus prior `hexToRgb`/`rgbToHex` tests).

- [ ] **Step 5: Stop — review diff, do NOT commit**

Run: `git diff src/_lib/recolorImage.js tests/_lib/recolorImage.test.js`
Leave unstaged.

---

## Task 3: Task module `runRecolorThumb` — validation (TDD)

**Files:**
- Create: `src/recolorThumb.js`
- Create: `tests/recolorThumb.test.js`

- [ ] **Step 1: Write failing validation tests**

Create `tests/recolorThumb.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { runRecolorThumb } from "../src/recolorThumb.js";

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-recolor-")); });
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

const VALID_PARAMS = {
  sourceColor: "#7A97C1",
  tolerance: 70,
  gradientStart: "#FFC0CB",
  gradientEnd: "#FF69B4",
  gradientDirection: "vertical",
};

describe("runRecolorThumb — validation", () => {
  it("rejects when inputDir missing", async () => {
    await expect(runRecolorThumb({
      inputDir: "", output: tmpDir, ...VALID_PARAMS,
    })).rejects.toThrow(/không tồn tại/);
  });

  it("rejects when inputDir does not exist", async () => {
    await expect(runRecolorThumb({
      inputDir: path.join(tmpDir, "nope"), output: tmpDir, ...VALID_PARAMS,
    })).rejects.toThrow(/không tồn tại/);
  });

  it("rejects when output is empty", async () => {
    await expect(runRecolorThumb({
      inputDir: tmpDir, output: "", ...VALID_PARAMS,
    })).rejects.toThrow(/output/);
  });

  it("rejects when inputDir has no .jpg/.png", async () => {
    const inputDir = path.join(tmpDir, "in");
    fs.mkdirSync(inputDir);
    fs.writeFileSync(path.join(inputDir, "readme.txt"), "");
    await expect(runRecolorThumb({
      inputDir, output: path.join(tmpDir, "out"), ...VALID_PARAMS,
    })).rejects.toThrow(/không có file ảnh/);
  });

  it("rejects when sourceColor hex is invalid", async () => {
    const inputDir = path.join(tmpDir, "in");
    fs.mkdirSync(inputDir);
    fs.writeFileSync(path.join(inputDir, "a.jpg"), "");
    await expect(runRecolorThumb({
      inputDir, output: path.join(tmpDir, "out"),
      ...VALID_PARAMS, sourceColor: "not-hex",
    })).rejects.toThrow(/sai format/);
  });

  it("rejects when gradientStart hex is invalid", async () => {
    const inputDir = path.join(tmpDir, "in");
    fs.mkdirSync(inputDir);
    fs.writeFileSync(path.join(inputDir, "a.jpg"), "");
    await expect(runRecolorThumb({
      inputDir, output: path.join(tmpDir, "out"),
      ...VALID_PARAMS, gradientStart: "#GGGGGG",
    })).rejects.toThrow(/sai format/);
  });

  it("rejects when tolerance is below 0", async () => {
    const inputDir = path.join(tmpDir, "in");
    fs.mkdirSync(inputDir);
    fs.writeFileSync(path.join(inputDir, "a.jpg"), "");
    await expect(runRecolorThumb({
      inputDir, output: path.join(tmpDir, "out"),
      ...VALID_PARAMS, tolerance: -1,
    })).rejects.toThrow(/Tolerance/);
  });

  it("rejects when tolerance is above 255", async () => {
    const inputDir = path.join(tmpDir, "in");
    fs.mkdirSync(inputDir);
    fs.writeFileSync(path.join(inputDir, "a.jpg"), "");
    await expect(runRecolorThumb({
      inputDir, output: path.join(tmpDir, "out"),
      ...VALID_PARAMS, tolerance: 300,
    })).rejects.toThrow(/Tolerance/);
  });

  it("rejects when tolerance is not an integer", async () => {
    const inputDir = path.join(tmpDir, "in");
    fs.mkdirSync(inputDir);
    fs.writeFileSync(path.join(inputDir, "a.jpg"), "");
    await expect(runRecolorThumb({
      inputDir, output: path.join(tmpDir, "out"),
      ...VALID_PARAMS, tolerance: 1.5,
    })).rejects.toThrow(/Tolerance/);
  });

  it("rejects when gradientDirection is invalid", async () => {
    const inputDir = path.join(tmpDir, "in");
    fs.mkdirSync(inputDir);
    fs.writeFileSync(path.join(inputDir, "a.jpg"), "");
    await expect(runRecolorThumb({
      inputDir, output: path.join(tmpDir, "out"),
      ...VALID_PARAMS, gradientDirection: "diagonal",
    })).rejects.toThrow(/gradientDirection/);
  });

  it("throws AbortError when signal already fired", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(runRecolorThumb({
      inputDir: tmpDir, output: tmpDir, ...VALID_PARAMS, signal: ctrl.signal,
    })).rejects.toThrow(/Aborted/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/recolorThumb.test.js`
Expected: FAIL — `src/recolorThumb.js` does not exist.

- [ ] **Step 3: Write minimal implementation (validation only)**

Create `src/recolorThumb.js`:

```js
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { TaskRunner } from "./_lib/runner.js";
import { recolorPixels, hexToRgb } from "./_lib/recolorImage.js";

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export async function runRecolorThumb(config) {
  const runner = new TaskRunner(config);
  const {
    inputDir, output,
    sourceColor, tolerance,
    gradientStart, gradientEnd, gradientDirection,
  } = config;
  runner.checkAborted();

  if (!inputDir || !fs.existsSync(inputDir)) {
    throw new Error("Folder thumbnail không tồn tại.");
  }
  if (!output) {
    throw new Error("Thiếu folder output.");
  }
  if (!HEX_RE.test(sourceColor) || !HEX_RE.test(gradientStart) || !HEX_RE.test(gradientEnd)) {
    throw new Error("Màu sai format (cần #RRGGBB).");
  }
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 255) {
    throw new Error("Tolerance phải là số nguyên 0–255.");
  }
  if (gradientDirection !== "vertical" && gradientDirection !== "horizontal") {
    throw new Error(`gradientDirection không hợp lệ: ${gradientDirection}`);
  }

  const files = fs.readdirSync(inputDir)
    .filter((n) => /\.(jpe?g|png)$/i.test(n))
    .sort();
  if (files.length === 0) {
    throw new Error("Folder không có file ảnh (.jpg/.png).");
  }

  fs.mkdirSync(output, { recursive: true });

  // Batch processing comes in Task 4.
  return { ok: true, outputs: [], errors: [] };
}
```

- [ ] **Step 4: Run tests to verify validation tests pass**

Run: `npx vitest run tests/recolorThumb.test.js`
Expected: PASS — 11 validation tests pass. (Happy path test in Task 4.)

- [ ] **Step 5: Stop — review diff, do NOT commit**

---

## Task 4: Task module batch processing (TDD with sharp fixtures)

**Files:**
- Modify: `src/recolorThumb.js`
- Modify: `tests/recolorThumb.test.js`

- [ ] **Step 1: Append happy-path test using sharp-generated fixtures**

Append to `tests/recolorThumb.test.js`:

```js
import sharp from "sharp";

async function makeFlatJpeg(p, w, h, color) {
  await sharp({ create: { width: w, height: h, channels: 3, background: color } })
    .jpeg({ quality: 90 }).toFile(p);
}

async function makeFlatPng(p, w, h, color) {
  await sharp({ create: { width: w, height: h, channels: 3, background: color } })
    .png().toFile(p);
}

describe("runRecolorThumb — batch processing", () => {
  it("processes a folder of flat-color jpegs, replacing source color with gradient", async () => {
    const inputDir = path.join(tmpDir, "in");
    const output = path.join(tmpDir, "out");
    fs.mkdirSync(inputDir);
    await makeFlatJpeg(path.join(inputDir, "a.jpg"), 8, 8, { r: 0x7A, g: 0x97, b: 0xC1 });
    await makeFlatJpeg(path.join(inputDir, "b.jpg"), 8, 8, { r: 0x7A, g: 0x97, b: 0xC1 });

    const r = await runRecolorThumb({
      inputDir, output, ...VALID_PARAMS,
    });

    expect(r.ok).toBe(true);
    expect(r.outputs).toHaveLength(2);
    expect(fs.existsSync(path.join(output, "a.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(output, "b.jpg"))).toBe(true);

    // Top row should look like gradient start (pink ≈ #FFC0CB) after recolor.
    const { data, info } = await sharp(path.join(output, "a.jpg")).raw().toBuffer({ resolveWithObject: true });
    const topR = data[0];
    expect(topR).toBeGreaterThan(220); // ≈ 255 with JPEG noise
  }, 30_000);

  it("keeps original extension (.png stays .png)", async () => {
    const inputDir = path.join(tmpDir, "in");
    const output = path.join(tmpDir, "out");
    fs.mkdirSync(inputDir);
    await makeFlatPng(path.join(inputDir, "a.png"), 8, 8, { r: 0x7A, g: 0x97, b: 0xC1 });

    const r = await runRecolorThumb({
      inputDir, output, ...VALID_PARAMS,
    });

    expect(r.ok).toBe(true);
    expect(fs.existsSync(path.join(output, "a.png"))).toBe(true);
    const meta = await sharp(path.join(output, "a.png")).metadata();
    expect(meta.format).toBe("png");
  }, 30_000);

  it("leaves untouched colors alone (pixels outside tolerance)", async () => {
    const inputDir = path.join(tmpDir, "in");
    const output = path.join(tmpDir, "out");
    fs.mkdirSync(inputDir);
    // Pure black image, source #7A97C1 → no match → output is still black-ish.
    await makeFlatJpeg(path.join(inputDir, "black.jpg"), 8, 8, { r: 0, g: 0, b: 0 });

    await runRecolorThumb({ inputDir, output, ...VALID_PARAMS });

    const { data } = await sharp(path.join(output, "black.jpg")).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeLessThan(20);
  }, 30_000);
});
```

- [ ] **Step 2: Run new tests to verify they fail**

Run: `npx vitest run tests/recolorThumb.test.js -t "batch processing"`
Expected: FAIL — current `runRecolorThumb` returns `{ ok: true, outputs: [] }` without actually writing files.

- [ ] **Step 3: Replace the stub with the real batch loop**

Replace the trailing `return { ok: true, outputs: [], errors: [] };` in `src/recolorThumb.js` with:

```js
  const params = {
    sourceColor: hexToRgb(sourceColor),
    tolerance,
    gradientStart: hexToRgb(gradientStart),
    gradientEnd: hexToRgb(gradientEnd),
    gradientDirection,
  };

  const total = files.length;
  const outputs = [];
  const errors = [];

  for (let i = 0; i < total; i++) {
    runner.checkAborted();
    const name = files[i];
    const inPath = path.join(inputDir, name);
    const outPath = path.join(output, name);
    const message = `${i + 1}/${total} ${name}`;
    runner.setProgress((i / total) * 100, message);
    try {
      const { data, info } = await sharp(inPath)
        .rotate()
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      recolorPixels(data, info.width, info.height, params);
      const ext = path.extname(name).toLowerCase();
      const isJpeg = ext === ".jpg" || ext === ".jpeg";
      const pipeline = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
      if (isJpeg) {
        await pipeline.jpeg({ quality: 90 }).toFile(outPath);
      } else {
        await pipeline.png().toFile(outPath);
      }
      outputs.push(outPath);
      runner.log("info", `Saved: ${name}`);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      errors.push({ file: name, message: err.message, stack: err.stack });
      runner.log("error", `${name} failed: ${err.message}`);
    }
    runner.setProgress(((i + 1) / total) * 100, message);
  }

  runner.setProgress(100, "Done");
  return { ok: errors.length === 0, outputs, errors };
```

- [ ] **Step 4: Run all tests for the module**

Run: `npx vitest run tests/recolorThumb.test.js`
Expected: PASS — 14 tests total (11 validation + 3 batch).

- [ ] **Step 5: Run the full test suite to ensure nothing else broke**

Run: `npm test`
Expected: All tests pass. (Existing suite + new tests.)

- [ ] **Step 6: Stop — review diff, do NOT commit**

---

## Task 5: Register queue handler in main process

**Files:**
- Modify: `electron/ipc/queue.js`

- [ ] **Step 1: Add import and runner entry**

Edit `electron/ipc/queue.js` — add the import after the existing `runThumbAvatar` import (around line 10):

```js
import { runRecolorThumb } from "../../src/recolorThumb.js";
```

And inside the `runners` object (around line 19), add `recolorThumb`:

```js
const runners = {
  render: runRender, trimEnds: runTrimEnds, cutBg: runCutBg,
  getUrls: runGetUrls, download: runDownload, concatHeadTail: runConcatHeadTail,
  thumbAvatar: runThumbAvatar,
  recolorThumb: runRecolorThumb,
  trendSearch: runTrendSearch,
  _ytdlpUpdate: runYtdlpUpdate,
};
```

- [ ] **Step 2: Verify the import resolves**

Run: `node --check electron/ipc/queue.js`
Expected: no syntax errors (note: `--check` doesn't resolve imports; if it errors out due to ESM, skip — Step 3 will catch it).

- [ ] **Step 3: Run unit tests to ensure no regression**

Run: `npm test`
Expected: PASS — all existing tests still pass.

- [ ] **Step 4: Stop — review diff, do NOT commit**

---

## Task 6: Add IPC `fs:listImages` and `fs:readImageDataUrl`

**Files:**
- Modify: `electron/ipc/fs.js`
- Modify: `electron/preload.mjs`

- [ ] **Step 1: Register the two new IPC handlers**

Edit `electron/ipc/fs.js` — append inside `registerFsIpc()` (after `fs:writeTrendUrls`):

```js
  ipcMain.handle("fs:listImages", (_, folder) => {
    if (!folder || !fs.existsSync(folder)) return [];
    return fs.readdirSync(folder)
      .filter((n) => /\.(jpe?g|png)$/i.test(n))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  });

  ipcMain.handle("fs:readImageDataUrl", (_, fullPath) => {
    if (!fullPath || !fs.existsSync(fullPath)) return null;
    const ext = path.extname(fullPath).toLowerCase();
    let mime;
    if (ext === ".jpg" || ext === ".jpeg") mime = "image/jpeg";
    else if (ext === ".png") mime = "image/png";
    else return null;
    const b64 = fs.readFileSync(fullPath).toString("base64");
    return `data:${mime};base64,${b64}`;
  });
```

- [ ] **Step 2: Expose them in preload bridge**

Edit `electron/preload.mjs` — inside the `fs:` block (around line 55-61), add the two methods:

```js
  fs: {
    exists: (p) => ipcRenderer.invoke("fs:exists", p),
    listMp4: (folder) => ipcRenderer.invoke("fs:listMp4", folder),
    listImages: (folder) => ipcRenderer.invoke("fs:listImages", folder),
    readImageDataUrl: (p) => ipcRenderer.invoke("fs:readImageDataUrl", p),
    readUrlsFile: (p) => ipcRenderer.invoke("fs:readUrlsFile", p),
    readVideoInfos: (p) => ipcRenderer.invoke("fs:readVideoInfos", p),
    writeTrendUrls: (args) => ipcRenderer.invoke("fs:writeTrendUrls", args),
  },
```

- [ ] **Step 3: Verify with full test run**

Run: `npm test`
Expected: PASS — no regression.

- [ ] **Step 4: Stop — review diff, do NOT commit**

---

## Task 7: Renderer screen — base form (folder pickers + color inputs)

**Files:**
- Create: `electron/renderer/screens/recolorThumb.js`

- [ ] **Step 1: Create the screen file with form structure**

Create `electron/renderer/screens/recolorThumb.js`:

```js
import { toast } from "../components/toast.js";

const DEFAULTS = {
  sourceColor:       "#7A97C1",
  tolerance:         70,
  gradientStart:     "#FFC0CB",
  gradientEnd:       "#FF69B4",
  gradientDirection: "vertical",
};

export async function renderRecolorThumb(el) {
  const s = await window.api.settings.get();
  const ws = await window.api.app.getWorkspace();
  const last = s.lastConfig?.recolorThumb ?? {};
  const lastParams = s.recolor?.last ?? {};
  const inputDir = last.inputDir ?? `${ws}\\thumbs`;
  const output = last.output ?? `${ws}\\recolored`;
  const sourceColor = lastParams.sourceColor ?? DEFAULTS.sourceColor;
  const tolerance = lastParams.tolerance ?? DEFAULTS.tolerance;
  const gradientStart = lastParams.gradientStart ?? DEFAULTS.gradientStart;
  const gradientEnd = lastParams.gradientEnd ?? DEFAULTS.gradientEnd;
  const gradientDirection = lastParams.gradientDirection ?? DEFAULTS.gradientDirection;

  el.innerHTML = `
    <div class="screen-header">🎨 Đổi màu thumbnail</div>
    <p class="screen-subtitle">Thay vùng có 1 màu chủ đạo bằng gradient. Click ảnh để pick màu gốc.</p>
    <div class="recolor-layout" style="display:grid;grid-template-columns:minmax(360px,1fr) minmax(360px,1fr);gap:24px">
      <form id="task-form">
        <div class="field">
          <label>📁 Folder thumbnail (.jpg/.png)</label>
          <div class="field-row">
            <input id="input-dir" type="text" value="${escapeAttr(inputDir)}" required>
            <button type="button" id="pick-input">📂 Chọn…</button>
            <button type="button" data-open-id="input-dir" title="Mở folder">↗</button>
          </div>
        </div>
        <div class="field">
          <label>📁 Folder output</label>
          <div class="field-row">
            <input id="output" type="text" value="${escapeAttr(output)}" required>
            <button type="button" id="pick-output">📂 Chọn…</button>
            <button type="button" data-open-id="output" title="Mở folder">↗</button>
          </div>
        </div>

        <div class="field">
          <label>🖼️ Ảnh mẫu (preview)</label>
          <div class="field-row">
            <select id="sample-select"><option value="">(chưa có ảnh)</option></select>
            <button type="button" id="sample-random" title="Đổi ảnh khác">🔀</button>
          </div>
        </div>

        <div class="field">
          <label>🎯 Màu gốc</label>
          <div class="field-row">
            <span id="src-swatch" class="color-swatch" style="display:inline-block;width:32px;height:32px;border:1px solid #888;background:${sourceColor};vertical-align:middle"></span>
            <input id="src-hex" type="text" value="${escapeAttr(sourceColor)}" pattern="^#[0-9A-Fa-f]{6}$" style="width:110px">
            <button type="button" id="eyedropper" title="Click trên ảnh để pick màu">💧 Eyedropper</button>
          </div>
          <div class="field-row" style="margin-top:8px">
            <label style="flex:0 0 auto">Tolerance:</label>
            <input id="tolerance" type="range" min="0" max="255" step="1" value="${tolerance}" style="flex:1">
            <span id="tolerance-val" style="min-width:36px;text-align:right">${tolerance}</span>
          </div>
        </div>

        <div class="field">
          <label>🎨 Gradient thay thế</label>
          <div class="field-row" style="margin-top:4px">
            <span style="width:60px">Start:</span>
            <span id="start-swatch" class="color-swatch" style="display:inline-block;width:32px;height:32px;border:1px solid #888;background:${gradientStart};vertical-align:middle"></span>
            <input id="start-hex" type="text" value="${escapeAttr(gradientStart)}" pattern="^#[0-9A-Fa-f]{6}$" style="width:110px">
            <input id="start-color" type="color" value="${escapeAttr(gradientStart)}">
          </div>
          <div class="field-row" style="margin-top:4px">
            <span style="width:60px">End:</span>
            <span id="end-swatch" class="color-swatch" style="display:inline-block;width:32px;height:32px;border:1px solid #888;background:${gradientEnd};vertical-align:middle"></span>
            <input id="end-hex" type="text" value="${escapeAttr(gradientEnd)}" pattern="^#[0-9A-Fa-f]{6}$" style="width:110px">
            <input id="end-color" type="color" value="${escapeAttr(gradientEnd)}">
          </div>
          <div class="field-row" style="margin-top:8px">
            <label style="flex:0 0 auto">Hướng:</label>
            <label><input type="radio" name="dir" value="vertical" ${gradientDirection === "vertical" ? "checked" : ""}> Dọc</label>
            <label><input type="radio" name="dir" value="horizontal" ${gradientDirection === "horizontal" ? "checked" : ""}> Ngang</label>
          </div>
        </div>

        <div class="field-row" style="margin-top:16px">
          <button type="submit" class="primary">▶  Thực hiện</button>
          <button type="button" id="reset-params">↺ Reset</button>
        </div>
      </form>

      <div class="preview-pane">
        <canvas id="preview-canvas" style="max-width:100%;border:1px solid #444;display:block"></canvas>
        <div id="preview-info" style="margin-top:6px;font-size:12px;color:#aaa">Chọn folder để xem preview</div>
        <div style="margin-top:6px">
          <label><input type="radio" name="view" value="processed" checked> Sau xử lý</label>
          &nbsp;
          <label><input type="radio" name="view" value="original"> Gốc</label>
        </div>
      </div>
    </div>
  `;

  // ── folder pickers ──
  el.querySelector("#pick-input").addEventListener("click", async () => {
    const cur = el.querySelector("#input-dir").value;
    const p = await window.api.dialog.pickFolder(cur);
    if (p) { el.querySelector("#input-dir").value = p; await refreshSamples(); }
  });
  el.querySelector("#pick-output").addEventListener("click", async () => {
    const cur = el.querySelector("#output").value;
    const p = await window.api.dialog.pickFolder(cur);
    if (p) el.querySelector("#output").value = p;
  });
  el.querySelectorAll("[data-open-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const v = el.querySelector(`#${btn.dataset.openId}`)?.value?.trim();
      if (v) await window.api.shell.openFolder(v);
    });
  });

  // ── color swatch ↔ hex ↔ native picker sync ──
  function wireColorTrio(swatchId, hexId, colorId) {
    const swatch = el.querySelector(`#${swatchId}`);
    const hexEl = el.querySelector(`#${hexId}`);
    const colEl = colorId ? el.querySelector(`#${colorId}`) : null;
    hexEl.addEventListener("input", () => {
      if (/^#[0-9A-Fa-f]{6}$/.test(hexEl.value)) {
        swatch.style.background = hexEl.value;
        if (colEl) colEl.value = hexEl.value;
      }
    });
    if (colEl) {
      colEl.addEventListener("input", () => {
        hexEl.value = colEl.value.toUpperCase();
        swatch.style.background = colEl.value;
      });
    }
  }
  wireColorTrio("src-swatch", "src-hex", null);
  wireColorTrio("start-swatch", "start-hex", "start-color");
  wireColorTrio("end-swatch", "end-hex", "end-color");

  // ── tolerance slider live label ──
  const tolEl = el.querySelector("#tolerance");
  const tolValEl = el.querySelector("#tolerance-val");
  tolEl.addEventListener("input", () => { tolValEl.textContent = tolEl.value; });

  // ── sample listing (basic — preview wiring in Task 8) ──
  async function refreshSamples() {
    const folder = el.querySelector("#input-dir").value.trim();
    const names = folder ? await window.api.fs.listImages(folder) : [];
    const select = el.querySelector("#sample-select");
    select.innerHTML = names.length === 0
      ? `<option value="">(folder rỗng)</option>`
      : names.map((n) => `<option value="${escapeAttr(n)}">${escapeAttr(n)}</option>`).join("");
  }
  await refreshSamples();

  // ── reset ──
  el.querySelector("#reset-params").addEventListener("click", () => {
    el.querySelector("#src-hex").value = DEFAULTS.sourceColor;
    el.querySelector("#src-swatch").style.background = DEFAULTS.sourceColor;
    el.querySelector("#tolerance").value = DEFAULTS.tolerance;
    el.querySelector("#tolerance-val").textContent = DEFAULTS.tolerance;
    el.querySelector("#start-hex").value = DEFAULTS.gradientStart;
    el.querySelector("#start-swatch").style.background = DEFAULTS.gradientStart;
    el.querySelector("#start-color").value = DEFAULTS.gradientStart;
    el.querySelector("#end-hex").value = DEFAULTS.gradientEnd;
    el.querySelector("#end-swatch").style.background = DEFAULTS.gradientEnd;
    el.querySelector("#end-color").value = DEFAULTS.gradientEnd;
    el.querySelector(`input[name="dir"][value="${DEFAULTS.gradientDirection}"]`).checked = true;
  });

  // ── submit ──
  el.querySelector("#task-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const inputDir = el.querySelector("#input-dir").value.trim();
    const output = el.querySelector("#output").value.trim();
    const sourceColor = el.querySelector("#src-hex").value.trim();
    const tolerance = Number(el.querySelector("#tolerance").value);
    const gradientStart = el.querySelector("#start-hex").value.trim();
    const gradientEnd = el.querySelector("#end-hex").value.trim();
    const gradientDirection = el.querySelector('input[name="dir"]:checked')?.value;
    if (!inputDir || !output) return;

    const config = { inputDir, output, sourceColor, tolerance, gradientStart, gradientEnd, gradientDirection };
    await window.api.queue.add({ type: "recolorThumb", config });
    await window.api.settings.set({
      "lastConfig.recolorThumb": { inputDir, output },
      "recolor.last": { sourceColor, tolerance, gradientStart, gradientEnd, gradientDirection },
    });
    toast({ kind: "success", message: "✅ Đã thêm vào hàng đợi" });
  });
}

function escapeAttr(s) {
  return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}
```

- [ ] **Step 2: Run all tests for safety**

Run: `npm test`
Expected: PASS — no regression (renderer screen isn't unit-tested in this codebase).

- [ ] **Step 3: Stop — review diff, do NOT commit**

---

## Task 8: Renderer — sample image loading + canvas drawing

**Files:**
- Modify: `electron/renderer/screens/recolorThumb.js`

- [ ] **Step 1: Add canvas-loading helpers and wire sample change**

In `electron/renderer/screens/recolorThumb.js`, **inside `renderRecolorThumb`**, **first delete the existing `await refreshSamples();` line** (the one right before `// ── reset ──` from Task 7).

Then add the following block in that exact spot (right before `// ── reset ──`):

```js
  // ── canvas state ──
  const displayCanvas = el.querySelector("#preview-canvas");
  const dctx = displayCanvas.getContext("2d");
  // Detached canvas at full resolution (for eyedropper + processing source).
  const sourceCanvas = document.createElement("canvas");
  const sctx = sourceCanvas.getContext("2d");
  // Backing pixel buffer (RGBA at native resolution). Used by Task 10 (preview).
  let originalImageData = null;
  let currentSampleName = "";

  const MAX_PREVIEW_W = 720;
  const MAX_PREVIEW_H = 405;

  async function loadSample(name) {
    currentSampleName = name;
    const infoEl = el.querySelector("#preview-info");
    if (!name) {
      originalImageData = null;
      dctx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
      infoEl.textContent = "Chọn folder để xem preview";
      return;
    }
    const folder = el.querySelector("#input-dir").value.trim();
    const fullPath = `${folder}\\${name}`;
    const dataUrl = await window.api.fs.readImageDataUrl(fullPath);
    if (!dataUrl) {
      originalImageData = null;
      infoEl.textContent = `Không đọc được ${name}`;
      return;
    }
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Image decode failed"));
      img.src = dataUrl;
    });
    sourceCanvas.width = img.naturalWidth;
    sourceCanvas.height = img.naturalHeight;
    sctx.drawImage(img, 0, 0);
    originalImageData = sctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);

    const scale = Math.min(1, MAX_PREVIEW_W / sourceCanvas.width, MAX_PREVIEW_H / sourceCanvas.height);
    displayCanvas.width = Math.round(sourceCanvas.width * scale);
    displayCanvas.height = Math.round(sourceCanvas.height * scale);
    drawPreview();   // initial: original
    infoEl.textContent = `Đang xem: ${name} (${sourceCanvas.width}×${sourceCanvas.height})`;
  }

  function drawPreview() {
    if (!originalImageData) return;
    // Default: just draw the original scaled into the display canvas.
    // Task 10 will replace this with processed pixels when "Sau xử lý" is selected.
    dctx.drawImage(sourceCanvas, 0, 0, displayCanvas.width, displayCanvas.height);
  }

  el.querySelector("#sample-select").addEventListener("change", (e) => loadSample(e.target.value));
  el.querySelector("#sample-random").addEventListener("click", () => {
    const select = el.querySelector("#sample-select");
    if (select.options.length === 0) return;
    const idx = Math.floor(Math.random() * select.options.length);
    select.selectedIndex = idx;
    loadSample(select.value);
  });
```

- [ ] **Step 2: Modify `refreshSamples` to auto-load first sample, then call it after canvas block**

In the same file, **replace** the body of `refreshSamples` (originally added in Task 7) with the version that auto-loads:

```js
  async function refreshSamples() {
    const folder = el.querySelector("#input-dir").value.trim();
    const names = folder ? await window.api.fs.listImages(folder) : [];
    const select = el.querySelector("#sample-select");
    select.innerHTML = names.length === 0
      ? `<option value="">(folder rỗng)</option>`
      : names.map((n) => `<option value="${escapeAttr(n)}">${escapeAttr(n)}</option>`).join("");
    await loadSample(names[0] ?? "");
  }
```

`refreshSamples` references `loadSample`, which is declared inside the canvas state block from Step 1. Both are `async function` declarations — they hoist within the enclosing function. But `loadSample` accesses `let`-bound variables (`sourceCanvas`, `sctx`, `originalImageData`) which are in the temporal dead zone (TDZ) until their declarations execute. So the **call site** of `refreshSamples` must run AFTER the canvas state block.

In Step 1 you already deleted the original `await refreshSamples()` call. Now add a **new** `await refreshSamples();` line at the bottom of the canvas state block — immediately after the `el.querySelector("#sample-random").addEventListener(...)` block and before `// ── reset ──`. That guarantees `sourceCanvas` etc. are initialized when `loadSample` first runs.

- [ ] **Step 3: Manually verify in the dev app**

Run: `npm run dev`
Verify:
  1. Navigate to "Đổi màu thumbnail" via sidebar (only after Task 11 is done — for now navigate via `#recolorThumb` hash).
  2. Folder with .jpg/.png shows files in sample select; first one renders in canvas.
  3. "🔀" button switches to another sample.
  4. Canvas info shows `name (WxH)`.

If sidebar not yet wired, set `window.location.hash = "recolorThumb"` in DevTools console.

- [ ] **Step 4: Run unit tests**

Run: `npm test`
Expected: PASS — no regression.

- [ ] **Step 5: Stop — review diff, do NOT commit**

---

## Task 9: Renderer — eyedropper

**Files:**
- Modify: `electron/renderer/screens/recolorThumb.js`

- [ ] **Step 1: Wire eyedropper state + click handler**

In `electron/renderer/screens/recolorThumb.js`, add inside `renderRecolorThumb` (after the canvas state block from Task 8, before `// ── reset ──`):

```js
  // ── eyedropper ──
  let eyedropperActive = false;
  const eyedropperBtn = el.querySelector("#eyedropper");

  function setEyedropper(active) {
    eyedropperActive = active;
    displayCanvas.style.cursor = active ? "crosshair" : "";
    eyedropperBtn.classList.toggle("active", active);
  }

  eyedropperBtn.addEventListener("click", () => setEyedropper(!eyedropperActive));

  displayCanvas.addEventListener("click", (e) => {
    if (!eyedropperActive || !originalImageData) return;
    const rect = displayCanvas.getBoundingClientRect();
    const dispX = (e.clientX - rect.left) * (displayCanvas.width / rect.width);
    const dispY = (e.clientY - rect.top) * (displayCanvas.height / rect.height);
    const srcX = Math.floor(dispX * (sourceCanvas.width / displayCanvas.width));
    const srcY = Math.floor(dispY * (sourceCanvas.height / displayCanvas.height));
    const idx = (srcY * sourceCanvas.width + srcX) * 4;
    const r = originalImageData.data[idx];
    const g = originalImageData.data[idx + 1];
    const b = originalImageData.data[idx + 2];
    const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0").toUpperCase()).join("")}`;
    el.querySelector("#src-hex").value = hex;
    el.querySelector("#src-swatch").style.background = hex;
    setEyedropper(false);
  });

  // Esc cancels eyedropper
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && eyedropperActive) setEyedropper(false);
  });
```

- [ ] **Step 2: Manually verify in the dev app**

Run: `npm run dev`
Verify:
  1. Click "💧 Eyedropper" → cursor on canvas becomes crosshair.
  2. Click a pixel on canvas → source hex + swatch update to that pixel's color; cursor returns to default.
  3. Press Esc with eyedropper active → it deactivates.

- [ ] **Step 3: Stop — review diff, do NOT commit**

---

## Task 10: Renderer — live preview with debounce

**Files:**
- Modify: `electron/renderer/screens/recolorThumb.js`

- [ ] **Step 1: Replace `drawPreview` with processing-aware version**

In `electron/renderer/screens/recolorThumb.js`, import the shared module by adding at the top (after the existing import):

```js
import { recolorPixels, hexToRgb } from "../../../src/_lib/recolorImage.js";
```

Then replace the placeholder `drawPreview()` function from Task 8 with:

```js
  function getViewMode() {
    return el.querySelector('input[name="view"]:checked')?.value || "processed";
  }

  function readParams() {
    return {
      sourceColor:       hexToRgb(el.querySelector("#src-hex").value),
      tolerance:         Number(el.querySelector("#tolerance").value),
      gradientStart:     hexToRgb(el.querySelector("#start-hex").value),
      gradientEnd:       hexToRgb(el.querySelector("#end-hex").value),
      gradientDirection: el.querySelector('input[name="dir"]:checked')?.value || "vertical",
    };
  }

  function drawPreview() {
    if (!originalImageData) return;
    if (getViewMode() === "original") {
      sctx.putImageData(originalImageData, 0, 0);
      dctx.drawImage(sourceCanvas, 0, 0, displayCanvas.width, displayCanvas.height);
      return;
    }
    let params;
    try { params = readParams(); }
    catch { dctx.drawImage(sourceCanvas, 0, 0, displayCanvas.width, displayCanvas.height); return; }
    const processed = new ImageData(
      new Uint8ClampedArray(originalImageData.data),
      originalImageData.width, originalImageData.height,
    );
    recolorPixels(processed.data, processed.width, processed.height, params);
    sctx.putImageData(processed, 0, 0);
    dctx.drawImage(sourceCanvas, 0, 0, displayCanvas.width, displayCanvas.height);
  }
```

- [ ] **Step 2: Add debounce scheduler + wire param-change listeners**

Add inside `renderRecolorThumb` after `drawPreview` is defined (and after the eyedropper block):

```js
  let previewTimer = null;
  function schedulePreview() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => { previewTimer = null; drawPreview(); }, 200);
  }

  for (const id of ["src-hex", "tolerance", "start-hex", "end-hex", "start-color", "end-color"]) {
    el.querySelector(`#${id}`).addEventListener("input", schedulePreview);
  }
  el.querySelectorAll('input[name="dir"]').forEach((r) => r.addEventListener("change", schedulePreview));
  el.querySelectorAll('input[name="view"]').forEach((r) => r.addEventListener("change", () => drawPreview()));
```

The view-mode toggle calls `drawPreview()` immediately (no debounce) so the user gets instant feedback when comparing original vs processed.

- [ ] **Step 3: Trigger preview after eyedropper picks a color**

In the eyedropper click handler from Task 9, add `schedulePreview()` at the end (after `setEyedropper(false)`):

```js
    setEyedropper(false);
    schedulePreview();
```

- [ ] **Step 4: Trigger preview after reset**

In the reset button handler (from Task 7), add `schedulePreview()` at the end:

```js
    el.querySelector(`input[name="dir"][value="${DEFAULTS.gradientDirection}"]`).checked = true;
    schedulePreview();
```

- [ ] **Step 5: Manually verify in the dev app**

Run: `npm run dev`
Verify:
  1. Sliding tolerance → canvas updates within ~250ms.
  2. Changing source/gradient hex/color picker → canvas updates.
  3. Toggle "Sau xử lý / Gốc" → instant switch.
  4. Eyedropper pick a pixel → source updates AND preview updates.

- [ ] **Step 6: Run unit tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Stop — review diff, do NOT commit**

---

## Task 11: Sidebar nav item + router registration

**Files:**
- Modify: `electron/renderer/components/sidebar.js`
- Modify: `electron/renderer/main.js`

- [ ] **Step 1: Insert sidebar nav item**

Edit `electron/renderer/components/sidebar.js` — in the `NAV_ITEMS` array, insert a new entry right after `thumbAvatar`:

```js
      { id: "thumbAvatar", icon: "😂", label: "Gắn avatar vào thumbnail" },
      { id: "recolorThumb", icon: "🎨", label: "Đổi màu thumbnail" },
      { id: "trendSearch", icon: "🔍", label: "Tìm trend" },
```

- [ ] **Step 2: Register screen in router**

Edit `electron/renderer/main.js`:
  a. After the existing `import { renderThumbAvatar }` line, add:

```js
import { renderRecolorThumb } from "./screens/recolorThumb.js";
```

  b. In the `screens` object, add `recolorThumb`:

```js
const screens = {
  render: renderRender, trimEnds: renderTrimEnds, cutBg: renderCutBg,
  getUrls: renderGetUrls, download: renderDownload, concatHeadTail: renderConcatHeadTail,
  thumbAvatar: renderThumbAvatar, recolorThumb: renderRecolorThumb, trendSearch: renderTrendSearch,
  queue: renderQueue, settings: renderSettings,
};
```

  c. In `TASK_LABELS`, add an entry:

```js
const TASK_LABELS = {
  render: "Render Video", trimEnds: "Cắt đầu/cuối", cutBg: "Chia nhỏ video nền",
  getUrls: "Lấy link kênh", download: "Tải video", concatHeadTail: "Nối đầu/cuối",
  thumbAvatar: "Gắn avatar", recolorThumb: "Đổi màu thumbnail", trendSearch: "Tìm trend",
};
```

- [ ] **Step 3: Manually verify the sidebar entry**

Run: `npm run dev`
Verify:
  1. Sidebar shows "🎨 Đổi màu thumbnail" right after "Gắn avatar vào thumbnail".
  2. Click it → screen renders with the form and preview pane.
  3. Submitting the form adds a task to the queue (visible in queue dock).
  4. After task completes, toast says "✅ Đổi màu thumbnail hoàn thành".

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Stop — review diff, do NOT commit**

---

## Task 12: End-to-end verification against acceptance criteria

**Files:** none — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: All tests pass (existing + new `recolorImage` + `recolorThumb`).

- [ ] **Step 2: Build the app in unpacked mode**

Run: `npm run build:dir`
Expected: builds without errors; produces `dist/win-unpacked/VidMaster.exe`.

- [ ] **Step 3: Launch and verify all 9 acceptance criteria**

Run: `dist/win-unpacked/VidMaster.exe`
Walk through and confirm each criterion from [docs/specs/2026-05-18-vidmaster-recolor-thumb-design.md](../specs/2026-05-18-vidmaster-recolor-thumb-design.md) section 12:

  1. [ ] Sidebar nav item present and clickable, no regression on other tasks.
  2. [ ] Eyedropper click on canvas → swatch + hex update to the exact pixel RGB (verify by picking a known-color pixel from a synthetic test image).
  3. [ ] Preview updates < 300ms after slider/color/direction/sample changes.
  4. [ ] Toggle "Sau xử lý / Gốc" — instant (no debounce).
  5. [ ] Batch processes a folder of ≥10 real thumbnails; output has correct format (.jpg stays .jpg, .png stays .png); vertical gradient: top = start, bottom ≈ end.
  6. [ ] Fresh workspace: defaults `#7A97C1`, tol 70, `#FFC0CB` → `#FF69B4`, vertical — verified by deleting settings or using a clean workspace.
  7. [ ] Abort mid-batch via queue dock "Cancel" → task stops; written files remain in output; queue state = cancelled.
  8. [ ] `npm test` clean.
  9. [ ] Installer-mode (`build:dir`) app starts and the new task is usable.

- [ ] **Step 4: Stop — review diff, do NOT commit**

Run: `git status`
Verify the modified/new files match the File Structure section at the top of this plan. Leave all changes unstaged for the user to review.

---

## Notes for the implementer

- **Vietnamese UI + technical keywords inline** (per user memory): error messages and labels in Vietnamese, but keep `RRGGBB`, `gradientDirection`, `Tolerance`, `AbortError` inline for debuggability.
- **No auto-commit** (per user memory): every task ends with `git diff` review only.
- **No worktrees** (per user memory): work directly on the current checkout. Create a topic branch with `git checkout -b feat/recolor-thumb` if you want isolation.
- The `.claude/worktrees/` directories in the repo are stale from earlier work — do not modify them.
- `sharp` is in `asarUnpack` already, so installer-mode works without extra config.
