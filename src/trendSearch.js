import pLimit from "p-limit";
import { TaskRunner } from "./_lib/runner.js";
import { searchTrending } from "./_lib/youtubeSearch.js";
import { analyzeWhyHot } from "./_lib/geminiAnalyze.js";
import { extractIntent } from "./_lib/intentExtract.js";
import { KeyRotator, AllKeysExhausted } from "./_lib/keyRotator.js";

const ANALYZE_CONCURRENCY = 3;
const SEARCH_CONCURRENCY = 3;

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

function mergeSearchResults(results) {
  const videosById = new Map();
  const channelsById = new Map();
  let quotaYoutube = 0;
  for (const r of results) {
    quotaYoutube += r.quotaUsed?.youtube ?? 0;
    for (const v of r.videos || []) {
      if (!videosById.has(v.id)) videosById.set(v.id, v);
    }
    for (const c of r.channels || []) {
      const existing = channelsById.get(c.id);
      if (!existing) {
        channelsById.set(c.id, { ...c, matchedVideoIds: [...c.matchedVideoIds] });
      } else {
        const seen = new Set(existing.matchedVideoIds);
        for (const id of c.matchedVideoIds) if (!seen.has(id)) { seen.add(id); existing.matchedVideoIds.push(id); }
      }
    }
  }
  // Recompute aggregateViews per channel from the deduped videos
  const videos = [...videosById.values()];
  const aggregateByChannel = new Map();
  for (const v of videos) aggregateByChannel.set(v.channelId, (aggregateByChannel.get(v.channelId) || 0) + v.viewCount);
  for (const c of channelsById.values()) c.aggregateViews = aggregateByChannel.get(c.id) || 0;
  return { videos, channels: [...channelsById.values()], quotaUsed: { youtube: quotaYoutube } };
}

export async function runTrendSearch(config) {
  const runner = new TaskRunner({ ...config, throttleMs: 0 });
  const {
    keyword, regionCode, relevanceLanguage,
    timeWindowDays, minViews, minDurationMinutes = 0, sortBy, analyzeTopN,
    apiKey, aiKeys, aiModel,
  } = config;
  const { signal } = config;

  if (!apiKey) throw new Error("Thiếu YouTube API key.");
  if (!keyword) throw new Error("Thiếu keyword.");
  if (!aiKeys || aiKeys.length === 0) {
    throw new Error("Cần AI API key để phân tích keyword. Vào Settings → AI để thêm.");
  }

  runner.checkAborted();
  runner.setProgress(2, "AI phân tích keyword...");

  const rotator = new KeyRotator(aiKeys);
  let intent;
  try {
    intent = await extractIntent({
      rotator, userInput: keyword, regionCode, relevanceLanguage, signal, model: aiModel,
    });
  } catch (err) {
    if (err instanceof AllKeysExhausted) {
      throw new Error("Tất cả AI key đã hết quota. Hãy thêm key mới hoặc thử lại sau.");
    }
    throw err;
  }
  runner.checkAborted();

  // Apply AI filterHints — they override config defaults but UI is shown in result
  const effectiveWindow = intent.filterHints.timeWindowDays ?? timeWindowDays;
  const effectiveSortBy = intent.filterHints.sortBy ?? sortBy;
  const effectiveMinDuration = intent.filterHints.minDurationMinutes ?? minDurationMinutes;

  runner.setProgress(15, `Tìm video theo ${intent.queries.length} query...`);
  const publishedAfter = new Date(Date.now() - effectiveWindow * 24 * 60 * 60 * 1000).toISOString();

  const searchLimit = pLimit(SEARCH_CONCURRENCY);
  let searchesDone = 0;
  const searchResults = await Promise.all(
    intent.queries.map((q) => searchLimit(async () => {
      runner.checkAborted();
      const r = await searchTrending({
        apiKey, keyword: q, regionCode, relevanceLanguage, publishedAfter, signal,
      });
      searchesDone++;
      runner.setProgress(15 + (searchesDone / intent.queries.length) * 40, `Tìm video ${searchesDone}/${intent.queries.length}...`);
      return r;
    })),
  );
  runner.checkAborted();

  const search = mergeSearchResults(searchResults);

  const now = Date.now();
  const minDurationSec = effectiveMinDuration * 60;
  const enriched = search.videos
    .map((v) => ({ ...v, velocity: computeVelocity(v, now), analysis: null }))
    .filter((v) => v.viewCount >= minViews && v.duration >= minDurationSec);

  const sorted = sortVideos(enriched, effectiveSortBy);

  let geminiCalls = 0;
  if (analyzeTopN > 0) {
    runner.setProgress(60, "Phân tích AI...");
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
          model: aiModel,
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
    intent: {
      queries: intent.queries,
      interpretation: intent.interpretation,
      effectiveFilters: { timeWindowDays: effectiveWindow, sortBy: effectiveSortBy, minDurationMinutes: effectiveMinDuration },
    },
    quotaUsed: { ...search.quotaUsed, geminiCalls: geminiCalls + 1 }, // +1 for intent extraction
    errors: [],
  };
}
