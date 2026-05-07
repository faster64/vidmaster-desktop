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
    expect(meta.channels).toBe(4);
  });

  it("makes the four corners transparent (alpha = 0)", async () => {
    const buf = await circleCrop(avatarPng, 80);
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(info.width - 1, 0)).toBe(0);
    expect(alphaAt(0, info.height - 1)).toBe(0);
    expect(alphaAt(info.width - 1, info.height - 1)).toBe(0);
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
