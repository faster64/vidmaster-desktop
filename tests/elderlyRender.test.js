import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { runElderlyRender } from "../src/elderlyRender.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, "fixtures");
const tinyMp4 = path.join(fixtures, "tiny.mp4");
const tinyVideoWithAudio = path.join(fixtures, "tiny-with-audio.mp4");
const tinyMp3 = path.join(fixtures, "tiny.mp3");

const DEFAULT_CROP = "in_w:205:0:480";
const DEFAULT_OVERLAY = "(main_w-overlay_w)/2:550";

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-elderlyRender-")); });
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function setupFolders() {
  const input = path.join(tmpDir, "in");
  const bg = path.join(tmpDir, "bg");
  const out = path.join(tmpDir, "out");
  fs.mkdirSync(input); fs.mkdirSync(bg);
  return { input, bg, out };
}

describe("runElderlyRender validation", () => {
  const base = () => ({
    inputFolder: "", backgroundFolder: "", output: "",
    cropValue: DEFAULT_CROP, overlayValue: DEFAULT_OVERLAY,
  });

  it("rejects when inputFolder does not exist", async () => {
    await expect(runElderlyRender({
      ...base(),
      inputFolder: path.join(tmpDir, "nope"),
      backgroundFolder: tmpDir, output: tmpDir,
    })).rejects.toThrow(/input/i);
  });

  it("rejects when backgroundFolder does not exist", async () => {
    const input = path.join(tmpDir, "in");
    fs.mkdirSync(input);
    fs.copyFileSync(tinyMp3, path.join(input, "a.mp3"));
    await expect(runElderlyRender({
      ...base(),
      inputFolder: input,
      backgroundFolder: path.join(tmpDir, "nope"),
      output: tmpDir,
    })).rejects.toThrow(/video n.n/i);
  });

  it("rejects when output is empty", async () => {
    const { input, bg } = setupFolders();
    fs.copyFileSync(tinyMp3, path.join(input, "a.mp3"));
    fs.copyFileSync(tinyMp4, path.join(bg, "bg.mp4"));
    await expect(runElderlyRender({
      ...base(),
      inputFolder: input, backgroundFolder: bg, output: "",
    })).rejects.toThrow(/output/i);
  });

  it("rejects when inputFolder has no .mp3/.mp4", async () => {
    const { input, bg, out } = setupFolders();
    fs.copyFileSync(tinyMp4, path.join(bg, "bg.mp4"));
    await expect(runElderlyRender({
      ...base(),
      inputFolder: input, backgroundFolder: bg, output: out,
    })).rejects.toThrow(/không có file/i);
  });

  it("rejects when backgroundFolder has no .mp4", async () => {
    const { input, bg, out } = setupFolders();
    fs.copyFileSync(tinyMp3, path.join(input, "a.mp3"));
    await expect(runElderlyRender({
      ...base(),
      inputFolder: input, backgroundFolder: bg, output: out,
    })).rejects.toThrow(/không có file .mp4/i);
  });

  it("rejects when has .mp4 input but cropValue empty", async () => {
    const { input, bg, out } = setupFolders();
    fs.copyFileSync(tinyVideoWithAudio, path.join(input, "a.mp4"));
    fs.copyFileSync(tinyMp4, path.join(bg, "bg.mp4"));
    await expect(runElderlyRender({
      inputFolder: input, backgroundFolder: bg, output: out,
      cropValue: "", overlayValue: DEFAULT_OVERLAY,
    })).rejects.toThrow(/cropValue|overlayValue/);
  });

  it("rejects when has .mp4 input but overlayValue empty", async () => {
    const { input, bg, out } = setupFolders();
    fs.copyFileSync(tinyVideoWithAudio, path.join(input, "a.mp4"));
    fs.copyFileSync(tinyMp4, path.join(bg, "bg.mp4"));
    await expect(runElderlyRender({
      inputFolder: input, backgroundFolder: bg, output: out,
      cropValue: DEFAULT_CROP, overlayValue: "   ",
    })).rejects.toThrow(/cropValue|overlayValue/);
  });

  it("allows mp3-only input with empty crop/overlay", async () => {
    const { input, bg, out } = setupFolders();
    fs.copyFileSync(tinyMp3, path.join(input, "a.mp3"));
    fs.copyFileSync(tinyMp4, path.join(bg, "bg.mp4"));
    const r = await runElderlyRender({
      inputFolder: input, backgroundFolder: bg, output: out,
      cropValue: "", overlayValue: "",
    });
    expect(r.ok).toBe(true);
    expect(r.outputs).toHaveLength(1);
  }, 60_000);

  it("aborts when signal already fired", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(runElderlyRender({
      inputFolder: tmpDir, backgroundFolder: tmpDir, output: tmpDir,
      cropValue: DEFAULT_CROP, overlayValue: DEFAULT_OVERLAY,
      signal: ctrl.signal,
    })).rejects.toThrow(/Aborted/);
  });
});

describe("runElderlyRender happy path", () => {
  it("renders mp3 input → output .mp4 with mp3 audio", async () => {
    const { input, bg, out } = setupFolders();
    fs.copyFileSync(tinyMp3, path.join(input, "audio.mp3"));
    fs.copyFileSync(tinyMp4, path.join(bg, "bg.mp4"));

    const r = await runElderlyRender({
      inputFolder: input, backgroundFolder: bg, output: out,
      cropValue: DEFAULT_CROP, overlayValue: DEFAULT_OVERLAY,
    });

    expect(r.ok).toBe(true);
    expect(r.outputs).toHaveLength(1);
    expect(fs.existsSync(path.join(out, "audio.mp4"))).toBe(true);
    expect(fs.existsSync(path.join(out, "_rendered.json"))).toBe(true);
    const hist = JSON.parse(fs.readFileSync(path.join(out, "_rendered.json"), "utf-8"));
    expect(hist.rendered).toContain("audio");
  }, 60_000);

  it("renders mp4 input via Older-mode pipeline → output .mp4", async () => {
    const { input, bg, out } = setupFolders();
    fs.copyFileSync(tinyVideoWithAudio, path.join(input, "clip.mp4"));
    fs.copyFileSync(tinyMp4, path.join(bg, "bg.mp4"));

    const r = await runElderlyRender({
      inputFolder: input, backgroundFolder: bg, output: out,
      cropValue: DEFAULT_CROP, overlayValue: DEFAULT_OVERLAY,
    });

    expect(r.ok).toBe(true);
    expect(r.outputs).toHaveLength(1);
    expect(fs.existsSync(path.join(out, "clip.mp4"))).toBe(true);
  }, 60_000);

  it("mixed batch — mp3 + mp4 with round-robin background pairing", async () => {
    const { input, bg, out } = setupFolders();
    fs.copyFileSync(tinyMp3, path.join(input, "01-audio.mp3"));
    fs.copyFileSync(tinyVideoWithAudio, path.join(input, "02-video.mp4"));
    fs.copyFileSync(tinyMp4, path.join(bg, "bg1.mp4"));
    fs.copyFileSync(tinyMp4, path.join(bg, "bg2.mp4"));

    const r = await runElderlyRender({
      inputFolder: input, backgroundFolder: bg, output: out,
      cropValue: DEFAULT_CROP, overlayValue: DEFAULT_OVERLAY,
    });

    expect(r.ok).toBe(true);
    expect(r.outputs).toHaveLength(2);
    expect(fs.existsSync(path.join(out, "01-audio.mp4"))).toBe(true);
    expect(fs.existsSync(path.join(out, "02-video.mp4"))).toBe(true);
  }, 120_000);

  it("skips already-rendered inputs via _rendered.json", async () => {
    const { input, bg, out } = setupFolders();
    fs.mkdirSync(out);
    fs.copyFileSync(tinyMp3, path.join(input, "done.mp3"));
    fs.copyFileSync(tinyMp4, path.join(bg, "bg.mp4"));
    fs.writeFileSync(path.join(out, "_rendered.json"),
      JSON.stringify({ version: 1, rendered: ["done"] }));
    fs.writeFileSync(path.join(out, "done.mp4"), "FAKE");
    const sizeBefore = fs.statSync(path.join(out, "done.mp4")).size;

    const r = await runElderlyRender({
      inputFolder: input, backgroundFolder: bg, output: out,
      cropValue: "", overlayValue: "",
    });

    expect(r.ok).toBe(true);
    expect(r.outputs).toHaveLength(0);
    expect(fs.statSync(path.join(out, "done.mp4")).size).toBe(sizeBefore);
  }, 30_000);

  it("heals rendered set from on-disk .mp4 files even without _rendered.json", async () => {
    const { input, bg, out } = setupFolders();
    fs.mkdirSync(out);
    fs.copyFileSync(tinyMp3, path.join(input, "already.mp3"));
    fs.copyFileSync(tinyMp4, path.join(bg, "bg.mp4"));
    fs.writeFileSync(path.join(out, "already.mp4"), "FAKE");

    const r = await runElderlyRender({
      inputFolder: input, backgroundFolder: bg, output: out,
      cropValue: "", overlayValue: "",
    });

    expect(r.ok).toBe(true);
    expect(r.outputs).toHaveLength(0);
  }, 30_000);
});
