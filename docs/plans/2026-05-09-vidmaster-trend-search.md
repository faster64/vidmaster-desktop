# Trend Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Trend Search task to VidMaster — keyword + region/window/threshold → trending videos & channels from YouTube, with Gemini-powered "why hot" analysis (free tier, multi-key rotation), wired to push selected URLs into the existing Download task.

**Architecture:** New task module `src/trendSearch.js` orchestrates 3 helpers in `src/_lib/`: `youtubeSearch.js` (3 parallel `search.list` + dedupe + batch enrich), `geminiAnalyze.js` (multimodal "why hot" analyzer), and `keyRotator.js` (round-robin with cooldown). Renderer screen has 2-pane results (Videos / Channels) with checkbox-to-Download. Plugs into existing QueueManager + IPC + Settings infrastructure.

**Tech Stack:** Node 20, Electron 30, vitest, p-limit (already in deps), `fetch` global, electron-store. Spec: [docs/specs/2026-05-09-trend-search-design.md](../specs/2026-05-09-trend-search-design.md).

---

## File Structure

**Create:**
- `src/_lib/keyRotator.js` — generic round-robin with cooldown
- `src/_lib/youtubeSearch.js` — YouTube Data API search wrapper
- `src/_lib/geminiAnalyze.js` — Gemini "why hot" analyzer
- `src/trendSearch.js` — task orchestrator (TaskRunner pattern)
- `electron/renderer/screens/trendSearch.js` — UI screen
- `tests/_lib/keyRotator.test.js`
- `tests/_lib/youtubeSearch.test.js`
- `tests/_lib/geminiAnalyze.test.js`
- `tests/trendSearch.test.js`

**Modify:**
- `electron/settings.js` — bump `SCHEMA_VERSION` 6→7, add `gemini` + `trendSearch` defaults, add migration block
- `electron/ipc/queue.js` — register `trendSearch` runner
- `electron/renderer/main.js` — register screen
- `electron/renderer/components/sidebar.js` — add nav entry
- `electron/renderer/screens/settings.js` — add "AI" tab for Gemini keys
- `docs/specs/2026-05-06-vidmaster-desktop-app-design.md` — add Trend Search to task list (final task)

---

## Task 1: KeyRotator — generic round-robin with cooldown

**Files:**
- Create: `src/_lib/keyRotator.js`
- Test: `tests/_lib/keyRotator.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/_lib/keyRotator.test.js
import { describe, it, expect, beforeEach, vi } from "vitest";
import { KeyRotator, AllKeysExhausted } from "../../src/_lib/keyRotator.js";

describe("KeyRotator", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-05-09T00:00:00Z")); });

  it("round-robins through keys", () => {
    const r = new KeyRotator(["a", "b", "c"]);
    expect(r.next()).toBe("a");
    expect(r.next()).toBe("b");
    expect(r.next()).toBe("c");
    expect(r.next()).toBe("a");
  });

  it("skips a key in cooldown", () => {
    const r = new KeyRotator(["a", "b", "c"]);
    r.next(); // a
    r.markCooldown("b", 60_000);
    expect(r.next()).toBe("c");
    expect(r.next()).toBe("a");
    expect(r.next()).toBe("c"); // b still in cooldown
  });

  it("re-enters key after cooldown expires", () => {
    const r = new KeyRotator(["a", "b"]);
    r.markCooldown("a", 1000);
    expect(r.next()).toBe("b");
    vi.advanceTimersByTime(1500);
    expect(r.next()).toBe("a");
  });

  it("throws AllKeysExhausted when all on cooldown", () => {
    const r = new KeyRotator(["a", "b"]);
    r.markCooldown("a", 60_000);
    r.markCooldown("b", 60_000);
    expect(() => r.next()).toThrow(AllKeysExhausted);
  });

  it("throws AllKeysExhausted when constructed empty", () => {
    const r = new KeyRotator([]);
    expect(() => r.next()).toThrow(AllKeysExhausted);
  });

  it("isolates state across instances", () => {
    const r1 = new KeyRotator(["a", "b"]);
    const r2 = new KeyRotator(["a", "b"]);
    r1.markCooldown("a", 60_000);
    expect(r2.next()).toBe("a");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/_lib/keyRotator.test.js`
Expected: FAIL with `Cannot find module '../../src/_lib/keyRotator.js'`.

- [ ] **Step 3: Write the implementation**

```js
// src/_lib/keyRotator.js
export class AllKeysExhausted extends Error {
  constructor(message = "All keys are on cooldown") {
    super(message);
    this.name = "AllKeysExhausted";
  }
}

export class KeyRotator {
  constructor(keys) {
    this.keys = [...(keys || [])];
    this.cooldownUntil = new Map();
    this.cursor = 0;
  }

  next() {
    const n = this.keys.length;
    if (n === 0) throw new AllKeysExhausted();
    const now = Date.now();
    for (let i = 0; i < n; i++) {
      const k = this.keys[(this.cursor + i) % n];
      const cd = this.cooldownUntil.get(k) || 0;
      if (cd <= now) {
        this.cursor = (this.cursor + i + 1) % n;
        return k;
      }
    }
    throw new AllKeysExhausted();
  }

  markCooldown(key, durationMs) {
    this.cooldownUntil.set(key, Date.now() + durationMs);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/_lib/keyRotator.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/_lib/keyRotator.js tests/_lib/keyRotator.test.js
git commit -m "feat(trend): add KeyRotator with cooldown for API key round-robin"
```

---

## Task 2: youtubeSearch — multi-pass discovery

**Files:**
- Create: `src/_lib/youtubeSearch.js`
- Test: `tests/_lib/youtubeSearch.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/_lib/youtubeSearch.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/_lib/youtubeSearch.test.js`
Expected: FAIL with `Cannot find module '../../src/_lib/youtubeSearch.js'`.

- [ ] **Step 3: Write the implementation**

```js
// src/_lib/youtubeSearch.js
import { throwIfAborted, AbortError } from "./abortError.js";
import { parseIso8601Duration } from "./youtube.js";

const BASE = "https://www.googleapis.com/youtube/v3";
const SORT_ORDERS = ["relevance", "viewCount", "date"];

async function getJson(url, { signal } = {}) {
  throwIfAborted(signal);
  let res;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
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
    u.searchParams.set("type", "video");
    u.searchParams.set("maxResults", "50");
    u.searchParams.set("q", keyword);
    u.searchParams.set("order", order);
    u.searchParams.set("publishedAfter", publishedAfter);
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
  for (const r of searchResults) {
    for (const item of r.items || []) {
      const vid = item.id?.videoId;
      if (vid && !seen.has(vid)) {
        seen.add(vid);
        videoIds.push(vid);
      }
    }
  }

  onProgress?.({ stage: "enriching", pct: 0 });
  const videoBatches = chunk(videoIds, 50);
  const videoItems = [];
  for (const batch of videoBatches) {
    throwIfAborted(signal);
    const u = new URL(`${BASE}/videos`);
    u.searchParams.set("part", "snippet,statistics,contentDetails");
    u.searchParams.set("id", batch.join(","));
    u.searchParams.set("key", apiKey);
    const data = await getJson(u.toString(), { signal });
    videoItems.push(...(data.items || []));
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

  const channelIds = [...new Set(videos.map((v) => v.channelId).filter(Boolean))];
  const channelBatches = chunk(channelIds, 50);
  const channelItems = [];
  for (const batch of channelBatches) {
    throwIfAborted(signal);
    const u = new URL(`${BASE}/channels`);
    u.searchParams.set("part", "snippet,statistics");
    u.searchParams.set("id", batch.join(","));
    u.searchParams.set("key", apiKey);
    const data = await getJson(u.toString(), { signal });
    channelItems.push(...(data.items || []));
  }
  onProgress?.({ stage: "enriching", pct: 100 });

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
    quotaUsed: { youtube: 3 * 100 + 1 + 1 },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/_lib/youtubeSearch.test.js`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/_lib/youtubeSearch.js tests/_lib/youtubeSearch.test.js
git commit -m "feat(trend): add youtubeSearch with 3-way merge dedupe + batch enrich"
```

---

## Task 3: geminiAnalyze — multimodal "why hot" with key rotation

**Files:**
- Create: `src/_lib/geminiAnalyze.js`
- Test: `tests/_lib/geminiAnalyze.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/_lib/geminiAnalyze.test.js
import { describe, it, expect, beforeEach, vi } from "vitest";
import { analyzeWhyHot } from "../../src/_lib/geminiAnalyze.js";
import { KeyRotator, AllKeysExhausted } from "../../src/_lib/keyRotator.js";

const VIDEO = {
  id: "v1", title: "Cat does flip", channelTitle: "Cats", channelSubs: 1000,
  velocity: 5000, viewCount: 50000, likeCount: 1000, commentCount: 200,
  publishedAt: "2026-05-01T00:00:00Z",
  thumbnailUrl: "https://example.com/thumb.jpg",
};

function fetchJson(json, status = 200) {
  return { ok: status >= 200 && status < 300, status, statusText: "", json: async () => json };
}

describe("analyzeWhyHot", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("returns parsed reason and factors on happy path", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(fetchJson({ /* thumbnail */ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })) // thumbnail fetch — but happy path test mocks it differently below
      .mockResolvedValueOnce(fetchJson({
        candidates: [{ content: { parts: [{ text: '{"reason":"viral title","factors":["title hook","timing"]}' }] } }],
      }));
    // Reset and use a single dispatcher that handles both URLs
    global.fetch = vi.fn(async (url) => {
      if (url.includes("example.com/thumb")) return { ok: true, arrayBuffer: async () => Buffer.from("fakejpeg").buffer };
      return fetchJson({ candidates: [{ content: { parts: [{ text: '{"reason":"viral title","factors":["hook","timing"]}' }] } }] });
    });
    const rotator = new KeyRotator(["k1"]);
    const result = await analyzeWhyHot({ rotator, video: VIDEO });
    expect(result).toEqual({ reason: "viral title", factors: ["hook", "timing"] });
  });

  it("rotates key on 429 and retries with the next key", async () => {
    let call = 0;
    global.fetch = vi.fn(async (url) => {
      if (url.includes("example.com/thumb")) return { ok: true, arrayBuffer: async () => Buffer.from("x").buffer };
      call++;
      if (call === 1) return fetchJson({ error: { message: "rate" } }, 429);
      return fetchJson({ candidates: [{ content: { parts: [{ text: '{"reason":"r","factors":[]}' }] } }] });
    });
    const rotator = new KeyRotator(["k1", "k2"]);
    const result = await analyzeWhyHot({ rotator, video: VIDEO });
    expect(result.reason).toBe("r");
  });

  it("throws AllKeysExhausted when all keys hit 429", async () => {
    global.fetch = vi.fn(async (url) => {
      if (url.includes("example.com/thumb")) return { ok: true, arrayBuffer: async () => Buffer.from("x").buffer };
      return fetchJson({ error: { message: "rate" } }, 429);
    });
    const rotator = new KeyRotator(["k1", "k2"]);
    await expect(analyzeWhyHot({ rotator, video: VIDEO })).rejects.toBeInstanceOf(AllKeysExhausted);
  });

  it("strips ```json fences and parses", async () => {
    global.fetch = vi.fn(async (url) => {
      if (url.includes("example.com/thumb")) return { ok: true, arrayBuffer: async () => Buffer.from("x").buffer };
      return fetchJson({ candidates: [{ content: { parts: [{ text: '```json\n{"reason":"x","factors":["a"]}\n```' }] } }] });
    });
    const result = await analyzeWhyHot({ rotator: new KeyRotator(["k"]), video: VIDEO });
    expect(result).toEqual({ reason: "x", factors: ["a"] });
  });

  it("returns parse_failed error on invalid JSON", async () => {
    global.fetch = vi.fn(async (url) => {
      if (url.includes("example.com/thumb")) return { ok: true, arrayBuffer: async () => Buffer.from("x").buffer };
      return fetchJson({ candidates: [{ content: { parts: [{ text: "not json at all" }] } }] });
    });
    const result = await analyzeWhyHot({ rotator: new KeyRotator(["k"]), video: VIDEO });
    expect(result).toEqual({ error: "parse_failed" });
  });

  it("includes inline_data part when thumbnail fetch succeeds", async () => {
    let geminiBody = null;
    global.fetch = vi.fn(async (url, opts) => {
      if (url.includes("example.com/thumb")) return { ok: true, arrayBuffer: async () => Buffer.from("img").buffer };
      geminiBody = JSON.parse(opts.body);
      return fetchJson({ candidates: [{ content: { parts: [{ text: '{"reason":"r","factors":[]}' }] } }] });
    });
    await analyzeWhyHot({ rotator: new KeyRotator(["k"]), video: VIDEO });
    const parts = geminiBody.contents[0].parts;
    expect(parts).toContainEqual(expect.objectContaining({ inline_data: expect.objectContaining({ mime_type: "image/jpeg" }) }));
  });

  it("proceeds text-only when thumbnail fetch fails", async () => {
    global.fetch = vi.fn(async (url, opts) => {
      if (url.includes("example.com/thumb")) return { ok: false, status: 404, statusText: "NF" };
      const body = JSON.parse(opts.body);
      const parts = body.contents[0].parts;
      expect(parts.some((p) => p.inline_data)).toBe(false);
      return fetchJson({ candidates: [{ content: { parts: [{ text: '{"reason":"r","factors":[]}' }] } }] });
    });
    const result = await analyzeWhyHot({ rotator: new KeyRotator(["k"]), video: VIDEO });
    expect(result.reason).toBe("r");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/_lib/geminiAnalyze.test.js`
Expected: FAIL with `Cannot find module '../../src/_lib/geminiAnalyze.js'`.

- [ ] **Step 3: Write the implementation**

```js
// src/_lib/geminiAnalyze.js
import { throwIfAborted, AbortError } from "./abortError.js";
import { AllKeysExhausted } from "./keyRotator.js";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
const COOLDOWN_429_MS = 60_000;
const COOLDOWN_403_MS = 24 * 60 * 60 * 1000;

function buildPrompt(video) {
  return [
    "Phân tích ngắn gọn (3-5 bullet) tại sao video này có thể đang hot:",
    `- Title: ${video.title}`,
    `- Channel: ${video.channelTitle} (subs: ${video.channelSubs ?? "?"})`,
    `- Views/ngày: ${video.velocity}`,
    `- Tổng views: ${video.viewCount}, likes: ${video.likeCount}, comments: ${video.commentCount}`,
    `- Upload: ${video.publishedAt}`,
    "",
    'Trả về JSON đúng định dạng: { "reason": "1 câu tóm tắt", "factors": ["yếu tố 1", "yếu tố 2"] }',
  ].join("\n");
}

async function fetchThumbnailBase64(url, signal) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  } catch (err) {
    if (err.name === "AbortError" || signal?.aborted) throw new AbortError();
    return null;
  }
}

function stripFences(s) {
  return String(s).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function tryParse(text) {
  try { return JSON.parse(stripFences(text)); } catch { return null; }
}

export async function analyzeWhyHot({ rotator, video, signal }) {
  throwIfAborted(signal);
  const thumbB64 = await fetchThumbnailBase64(video.thumbnailUrl, signal);
  throwIfAborted(signal);

  const parts = [{ text: buildPrompt(video) }];
  if (thumbB64) parts.push({ inline_data: { mime_type: "image/jpeg", data: thumbB64 } });

  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
  });

  while (true) {
    const key = rotator.next(); // throws AllKeysExhausted
    throwIfAborted(signal);
    let res;
    try {
      res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body, signal,
      });
    } catch (err) {
      if (err.name === "AbortError" || signal?.aborted) throw new AbortError();
      throw err;
    }
    if (res.status === 429) {
      rotator.markCooldown(key, COOLDOWN_429_MS);
      continue;
    }
    if (res.status === 403) {
      rotator.markCooldown(key, COOLDOWN_403_MS);
      continue;
    }
    if (!res.ok) {
      let detail = "";
      try { detail = JSON.stringify(await res.json()); } catch {}
      throw new Error(`Gemini API ${res.status}: ${detail || res.statusText}`);
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = tryParse(text);
    if (parsed && typeof parsed.reason === "string" && Array.isArray(parsed.factors)) {
      return { reason: parsed.reason, factors: parsed.factors };
    }
    return { error: "parse_failed" };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/_lib/geminiAnalyze.test.js`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/_lib/geminiAnalyze.js tests/_lib/geminiAnalyze.test.js
git commit -m "feat(trend): add geminiAnalyze with key rotation + multimodal thumbnail"
```

---

## Task 4: trendSearch orchestrator

**Files:**
- Create: `src/trendSearch.js`
- Test: `tests/trendSearch.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/trendSearch.test.js
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/_lib/youtubeSearch.js", () => ({
  searchTrending: vi.fn(),
}));
vi.mock("../src/_lib/geminiAnalyze.js", () => ({
  analyzeWhyHot: vi.fn(),
}));

import { runTrendSearch } from "../src/trendSearch.js";
import { searchTrending } from "../src/_lib/youtubeSearch.js";
import { analyzeWhyHot } from "../src/_lib/geminiAnalyze.js";

const VIDEOS = [
  { id: "v1", title: "T1", channelId: "c1", channelTitle: "C1", thumbnailUrl: "u1", publishedAt: "2026-05-01T00:00:00Z", viewCount: 10000, likeCount: 100, commentCount: 10, duration: 60 },
  { id: "v2", title: "T2", channelId: "c2", channelTitle: "C2", thumbnailUrl: "u2", publishedAt: "2026-05-08T00:00:00Z", viewCount: 5000, likeCount: 50, commentCount: 5, duration: 90 },
];
const CHANNELS = [
  { id: "c1", title: "C1", thumbnailUrl: "ct1", subscriberCount: 1000, aggregateViews: 10000, matchedVideoIds: ["v1"] },
  { id: "c2", title: "C2", thumbnailUrl: "ct2", subscriberCount: 500, aggregateViews: 5000, matchedVideoIds: ["v2"] },
];

describe("runTrendSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-09T00:00:00Z"));
    searchTrending.mockResolvedValue({ videos: VIDEOS, channels: CHANNELS, quotaUsed: { youtube: 302 } });
  });

  it("computes velocity and applies sortBy=velocity", async () => {
    analyzeWhyHot.mockResolvedValue({ reason: "r", factors: [] });
    const result = await runTrendSearch({
      keyword: "x", regionCode: "VN", relevanceLanguage: "vi",
      timeWindowDays: 7, minViews: 0, sortBy: "velocity", analyzeTopN: 0,
      apiKey: "K", geminiKeys: [],
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
      apiKey: "K", geminiKeys: [],
    });
    expect(result.videos.map((v) => v.id)).toEqual(["v1"]);
  });

  it("skips Gemini when analyzeTopN=0 or geminiKeys empty", async () => {
    const result = await runTrendSearch({
      keyword: "x", regionCode: "", relevanceLanguage: "",
      timeWindowDays: 7, minViews: 0, sortBy: "date", analyzeTopN: 10,
      apiKey: "K", geminiKeys: [],
    });
    expect(analyzeWhyHot).not.toHaveBeenCalled();
    expect(result.videos.every((v) => v.analysis === null)).toBe(true);
  });

  it("calls analyzeWhyHot for top N when keys present", async () => {
    analyzeWhyHot.mockImplementation(async ({ video }) => ({ reason: `why-${video.id}`, factors: [] }));
    const result = await runTrendSearch({
      keyword: "x", regionCode: "", relevanceLanguage: "",
      timeWindowDays: 30, minViews: 0, sortBy: "totalViews", analyzeTopN: 1,
      apiKey: "K", geminiKeys: ["g1"],
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
      apiKey: "K", geminiKeys: ["g1"],
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
      apiKey: "K", geminiKeys: ["g1"],
      onProgress: (pct, msg) => stages.push({ pct, msg }),
    });
    const messages = stages.map((s) => s.msg);
    expect(messages.some((m) => m.includes("Tìm"))).toBe(true);
    expect(messages.some((m) => m.includes("Phân tích"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/trendSearch.test.js`
Expected: FAIL with `Cannot find module '../src/trendSearch.js'`.

- [ ] **Step 3: Write the implementation**

```js
// src/trendSearch.js
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
  const runner = new TaskRunner(config);
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
        else v.analysis = { error: "analyze_failed", message: err.message };
      } finally {
        done++;
        runner.setProgress(60 + (done / targets.length) * 35, `Phân tích AI ${done}/${targets.length}...`);
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/trendSearch.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/trendSearch.js tests/trendSearch.test.js
git commit -m "feat(trend): add trendSearch orchestrator with velocity sort + AI analysis"
```

---

## Task 5: Settings schema migration (gemini.apiKeys + trendSearch defaults)

**Files:**
- Modify: `electron/settings.js`

- [ ] **Step 1: Bump SCHEMA_VERSION and extend defaults**

Edit `electron/settings.js` line 6:

```js
const SCHEMA_VERSION = 7;
```

Edit `buildDefaults()` (around line 18) — add two top-level keys before `lastUsedTask`:

```js
    gemini: {
      apiKeys: [],
    },
    trendSearch: {
      regionCode: "VN",
      relevanceLanguage: "vi",
      timeWindowDays: 7,
      minViews: 1000,
      sortBy: "velocity",
      analyzeTopN: 10,
    },
```

- [ ] **Step 2: Add migration block for v6 → v7**

Edit `migrate(store)` (around line 48) — add after the `if (v < 6)` block, before `store.set("version", SCHEMA_VERSION)`:

```js
  if (v < 7) {
    store.set("gemini", {
      apiKeys: store.get("gemini.apiKeys") ?? [],
    });
    store.set("trendSearch", {
      regionCode: store.get("trendSearch.regionCode") ?? "VN",
      relevanceLanguage: store.get("trendSearch.relevanceLanguage") ?? "vi",
      timeWindowDays: store.get("trendSearch.timeWindowDays") ?? 7,
      minViews: store.get("trendSearch.minViews") ?? 1000,
      sortBy: store.get("trendSearch.sortBy") ?? "velocity",
      analyzeTopN: store.get("trendSearch.analyzeTopN") ?? 10,
    });
  }
```

- [ ] **Step 3: Run tests to make sure existing settings tests still pass**

Run: `npx vitest run tests/`
Expected: PASS for everything that was passing before (the 2 pre-existing buttonFeedback failures remain unchanged).

- [ ] **Step 4: Commit**

```bash
git add electron/settings.js
git commit -m "feat(trend): bump settings to v7, add gemini + trendSearch keys"
```

---

## Task 6: Wire IPC + queue runner registration

**Files:**
- Modify: `electron/ipc/queue.js`

- [ ] **Step 1: Import and register trendSearch runner**

Edit `electron/ipc/queue.js` line 10 — add import:

```js
import { runTrendSearch } from "../../src/trendSearch.js";
```

Edit the `runners` object (around line 15) — add `trendSearch: runTrendSearch,`:

```js
  const runners = {
    render: runRender, trimEnds: runTrimEnds, cutBg: runCutBg,
    getUrls: runGetUrls, download: runDownload, concatHeadTail: runConcatHeadTail,
    thumbAvatar: runThumbAvatar,
    trendSearch: runTrendSearch,
    _ytdlpUpdate: runYtdlpUpdate,
  };
```

- [ ] **Step 2: Run tests + start dev to confirm no startup error**

Run: `npx vitest run tests/`
Expected: PASS for everything previously passing.

Run: `npm run dev` — confirm window opens without console error. Close it.

- [ ] **Step 3: Commit**

```bash
git add electron/ipc/queue.js
git commit -m "feat(trend): register trendSearch runner in QueueManager"
```

---

## Task 7: Renderer screen — form + results + push-to-Download

**Files:**
- Create: `electron/renderer/screens/trendSearch.js`

- [ ] **Step 1: Write the screen module**

```js
// electron/renderer/screens/trendSearch.js
import { runWithFeedback } from "../components/buttonFeedback.js";

export async function renderTrendSearch(el) {
  const s = await window.api.settings.get();
  const ws = await window.api.app.getWorkspace();
  const cfg = s.trendSearch || {};

  el.innerHTML = `
    <div class="screen-header">🔍 Tìm trend</div>
    <p class="screen-subtitle">Nhập keyword (đa ngôn ngữ) để tìm video hot + kênh nổi bật.</p>
    <form id="trend-form">
      <div class="field">
        <label>Keyword</label>
        <input id="kw" type="text" required placeholder="vd: cat, công nghệ, K-pop">
      </div>
      <div class="row" style="display:flex;gap:12px;flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:140px">
          <label>Region</label>
          <select id="region">
            <option value="VN" ${cfg.regionCode === "VN" ? "selected" : ""}>Việt Nam</option>
            <option value="US" ${cfg.regionCode === "US" ? "selected" : ""}>United States</option>
            <option value="JP" ${cfg.regionCode === "JP" ? "selected" : ""}>Japan</option>
            <option value="KR" ${cfg.regionCode === "KR" ? "selected" : ""}>Korea</option>
            <option value="" ${!cfg.regionCode ? "selected" : ""}>(Toàn cầu)</option>
          </select>
        </div>
        <div class="field" style="flex:1;min-width:140px">
          <label>Language</label>
          <select id="lang">
            <option value="vi" ${cfg.relevanceLanguage === "vi" ? "selected" : ""}>vi</option>
            <option value="en" ${cfg.relevanceLanguage === "en" ? "selected" : ""}>en</option>
            <option value="ja" ${cfg.relevanceLanguage === "ja" ? "selected" : ""}>ja</option>
            <option value="ko" ${cfg.relevanceLanguage === "ko" ? "selected" : ""}>ko</option>
            <option value="" ${!cfg.relevanceLanguage ? "selected" : ""}>(Auto)</option>
          </select>
        </div>
        <div class="field" style="flex:1;min-width:120px">
          <label>Window (ngày)</label>
          <input id="window" type="number" min="1" max="365" value="${cfg.timeWindowDays ?? 7}">
        </div>
        <div class="field" style="flex:1;min-width:120px">
          <label>Min views</label>
          <input id="minViews" type="number" min="0" value="${cfg.minViews ?? 1000}">
        </div>
        <div class="field" style="flex:1;min-width:140px">
          <label>Sort by</label>
          <select id="sortBy">
            <option value="velocity" ${cfg.sortBy === "velocity" ? "selected" : ""}>Views/ngày</option>
            <option value="totalViews" ${cfg.sortBy === "totalViews" ? "selected" : ""}>Tổng views</option>
            <option value="date" ${cfg.sortBy === "date" ? "selected" : ""}>Mới nhất</option>
          </select>
        </div>
        <div class="field" style="flex:1;min-width:120px">
          <label>Analyze top N</label>
          <input id="topN" type="number" min="0" max="50" value="${cfg.analyzeTopN ?? 10}">
        </div>
      </div>
      <button type="submit" class="primary">▶  Thực hiện</button>
    </form>
    <div id="trend-banner" style="margin-top:12px"></div>
    <div id="trend-result" style="margin-top:24px"></div>
  `;

  if (!s.youtube?.apiKey) {
    el.querySelector("#trend-banner").innerHTML =
      `<div class="banner banner-warn">Thiếu YouTube API key. <a href="#settings">Mở Settings</a></div>`;
  }
  if (!s.gemini?.apiKeys?.length) {
    el.querySelector("#trend-banner").innerHTML +=
      `<div class="banner banner-info">Chưa có Gemini API key — sẽ bỏ qua phân tích AI. <a href="#settings">Thêm key</a></div>`;
  }

  el.querySelector("#trend-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const keyword = el.querySelector("#kw").value.trim();
    if (!keyword) return;
    const config = {
      keyword,
      regionCode: el.querySelector("#region").value,
      relevanceLanguage: el.querySelector("#lang").value,
      timeWindowDays: parseInt(el.querySelector("#window").value, 10) || 7,
      minViews: parseInt(el.querySelector("#minViews").value, 10) || 0,
      sortBy: el.querySelector("#sortBy").value,
      analyzeTopN: parseInt(el.querySelector("#topN").value, 10) || 0,
      apiKey: s.youtube?.apiKey || "",
      geminiKeys: s.gemini?.apiKeys || [],
    };
    const submitBtn = el.querySelector('button[type="submit"]');
    await runWithFeedback(submitBtn, async () => {
      await window.api.queue.add({ type: "trendSearch", config });
      await window.api.settings.set({
        "trendSearch": {
          regionCode: config.regionCode,
          relevanceLanguage: config.relevanceLanguage,
          timeWindowDays: config.timeWindowDays,
          minViews: config.minViews,
          sortBy: config.sortBy,
          analyzeTopN: config.analyzeTopN,
        },
      });
    });
  });

  const unsub = window.api.queue.onUpdate((state) => {
    if (el.dataset.screen !== "trendSearch") { unsub?.(); return; }
    const last = state.completed.find((j) => j.type === "trendSearch" && j.status === "done");
    if (!last) return;
    const viewer = el.querySelector("#trend-result");
    if (!viewer || viewer.dataset.jobId === last.id) return;
    viewer.dataset.jobId = last.id;
    renderResults(viewer, last.result, ws);
  });
}

function renderResults(el, result, workspace) {
  const { videos = [], channels = [] } = result || {};
  el.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <h3 style="margin:0">Kết quả</h3>
      <button id="dl-selected" class="primary" disabled>⬇ Tải về đã chọn (0)</button>
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">
      <div>
        <h4>Videos (${videos.length})</h4>
        <div id="videos">${videos.map((v, i) => videoCard(v, i)).join("")}</div>
      </div>
      <div>
        <h4>Channels (${channels.length})</h4>
        <div id="channels">${channels.map((c) => channelCard(c)).join("")}</div>
      </div>
    </div>
  `;

  const selected = new Set();
  const dlBtn = el.querySelector("#dl-selected");
  el.querySelectorAll(".vc-check").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) selected.add(id); else selected.delete(id);
      dlBtn.disabled = selected.size === 0;
      dlBtn.textContent = `⬇ Tải về đã chọn (${selected.size})`;
    });
  });

  dlBtn.addEventListener("click", () => pushToDownload([...selected], workspace));

  el.querySelectorAll(".ch-getUrls").forEach((b) => {
    b.addEventListener("click", async () => {
      const handle = b.dataset.handle;
      const prev = (await window.api.settings.get("lastConfig.getUrls")) || {};
      await window.api.settings.set({ "lastConfig.getUrls": { ...prev, handle } });
      window.location.hash = "getUrls";
    });
  });
}

function videoCard(v, i) {
  const ana = v.analysis;
  const why = ana && !ana.error ? `<div class="vc-why"><b>Vì sao hot:</b> ${escape(ana.reason)}<ul>${(ana.factors || []).map((f) => `<li>${escape(f)}</li>`).join("")}</ul></div>`
    : ana?.error ? `<div class="vc-why"><i>Phân tích lỗi: ${escape(ana.error)}</i></div>` : "";
  return `<div class="vc-card" style="display:flex;gap:8px;padding:8px;border-bottom:1px solid #eee">
    <input type="checkbox" class="vc-check" data-id="${escapeAttr(v.id)}">
    <img src="${escapeAttr(v.thumbnailUrl)}" style="width:120px;height:auto" loading="lazy">
    <div style="flex:1;min-width:0">
      <div><a href="https://www.youtube.com/watch?v=${escapeAttr(v.id)}" target="_blank">${escape(v.title)}</a></div>
      <div style="color:#666;font-size:12px">${escape(v.channelTitle)} · ${v.velocity.toLocaleString()}/ngày · ${v.viewCount.toLocaleString()} views · ${formatAge(v.publishedAt)}</div>
      ${why}
    </div>
  </div>`;
}

function channelCard(c) {
  return `<div class="ch-card" style="display:flex;gap:8px;padding:8px;border-bottom:1px solid #eee">
    <img src="${escapeAttr(c.thumbnailUrl)}" style="width:48px;height:48px;border-radius:50%" loading="lazy">
    <div style="flex:1;min-width:0">
      <div><b>${escape(c.title)}</b></div>
      <div style="color:#666;font-size:12px">${c.subscriberCount.toLocaleString()} subs · ${c.matchedVideoIds.length} video</div>
      <button class="ch-getUrls" data-handle="${escapeAttr(c.title)}">📥 Get all uploads</button>
    </div>
  </div>`;
}

async function pushToDownload(videoIds, workspace) {
  if (!workspace) { alert("Chưa có workspace."); return; }
  const urls = videoIds.map((id) => `https://www.youtube.com/watch?v=${id}`).join("\n") + "\n";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = await window.api.fs.writeTrendUrls({ workspace, stamp, content: urls });
  if (!dir) { alert("Không ghi được file URLs."); return; }
  const s = await window.api.settings.get();
  const ytdlpPath = s.download?.ytdlpPath;
  await window.api.queue.add({
    type: "download",
    config: {
      urlsFile: dir.urlsFile,
      output: dir.output,
      ytdlpPath,
      maxConcurrent: s.download?.maxConcurrent ?? 3,
    },
  });
  window.location.hash = "queue";
}

function formatAge(iso) {
  const days = Math.max(1, Math.floor((Date.now() - Date.parse(iso)) / (24 * 60 * 60 * 1000)));
  return `${days} ngày trước`;
}

function escape(s) {
  return String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}
function escapeAttr(s) {
  return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}
```

- [ ] **Step 2: Add `fs.writeTrendUrls` IPC handler**

Edit `electron/ipc/fs.js` — add a new handler at the bottom of `registerFsIpc()`:

```js
  ipcMain.handle("fs:writeTrendUrls", async (_, { workspace, stamp, content }) => {
    if (!workspace) return null;
    const dir = path.join(workspace, "trends", stamp);
    fs.mkdirSync(dir, { recursive: true });
    const urlsFile = path.join(dir, "urls.txt");
    fs.writeFileSync(urlsFile, content, "utf8");
    return { urlsFile, output: dir };
  });
```

- [ ] **Step 3: Expose in preload**

Edit `electron/preload.mjs` — extend the `fs` namespace:

```js
  fs: {
    exists: (p) => ipcRenderer.invoke("fs:exists", p),
    listMp4: (folder) => ipcRenderer.invoke("fs:listMp4", folder),
    readUrlsFile: (p) => ipcRenderer.invoke("fs:readUrlsFile", p),
    readVideoInfos: (p) => ipcRenderer.invoke("fs:readVideoInfos", p),
    writeTrendUrls: (args) => ipcRenderer.invoke("fs:writeTrendUrls", args),
  },
```

- [ ] **Step 4: Run tests + dev start**

Run: `npx vitest run tests/`
Expected: PASS unchanged.

Run: `npm run dev` — open the app, verify it loads without console errors. Close it.

- [ ] **Step 5: Commit**

```bash
git add electron/renderer/screens/trendSearch.js electron/ipc/fs.js electron/preload.mjs
git commit -m "feat(trend): add Trend Search renderer screen + writeTrendUrls IPC"
```

---

## Task 8: Sidebar entry + screen registration

**Files:**
- Modify: `electron/renderer/main.js`
- Modify: `electron/renderer/components/sidebar.js`

- [ ] **Step 1: Register screen in main.js**

Edit `electron/renderer/main.js` line 9 — add import after `renderThumbAvatar`:

```js
import { renderTrendSearch } from "./screens/trendSearch.js";
```

Edit the `screens` object (around line 15):

```js
const screens = {
  render: renderRender, trimEnds: renderTrimEnds, cutBg: renderCutBg,
  getUrls: renderGetUrls, download: renderDownload, concatHeadTail: renderConcatHeadTail,
  thumbAvatar: renderThumbAvatar, trendSearch: renderTrendSearch,
  queue: renderQueue, settings: renderSettings,
};
```

Add label (around line 84):

```js
const TASK_LABELS = {
  render: "Render Video", trimEnds: "Cắt đầu/cuối", cutBg: "Chia nhỏ video nền",
  getUrls: "Lấy link kênh", download: "Tải video", concatHeadTail: "Nối đầu/cuối",
  thumbAvatar: "Gắn avatar", trendSearch: "Tìm trend",
};
```

- [ ] **Step 2: Add sidebar nav item**

Edit `electron/renderer/components/sidebar.js` — extend the Tasks group items (around line 4) by inserting before `getUrls`:

```js
      { id: "trendSearch", icon: "🔍", label: "Tìm trend" },
```

- [ ] **Step 3: Dev test**

Run: `npm run dev` — confirm "🔍 Tìm trend" appears in sidebar; click it → form renders; close.

- [ ] **Step 4: Commit**

```bash
git add electron/renderer/main.js electron/renderer/components/sidebar.js
git commit -m "feat(trend): wire Trend Search screen into sidebar + router"
```

---

## Task 9: Settings UI — AI tab for Gemini keys

**Files:**
- Modify: `electron/renderer/screens/settings.js`

- [ ] **Step 1: Add an "AI" tab and renderer**

Edit `electron/renderer/screens/settings.js` — find the `TABS` array (around line 16) and add an entry **before** the default-active tab list end (after `ffmpeg`):

```js
    { id: "ai",        label: "AI",        render: (b) => renderAiTab(b, s) },
```

- [ ] **Step 2: Add the `renderAiTab` function**

Append at the end of the file (before any closing `function escape` helpers if they exist):

```js
function renderAiTab(el, s) {
  const keys = s.gemini?.apiKeys || [];
  el.innerHTML = `
    <h3>Gemini API keys</h3>
    <p style="color:#666">Free tier: 1500 req/key/day. Có thể thêm nhiều key — VidMaster sẽ round-robin và tự cooldown khi 429.</p>
    <div id="ai-keys">
      ${keys.map((k, i) => keyRow(k, i)).join("")}
    </div>
    <div style="margin-top:8px;display:flex;gap:8px">
      <input id="ai-new-key" type="text" placeholder="AIza..." style="flex:1">
      <button id="ai-add">+ Thêm</button>
    </div>
  `;

  el.querySelector("#ai-add").addEventListener("click", async () => {
    const input = el.querySelector("#ai-new-key");
    const v = input.value.trim();
    if (!v) return;
    const next = [...(s.gemini?.apiKeys || []), v];
    await window.api.settings.set({ gemini: { apiKeys: next } });
    location.reload();
  });

  el.querySelectorAll(".ai-rm").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.i, 10);
      const next = (s.gemini?.apiKeys || []).filter((_, i) => i !== idx);
      await window.api.settings.set({ gemini: { apiKeys: next } });
      location.reload();
    });
  });
}

function keyRow(k, i) {
  const masked = k.length > 8 ? `${k.slice(0, 4)}…${k.slice(-4)}` : k;
  return `<div style="display:flex;gap:8px;align-items:center;padding:4px 0">
    <code style="flex:1">${masked}</code>
    <button class="ai-rm" data-i="${i}">Xóa</button>
  </div>`;
}
```

- [ ] **Step 3: Dev test**

Run: `npm run dev` — open Settings → AI tab; add a fake key like `AIzaTEST`; refresh; remove it; close.

- [ ] **Step 4: Commit**

```bash
git add electron/renderer/screens/settings.js
git commit -m "feat(trend): add AI tab in Settings for Gemini keys CRUD"
```

---

## Task 10: Manual test pass + spec sync

**Files:**
- Modify: `docs/specs/2026-05-06-vidmaster-desktop-app-design.md` (add Trend Search to task list)

- [ ] **Step 1: Manual test plan**

Run `npm run dev` and walk through the full plan:

1. Search "công nghệ" + region VN + language vi + window 7 + minViews 1000 + sort velocity + topN 10. Verify ~10-50 videos returned, "Vì sao hot" populated for top 10.
2. Search "Korean drama" + region KR + language ko. Verify KR-biased results.
3. Empty Gemini keys (Settings → AI → remove all). Search again — banner shown, all videos `analysis: null`.
4. Tick 5 video → click "Tải về đã chọn" → verify navigates to Queue screen and Download job is queued.
5. While analyzing, click cancel in Queue. Verify status flips to cancelled, no further progress.
6. From a Channel card, click "📥 Get all uploads" → GetUrls screen opens with handle pre-filled.

Document any failures with screenshots; fix and re-run before moving on.

- [ ] **Step 2: Update master design doc**

Edit `docs/specs/2026-05-06-vidmaster-desktop-app-design.md` — find the task list (search for `getUrls` or `Lấy link kênh`) and add an entry for `trendSearch`/Tìm trend with a one-line description and a link to the dedicated spec [docs/specs/2026-05-09-trend-search-design.md](2026-05-09-trend-search-design.md).

- [ ] **Step 3: Final test sweep**

Run: `npx vitest run tests/`
Expected: PASS for everything except the 2 pre-existing buttonFeedback failures.

- [ ] **Step 4: Commit**

```bash
git add docs/specs/2026-05-06-vidmaster-desktop-app-design.md
git commit -m "docs: list Trend Search task in master design doc"
```

---

## Self-review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Task module + TaskRunner | Task 4 |
| `youtubeSearch.js` 3-pass + dedupe + enrich | Task 2 |
| `geminiAnalyze.js` multimodal + key rotation | Task 3 |
| `keyRotator.js` cooldown | Task 1 |
| Settings schema additions | Task 5 |
| IPC + queue runner | Task 6 |
| UI screen + push-to-Download | Task 7 |
| Sidebar entry | Task 8 |
| Settings AI tab | Task 9 |
| Cross-screen deeplink ("Get all uploads") | Task 7 (channelCard) + GetUrls reads `lastConfig.getUrls.handle` already |
| Manual test plan | Task 10 |

**Type consistency:** `analyzeWhyHot({ rotator, video, signal })` matches across Tasks 3 and 4. `searchTrending` return shape `{ videos, channels, quotaUsed }` matches Tasks 2 and 4. Renderer screen reads `result.videos[i].velocity` which Task 4 sets.

**Placeholder scan:** All steps contain executable code or commands. No "TBD" or "implement later".

**Decisions deferred from spec:**
- Persisted Gemini cooldown: spec says in-memory only — no task needed for persistence.
- YouTube key rotation: explicitly out of scope v1 — Task 5 adds only single-key field (no change needed since `youtube.apiKey` exists).
