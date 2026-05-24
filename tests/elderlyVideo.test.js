import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { runElderlyVideo, computeOverlayXY, ANCHORS } from "../src/elderlyVideo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, "fixtures");
const tinyImage = path.join(fixtures, "tiny.png");
const tinyVideo = path.join(fixtures, "tiny-with-audio.mp4");
const tinySilentVideo = path.join(fixtures, "tiny-silent.mp4");

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-elderly-")); });
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe("computeOverlayXY", () => {
  it("top-left → [0,0]", () => {
    expect(computeOverlayXY("top-left", 1280, 720, 480, 270)).toEqual([0, 0]);
  });
  it("top-right 480×270 → [800, 0]", () => {
    expect(computeOverlayXY("top-right", 1280, 720, 480, 270)).toEqual([800, 0]);
  });
  it("bottom-right 480×270 → [800, 450]", () => {
    expect(computeOverlayXY("bottom-right", 1280, 720, 480, 270)).toEqual([800, 450]);
  });
  it("bottom-left 480×270 → [0, 450]", () => {
    expect(computeOverlayXY("bottom-left", 1280, 720, 480, 270)).toEqual([0, 450]);
  });
  it("center 480×270 → [400, 225]", () => {
    expect(computeOverlayXY("center", 1280, 720, 480, 270)).toEqual([400, 225]);
  });
  it("top centered 480×270 → [400, 0]", () => {
    expect(computeOverlayXY("top", 1280, 720, 480, 270)).toEqual([400, 0]);
  });
  it("bottom centered 480×270 → [400, 450]", () => {
    expect(computeOverlayXY("bottom", 1280, 720, 480, 270)).toEqual([400, 450]);
  });
  it("right centered 480×270 → [800, 225]", () => {
    expect(computeOverlayXY("right", 1280, 720, 480, 270)).toEqual([800, 225]);
  });
  it("left centered 480×270 → [0, 225]", () => {
    expect(computeOverlayXY("left", 1280, 720, 480, 270)).toEqual([0, 225]);
  });
  it("bottom-right + offset (-20,-20) → [780, 430]", () => {
    expect(computeOverlayXY("bottom-right", 1280, 720, 480, 270, -20, -20)).toEqual([780, 430]);
  });
  it("top-left + offset (50, 30) → [50, 30]", () => {
    expect(computeOverlayXY("top-left", 1280, 720, 480, 270, 50, 30)).toEqual([50, 30]);
  });
  it("rounds odd-pixel anchors", () => {
    // canvas 1280, overlay 481 → halfX = (1280-481)/2 = 399.5 → 400
    expect(computeOverlayXY("center", 1280, 720, 481, 271)).toEqual([400, 225]);
  });
  it("throws on unknown anchor", () => {
    expect(() => computeOverlayXY("diagonal", 1280, 720, 480, 270)).toThrow(/Anchor/);
  });
});

describe("runElderlyVideo validation", () => {
  const baseConfig = () => ({
    inputImages: "", inputVideos: "", output: "",
    anchor: "bottom-left", overlayWidth: 480, overlayHeight: 270,
    offsetX: 0, offsetY: 0,
  });

  it("rejects when inputImages does not exist", async () => {
    await expect(runElderlyVideo({
      ...baseConfig(),
      inputImages: path.join(tmpDir, "no-such-folder"),
      inputVideos: tmpDir, output: tmpDir,
    })).rejects.toThrow(/ảnh n.n/i);
  });

  it("rejects when inputVideos does not exist", async () => {
    const inputImages = path.join(tmpDir, "imgs");
    fs.mkdirSync(inputImages);
    fs.copyFileSync(tinyImage, path.join(inputImages, "a.png"));
    await expect(runElderlyVideo({
      ...baseConfig(),
      inputImages,
      inputVideos: path.join(tmpDir, "no-such-folder"),
      output: tmpDir,
    })).rejects.toThrow(/video/i);
  });

  it("rejects when output is empty", async () => {
    const inputImages = path.join(tmpDir, "imgs");
    const inputVideos = path.join(tmpDir, "vids");
    fs.mkdirSync(inputImages); fs.mkdirSync(inputVideos);
    fs.copyFileSync(tinyImage, path.join(inputImages, "a.png"));
    fs.copyFileSync(tinyVideo, path.join(inputVideos, "a.mp4"));
    await expect(runElderlyVideo({
      ...baseConfig(),
      inputImages, inputVideos, output: "",
    })).rejects.toThrow(/output/i);
  });

  it("rejects when inputImages has no .jpg/.png files", async () => {
    const inputImages = path.join(tmpDir, "imgs");
    const inputVideos = path.join(tmpDir, "vids");
    fs.mkdirSync(inputImages); fs.mkdirSync(inputVideos);
    fs.copyFileSync(tinyVideo, path.join(inputVideos, "a.mp4"));
    await expect(runElderlyVideo({
      ...baseConfig(),
      inputImages, inputVideos, output: path.join(tmpDir, "out"),
    })).rejects.toThrow(/không có file .jpg/i);
  });

  it("rejects when inputVideos has no .mp4 files", async () => {
    const inputImages = path.join(tmpDir, "imgs");
    const inputVideos = path.join(tmpDir, "vids");
    fs.mkdirSync(inputImages); fs.mkdirSync(inputVideos);
    fs.copyFileSync(tinyImage, path.join(inputImages, "a.png"));
    await expect(runElderlyVideo({
      ...baseConfig(),
      inputImages, inputVideos, output: path.join(tmpDir, "out"),
    })).rejects.toThrow(/không có file .mp4/i);
  });

  it("rejects on invalid anchor", async () => {
    const inputImages = path.join(tmpDir, "imgs");
    const inputVideos = path.join(tmpDir, "vids");
    fs.mkdirSync(inputImages); fs.mkdirSync(inputVideos);
    fs.copyFileSync(tinyImage, path.join(inputImages, "a.png"));
    fs.copyFileSync(tinyVideo, path.join(inputVideos, "a.mp4"));
    await expect(runElderlyVideo({
      ...baseConfig(),
      inputImages, inputVideos, output: path.join(tmpDir, "out"),
      anchor: "diagonal",
    })).rejects.toThrow(/Anchor/);
  });

  it("rejects on overlayWidth <= 0", async () => {
    await expect(runElderlyVideo({
      ...baseConfig(),
      inputImages: tmpDir, inputVideos: tmpDir, output: tmpDir,
      overlayWidth: 0,
    })).rejects.toThrow(/overlayWidth/);
  });

  it("rejects on non-integer overlayHeight", async () => {
    await expect(runElderlyVideo({
      ...baseConfig(),
      inputImages: tmpDir, inputVideos: tmpDir, output: tmpDir,
      overlayHeight: 270.5,
    })).rejects.toThrow(/overlayHeight/);
  });

  it("aborts when signal already fired", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(runElderlyVideo({
      ...baseConfig(),
      inputImages: tmpDir, inputVideos: tmpDir, output: tmpDir,
      signal: ctrl.signal,
    })).rejects.toThrow(/Aborted/);
  });
});

describe("runElderlyVideo happy path", () => {
  it("produces one output per video (1 image + 1 video → 1 output)", async () => {
    const inputImages = path.join(tmpDir, "imgs");
    const inputVideos = path.join(tmpDir, "vids");
    const output = path.join(tmpDir, "out");
    fs.mkdirSync(inputImages); fs.mkdirSync(inputVideos);
    fs.copyFileSync(tinyImage, path.join(inputImages, "bg.png"));
    fs.copyFileSync(tinyVideo, path.join(inputVideos, "clip.mp4"));

    const r = await runElderlyVideo({
      inputImages, inputVideos, output,
      anchor: "center",
      overlayWidth: 320, overlayHeight: 180,
      offsetX: 0, offsetY: 0,
    });

    expect(r.ok).toBe(true);
    expect(r.outputs).toHaveLength(1);
    expect(fs.existsSync(path.join(output, "clip.mp4"))).toBe(true);
    expect(fs.existsSync(path.join(output, "_processed.json"))).toBe(true);
    const hist = JSON.parse(fs.readFileSync(path.join(output, "_processed.json"), "utf-8"));
    expect(hist.processed).toContain("clip");
  }, 60_000);

  it("handles overlay video without audio (silent track injected)", async () => {
    const inputImages = path.join(tmpDir, "imgs");
    const inputVideos = path.join(tmpDir, "vids");
    const output = path.join(tmpDir, "out");
    fs.mkdirSync(inputImages); fs.mkdirSync(inputVideos);
    fs.copyFileSync(tinyImage, path.join(inputImages, "bg.png"));
    fs.copyFileSync(tinySilentVideo, path.join(inputVideos, "silent.mp4"));

    const r = await runElderlyVideo({
      inputImages, inputVideos, output,
      anchor: "bottom-right",
      overlayWidth: 320, overlayHeight: 180,
    });

    expect(r.ok).toBe(true);
    expect(fs.existsSync(path.join(output, "silent.mp4"))).toBe(true);
  }, 60_000);

  it("skips already-processed videos via _processed.json", async () => {
    const inputImages = path.join(tmpDir, "imgs");
    const inputVideos = path.join(tmpDir, "vids");
    const output = path.join(tmpDir, "out");
    fs.mkdirSync(inputImages); fs.mkdirSync(inputVideos); fs.mkdirSync(output);
    fs.copyFileSync(tinyImage, path.join(inputImages, "bg.png"));
    fs.copyFileSync(tinyVideo, path.join(inputVideos, "clip.mp4"));
    // Pre-seed: pretend clip.mp4 was already rendered
    fs.writeFileSync(path.join(output, "_processed.json"),
      JSON.stringify({ version: 1, processed: ["clip"] }));
    // Create a fake output file so heal-from-disk picks it up too
    fs.writeFileSync(path.join(output, "clip.mp4"), "FAKE");
    const sizeBefore = fs.statSync(path.join(output, "clip.mp4")).size;

    const r = await runElderlyVideo({
      inputImages, inputVideos, output,
      anchor: "bottom-left", overlayWidth: 480, overlayHeight: 270,
    });

    expect(r.ok).toBe(true);
    expect(r.outputs).toHaveLength(0);
    // The pre-existing clip.mp4 should not have been overwritten
    const sizeAfter = fs.statSync(path.join(output, "clip.mp4")).size;
    expect(sizeAfter).toBe(sizeBefore);
  }, 30_000);

  it("heals processed-set from on-disk output files even without _processed.json", async () => {
    const inputImages = path.join(tmpDir, "imgs");
    const inputVideos = path.join(tmpDir, "vids");
    const output = path.join(tmpDir, "out");
    fs.mkdirSync(inputImages); fs.mkdirSync(inputVideos); fs.mkdirSync(output);
    fs.copyFileSync(tinyImage, path.join(inputImages, "bg.png"));
    fs.copyFileSync(tinyVideo, path.join(inputVideos, "alreadyDone.mp4"));
    // Pre-create output file but no _processed.json
    fs.writeFileSync(path.join(output, "alreadyDone.mp4"), "FAKE");

    const r = await runElderlyVideo({
      inputImages, inputVideos, output,
      anchor: "bottom-left", overlayWidth: 480, overlayHeight: 270,
    });

    expect(r.ok).toBe(true);
    expect(r.outputs).toHaveLength(0);
  }, 30_000);
});
