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
    const r = data[((16 + 40) * info.width + (16 + 40)) * 3];
    expect(r).toBeGreaterThan(150);
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
    fs.mkdirSync(path.join(output, "a"), { recursive: true });
    fs.writeFileSync(path.join(output, "a", "t.jpg"), "OLD");

    await runThumbAvatar({
      thumbDir, avatarDir, output, position: "bottom-right", size: 80, margin: 16,
    });
    const stats = fs.statSync(path.join(output, "a", "t.jpg"));
    expect(stats.size).toBeGreaterThan(100);
  }, 30_000);
});
