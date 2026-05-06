import { throwIfAborted, AbortError } from "./abortError.js";

const BASE = "https://www.googleapis.com/youtube/v3";

export function parseIso8601Duration(s) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(String(s));
  if (!m) return 0;
  const [, h, mm, ss] = m;
  return (+h || 0) * 3600 + (+mm || 0) * 60 + (+ss || 0);
}

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

export async function fetchUploadsPlaylistId({ apiKey, handle, signal }) {
  const h = handle.startsWith("@") ? handle : `@${handle}`;
  const url = `${BASE}/channels?part=id,contentDetails&forHandle=${encodeURIComponent(h)}&key=${apiKey}`;
  const data = await getJson(url, { signal });
  if (!data.items || data.items.length === 0) {
    throw new Error(`Không tìm thấy channel cho handle: ${h}`);
  }
  return data.items[0].contentDetails.relatedPlaylists.uploads;
}

export async function listAllUploadVideos({ apiKey, playlistId, signal, onPage }) {
  const all = [];
  let nextPageToken = null;
  let totalPages = 1;
  let pagesDone = 0;

  do {
    throwIfAborted(signal);
    const u = new URL(`${BASE}/playlistItems`);
    u.searchParams.set("part", "snippet");
    u.searchParams.set("playlistId", playlistId);
    u.searchParams.set("maxResults", "50");
    u.searchParams.set("key", apiKey);
    if (nextPageToken) u.searchParams.set("pageToken", nextPageToken);
    const page = await getJson(u.toString(), { signal });

    if (pagesDone === 0 && page.pageInfo?.totalResults != null) {
      totalPages = Math.max(1, Math.ceil(page.pageInfo.totalResults / 50));
    }

    const ids = (page.items || []).map((i) => i.snippet?.resourceId?.videoId).filter(Boolean);
    if (ids.length > 0) {
      throwIfAborted(signal);
      const u2 = new URL(`${BASE}/videos`);
      u2.searchParams.set("part", "contentDetails,snippet,statistics");
      u2.searchParams.set("id", ids.join(","));
      u2.searchParams.set("key", apiKey);
      const v = await getJson(u2.toString(), { signal });
      for (const item of v.items || []) {
        all.push({
          id: item.id,
          title: item.snippet?.title ?? "",
          publishedAt: item.snippet?.publishedAt ?? "",
          durationSec: parseIso8601Duration(item.contentDetails?.duration),
          viewCount: parseInt(item.statistics?.viewCount ?? "0", 10) || 0,
        });
      }
    }

    pagesDone++;
    onPage?.({ pagesDone, totalPages });
    nextPageToken = page.nextPageToken;
  } while (nextPageToken);

  return all;
}
