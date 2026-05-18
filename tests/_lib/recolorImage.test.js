import { describe, it, expect } from "vitest";
import { hexToRgb, rgbToHex, recolorPixels } from "../../src/_lib/recolorImage.js";

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

  it("approximates gradient end at y=h-1 (ratio is (h-1)/h, not 1.0)", () => {
    const buf = makeBuffer(1, 4, { r: 0x7A, g: 0x97, b: 0xC1 });
    recolorPixels(buf, 1, 4, PARAMS_VERTICAL);
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
    const buf = makeBuffer(1, 1, { r: 0x7A + 20, g: 0x97, b: 0xC1 });
    recolorPixels(buf, 1, 1, PARAMS_VERTICAL);
    expect(pixelAt(buf, 1, 0, 0)).toEqual({ r: 0xFF, g: 0xC0, b: 0xCB, a: 255 });
  });

  it("tolerance=0 only changes pixels exactly equal to source", () => {
    const params = { ...PARAMS_VERTICAL, tolerance: 0 };
    const buf = new Uint8ClampedArray([
      0x7A, 0x97, 0xC1, 255,
      0x7B, 0x97, 0xC1, 255,
    ]);
    recolorPixels(buf, 2, 1, params);
    expect([buf[0], buf[1], buf[2]]).toEqual([0xFF, 0xC0, 0xCB]);
    expect([buf[4], buf[5], buf[6]]).toEqual([0x7B, 0x97, 0xC1]);
  });

  it("horizontal direction uses x/width instead of y/height", () => {
    const params = { ...PARAMS_VERTICAL, gradientDirection: "horizontal" };
    const buf = makeBuffer(4, 1, { r: 0x7A, g: 0x97, b: 0xC1 });
    recolorPixels(buf, 4, 1, params);
    expect(pixelAt(buf, 4, 0, 0)).toEqual({ r: 0xFF, g: 0xC0, b: 0xCB, a: 255 });
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
