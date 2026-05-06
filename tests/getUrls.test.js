import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let runGetUrls;
let tmpDir;

vi.mock("../src/_lib/youtube.js", () => ({
  fetchUploadsPlaylistId: vi.fn(),
  listAllUploadVideos: vi.fn(),
  parseIso8601Duration: vi.fn(),
}));

beforeEach(async () => {
  vi.resetModules();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-geturls-"));
  ({ runGetUrls } = await import("../src/getUrls.js"));
});

afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

const VIDEOS = [
  { id: "v1", title: "Long video", publishedAt: "2024-01-03T00:00:00Z", durationSec: 1800, viewCount: 1000 },
  { id: "v2", title: "Short clip",  publishedAt: "2024-01-02T00:00:00Z", durationSec: 60,   viewCount: 5000 },
  { id: "v3", title: "Medium",      publishedAt: "2024-01-01T00:00:00Z", durationSec: 600,  viewCount: 2000 },
];

describe("runGetUrls", () => {
  it("filters by minDurationMinutes and writes both files (sorted by VIEW)", async () => {
    const yt = await import("../src/_lib/youtube.js");
    yt.fetchUploadsPlaylistId.mockResolvedValue("UUtest");
    yt.listAllUploadVideos.mockImplementation(async ({ onPage }) => {
      onPage?.({ pagesDone: 1, totalPages: 1 });
      return VIDEOS;
    });

    const result = await runGetUrls({
      handle: "@chan", apiKey: "K",
      minDurationMinutes: 5, sortOrder: "VIEW",
      workspace: tmpDir,
    });

    expect(result.ok).toBe(true);
    const dir = path.join(tmpDir, "channels", "chan");
    const urls = fs.readFileSync(path.join(dir, "only_video_urls.txt"), "utf8").trim().split("\n");
    expect(urls).toEqual([
      "https://www.youtube.com/watch?v=v3",
      "https://www.youtube.com/watch?v=v1",
    ]);
    const infos = fs.readFileSync(path.join(dir, "video_infos.txt"), "utf8").trim().split("\n");
    expect(infos).toHaveLength(2);
    expect(infos[0]).toContain("\thttps://www.youtube.com/watch?v=v3\t");
  });

  it("sorts by LATEST", async () => {
    const yt = await import("../src/_lib/youtube.js");
    yt.fetchUploadsPlaylistId.mockResolvedValue("UU");
    yt.listAllUploadVideos.mockResolvedValue(VIDEOS);
    await runGetUrls({ handle: "c", apiKey: "K", minDurationMinutes: 5, sortOrder: "LATEST", workspace: tmpDir });
    const urls = fs.readFileSync(path.join(tmpDir, "channels", "c", "only_video_urls.txt"), "utf8").trim().split("\n");
    expect(urls).toEqual([
      "https://www.youtube.com/watch?v=v1",
      "https://www.youtube.com/watch?v=v3",
    ]);
  });

  it("emits progress 5% start → 90% after fetch → 100% after write", async () => {
    const yt = await import("../src/_lib/youtube.js");
    yt.fetchUploadsPlaylistId.mockResolvedValue("UU");
    yt.listAllUploadVideos.mockImplementation(async ({ onPage }) => {
      onPage({ pagesDone: 1, totalPages: 2 });
      onPage({ pagesDone: 2, totalPages: 2 });
      return [VIDEOS[0]];
    });
    const ticks = [];
    await runGetUrls({
      handle: "@x", apiKey: "K", minDurationMinutes: 5, sortOrder: "VIEW",
      workspace: tmpDir,
      onProgress: (p) => ticks.push(p),
    });
    expect(ticks[0]).toBeGreaterThanOrEqual(5);
    expect(ticks.at(-1)).toBe(100);
    expect(Math.max(...ticks)).toBe(100);
  });

  it("aborts cleanly", async () => {
    const yt = await import("../src/_lib/youtube.js");
    yt.fetchUploadsPlaylistId.mockResolvedValue("UU");
    yt.listAllUploadVideos.mockRejectedValue(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(runGetUrls({
      handle: "@x", apiKey: "K", minDurationMinutes: 5, sortOrder: "VIEW",
      workspace: tmpDir, signal: ctrl.signal,
    })).rejects.toThrow(/Aborted/);
  });
});
