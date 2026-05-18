import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { runRecolorThumb } from "../src/recolorThumb.js";
import sharp from "sharp";

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

    const { data } = await sharp(path.join(output, "a.jpg")).raw().toBuffer({ resolveWithObject: true });
    const topR = data[0];
    expect(topR).toBeGreaterThan(220);
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
    await makeFlatJpeg(path.join(inputDir, "black.jpg"), 8, 8, { r: 0, g: 0, b: 0 });

    await runRecolorThumb({ inputDir, output, ...VALID_PARAMS });

    const { data } = await sharp(path.join(output, "black.jpg")).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeLessThan(20);
  }, 30_000);
});
