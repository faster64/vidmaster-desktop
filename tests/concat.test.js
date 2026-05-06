import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { runConcat } from "../src/concat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tinyMp4 = path.join(__dirname, "fixtures", "tiny.mp4");
const tinyPng = path.join(__dirname, "fixtures", "tiny.png");

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-concat-")); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe("runConcat", () => {
  it("produces a concatenated output for a single-folder manual run", async () => {
    const thumbs = path.join(tmpDir, "thumbs"); fs.mkdirSync(thumbs);
    const done = path.join(tmpDir, "done", "f1"); fs.mkdirSync(done, { recursive: true });
    const output = path.join(tmpDir, "out"); fs.mkdirSync(output);
    const temp = path.join(tmpDir, "temp"); fs.mkdirSync(temp);

    fs.copyFileSync(tinyMp4, path.join(done, "1.mp4"));
    fs.copyFileSync(tinyPng, path.join(thumbs, "f1.jpg"));

    const result = await runConcat({
      thumbsDir: thumbs, doneDir: path.dirname(done), output, tempDir: temp,
      chunkSize: 1, folderName: "f1",
    });
    expect(result.ok).toBe(true);
    expect(result.outputs.length).toBeGreaterThan(0);
  });

  it("throws AbortError when aborted before start", async () => {
    const ctrl = new AbortController(); ctrl.abort();
    await expect(runConcat({
      thumbsDir: tmpDir, doneDir: tmpDir, output: tmpDir, tempDir: tmpDir, signal: ctrl.signal,
    })).rejects.toThrow("Aborted");
  });
});
