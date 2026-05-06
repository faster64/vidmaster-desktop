import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { runSnow } from "../src/snow.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tinyPng = path.join(__dirname, "fixtures", "tiny.png");

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-snow-")); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe("runSnow", () => {
  it("rejects with a clear error if snowAsset is missing", async () => {
    await expect(runSnow({
      input: tmpDir, output: tmpDir, snowAsset: path.join(tmpDir, "no-such.mov"), duration: 1,
    })).rejects.toThrow();
  });

  it("throws AbortError when aborted before start", async () => {
    const ctrl = new AbortController(); ctrl.abort();
    await expect(runSnow({
      input: tmpDir, output: tmpDir, snowAsset: "x", duration: 1, signal: ctrl.signal,
    })).rejects.toThrow("Aborted");
  });
});
