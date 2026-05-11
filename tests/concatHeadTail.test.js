import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { runConcatHeadTail } from "../src/concatHeadTail.js";

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-cht-")); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe("runConcatHeadTail", () => {
  it("rejects when folderA missing", async () => {
    await expect(
      runConcatHeadTail({ folderA: "", folderB: tmpDir, folderC: "", output: tmpDir })
    ).rejects.toThrow(/folder A/i);
  });

  it("rejects when folderA does not exist", async () => {
    await expect(
      runConcatHeadTail({ folderA: "/nope/missing", folderB: tmpDir, folderC: "", output: tmpDir })
    ).rejects.toThrow(/không tồn tại/);
  });

  it("rejects when both B and C are empty", async () => {
    const a = path.join(tmpDir, "a");
    fs.mkdirSync(a);
    await expect(
      runConcatHeadTail({ folderA: a, folderB: "", folderC: "", output: tmpDir })
    ).rejects.toThrow(/ít nhất 1/);
  });

  it("rejects when output is missing", async () => {
    const a = path.join(tmpDir, "a");
    const b = path.join(tmpDir, "b");
    fs.mkdirSync(a); fs.mkdirSync(b);
    await expect(
      runConcatHeadTail({ folderA: a, folderB: b, folderC: "", output: "" })
    ).rejects.toThrow(/output/);
  });

  it("rejects when folderA is empty", async () => {
    const a = path.join(tmpDir, "a");
    const b = path.join(tmpDir, "b");
    fs.mkdirSync(a); fs.mkdirSync(b);
    fs.writeFileSync(path.join(b, "intro.mp4"), "");
    await expect(
      runConcatHeadTail({ folderA: a, folderB: b, folderC: "", output: tmpDir })
    ).rejects.toThrow(/A trống/);
  });

  it("throws AbortError when aborted before start", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      runConcatHeadTail({ folderA: tmpDir, folderB: tmpDir, folderC: "", output: tmpDir, signal: ctrl.signal })
    ).rejects.toThrow("Aborted");
  });
});
