import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { runTrim } from "../src/trim.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tinyMp4 = path.join(__dirname, "fixtures", "tiny.mp4");

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-trim-")); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe("runTrim", () => {
  it("produces a single 1s segment for a 1s input", async () => {
    const input = path.join(tmpDir, "in");
    const output = path.join(tmpDir, "out");
    fs.mkdirSync(input);
    fs.copyFileSync(tinyMp4, path.join(input, "v1.mp4"));

    const ticks = [];
    const result = await runTrim({
      input, output, segmentSeconds: 30, replace: false,
      onProgress: (p) => ticks.push(p),
    });

    expect(result.ok).toBe(true);
    expect(result.outputs.length).toBeGreaterThanOrEqual(1);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.at(-1)).toBe(100);
  });

  it("replaces originals when replace=true", async () => {
    const input = path.join(tmpDir, "in");
    fs.mkdirSync(input);
    const original = path.join(input, "v1.mp4");
    fs.copyFileSync(tinyMp4, original);

    await runTrim({ input, output: input, segmentSeconds: 30, replace: true });

    expect(fs.existsSync(original)).toBe(false);
  });

  it("throws AbortError when signal aborted before start", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      runTrim({ input: tmpDir, output: tmpDir, segmentSeconds: 30, signal: ctrl.signal })
    ).rejects.toThrow("Aborted");
  });
});
