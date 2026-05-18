import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { EventEmitter } from "events";

let runDownload;
let tmpDir;

const fakeChildren = [];
function makeFakeChild(handlers) {
  const ee = new EventEmitter();
  ee.stdout = new EventEmitter();
  ee.stderr = new EventEmitter();
  ee.kill = vi.fn();
  ee.handlers = handlers || {};
  fakeChildren.push(ee);
  setImmediate(() => ee.handlers.onSpawn?.(ee));
  return ee;
}

vi.mock("child_process", () => ({
  spawn: vi.fn(() => makeFakeChild()),
}));

vi.mock("../src/_lib/ytdlp.js", () => ({
  ensureBinary: vi.fn(async ({ targetPath }) => targetPath),
  getStatus: vi.fn(async () => ({ exists: true, path: "/yt.exe", version: "x", lastModified: new Date() })),
}));

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  fakeChildren.length = 0;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-dl-"));
  ({ runDownload } = await import("../src/download.js"));
});

afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe("runDownload", () => {
  it("calls ensureBinary then spawns one yt-dlp per URL", async () => {
    const urlsFile = path.join(tmpDir, "urls.txt");
    fs.writeFileSync(urlsFile, "https://yt/a\nhttps://yt/b\n", "utf8");
    const cp = await import("child_process");

    const promise = runDownload({
      urlsFile, output: tmpDir, ytdlpPath: "/yt.exe", maxConcurrent: 2,
    });

    await new Promise((r) => setImmediate(r));
    expect(cp.spawn).toHaveBeenCalledTimes(2);

    for (const c of fakeChildren) c.emit("close", 0);
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("respects maxConcurrent (3rd URL waits)", async () => {
    const urlsFile = path.join(tmpDir, "urls.txt");
    fs.writeFileSync(urlsFile, "u1\nu2\nu3\n", "utf8");
    const cp = await import("child_process");

    const promise = runDownload({
      urlsFile, output: tmpDir, ytdlpPath: "/yt.exe", maxConcurrent: 2,
    });
    await new Promise((r) => setImmediate(r));
    expect(cp.spawn).toHaveBeenCalledTimes(2);
    fakeChildren[0].emit("close", 0);
    await new Promise((r) => setImmediate(r));
    expect(cp.spawn).toHaveBeenCalledTimes(3);
    fakeChildren[1].emit("close", 0);
    fakeChildren[2].emit("close", 0);
    await promise;
  });

  it("aggregates per-URL % into onProgress message", async () => {
    const urlsFile = path.join(tmpDir, "urls.txt");
    fs.writeFileSync(urlsFile, "u1\n", "utf8");
    const ticks = [];
    const promise = runDownload({
      urlsFile, output: tmpDir, ytdlpPath: "/yt.exe", maxConcurrent: 1,
      onProgress: (p, msg) => ticks.push({ p, msg }),
      throttleMs: 0,
    });
    await new Promise((r) => setImmediate(r));
    fakeChildren[0].stderr.emit("data", "[download]   42.0% of 10MiB at 1MiB/s ETA 00:01\n");
    await new Promise((r) => setImmediate(r));
    fakeChildren[0].emit("close", 0);
    await promise;
    const has42 = ticks.some((t) => /42/.test(t.msg ?? ""));
    expect(has42).toBe(true);
    expect(ticks.at(-1).p).toBe(100);
  });

  it("collects errors per failing URL but continues", async () => {
    const urlsFile = path.join(tmpDir, "urls.txt");
    fs.writeFileSync(urlsFile, "u-good\nu-bad\n", "utf8");
    const promise = runDownload({
      urlsFile, output: tmpDir, ytdlpPath: "/yt.exe", maxConcurrent: 2,
    });
    await new Promise((r) => setImmediate(r));
    fakeChildren[0].emit("close", 0);
    fakeChildren[1].stderr.emit("data", "ERROR: video unavailable\n");
    fakeChildren[1].emit("close", 1);
    const r = await promise;
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].url).toBe("u-bad");
  });

  it("aborts via signal: kills children", async () => {
    const urlsFile = path.join(tmpDir, "urls.txt");
    fs.writeFileSync(urlsFile, "u1\nu2\n", "utf8");
    const ctrl = new AbortController();
    const promise = runDownload({
      urlsFile, output: tmpDir, ytdlpPath: "/yt.exe", maxConcurrent: 2,
      signal: ctrl.signal,
    });
    await new Promise((r) => setImmediate(r));
    ctrl.abort();
    await new Promise((r) => setImmediate(r));
    for (const c of fakeChildren) expect(c.kill).toHaveBeenCalledWith("SIGTERM");
    for (const c of fakeChildren) c.emit("close", 1);
    await expect(promise).rejects.toThrow(/Aborted/);
  });

  it("rejects invalid format", async () => {
    const urlsFile = path.join(tmpDir, "urls.txt");
    fs.writeFileSync(urlsFile, "u1\n", "utf8");
    await expect(runDownload({
      urlsFile, output: tmpDir, ytdlpPath: "/yt.exe", maxConcurrent: 1, format: "wav",
    })).rejects.toThrow(/Định dạng không hợp lệ/);
  });

  it("uses mp4 args by default (no format param)", async () => {
    const urlsFile = path.join(tmpDir, "urls.txt");
    fs.writeFileSync(urlsFile, "u1\n", "utf8");
    const cp = await import("child_process");

    const promise = runDownload({
      urlsFile, output: tmpDir, ytdlpPath: "/yt.exe", maxConcurrent: 1,
    });
    await new Promise((r) => setImmediate(r));
    fakeChildren[0].emit("close", 0);
    await promise;

    const args = cp.spawn.mock.calls[0][1];
    expect(args).toContain("--merge-output-format");
    expect(args).toContain("mp4");
    expect(args).not.toContain("--extract-audio");
  });

  it("uses mp3 args when format=mp3", async () => {
    const urlsFile = path.join(tmpDir, "urls.txt");
    fs.writeFileSync(urlsFile, "u1\n", "utf8");
    const cp = await import("child_process");

    const promise = runDownload({
      urlsFile, output: tmpDir, ytdlpPath: "/yt.exe", maxConcurrent: 1, format: "mp3",
    });
    await new Promise((r) => setImmediate(r));
    fakeChildren[0].emit("close", 0);
    await promise;

    const args = cp.spawn.mock.calls[0][1];
    expect(args).toContain("--extract-audio");
    expect(args).toContain("--audio-format");
    expect(args).toContain("mp3");
    expect(args).not.toContain("--merge-output-format");
  });
});
