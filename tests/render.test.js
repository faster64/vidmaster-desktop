import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { runRender, validateChromaKeyFile } from "../src/render.js";

describe("runRender", () => {
  it("rejects with a clear error if input folders are missing", async () => {
    await expect(runRender({
      videosPerFolder: 1,
      inputs: { overlays: "/nope/overlays", backgrounds: "/nope/bg" },
      output: "/nope/out",
      ffmpeg: { useGPU: false, encoder: "libx264", maxConcurrent: 1 },
    })).rejects.toThrow();
  });

  it("throws AbortError when aborted before start", async () => {
    const ctrl = new AbortController(); ctrl.abort();
    await expect(runRender({
      videosPerFolder: 1,
      inputs: { overlays: "/x", backgrounds: "/y" },
      output: "/z",
      ffmpeg: { useGPU: false, encoder: "libx264", maxConcurrent: 1 },
      signal: ctrl.signal,
    })).rejects.toThrow("Aborted");
  });
});

describe("validateChromaKeyFile", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-chroma-")); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("throws when the file does not exist", () => {
    expect(() => validateChromaKeyFile(path.join(tmpDir, "nope.txt")))
      .toThrow(/Không tìm thấy/);
  });

  it("throws when no valid colors (only comments / blanks)", () => {
    const p = path.join(tmpDir, "ck.txt");
    fs.writeFileSync(p, "# just a comment\n\n   \n# another\n");
    expect(() => validateChromaKeyFile(p)).toThrow(/không có color hợp lệ/);
  });

  it("throws and reports invalid lines with line numbers", () => {
    const p = path.join(tmpDir, "ck.txt");
    fs.writeFileSync(p, "D4F9D7\nNOTHEX\n123ZZZ\nABCDEF\n");
    expect(() => validateChromaKeyFile(p)).toThrow(/2 dòng không hợp lệ/);
    expect(() => validateChromaKeyFile(p)).toThrow(/dòng 2: "NOTHEX"/);
    expect(() => validateChromaKeyFile(p)).toThrow(/dòng 3: "123ZZZ"/);
  });

  it("rejects 7-character hex (must be exactly 6)", () => {
    const p = path.join(tmpDir, "ck.txt");
    fs.writeFileSync(p, "D4F9D7F\n");
    expect(() => validateChromaKeyFile(p)).toThrow(/không hợp lệ/);
  });

  it("returns sorted list of valid hex colors and ignores comments + blanks", () => {
    const p = path.join(tmpDir, "ck.txt");
    fs.writeFileSync(p, "# header\nD4F9D7\n\nFBFF02\n\n# inline note above\nABCDEF\n");
    const colors = validateChromaKeyFile(p);
    expect(colors).toEqual(["D4F9D7", "FBFF02", "ABCDEF"]);
  });

  it("accepts CRLF line endings", () => {
    const p = path.join(tmpDir, "ck.txt");
    fs.writeFileSync(p, "D4F9D7\r\nFBFF02\r\n");
    expect(validateChromaKeyFile(p)).toEqual(["D4F9D7", "FBFF02"]);
  });
});
