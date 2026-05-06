import { describe, it, expect } from "vitest";
import { runRender } from "../src/render.js";

describe("runRender", () => {
  it("rejects with a clear error if input folders are missing", async () => {
    await expect(runRender({
      currentDay: 1,
      videosPerFolder: 1,
      inputs: { overlays: "/nope/overlays", backgrounds: "/nope/bg" },
      output: "/nope/out",
      ffmpeg: { useGPU: false, encoder: "libx264", maxConcurrent: 1 },
    })).rejects.toThrow();
  });

  it("throws AbortError when aborted before start", async () => {
    const ctrl = new AbortController(); ctrl.abort();
    await expect(runRender({
      currentDay: 1, videosPerFolder: 1,
      inputs: { overlays: "/x", backgrounds: "/y" },
      output: "/z",
      ffmpeg: { useGPU: false, encoder: "libx264", maxConcurrent: 1 },
      signal: ctrl.signal,
    })).rejects.toThrow("Aborted");
  });
});
