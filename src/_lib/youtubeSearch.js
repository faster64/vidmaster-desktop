import { throwIfAborted, AbortError } from "./abortError.js";
import { parseIso8601Duration } from "./youtube.js";

const BASE = "https://www.googleapis.com/youtube/v3";
const SORT_ORDERS = ["relevance", "viewCount", "date"];

async function getJson(url, { signal } = {}) {
  throwIfAborted(signal);
  let res;
  try {
    const fetchPromise = fetch(url, { signal });
    if (signal) {
      const abortPromise = new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new AbortError()), { once: true }),
      );
      res = await Promise.race([fetchPromise, abortPromise]);
    } else {
      res = await fetchPromise;
    }
  } catch (err) {
    if (err instanceof AbortError) throw err;
    if (err.name === "AbortError" || signal?.aborted) throw new AbortError();
    throw err;
  }
  if (!res.ok) {
    let body = "";
    try { body = JSON.stringify(await res.json()); } catch {}
    throw new Error(`YouTube API ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function searchTrending({
  apiKey, keyword, regionCode, relevanceLanguage, publishedAfter,
  signal, onProgress,
}) {
  if (!apiKey) throw new Error("Thiếu YouTube API key.");
  if (!keyword) throw new Error("Thiếu keyword.");

  const buildSearchUrl = (order) => {
    const u = new URL(`${BASE}/search`);
    u.searchParams.set("part", "snippet");
    u.searchParams.set("q", keyword);
    u.searchParams.set("order", order);
    u.searchParams.set("type", "video");
    u.searchParams.set("maxResults", "50");
    if (publishedAfter) u.searchParams.set("publishedAfter", publishedAfter);
    if (regionCode) u.searchParams.set("regionCode", regionCode);
    if (relevanceLanguage) u.searchParams.set("relevanceLanguage", relevanceLanguage);
    u.searchParams.set("key", apiKey);
    return u.toString();
  };

  onProgress?.({ stage: "searching", pct: 0 });
  const searchResults = await Promise.all(
    SORT_ORDERS.map((order) => getJson(buildSearchUrl(order), { signal })),
  );
  onProgress?.({ stage: "searching", pct: 100 });

  const seen = new Set();
  const videoIds = [];
  const searchChannelIds = new Set();
  for (const r of searchResults) {
    for (const item of r.items || []) {
      const vid = item.id?.videoId;
      if (vid && !seen.has(vid)) {
        seen.add(vid);
        videoIds.push(vid);
      }
      const cid = item.snippet?.channelId;
      if (cid) searchChannelIds.add(cid);
    }
  }

  onProgress?.({ stage: "enriching", pct: 0 });
  const videoBatches = chunk(videoIds, 50);
  const channelIds = [...searchChannelIds];
  const channelBatches = chunk(channelIds, 50);
  const totalEnrichBatches = videoBatches.length + channelBatches.length;
  let enrichDone = 0;
  const tickEnrich = () => {
    enrichDone++;
    if (totalEnrichBatches > 0) {
      onProgress?.({ stage: "enriching", pct: Math.round((enrichDone / totalEnrichBatches) * 100) });
    }
  };
  const videoItems = [];
  for (const batch of videoBatches) {
    throwIfAborted(signal);
    const u = new URL(`${BASE}/videos`);
    u.searchParams.set("part", "snippet,statistics,contentDetails");
    u.searchParams.set("id", batch.join(","));
    u.searchParams.set("key", apiKey);
    const data = await getJson(u.toString(), { signal });
    videoItems.push(...(data.items || []));
    tickEnrich();
  }

  const videos = videoItems.map((it) => ({
    id: it.id,
    title: it.snippet?.title ?? "",
    channelId: it.snippet?.channelId ?? "",
    channelTitle: it.snippet?.channelTitle ?? "",
    thumbnailUrl: it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url || "",
    publishedAt: it.snippet?.publishedAt ?? "",
    viewCount: parseInt(it.statistics?.viewCount ?? "0", 10) || 0,
    likeCount: parseInt(it.statistics?.likeCount ?? "0", 10) || 0,
    commentCount: parseInt(it.statistics?.commentCount ?? "0", 10) || 0,
    duration: parseIso8601Duration(it.contentDetails?.duration),
  }));

  const channelItems = [];
  for (const batch of channelBatches) {
    throwIfAborted(signal);
    const u = new URL(`${BASE}/channels`);
    u.searchParams.set("part", "snippet,statistics");
    u.searchParams.set("id", batch.join(","));
    u.searchParams.set("key", apiKey);
    const data = await getJson(u.toString(), { signal });
    channelItems.push(...(data.items || []));
    tickEnrich();
  }
  if (totalEnrichBatches === 0) onProgress?.({ stage: "enriching", pct: 100 });

  const matchedByChannel = new Map();
  const aggViewsByChannel = new Map();
  for (const v of videos) {
    const arr = matchedByChannel.get(v.channelId) || [];
    arr.push(v.id);
    matchedByChannel.set(v.channelId, arr);
    aggViewsByChannel.set(v.channelId, (aggViewsByChannel.get(v.channelId) || 0) + v.viewCount);
  }

  const channels = channelItems.map((c) => ({
    id: c.id,
    title: c.snippet?.title ?? "",
    thumbnailUrl: c.snippet?.thumbnails?.default?.url || "",
    subscriberCount: parseInt(c.statistics?.subscriberCount ?? "0", 10) || 0,
    aggregateViews: aggViewsByChannel.get(c.id) || 0,
    matchedVideoIds: matchedByChannel.get(c.id) || [],
  }));

  return {
    videos,
    channels,
    quotaUsed: { youtube: 3 * 100 + videoBatches.length + channelBatches.length },
  };
}
