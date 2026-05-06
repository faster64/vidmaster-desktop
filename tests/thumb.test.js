import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { runThumb } from "../src/thumb.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tinyPng = path.join(__dirname, "fixtures", "tiny.png");

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-thumb-")); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe("runThumb", () => {
  it("produces output thumbnails when overlay images are present", async () => {
    const baseThumb = path.join(tmpDir, "base"); fs.mkdirSync(baseThumb);
    const overlays = path.join(tmpDir, "overlays"); fs.mkdirSync(overlays);
    const out = path.join(tmpDir, "out"); fs.mkdirSync(out);

    fs.copyFileSync(tinyPng, path.join(baseThumb, "1.png"));
    fs.copyFileSync(tinyPng, path.join(overlays, "1.png"));

    const result = await runThumb({
      input: baseThumb, overlays, output: out,
    });
    expect(result.ok).toBe(true);
    expect(result.outputs.length).toBeGreaterThan(0);
  });

  it("throws AbortError when aborted before start", async () => {
    const ctrl = new AbortController(); ctrl.abort();
    await expect(runThumb({
      input: tmpDir, overlays: tmpDir, output: tmpDir, signal: ctrl.signal,
    })).rejects.toThrow("Aborted");
  });
});
