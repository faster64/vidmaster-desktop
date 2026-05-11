import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/_lib/youtubeSearch.js", () => ({
  searchTrending: vi.fn(),
}));
vi.mock("../src/_lib/geminiAnalyze.js", () => ({
  analyzeWhyHot: vi.fn(),
}));
vi.mock("../src/_lib/intentExtract.js", () => ({
  extractIntent: vi.fn(),
}));

import { runTrendSearch } from "../src/trendSearch.js";
import { searchTrending } from "../src/_lib/youtubeSearch.js";
import { analyzeWhyHot } from "../src/_lib/geminiAnalyze.js";
import { extractIntent } from "../src/_lib/intentExtract.js";

const VIDEOS = [
  { id: "v1", title: "T1", channelId: "c1", channelTitle: "C1", thumbnailUrl: "u1", publishedAt: "2026-05-01T00:00:00Z", viewCount: 10000, likeCount: 100, commentCount: 10, duration: 60 },
  { id: "v2", title: "T2", channelId: "c2", channelTitle: "C2", thumbnailUrl: "u2", publishedAt: "2026-05-08T00:00:00Z", viewCount: 5000, likeCount: 50, commentCount: 5, duration: 90 },
];
const CHANNELS = [
  { id: "c1", title: "C1", thumbnailUrl: "ct1", subscriberCount: 1000, aggregateViews: 10000, matchedVideoIds: ["v1"] },
  { id: "c2", title: "C2", thumbnailUrl: "ct2", subscriberCount: 500, aggregateViews: 5000, matchedVideoIds: ["v2"] },
];

const NOOP_INTENT = {
  queries: ["x"],
  filterHints: { timeWindowDays: null, sortBy: null, minDurationMinutes: null },
  interpretation: "raw",
};

describe("runTrendSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-09T00:00:00Z"));
    searchTrending.mockResolvedValue({ videos: VIDEOS, channels: CHANNELS, quotaUsed: { youtube: 302 } });
    extractIntent.mockResolvedValue(NOOP_INTENT);
  });

  it("blocks when no AI keys are configured", async () => {
    await expect(runTrendSearch({
      keyword: "x", regionCode: "VN", relevanceLanguage: "vi",
      timeWindowDays: 7, minViews: 0, sortBy: "velocity", analyzeTopN: 0,
      apiKey: "K", aiKeys: [],
    })).rejects.toThrow(/AI API key/);
    expect(extractIntent).not.toHaveBeenCalled();
  });

  it("computes velocity and applies sortBy=velocity", async () => {
    analyzeWhyHot.mockResolvedValue({ reason: "r", factors: [] });
    const result = await runTrendSearch({
      keyword: "x", regionCode: "VN", relevanceLanguage: "vi",
      timeWindowDays: 7, minViews: 0, sortBy: "velocity", analyzeTopN: 0,
      apiKey: "K", aiKeys: ["g1"],
    });
    // v1 age=8 days → 1250/day; v2 age=1 day → 5000/day
    expect(result.videos[0].id).toBe("v2");
    expect(result.videos[1].id).toBe("v1");
    expect(result.videos[0].velocity).toBe(5000);
  });

  it("filters minViews", async () => {
    const result = await runTrendSearch({
      keyword: "x", regionCode: "", relevanceLanguage: "",
      timeWindowDays: 30, minViews: 7000, sortBy: "totalViews", analyzeTopN: 0,
      apiKey: "K", aiKeys: ["g1"],
    });
    expect(result.videos.map((v) => v.id)).toEqual(["v1"]);
  });

  it("filters minDurationMinutes (default 0 = no filter)", async () => {
    const result = await runTrendSearch({
      keyword: "x", regionCode: "", relevanceLanguage: "",
      timeWindowDays: 30, minViews: 0, minDurationMinutes: 1.4, sortBy: "totalViews", analyzeTopN: 0,
      apiKey: "K", aiKeys: ["g1"],
    });
    // 1.4 min = 84s threshold → only v2 (90s) passes; v1 (60s) filtered out
    expect(result.videos.map((v) => v.id)).toEqual(["v2"]);
  });

  it("skips analyzeWhyHot when analyzeTopN=0", async () => {
    const result = await runTrendSearch({
      keyword: "x", regionCode: "", relevanceLanguage: "",
      timeWindowDays: 7, minViews: 0, sortBy: "date", analyzeTopN: 0,
      apiKey: "K", aiKeys: ["g1"],
    });
    expect(analyzeWhyHot).not.toHaveBeenCalled();
    expect(result.videos.every((v) => v.analysis === null)).toBe(true);
  });

  it("calls analyzeWhyHot for top N when keys present", async () => {
    analyzeWhyHot.mockImplementation(async ({ video }) => ({ reason: `why-${video.id}`, factors: [] }));
    const result = await runTrendSearch({
      keyword: "x", regionCode: "", relevanceLanguage: "",
      timeWindowDays: 30, minViews: 0, sortBy: "totalViews", analyzeTopN: 1,
      apiKey: "K", aiKeys: ["g1"],
    });
    expect(analyzeWhyHot).toHaveBeenCalledTimes(1);
    expect(result.videos[0].analysis).toEqual({ reason: "why-v1", factors: [] });
    expect(result.videos[1].analysis).toBeNull();
  });

  it("preserves videos when Gemini fails for some", async () => {
    analyzeWhyHot.mockImplementation(async ({ video }) =>
      video.id === "v1" ? Promise.reject(new Error("boom")) : { reason: "ok", factors: [] },
    );
    const result = await runTrendSearch({
      keyword: "x", regionCode: "", relevanceLanguage: "",
      timeWindowDays: 30, minViews: 0, sortBy: "totalViews", analyzeTopN: 2,
      apiKey: "K", aiKeys: ["g1"],
    });
    expect(result.videos.find((v) => v.id === "v1").analysis).toBeNull();
    expect(result.videos.find((v) => v.id === "v2").analysis).toEqual({ reason: "ok", factors: [] });
  });

  it("emits progress events for each stage", async () => {
    analyzeWhyHot.mockResolvedValue({ reason: "r", factors: [] });
    const stages = [];
    await runTrendSearch({
      keyword: "x", regionCode: "", relevanceLanguage: "",
      timeWindowDays: 7, minViews: 0, sortBy: "date", analyzeTopN: 1,
      apiKey: "K", aiKeys: ["g1"],
      onProgress: (pct, msg) => stages.push({ pct, msg }),
    });
    const messages = stages.map((s) => s.msg);
    expect(messages.some((m) => m.includes("AI phân tích"))).toBe(true);
    expect(messages.some((m) => m.includes("Tìm"))).toBe(true);
    expect(messages.some((m) => m.includes("Phân tích"))).toBe(true);
  });

  it("runs searchTrending once per AI-extracted query and merges results", async () => {
    extractIntent.mockResolvedValue({
      queries: ["q1", "q2", "q3"],
      filterHints: { timeWindowDays: null, sortBy: null, minDurationMinutes: null },
      interpretation: "test",
    });
    await runTrendSearch({
      keyword: "x", regionCode: "", relevanceLanguage: "",
      timeWindowDays: 7, minViews: 0, sortBy: "velocity", analyzeTopN: 0,
      apiKey: "K", aiKeys: ["g1"],
    });
    expect(searchTrending).toHaveBeenCalledTimes(3);
    expect(searchTrending.mock.calls[0][0].keyword).toBe("q1");
    expect(searchTrending.mock.calls[1][0].keyword).toBe("q2");
    expect(searchTrending.mock.calls[2][0].keyword).toBe("q3");
  });

  it("dedupes videos that appear in multiple query results", async () => {
    extractIntent.mockResolvedValue({
      queries: ["q1", "q2"],
      filterHints: { timeWindowDays: null, sortBy: null, minDurationMinutes: null },
      interpretation: "",
    });
    // Both queries return the same v1
    searchTrending.mockResolvedValue({ videos: [VIDEOS[0]], channels: [CHANNELS[0]], quotaUsed: { youtube: 302 } });
    const result = await runTrendSearch({
      keyword: "x", regionCode: "", relevanceLanguage: "",
      timeWindowDays: 7, minViews: 0, sortBy: "velocity", analyzeTopN: 0,
      apiKey: "K", aiKeys: ["g1"],
    });
    expect(result.videos.length).toBe(1);
    expect(result.videos[0].id).toBe("v1");
    expect(result.quotaUsed.youtube).toBe(604); // 302 × 2 queries
  });

  it("applies AI filterHints to override config values", async () => {
    extractIntent.mockResolvedValue({
      queries: ["q"],
      filterHints: { timeWindowDays: 30, sortBy: "date", minDurationMinutes: 1.4 },
      interpretation: "",
    });
    const result = await runTrendSearch({
      keyword: "x", regionCode: "", relevanceLanguage: "",
      timeWindowDays: 7, minViews: 0, sortBy: "velocity", analyzeTopN: 0,
      apiKey: "K", aiKeys: ["g1"],
    });
    expect(result.intent.effectiveFilters).toEqual({ timeWindowDays: 30, sortBy: "date", minDurationMinutes: 1.4 });
    // sortBy=date → newer first → v2 then v1; minDuration 1.4 filters v1 out
    expect(result.videos.map((v) => v.id)).toEqual(["v2"]);
  });

  it("returns intent in result for UI display", async () => {
    extractIntent.mockResolvedValue({
      queries: ["k-drama 2026", "phim hàn"],
      filterHints: { timeWindowDays: null, sortBy: null, minDurationMinutes: null },
      interpretation: "Tìm K-drama mới",
    });
    const result = await runTrendSearch({
      keyword: "drama hàn", regionCode: "KR", relevanceLanguage: "ko",
      timeWindowDays: 7, minViews: 0, sortBy: "velocity", analyzeTopN: 0,
      apiKey: "K", aiKeys: ["g1"],
    });
    expect(result.intent.queries).toEqual(["k-drama 2026", "phim hàn"]);
    expect(result.intent.interpretation).toBe("Tìm K-drama mới");
  });
});
