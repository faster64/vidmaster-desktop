import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { runTrimEnds } from "../src/trimEnds.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tinyMp4 = path.join(__dirname, "fixtures", "tiny.mp4");

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-trimends-")); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe("runTrimEnds", () => {
  it("rejects when both trimStart and trimEnd are 0", async () => {
    await expect(
      runTrimEnds({ input: tmpDir, output: tmpDir, trimStart: 0, trimEnd: 0 })
    ).rejects.toThrow(/ít nhất 1/);
  });

  it("rejects negative trim values", async () => {
    await expect(
      runTrimEnds({ input: tmpDir, output: tmpDir, trimStart: -1, trimEnd: 0 })
    ).rejects.toThrow(/>= 0/);
  });

  it("rejects when input folder does not exist", async () => {
    await expect(
      runTrimEnds({ input: "/nope/missing", output: tmpDir, trimStart: 0, trimEnd: 1 })
    ).rejects.toThrow(/không tồn tại/);
  });

  it("throws AbortError when aborted before start", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      runTrimEnds({ input: tmpDir, output: tmpDir, trimStart: 0, trimEnd: 1, signal: ctrl.signal })
    ).rejects.toThrow("Aborted");
  });

  it("flags too-short video instead of erroring out the whole task", async () => {
    const input = path.join(tmpDir, "in");
    const output = path.join(tmpDir, "out");
    fs.mkdirSync(input);
    fs.copyFileSync(tinyMp4, path.join(input, "v1.mp4"));

    const result = await runTrimEnds({
      input, output, trimStart: 100, trimEnd: 0, replace: false,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].message).toMatch(/quá ngắn/);
  });
});
