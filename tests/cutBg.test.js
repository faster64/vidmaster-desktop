import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { runCutBg } from "../src/cutBg.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tinyMp4 = path.join(__dirname, "fixtures", "tiny.mp4");

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-cutbg-")); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe("runCutBg", () => {
  it("produces at least one output segment", async () => {
    const input = path.join(tmpDir, "in"); fs.mkdirSync(input);
    const output = path.join(tmpDir, "out"); fs.mkdirSync(output);
    fs.copyFileSync(tinyMp4, path.join(input, "bg.mp4"));

    const result = await runCutBg({ input, output });
    expect(result.ok).toBe(true);
    expect(result.outputs.length).toBeGreaterThan(0);
  });

  it("throws AbortError when aborted before start", async () => {
    const ctrl = new AbortController(); ctrl.abort();
    await expect(runCutBg({ input: tmpDir, output: tmpDir, signal: ctrl.signal }))
      .rejects.toThrow("Aborted");
  });
});
