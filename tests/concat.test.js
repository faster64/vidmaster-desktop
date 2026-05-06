import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { runConcat } from "../src/concat.js";
import { spawn } from "child_process";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const audio  = path.join(__dirname, "fixtures", "tiny-with-audio.mp4");
const silent = path.join(__dirname, "fixtures", "tiny-silent.mp4");

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-concat-")); });
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function probeStreams(file) {
  return new Promise((res, rej) => {
    const c = spawn(ffmpegPath, ["-i", file], { windowsHide: true });
    let err = "";
    c.stderr.on("data", (b) => { err += b.toString(); });
    c.on("close", () => res(err));
  });
}

describe("runConcat", () => {
  it("concats two audio inputs and keeps audio", async () => {
    const out = path.join(tmpDir, "out.mp4");
    const ticks = [];
    const r = await runConcat({
      inputs: [audio, audio],
      output: out,
      onProgress: (p) => ticks.push(p),
    });
    expect(r.ok).toBe(true);
    expect(fs.existsSync(out)).toBe(true);
    const info = await probeStreams(out);
    expect(info).toMatch(/Stream #\d:\d.*Audio/);
    expect(ticks.at(-1)).toBe(100);
  }, 30_000);

  it("concats mixed (silent + audio) and synthesises audio for silent", async () => {
    const out = path.join(tmpDir, "out.mp4");
    const r = await runConcat({ inputs: [silent, audio], output: out });
    expect(r.ok).toBe(true);
    const info = await probeStreams(out);
    expect(info).toMatch(/Stream #\d:\d.*Audio/);
  }, 30_000);

  it("rejects with < 2 inputs", async () => {
    await expect(runConcat({ inputs: [audio], output: path.join(tmpDir, "x.mp4") }))
      .rejects.toThrow(/ít nhất 2/);
  });

  it("rejects on missing input", async () => {
    await expect(runConcat({
      inputs: [audio, path.join(tmpDir, "no.mp4")],
      output: path.join(tmpDir, "x.mp4"),
    })).rejects.toThrow(/không tồn tại/i);
  });

  it("aborts when signal fires", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(runConcat({ inputs: [audio, audio], output: path.join(tmpDir, "x.mp4"), signal: ctrl.signal }))
      .rejects.toThrow(/Aborted/);
  });
});
