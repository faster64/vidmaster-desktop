import { describe, it, expect, beforeEach, vi } from "vitest";

let parseIso8601Duration, fetchUploadsPlaylistId, listAllUploadVideos;

beforeEach(async () => {
  vi.resetModules();
  ({ parseIso8601Duration, fetchUploadsPlaylistId, listAllUploadVideos } =
    await import("../../src/_lib/youtube.js"));
});

describe("parseIso8601Duration", () => {
  it("parses minute+second", () => expect(parseIso8601Duration("PT15M30S")).toBe(15 * 60 + 30));
  it("parses hour+minute+second", () => expect(parseIso8601Duration("PT1H2M3S")).toBe(3723));
  it("parses second-only", () => expect(parseIso8601Duration("PT45S")).toBe(45));
  it("parses zero", () => expect(parseIso8601Duration("PT0S")).toBe(0));
});

describe("fetchUploadsPlaylistId", () => {
  it("returns uploads playlist ID from channels.list response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ id: "UCxxx", contentDetails: { relatedPlaylists: { uploads: "UUxxx" } } }] }),
    });
    const id = await fetchUploadsPlaylistId({ apiKey: "K", handle: "@test" });
    expect(id).toBe("UUxxx");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("forHandle=%40test"),
      expect.any(Object),
    );
  });

  it("throws on empty items", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    await expect(fetchUploadsPlaylistId({ apiKey: "K", handle: "@nope" }))
      .rejects.toThrow(/Không tìm thấy channel/);
  });

  it("throws with HTTP status on non-200", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 403,
      json: async () => ({ error: { message: "quotaExceeded" } }),
    });
    await expect(fetchUploadsPlaylistId({ apiKey: "K", handle: "@x" }))
      .rejects.toThrow(/403/);
  });
});

describe("listAllUploadVideos", () => {
  it("paginates and merges video metadata", async () => {
    const responses = [
      { ok: true, json: async () => ({
        items: [{ snippet: { resourceId: { videoId: "v1" } } }, { snippet: { resourceId: { videoId: "v2" } } }],
        nextPageToken: "PG2", pageInfo: { totalResults: 3 },
      }) },
      { ok: true, json: async () => ({ items: [
        { id: "v1", snippet: { title: "T1", publishedAt: "2024-01-01T00:00:00Z" },
          contentDetails: { duration: "PT10M" }, statistics: { viewCount: "100" } },
        { id: "v2", snippet: { title: "T2", publishedAt: "2024-01-02T00:00:00Z" },
          contentDetails: { duration: "PT5M" }, statistics: { viewCount: "200" } },
      ] }) },
      { ok: true, json: async () => ({
        items: [{ snippet: { resourceId: { videoId: "v3" } } }],
        pageInfo: { totalResults: 3 },
      }) },
      { ok: true, json: async () => ({ items: [
        { id: "v3", snippet: { title: "T3", publishedAt: "2024-01-03T00:00:00Z" },
          contentDetails: { duration: "PT20M" }, statistics: { viewCount: "300" } },
      ] }) },
    ];
    let i = 0;
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve(responses[i++]));

    const pages = [];
    const videos = await listAllUploadVideos({
      apiKey: "K", playlistId: "UUx",
      onPage: (p) => pages.push(p),
    });
    expect(videos).toHaveLength(3);
    expect(videos[0]).toEqual({
      id: "v1", title: "T1", publishedAt: "2024-01-01T00:00:00Z",
      durationSec: 600, viewCount: 100,
    });
    expect(pages).toEqual([
      { pagesDone: 1, totalPages: 1 },
      { pagesDone: 2, totalPages: 1 },
    ]);
  });

  it("respects abort signal", async () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10);
    await expect(listAllUploadVideos({ apiKey: "K", playlistId: "UUx", signal: ctrl.signal }))
      .rejects.toThrow(/Aborted/);
  });
});
