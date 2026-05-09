# Trend Search — Design

**Status:** Draft
**Date:** 2026-05-09
**Owner:** @cuongnguyen.ftdev

## Summary

Add a new VidMaster task **Trend Search** ("Tìm trend") that takes a multi-language keyword (VI/EN/JA/KO) plus region/window/threshold filters, queries YouTube Data API for matching videos and channels, and uses Gemini 1.5 Flash (free tier, multi-key rotation) to explain *why* the top results are trending. Selected videos can be pushed into the existing Download task.

## Motivation

VidMaster currently supports per-channel discovery (`getUrls`: handle → uploads). There is no inverse path: keyword → trending content across YouTube. Manual trend research outside the app forces a context switch and disconnects from the existing download pipeline. This task fills that gap and keeps the discovery → download flow in one place.

## Non-goals

- Other platforms (TikTok, Bilibili, Instagram). YouTube only for v1.
- Persistent trend tracking / scheduled re-runs.
- Native UI for editing AI prompts. Prompt is fixed in code.
- Persisted Gemini key cooldown across app restarts (in-memory only).

## User flow

1. User opens **Tìm trend** from sidebar.
2. Enters: keyword, region (VN/US/JP/KR/ALL), language (vi/en/ja/ko/auto), time window (1/7/30/90 days), min views, sort (velocity / total views / date), `analyzeTopN` (default 10, 0 = skip AI).
3. Clicks **Tìm**. Progress bar shows `searching → enriching → analyzing → done`.
4. Result panes:
   - **Videos**: thumbnail, title, channel, views/day, total views, expandable "why hot" card, checkbox.
   - **Channels**: thumbnail, name, subs, aggregate views from this search, button "Get all uploads" (deeplink to GetUrls).
5. User ticks N videos, clicks **Tải về đã chọn** → URLs pushed into existing Download task queue.

## Architecture

### Data flow

```
[UI screen] keyword + filters
   ↓ IPC: trend:run
[Queue] Trend task (singleton, abortable)
   ↓
[trendSearch.js] orchestrator
   ├─ youtubeSearch.js
   │    ├─ search.list × 3 (relevance, viewCount, date) — parallel
   │    ├─ merge + dedupe by videoId
   │    ├─ videos.list (batch 50) — enrich statistics, contentDetails
   │    └─ channels.list (batch 50) — enrich subscriberCount
   ├─ velocity compute (views / age_in_days)
   └─ geminiAnalyze.js (parallel, top N)
        └─ keyRotator.js (round-robin, cooldown)
   ↓ IPC: trend:progress (stage, pct, message)
[UI screen] render 2 panels
   ↓ user selection
[Push to Download] window.api.download.enqueue({ urls, workspace })
```

### New modules

| File | Purpose | Mirrors |
|------|---------|---------|
| `src/_lib/youtubeSearch.js` | `searchTrending({ apiKey, keyword, regionCode, relevanceLanguage, publishedAfter, signal, onProgress })` → `{ videos, channels, quotaUsed }` | `src/_lib/youtube.js` (existing API helpers) |
| `src/_lib/geminiAnalyze.js` | `analyzeWhyHot({ keys, video, signal })` → `{ reason, factors }` (multi-modal: thumbnail URL part) | new |
| `src/_lib/keyRotator.js` | Generic round-robin: `new KeyRotator(keys)` → `next()`, `markCooldown(key, ms)`, throws `AllKeysExhausted` when none available | new |
| `src/trendSearch.js` | Task module: orchestrates + reports progress + handles abort | `src/getUrls.js` (TaskRunner pattern) |
| `electron/renderer/screens/trendSearch.js` | UI screen, 2 panels, push-to-download wiring | `electron/renderer/screens/getUrls.js` |
| `electron/ipc/trendSearch.js` | IPC bridge | `electron/ipc/fs.js` |

### Settings additions

```js
{
  youtube: { dataApiKey: "" },        // existing
  gemini: {
    apiKeys: []                        // user adds/removes in Settings → AI tab
  },
  trendSearch: {                       // last-used filters per workspace
    region: "VN",
    language: "vi",
    timeWindowDays: 7,
    minViews: 1000,
    sortBy: "velocity",
    analyzeTopN: 10
  }
}
```

Key rotation cooldown state is **in-memory** per `KeyRotator` instance, reset on app restart. No persistence.

### Sidebar

New entry "Tìm trend" inserted after "Tải về" (download). Icon: 🔍.

## Contracts

### Renderer → main

```js
window.api.trendSearch.run({
  keyword: string,             // required
  regionCode: "VN" | "US" | "JP" | "KR" | "",
  relevanceLanguage: "vi" | "en" | "ja" | "ko" | "",
  timeWindowDays: number,      // 1, 7, 30, 90
  minViews: number,
  sortBy: "velocity" | "totalViews" | "date",
  analyzeTopN: number          // 0 disables AI
}) → { jobId }
```

### Main → renderer (events)

```js
"trend:progress" → { jobId, stage, pct, message }
"trend:result"   → { jobId, videos, channels, quotaUsed }
"trend:error"    → { jobId, code, message }
```

`stage`: `"searching" | "enriching" | "analyzing" | "done"`.

### Cross-screen deeplinks

- "Get all uploads" button on a channel card → calls `window.api.nav.openGetUrls({ handle: channelTitle, prefill: true })`. GetUrls screen receives prefilled handle and is ready to run (user still clicks the run button there).
- "Tải về đã chọn" → calls `window.api.download.enqueue({ urls, workspace })` (existing Download IPC; no new contract needed).

### Result shape

```js
{
  videos: [{
    id, title, channelId, channelTitle, thumbnailUrl,
    publishedAt,                 // ISO string
    viewCount, likeCount, commentCount,
    duration,                    // seconds
    velocity,                    // views/day, computed
    analysis: { reason, factors[] } | null
  }],
  channels: [{
    id, title, thumbnailUrl, subscriberCount,
    aggregateViews,              // sum of viewCount across matched videos
    matchedVideoIds: [...]
  }],
  quotaUsed: { youtube: 302, geminiCalls: 10 }
}
```

### Gemini prompt template

```
Phân tích ngắn gọn (3-5 bullet) tại sao video này có thể đang hot:
- Title: <title>
- Channel: <channelTitle> (subs: <subs>)
- Views/ngày: <velocity>
- Tổng views: <viewCount>, likes: <likes>, comments: <comments>
- Upload: <publishedAt>
- Thumbnail: <inline image part>

Trả về JSON đúng định dạng:
{ "reason": "1 câu tóm tắt", "factors": ["yếu tố 1", "yếu tố 2", ...] }
```

Response is parsed leniently: strip ```` ```json ... ``` ```` fences if present, then `JSON.parse`. On failure → `analysis = { error: "parse_failed" }` for that video; UI shows retry button.

## Quota planning

Per single search:
- YouTube: 3 × `search.list` (100u) + 1 × `videos.list` (1u) + 1 × `channels.list` (1u) = **302 units**.
- 10k/day quota per YouTube key → **~33 searches/day** with the single YouTube key. **YouTube key rotation is NOT in scope for v1** — user manually replaces the key in Settings if quota hits the limit.
- Gemini Flash free tier: 1500 req/day per key. With `analyzeTopN = 10` → **~150 searches/key/day**. **Multi-key rotation IS in scope** (`gemini.apiKeys` array, round-robin via `KeyRotator`).
- Gemini analyze concurrency: limited to **3 parallel** via `pLimit(3)` (already in deps) — avoid burst that triggers 429 across all keys at once.

## Error handling

### Pre-flight
- Missing `youtube.dataApiKey` → toast (VN): "Thiếu YouTube API key. Vào Settings → YouTube." Button: deeplink to Settings tab.
- `gemini.apiKeys` empty → search proceeds, `analyzeTopN` forced to 0, banner above results: "Chưa có Gemini API key — bỏ qua phân tích AI. [Thêm key]".
- Empty keyword → search button disabled.

### YouTube runtime
- 403 quota exceeded → fail whole job, toast: "API key đã hết quota hôm nay."
- 400 invalid key → toast: "API key không hợp lệ."
- Network/timeout → 1 retry with backoff (500ms), then fail.
- Unsupported `regionCode` → fallback to ALL, log warning.

### Gemini runtime (key rotation)
- 429 rate limit → mark key cooldown 60s, try next.
- 403 daily quota → mark key cooldown until next day (24h ceiling), try next.
- All keys exhausted (`AllKeysExhausted`) → set `analysis: null` for that video. Per-video retry button in UI.
- Invalid JSON response → strip fences, retry parse once, then `analysis = { error: "parse_failed" }`.

### Cancel
- User clicks Cancel → `signal.abort()` propagates to all in-flight YouTube + Gemini fetches. Pending requests reject with `AbortError`. Runner cleanup, status = "cancelled".

### Partial result
- YouTube succeeds but all Gemini calls fail → render videos + channels, each video card shows retry button.

## Testing

Vitest, mocking `global.fetch`. Pattern matches existing `tests/_lib/youtube.test.js`.

### Unit
- `tests/_lib/youtubeSearch.test.js` — 3-way merge dedupe, batch enrich (split >50), velocity correctness with mocked time, abort propagation, quota tracking, 403 handling.
- `tests/_lib/keyRotator.test.js` — round-robin order, cooldown skip, all-cooldown throws, expired cooldown re-enters pool, isolated state per instance.
- `tests/_lib/geminiAnalyze.test.js` — happy path, 429→rotate key, all 429 throws, markdown-fenced JSON parses, invalid JSON → `parse_failed`, multimodal payload schema.
- `tests/trendSearch.test.js` — orchestrator with mocked submodules, `analyzeTopN: 0` skips Gemini, partial Gemini failure preserves videos, progress events fire correct stages.

### Out of scope
- UI screen tests (no precedent for renderer screen tests in repo).
- Real network calls.

### Manual test plan (pre-merge)
1. "công nghệ" + region VN → results VN-biased.
2. "Korean drama" + region KR + language ko → KR-biased.
3. Empty Gemini keys → videos render, banner shows.
4. 1 Gemini key with low remaining quota → observe rotation log when 429 fires.
5. Cancel mid-analyze → no ghost requests after.
6. Tick 5 videos → "Tải về đã chọn" → Download task receives 5 URLs.

## Implementation order

1. `keyRotator.js` + tests
2. `youtubeSearch.js` + tests
3. `geminiAnalyze.js` + tests
4. `trendSearch.js` orchestrator + tests
5. Settings additions (Gemini AI tab, schema migration)
6. IPC bridge `electron/ipc/trendSearch.js`
7. Renderer screen `electron/renderer/screens/trendSearch.js`
8. Sidebar entry + routing
9. Manual test plan
10. Update `docs/specs/2026-05-06-vidmaster-desktop-app-design.md` task list

## Open questions

None — all resolved during brainstorming.

## Decisions log

| Decision | Choice | Why |
|----------|--------|-----|
| Platform scope v1 | YouTube only | Existing infra, free quota usable, single integration |
| "Hot" criteria | User-pickable threshold (window + minViews + sortBy) | Power-user friendly, no opinionated default |
| Output | Display + checkbox → push to Download | Connects discovery to existing pipeline |
| AI provider | Gemini 1.5 Flash, multi-key rotation | Free tier, multimodal, multi-lingual; rotation handles per-key quota |
| Region targeting | Explicit user pick | Predictable, maps cleanly to YouTube `regionCode` |
| Discovery method | Multi-pass (3 sorts) + AI eager | Better coverage; quota cost acceptable per session |
| AI cooldown | In-memory per session | Simpler; no stale state across restarts |
