import { describe, it, expect } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { spawnFfmpeg } from "../../src/_lib/ffmpeg.js";
import { AbortError } from "../../src/_lib/abortError.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "..", "fixtures");
const tinyMp4 = path.join(fixturesDir, "tiny.mp4");

describe("spawnFfmpeg", () => {
  it("re-encodes a tiny clip and reports progress", async () => {
    const out = path.join(fixturesDir, ".tmp-encoded.mp4");
    const progressTicks = [];

    const result = await spawnFfmpeg(
      ["-y", "-i", tinyMp4, "-c:v", "libx264", "-preset", "ultrafast", out],
      { totalDurationSec: 1, onProgress: (p) => progressTicks.push(p) }
    );

    expect(result.exitCode).toBe(0);
    expect(progressTicks.length).toBeGreaterThan(0);
    expect(progressTicks.at(-1)).toBeGreaterThanOrEqual(0);
  });

  it("rejects with AbortError when signal aborts mid-run", async () => {
    const out = path.join(fixturesDir, ".tmp-aborted.mp4");
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 50);

    await expect(
      spawnFfmpeg(
        ["-y", "-f", "lavfi", "-i", "color=c=black:s=320x180:d=10", out],
        { signal: ctrl.signal, totalDurationSec: 10 }
      )
    ).rejects.toThrow(AbortError);
  });

  it("rejects on non-zero exit", async () => {
    await expect(
      spawnFfmpeg(["-i", "no-such-file.mp4", "out.mp4"], { totalDurationSec: 1 })
    ).rejects.toThrow();
  });
});
