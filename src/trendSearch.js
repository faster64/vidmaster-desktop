import pLimit from "p-limit";
import { TaskRunner } from "./_lib/runner.js";
import { searchTrending } from "./_lib/youtubeSearch.js";
import { analyzeWhyHot } from "./_lib/geminiAnalyze.js";
import { KeyRotator, AllKeysExhausted } from "./_lib/keyRotator.js";

const ANALYZE_CONCURRENCY = 3;

function computeVelocity(video, nowMs) {
  const publishedMs = Date.parse(video.publishedAt);
  if (!Number.isFinite(publishedMs)) return 0;
  const ageDays = Math.max(1, (nowMs - publishedMs) / (24 * 60 * 60 * 1000));
  return Math.round(video.viewCount / ageDays);
}

function sortVideos(videos, sortBy) {
  const arr = videos.slice();
  if (sortBy === "velocity") arr.sort((a, b) => b.velocity - a.velocity);
  else if (sortBy === "totalViews") arr.sort((a, b) => b.viewCount - a.viewCount);
  else if (sortBy === "date") arr.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return arr;
}

export async function runTrendSearch(config) {
  const runner = new TaskRunner({ ...config, throttleMs: 0 });
  const {
    keyword, regionCode, relevanceLanguage,
    timeWindowDays, minViews, sortBy, analyzeTopN,
    apiKey, geminiKeys,
  } = config;
  const { signal } = config;

  if (!apiKey) throw new Error("Thiếu YouTube API key.");
  if (!keyword) throw new Error("Thiếu keyword.");

  runner.checkAborted();
  runner.setProgress(2, "Tìm video...");

  const publishedAfter = new Date(Date.now() - timeWindowDays * 24 * 60 * 60 * 1000).toISOString();
  const search = await searchTrending({
    apiKey, keyword, regionCode, relevanceLanguage, publishedAfter,
    signal,
    onProgress: ({ stage, pct }) => {
      if (stage === "searching") runner.setProgress(2 + pct * 0.3, "Tìm video...");
      else if (stage === "enriching") runner.setProgress(35 + pct * 0.2, "Đọc thông tin video & kênh...");
    },
  });
  runner.checkAborted();

  const now = Date.now();
  const enriched = search.videos
    .map((v) => ({ ...v, velocity: computeVelocity(v, now), analysis: null }))
    .filter((v) => v.viewCount >= minViews);

  const sorted = sortVideos(enriched, sortBy);

  let geminiCalls = 0;
  if (analyzeTopN > 0 && geminiKeys.length > 0) {
    runner.setProgress(60, "Phân tích AI...");
    const rotator = new KeyRotator(geminiKeys);
    const limit = pLimit(ANALYZE_CONCURRENCY);
    const targets = sorted.slice(0, analyzeTopN);
    let done = 0;
    await Promise.all(targets.map((v) => limit(async () => {
      runner.checkAborted();
      try {
        const subs = search.channels.find((c) => c.id === v.channelId)?.subscriberCount ?? 0;
        v.analysis = await analyzeWhyHot({
          rotator,
          video: { ...v, channelSubs: subs },
          signal,
        });
        geminiCalls++;
      } catch (err) {
        if (err instanceof AllKeysExhausted) v.analysis = { error: "all_keys_exhausted" };
        else if (err.name === "AbortError") throw err;
        else {
          runner.log("warn", `analyzeWhyHot failed for ${v.id}: ${err.message}`);
          v.analysis = null;
        }
      } finally {
        done++;
        if (!signal?.aborted) {
          runner.setProgress(60 + (done / targets.length) * 35, `Phân tích AI ${done}/${targets.length}...`);
        }
      }
    })));
  }

  runner.setProgress(100, "Xong");
  return {
    ok: true,
    outputs: [],
    videos: sorted,
    channels: search.channels,
    quotaUsed: { ...search.quotaUsed, geminiCalls },
    errors: [],
  };
}
