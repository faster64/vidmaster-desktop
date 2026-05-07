import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { ensureWorkspace, defaultsForTask, REQUIRED_SUBFOLDERS } from "../../electron/workspace.js";

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-ws-")); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe("ensureWorkspace", () => {
  it("creates all required subfolders", () => {
    ensureWorkspace(tmpDir);
    for (const sub of REQUIRED_SUBFOLDERS) {
      expect(fs.existsSync(path.join(tmpDir, sub))).toBe(true);
    }
  });

  it("is idempotent", () => {
    ensureWorkspace(tmpDir);
    ensureWorkspace(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, "done"))).toBe(true);
  });
});

describe("defaultsForTask", () => {
  it("returns render input/output paths under the workspace", () => {
    const d = defaultsForTask(tmpDir, "render");
    expect(d.inputs.overlays).toBe(path.join(tmpDir, "overlays"));
    expect(d.inputs.backgrounds).toBe(path.join(tmpDir, "backgrounds"));
    expect(d.output).toBe(path.join(tmpDir, "done"));
  });

  it("returns trim defaults with empty input and done as output", () => {
    const d = defaultsForTask(tmpDir, "trim");
    expect(d.input).toBe("");
    expect(d.output).toBe(path.join(tmpDir, "done"));
  });
});
