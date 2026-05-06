import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { runRename } from "../src/rename.js";

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-rename-"));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("runRename", () => {
  it("normalises decomposed unicode filenames to NFC recursively", async () => {
    const nfd = "Việt".normalize("NFD") + ".jpg";
    const nfc = "Việt".normalize("NFC") + ".jpg";
    expect(nfd).not.toBe(nfc);

    const sub = path.join(tmpDir, "sub");
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(tmpDir, nfd), "x");
    fs.writeFileSync(path.join(sub, nfd), "y");

    const onLog = vi.fn();
    const result = await runRename({ folder: tmpDir, onLog });

    expect(result.ok).toBe(true);
    expect(fs.readdirSync(tmpDir).map((n) => n.normalize("NFC")))
      .toContain(nfc);
    expect(onLog).toHaveBeenCalled();
  });

  it("returns ok with empty outputs for an already-normalised tree", async () => {
    fs.writeFileSync(path.join(tmpDir, "ascii.txt"), "x");
    const result = await runRename({ folder: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.outputs).toEqual([]);
  });

  it("throws AbortError when aborted before start", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(runRename({ folder: tmpDir, signal: ctrl.signal }))
      .rejects.toThrow("Aborted");
  });
});
