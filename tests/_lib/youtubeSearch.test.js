import { describe, it, expect, beforeEach, vi } from "vitest";
import { searchTrending } from "../../src/_lib/youtubeSearch.js";

function fetchOK(jsonByUrlSubstring) {
  return vi.fn(async (url) => {
    for (const [needle, json] of Object.entries(jsonByUrlSubstring)) {
      if (url.includes(needle)) return { ok: true, json: async () => json };
    }
    throw new Error(`Unmocked URL: ${url}`);
  });
}

describe("searchTrending", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("merges 3 sort orders, dedupes by videoId, enriches via videos.list and channels.list", async () => {
    global.fetch = fetchOK({
      "search?part=snippet&q=cat&order=relevance":
        { items: [{ id: { videoId: "v1" }, snippet: { channelId: "c1" } },
                  { id: { videoId: "v2" }, snippet: { channelId: "c2" } }] },
      "search?part=snippet&q=cat&order=viewCount":
        { items: [{ id: { videoId: "v2" }, snippet: { channelId: "c2" } },
                  { id: { videoId: "v3" }, snippet: { channelId: "c1" } }] },
      "search?part=snippet&q=cat&order=date":
        { items: [{ id: { videoId: "v1" }, snippet: { channelId: "c1" } }] },
      "/videos?":
        { items: [
          { id: "v1", snippet: { title: "T1", channelId: "c1", channelTitle: "C1", publishedAt: "2026-05-01T00:00:00Z", thumbnails: { medium: { url: "thumb1" } } },
            statistics: { viewCount: "1000", likeCount: "10", commentCount: "5" }, contentDetails: { duration: "PT1M30S" } },
          { id: "v2", snippet: { title: "T2", channelId: "c2", channelTitle: "C2", publishedAt: "2026-05-05T00:00:00Z", thumbnails: { medium: { url: "thumb2" } } },
            statistics: { viewCount: "500", likeCount: "5", commentCount: "1" }, contentDetails: { duration: "PT2M" } },
          { id: "v3", snippet: { title: "T3", channelId: "c1", channelTitle: "C1", publishedAt: "2026-05-08T00:00:00Z", thumbnails: { medium: { url: "thumb3" } } },
            statistics: { viewCount: "200", likeCount: "2", commentCount: "0" }, contentDetails: { duration: "PT3M" } },
        ] },
      "/channels?":
        { items: [
          { id: "c1", snippet: { title: "C1", thumbnails: { default: { url: "ct1" } } }, statistics: { subscriberCount: "10000" } },
          { id: "c2", snippet: { title: "C2", thumbnails: { default: { url: "ct2" } } }, statistics: { subscriberCount: "5000" } },
        ] },
    });

    const result = await searchTrending({
      apiKey: "K", keyword: "cat", regionCode: "VN",
      relevanceLanguage: "vi", publishedAfter: "2026-04-01T00:00:00Z",
    });

    const ids = result.videos.map((v) => v.id).sort();
    expect(ids).toEqual(["v1", "v2", "v3"]);
    expect(result.videos.find((v) => v.id === "v1")).toMatchObject({ viewCount: 1000, likeCount: 10, commentCount: 5 });
    const channelIds = result.channels.map((c) => c.id).sort();
    expect(channelIds).toEqual(["c1", "c2"]);
    expect(result.channels.find((c) => c.id === "c1")).toMatchObject({ subscriberCount: 10000, matchedVideoIds: expect.arrayContaining(["v1", "v3"]) });
    expect(result.quotaUsed).toEqual({ youtube: 302 });
  });

  it("aborts on signal abort", async () => {
    global.fetch = vi.fn(async (_url, { signal }) => {
      await new Promise((_, rej) => signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 5);
    await expect(searchTrending({ apiKey: "K", keyword: "x", regionCode: "VN", relevanceLanguage: "vi", publishedAfter: "2026-04-01T00:00:00Z", signal: ac.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("throws on 403 quota exceeded", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 403, statusText: "Forbidden", json: async () => ({ error: { message: "quotaExceeded" } }) }));
    await expect(searchTrending({ apiKey: "K", keyword: "x", regionCode: "", relevanceLanguage: "", publishedAfter: "2026-04-01T00:00:00Z" }))
      .rejects.toThrow(/403/);
  });

  it("batches videos.list and channels.list when >50 ids", async () => {
    const manyVideos = Array.from({ length: 75 }, (_, i) => ({ id: { videoId: `v${i}` }, snippet: { channelId: `c${i % 60}` } }));
    let videoCalls = 0, channelCalls = 0;
    global.fetch = vi.fn(async (url) => {
      if (url.includes("/search?")) return { ok: true, json: async () => ({ items: manyVideos }) };
      if (url.includes("/videos?")) {
        videoCalls++;
        return { ok: true, json: async () => ({ items: [] }) };
      }
      if (url.includes("/channels?")) {
        channelCalls++;
        return { ok: true, json: async () => ({ items: [] }) };
      }
      throw new Error(`Unmocked: ${url}`);
    });
    await searchTrending({ apiKey: "K", keyword: "cat", regionCode: "", relevanceLanguage: "", publishedAfter: "2026-04-01T00:00:00Z" });
    expect(videoCalls).toBe(2);    // 75 → 50 + 25
    expect(channelCalls).toBe(2);  // 60 unique channels → 50 + 10
  });
});
