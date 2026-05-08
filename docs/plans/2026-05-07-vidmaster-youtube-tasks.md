# VidMaster YouTube Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3 task modules (Get URLs, Download, Concat) plus a yt-dlp binary manager to VidMaster, fully integrated with the existing queue, settings, and IPC layers.

**Architecture:** Each new task ships as a `src/<task>.js` module with the existing `runX(config) → { ok, outputs, errors }` signature. A shared `_lib/youtube.js` (REST + Node `fetch`) and `_lib/ytdlp.js` (binary lifecycle) sit alongside. New IPC handlers expose binary status, file listing, and URL/info file reading. New renderer screens follow the existing `taskFormShell` pattern except `concat.js`, which uses a custom 3-stage form with a reorderable list component. Settings v1 → v2 migration adds `youtube.*` and `download.*` keys with defaults.

**Tech Stack:** Node 20, Electron 30, electron-store, vitest, p-limit (already in deps), Node built-in `fetch`, ffmpeg via `@ffmpeg-installer/ffmpeg`, yt-dlp via spawned `yt-dlp.exe`.

**Reference docs:**
- Spec: `docs/specs/2026-05-07-vidmaster-youtube-tasks-design.md`
- Master spec: `docs/specs/2026-05-06-vidmaster-desktop-app-design.md` (existing patterns)

---

## File map

**Create:**
- `src/_lib/youtube.js`
- `src/_lib/ytdlp.js`
- `src/_lib/sanitize.js`
- `src/getUrls.js`
- `src/download.js`
- `src/concat.js`
- `electron/ipc/ytdlp.js`
- `electron/renderer/components/reorderableList.js`
- `electron/renderer/screens/getUrls.js`
- `electron/renderer/screens/download.js`
- `electron/renderer/screens/concat.js`
- `tests/_lib/youtube.test.js`
- `tests/_lib/ytdlp.test.js`
- `tests/_lib/sanitize.test.js`
- `tests/getUrls.test.js`
- `tests/download.test.js`
- `tests/concat.test.js`
- `tests/fixtures/tiny-with-audio.mp4` (generated via fixtures/generate.js)
- `tests/fixtures/tiny-silent.mp4` (generated via fixtures/generate.js)

**Modify:**
- `electron/settings.js` — add v2 migration + new defaults
- `electron/ipc/fs.js` — add listMp4, readUrlsFile, readVideoInfos handlers
- `electron/ipc/queue.js` — register `getUrls`, `download`, `concat` runners
- `electron/main.js` — register `registerYtdlpIpc`, auto-update hook
- `electron/preload.mjs` — expose `window.api.ytdlp`, extend `window.api.fs`
- `electron/renderer/components/sidebar.js` — add 3 nav items
- `electron/renderer/components/progressBar.js` — support sub-status text
- `electron/renderer/main.js` — register 3 new screens, label map
- `electron/renderer/screens/settings.js` — add YouTube + Download/yt-dlp groups
- `tests/fixtures/generate.js` — add audio/silent fixtures

---

## Task 1: Settings v2 — schema + migration

**Files:**
- Modify: `electron/settings.js`
- Test: `tests/electron/settings.test.js`

- [ ] **Step 1: Write failing migration test**

Append to `tests/electron/settings.test.js` inside the existing `describe`:

```js
  it("migrates v1 store to v2 with default youtube/download keys", () => {
    const s = createSettings();
    s.set({ workspace: "D:\\Test", version: 1 });
    // Re-create to trigger migration
    const s2 = createSettings();
    expect(s2.get("version")).toBe(2);
    expect(s2.get("youtube.apiKey")).toBe("AIzaSyDZTsPGvG0u5du3t7YGueGgnNi7IiulMus");
    expect(s2.get("youtube.minDurationMinutes")).toBe(8);
    expect(s2.get("youtube.sortOrder")).toBe("VIEW");
    expect(s2.get("download.autoUpdateYtDlp")).toBe(false);
    expect(s2.get("download.maxConcurrent")).toBe(3);
    expect(s2.get("download.ytdlpPath")).toMatch(/yt-dlp\.exe$/);
    expect(s2.get("workspace")).toBe("D:\\Test"); // preserved
  });

  it("returns defaults for new install (no migration needed)", () => {
    const s = createSettings();
    expect(s.get("version")).toBe(2);
    expect(s.get("youtube.minDurationMinutes")).toBe(8);
  });
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/electron/settings.test.js`
Expected: FAIL on the new migration test (`version` is 1, not 2).

- [ ] **Step 3: Update `electron/settings.js`**

Replace the file contents:

```js
import { app } from "electron";
import path from "path";
import Store from "electron-store";

const SCHEMA_VERSION = 2;
const DEFAULT_API_KEY = "AIzaSyDZTsPGvG0u5du3t7YGueGgnNi7IiulMus";

function defaultYtdlpPath() {
  return path.join(app.getPath("appData"), "VidMaster", "bin", "yt-dlp.exe");
}

function buildDefaults() {
  return {
    version: SCHEMA_VERSION,
    workspace: "",
    ffmpeg: { encoder: "auto", maxConcurrent: 2 },
    render: {
      useGPU: false,
      chromaKey: { color: "#D4F9D7", similarity: 0.2 },
      opacity: 0.7,
      crop: { height: 220, yOffset: 490 },
      keepColor: { enabled: false, list: ["#FBFF02"] },
    },
    youtube: {
      apiKey: DEFAULT_API_KEY,
      minDurationMinutes: 8,
      sortOrder: "VIEW",
    },
    download: {
      ytdlpPath: defaultYtdlpPath(),
      autoUpdateYtDlp: false,
      maxConcurrent: 3,
    },
    ui: { theme: "light", logLevel: "info", completedHistorySize: 50 },
    lastUsedTask: "render",
    lastConfig: {},
  };
}

function migrate(store) {
  const v = store.get("version") ?? 1;
  if (v >= SCHEMA_VERSION) return;
  if (v < 2) {
    store.set("youtube", {
      apiKey: store.get("youtube.apiKey") ?? DEFAULT_API_KEY,
      minDurationMinutes: store.get("youtube.minDurationMinutes") ?? 8,
      sortOrder: store.get("youtube.sortOrder") ?? "VIEW",
    });
    store.set("download", {
      ytdlpPath: store.get("download.ytdlpPath") ?? defaultYtdlpPath(),
      autoUpdateYtDlp: store.get("download.autoUpdateYtDlp") ?? false,
      maxConcurrent: store.get("download.maxConcurrent") ?? 3,
    });
  }
  store.set("version", SCHEMA_VERSION);
}

export function createSettings() {
  const defaults = buildDefaults();
  const store = new Store({ defaults, name: "config", cwd: app.getPath("userData") });
  migrate(store);

  const listeners = new Set();

  function get(key) {
    if (!key) return store.store;
    return store.get(key);
  }

  function set(patch) {
    for (const [k, v] of Object.entries(patch)) {
      store.set(k, v);
    }
    const snapshot = store.store;
    listeners.forEach((cb) => cb(snapshot));
  }

  function onChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  return { get, set, onChange };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/electron/settings.test.js`
Expected: PASS all tests including new migration tests.

- [ ] **Step 5: Commit**

```bash
git add electron/settings.js tests/electron/settings.test.js
git commit -m "feat(settings): add v2 schema with youtube/download keys + migration"
```

---

## Task 2: `_lib/sanitize.js` — Windows-safe filename helper

**Files:**
- Create: `src/_lib/sanitize.js`
- Test: `tests/_lib/sanitize.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/_lib/sanitize.test.js`:

```js
import { describe, it, expect } from "vitest";
import { sanitizeFilename } from "../../src/_lib/sanitize.js";

describe("sanitizeFilename", () => {
  it("replaces invalid Windows chars with underscore", () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j");
  });

  it("trims trailing dots and spaces", () => {
    expect(sanitizeFilename("name. ")).toBe("name");
    expect(sanitizeFilename("name...")).toBe("name");
  });

  it("replaces unicode ellipsis and fullwidth question mark with space", () => {
    expect(sanitizeFilename("title…end")).toBe("title end");
    expect(sanitizeFilename("question？mark")).toBe("question mark");
  });

  it("appends underscore to Windows reserved names", () => {
    expect(sanitizeFilename("CON")).toBe("CON_");
    expect(sanitizeFilename("com1")).toBe("com1_");
    expect(sanitizeFilename("LPT9")).toBe("LPT9_");
  });

  it("normalises NFC", () => {
    // 'é' as combining sequence vs precomposed
    const combining = "é";
    expect(sanitizeFilename(combining)).toBe("é");
  });

  it("preserves valid unicode", () => {
    expect(sanitizeFilename("Tiếng Việt")).toBe("Tiếng Việt");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/_lib/sanitize.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/_lib/sanitize.js`**

```js
const INVALID = /[\/\\:*?"<>|]/g;
const RESERVED = new Set([
  "CON","PRN","AUX","NUL",
  "COM1","COM2","COM3","COM4","COM5","COM6","COM7","COM8","COM9",
  "LPT1","LPT2","LPT3","LPT4","LPT5","LPT6","LPT7","LPT8","LPT9",
]);

export function sanitizeFilename(name) {
  let s = String(name ?? "");
  s = s.replace(INVALID, "_");
  s = s.replace(/…/g, " ").replace(/？/g, " ");
  s = s.replace(/[. ]+$/, "");
  if (RESERVED.has(s.toUpperCase())) s += "_";
  return s.normalize("NFC");
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run tests/_lib/sanitize.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/_lib/sanitize.js tests/_lib/sanitize.test.js
git commit -m "feat(sanitize): add Windows-safe filename helper"
```

---

## Task 3: `_lib/youtube.js` — REST client

**Files:**
- Create: `src/_lib/youtube.js`
- Test: `tests/_lib/youtube.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/_lib/youtube.test.js`:

```js
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
      // page 1: playlistItems
      { ok: true, json: async () => ({
        items: [{ snippet: { resourceId: { videoId: "v1" } } }, { snippet: { resourceId: { videoId: "v2" } } }],
        nextPageToken: "PG2", pageInfo: { totalResults: 3 },
      }) },
      // page 1: videos.list
      { ok: true, json: async () => ({ items: [
        { id: "v1", snippet: { title: "T1", publishedAt: "2024-01-01T00:00:00Z" },
          contentDetails: { duration: "PT10M" }, statistics: { viewCount: "100" } },
        { id: "v2", snippet: { title: "T2", publishedAt: "2024-01-02T00:00:00Z" },
          contentDetails: { duration: "PT5M" }, statistics: { viewCount: "200" } },
      ] }) },
      // page 2: playlistItems
      { ok: true, json: async () => ({
        items: [{ snippet: { resourceId: { videoId: "v3" } } }],
        pageInfo: { totalResults: 3 },
      }) },
      // page 2: videos.list
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
      { pagesDone: 1, totalPages: 1 }, // ceil(3/50)
      { pagesDone: 2, totalPages: 1 },
    ]);
  });

  it("respects abort signal", async () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {})); // never resolves
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10);
    await expect(listAllUploadVideos({ apiKey: "K", playlistId: "UUx", signal: ctrl.signal }))
      .rejects.toThrow(/Aborted/);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/_lib/youtube.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/_lib/youtube.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/_lib/youtube.test.js`
Expected: PASS all 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/_lib/youtube.js tests/_lib/youtube.test.js
git commit -m "feat(youtube): add YouTube Data API REST client"
```

---

## Task 4: `_lib/ytdlp.js` — binary manager

**Files:**
- Create: `src/_lib/ytdlp.js`
- Test: `tests/_lib/ytdlp.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/_lib/ytdlp.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

let getStatus, ensureBinary, updateBinary;
let tmpDir;
let savedFetch;

beforeEach(async () => {
  vi.resetModules();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-ytdlp-"));
  savedFetch = global.fetch;
  ({ getStatus, ensureBinary, updateBinary } = await import("../../src/_lib/ytdlp.js"));
});

afterEach(() => {
  global.fetch = savedFetch;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function fakeBinaryStream(bytes) {
  return {
    ok: true,
    headers: new Map([["content-length", String(bytes.length)]]),
    body: ReadableStream.from([bytes]),
  };
}

describe("getStatus", () => {
  it("returns exists=false when file missing", async () => {
    const res = await getStatus(path.join(tmpDir, "yt-dlp.exe"));
    expect(res.exists).toBe(false);
    expect(res.version).toBeNull();
  });

  it("returns exists=true and lastModified when file present", async () => {
    const p = path.join(tmpDir, "yt-dlp.exe");
    fs.writeFileSync(p, "stub");
    const res = await getStatus(p);
    expect(res.exists).toBe(true);
    expect(res.lastModified).toBeInstanceOf(Date);
    expect(res.path).toBe(p);
  });
});

describe("ensureBinary", () => {
  it("downloads when binary is missing", async () => {
    global.fetch = vi.fn().mockResolvedValue(fakeBinaryStream(Buffer.from("FAKE_BINARY_DATA")));
    const target = path.join(tmpDir, "yt-dlp.exe");
    const ticks = [];
    const out = await ensureBinary({ targetPath: target, onProgress: (p) => ticks.push(p) });
    expect(out).toBe(target);
    expect(fs.readFileSync(target, "utf8")).toBe("FAKE_BINARY_DATA");
    expect(ticks.at(-1)).toBe(100);
  });

  it("does nothing when binary already exists", async () => {
    const target = path.join(tmpDir, "yt-dlp.exe");
    fs.writeFileSync(target, "ALREADY_THERE");
    global.fetch = vi.fn();
    const out = await ensureBinary({ targetPath: target });
    expect(out).toBe(target);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(fs.readFileSync(target, "utf8")).toBe("ALREADY_THERE");
  });

  it("writes to .tmp and renames atomically", async () => {
    global.fetch = vi.fn().mockResolvedValue(fakeBinaryStream(Buffer.from("ABC")));
    const target = path.join(tmpDir, "yt-dlp.exe");
    await ensureBinary({ targetPath: target });
    // .tmp should not linger
    expect(fs.existsSync(target + ".tmp")).toBe(false);
    expect(fs.readFileSync(target, "utf8")).toBe("ABC");
  });

  it("aborts and cleans up .tmp when signal fires", async () => {
    const ctrl = new AbortController();
    let pulled = false;
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      headers: new Map([["content-length", "1000"]]),
      body: new ReadableStream({
        async pull(controller) {
          if (!pulled) {
            controller.enqueue(Buffer.from("first"));
            pulled = true;
            ctrl.abort();
            await new Promise((r) => setTimeout(r, 30));
          }
          controller.close();
        },
      }),
    }));
    const target = path.join(tmpDir, "yt-dlp.exe");
    await expect(ensureBinary({ targetPath: target, signal: ctrl.signal }))
      .rejects.toThrow(/Aborted/);
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(target + ".tmp")).toBe(false);
  });
});

describe("updateBinary", () => {
  it("forces redownload even if file exists", async () => {
    const target = path.join(tmpDir, "yt-dlp.exe");
    fs.writeFileSync(target, "OLD");
    global.fetch = vi.fn().mockResolvedValue(fakeBinaryStream(Buffer.from("NEW")));
    await updateBinary({ targetPath: target });
    expect(fs.readFileSync(target, "utf8")).toBe("NEW");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/_lib/ytdlp.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/_lib/ytdlp.js`**

```js
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { throwIfAborted, AbortError } from "./abortError.js";

const RELEASE_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";

export async function getStatus(targetPath) {
  let exists = false;
  let lastModified = null;
  try {
    const st = fs.statSync(targetPath);
    exists = st.isFile();
    lastModified = st.mtime;
  } catch {}

  let version = null;
  if (exists) {
    version = await probeVersion(targetPath).catch(() => null);
  }
  return { exists, path: targetPath, version, lastModified };
}

function probeVersion(binPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, ["--version"], { windowsHide: true });
    let out = "";
    child.stdout.on("data", (b) => { out += b.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(out.trim()) : reject(new Error(`exit ${code}`)));
  });
}

async function downloadTo(targetPath, { signal, onProgress, onLog } = {}) {
  throwIfAborted(signal);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmp = targetPath + ".tmp";
  // Cleanup any stale .tmp
  try { fs.unlinkSync(tmp); } catch {}

  let res;
  try {
    res = await fetch(RELEASE_URL, { signal });
  } catch (err) {
    if (err.name === "AbortError" || signal?.aborted) throw new AbortError();
    throw err;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading yt-dlp`);

  const totalRaw = res.headers.get?.("content-length") ?? res.headers.get("content-length");
  const total = totalRaw ? parseInt(totalRaw, 10) : 0;
  let received = 0;

  const file = fs.createWriteStream(tmp);
  const cleanupTmp = () => { try { fs.unlinkSync(tmp); } catch {} };
  const onAbort = () => { try { file.destroy(); } catch {} cleanupTmp(); };
  if (signal) signal.addEventListener("abort", onAbort, { once: true });

  try {
    const reader = res.body.getReader();
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      await new Promise((resolve, reject) => {
        file.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()));
      });
      if (onProgress && total > 0) onProgress(Math.min(99, (received / total) * 100));
    }
    await new Promise((r) => file.end(r));
  } catch (err) {
    cleanupTmp();
    if (err.name === "AbortError" || signal?.aborted) throw new AbortError();
    throw err;
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
  }

  if (signal?.aborted) {
    cleanupTmp();
    throw new AbortError();
  }

  fs.renameSync(tmp, targetPath);
  onProgress?.(100);
  onLog?.("info", `yt-dlp.exe saved to ${targetPath}`);
  return targetPath;
}

export async function ensureBinary({ targetPath, signal, onProgress, onLog } = {}) {
  if (fs.existsSync(targetPath)) {
    onProgress?.(100);
    return targetPath;
  }
  return downloadTo(targetPath, { signal, onProgress, onLog });
}

export async function updateBinary({ targetPath, signal, onProgress, onLog } = {}) {
  return downloadTo(targetPath, { signal, onProgress, onLog });
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/_lib/ytdlp.test.js`
Expected: PASS all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/_lib/ytdlp.js tests/_lib/ytdlp.test.js
git commit -m "feat(ytdlp): add binary lifecycle manager (status/ensure/update)"
```

---

## Task 5: `src/getUrls.js` — task module

**Files:**
- Create: `src/getUrls.js`
- Test: `tests/getUrls.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/getUrls.test.js`:

```js
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
      "https://www.youtube.com/watch?v=v3", // VIEW desc: 2000 then 1000
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
      "https://www.youtube.com/watch?v=v1", // 2024-01-03
      "https://www.youtube.com/watch?v=v3", // 2024-01-01
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
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/getUrls.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/getUrls.js`**

```js
import fs from "fs";
import path from "path";
import { TaskRunner } from "./_lib/runner.js";
import { fetchUploadsPlaylistId, listAllUploadVideos } from "./_lib/youtube.js";

export async function runGetUrls(config) {
  const runner = new TaskRunner(config);
  const {
    handle, apiKey, workspace,
    minDurationMinutes = 8,
    sortOrder = "VIEW",
  } = config;
  const { signal } = config;

  if (!handle) throw new Error("Thiếu handle.");
  if (!apiKey) throw new Error("Thiếu YouTube API key.");
  if (!workspace) throw new Error("Thiếu workspace.");

  runner.checkAborted();
  runner.setProgress(5, "Đang tìm kênh...");

  const playlistId = await fetchUploadsPlaylistId({ apiKey, handle, signal });
  runner.checkAborted();

  const videos = await listAllUploadVideos({
    apiKey, playlistId, signal,
    onPage: ({ pagesDone, totalPages }) => {
      const pct = 5 + Math.min(85, (pagesDone / Math.max(1, totalPages)) * 85);
      runner.setProgress(pct, `Đã đọc ${pagesDone}/${totalPages} trang`);
    },
  });

  runner.checkAborted();
  runner.setProgress(90, "Lọc & sắp xếp...");

  const minSec = minDurationMinutes * 60;
  const filtered = videos.filter((v) => v.durationSec > minSec);

  let sorted;
  if (sortOrder === "LATEST") {
    sorted = filtered.slice().sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  } else if (sortOrder === "MIX") {
    sorted = filtered.slice().sort(() => Math.random() - 0.5);
  } else {
    sorted = filtered.slice().sort((a, b) => b.viewCount - a.viewCount);
  }

  const handleSafe = handle.replace(/^@/, "");
  const dir = path.join(workspace, "channels", handleSafe);
  fs.mkdirSync(dir, { recursive: true });
  const urlsPath = path.join(dir, "only_video_urls.txt");
  const infosPath = path.join(dir, "video_infos.txt");

  const urls = sorted.map((v) => `https://www.youtube.com/watch?v=${v.id}`).join("\n") + (sorted.length ? "\n" : "");
  const infos = sorted.map((v) =>
    `${v.publishedAt}\thttps://www.youtube.com/watch?v=${v.id}\t${v.viewCount}\t${v.title}\t${formatDur(v.durationSec)}`
  ).join("\n") + (sorted.length ? "\n" : "");

  fs.writeFileSync(urlsPath, urls, "utf8");
  fs.writeFileSync(infosPath, infos, "utf8");

  runner.setProgress(100, `Đã ghi ${sorted.length} URLs`);
  runner.log("info", `${sorted.length} videos written to ${urlsPath}`);

  return {
    ok: true,
    outputs: [urlsPath, infosPath],
    videos: sorted,
    errors: [],
  };
}

function formatDur(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
function pad(n) { return String(n).padStart(2, "0"); }
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/getUrls.test.js`
Expected: PASS all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/getUrls.js tests/getUrls.test.js
git commit -m "feat(getUrls): add task module to fetch channel videos"
```

---

## Task 6: `src/download.js` — task module

**Files:**
- Create: `src/download.js`
- Test: `tests/download.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/download.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { EventEmitter } from "events";

let runDownload;
let tmpDir;

const fakeChildren = [];
function makeFakeChild(handlers) {
  const ee = new EventEmitter();
  ee.stdout = new EventEmitter();
  ee.stderr = new EventEmitter();
  ee.kill = vi.fn();
  ee.handlers = handlers || {};
  fakeChildren.push(ee);
  setImmediate(() => ee.handlers.onSpawn?.(ee));
  return ee;
}

vi.mock("child_process", () => ({
  spawn: vi.fn(() => makeFakeChild()),
}));

vi.mock("../src/_lib/ytdlp.js", () => ({
  ensureBinary: vi.fn(async ({ targetPath }) => targetPath),
  getStatus: vi.fn(async () => ({ exists: true, path: "/yt.exe", version: "x", lastModified: new Date() })),
}));

beforeEach(async () => {
  vi.resetModules();
  fakeChildren.length = 0;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-dl-"));
  ({ runDownload } = await import("../src/download.js"));
});

afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe("runDownload", () => {
  it("calls ensureBinary then spawns one yt-dlp per URL", async () => {
    const urlsFile = path.join(tmpDir, "urls.txt");
    fs.writeFileSync(urlsFile, "https://yt/a\nhttps://yt/b\n", "utf8");
    const cp = await import("child_process");

    const promise = runDownload({
      urlsFile, output: tmpDir, ytdlpPath: "/yt.exe", maxConcurrent: 2,
    });

    // Allow microtasks to schedule spawns
    await Promise.resolve();
    await Promise.resolve();
    expect(cp.spawn).toHaveBeenCalledTimes(2);

    // Finish all children with code 0
    for (const c of fakeChildren) c.emit("close", 0);
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("respects maxConcurrent (3rd URL waits)", async () => {
    const urlsFile = path.join(tmpDir, "urls.txt");
    fs.writeFileSync(urlsFile, "u1\nu2\nu3\n", "utf8");
    const cp = await import("child_process");

    const promise = runDownload({
      urlsFile, output: tmpDir, ytdlpPath: "/yt.exe", maxConcurrent: 2,
    });
    await new Promise((r) => setImmediate(r));
    expect(cp.spawn).toHaveBeenCalledTimes(2);
    fakeChildren[0].emit("close", 0);
    await new Promise((r) => setImmediate(r));
    expect(cp.spawn).toHaveBeenCalledTimes(3);
    fakeChildren[1].emit("close", 0);
    fakeChildren[2].emit("close", 0);
    await promise;
  });

  it("aggregates per-URL % into onProgress message", async () => {
    const urlsFile = path.join(tmpDir, "urls.txt");
    fs.writeFileSync(urlsFile, "u1\n", "utf8");
    const ticks = [];
    const promise = runDownload({
      urlsFile, output: tmpDir, ytdlpPath: "/yt.exe", maxConcurrent: 1,
      onProgress: (p, msg) => ticks.push({ p, msg }),
    });
    await new Promise((r) => setImmediate(r));
    fakeChildren[0].stderr.emit("data", "[download]   42.0% of 10MiB at 1MiB/s ETA 00:01\n");
    await new Promise((r) => setImmediate(r));
    fakeChildren[0].emit("close", 0);
    await promise;
    const has42 = ticks.some((t) => /42/.test(t.msg ?? ""));
    expect(has42).toBe(true);
    expect(ticks.at(-1).p).toBe(100);
  });

  it("collects errors per failing URL but continues", async () => {
    const urlsFile = path.join(tmpDir, "urls.txt");
    fs.writeFileSync(urlsFile, "u-good\nu-bad\n", "utf8");
    const promise = runDownload({
      urlsFile, output: tmpDir, ytdlpPath: "/yt.exe", maxConcurrent: 2,
    });
    await new Promise((r) => setImmediate(r));
    fakeChildren[0].emit("close", 0);
    fakeChildren[1].stderr.emit("data", "ERROR: video unavailable\n");
    fakeChildren[1].emit("close", 1);
    const r = await promise;
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].url).toBe("u-bad");
  });

  it("aborts via signal: kills children", async () => {
    const urlsFile = path.join(tmpDir, "urls.txt");
    fs.writeFileSync(urlsFile, "u1\nu2\n", "utf8");
    const ctrl = new AbortController();
    const promise = runDownload({
      urlsFile, output: tmpDir, ytdlpPath: "/yt.exe", maxConcurrent: 2,
      signal: ctrl.signal,
    });
    await new Promise((r) => setImmediate(r));
    ctrl.abort();
    await new Promise((r) => setImmediate(r));
    for (const c of fakeChildren) expect(c.kill).toHaveBeenCalledWith("SIGTERM");
    for (const c of fakeChildren) c.emit("close", 1);
    await expect(promise).rejects.toThrow(/Aborted/);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/download.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/download.js`**

```js
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import pLimit from "p-limit";
import { TaskRunner } from "./_lib/runner.js";
import { AbortError, throwIfAborted } from "./_lib/abortError.js";
import { ensureBinary } from "./_lib/ytdlp.js";
import { sanitizeFilename } from "./_lib/sanitize.js";

const PCT_RE = /\[download\]\s+([\d.]+)%/;

export async function runDownload(config) {
  const runner = new TaskRunner(config);
  const {
    urlsFile, output, ytdlpPath,
    maxConcurrent = 3,
  } = config;
  const { signal } = config;

  if (!urlsFile) throw new Error("Thiếu file URLs.");
  if (!output) throw new Error("Thiếu folder output.");
  if (!ytdlpPath) throw new Error("Thiếu đường dẫn yt-dlp.");

  runner.checkAborted();
  fs.mkdirSync(output, { recursive: true });

  // Phase 1: bootstrap yt-dlp (0–5%)
  if (!fs.existsSync(ytdlpPath)) {
    runner.log("info", "Đang tải yt-dlp.exe...");
    await ensureBinary({
      targetPath: ytdlpPath, signal,
      onProgress: (p) => runner.setProgress(p * 0.05, "Tải yt-dlp..."),
    });
  }
  runner.setProgress(5, "");

  // Phase 2: read URLs
  const urls = fs.readFileSync(urlsFile, "utf8")
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (urls.length === 0) {
    return { ok: true, outputs: [], errors: [] };
  }

  const archiveFile = path.join(output, "downloaded.txt");
  const inflight = new Map(); // url → percent string
  const liveChildren = new Set();
  let completed = 0;
  const total = urls.length;
  const errors = [];

  const refreshProgress = () => {
    const lines = [...inflight.entries()]
      .map(([u, p]) => `  • ${shortUrl(u)} ${p}%`)
      .join("\n");
    const overall = 5 + (completed / total) * 95;
    runner.setProgress(overall, lines ? `Đang tải:\n${lines}` : "");
  };

  const onAbort = () => {
    for (const c of liveChildren) {
      try { c.kill("SIGTERM"); } catch {}
    }
  };
  if (signal) signal.addEventListener("abort", onAbort);

  const limit = pLimit(Math.min(5, Math.max(1, maxConcurrent)));

  try {
    const results = await Promise.allSettled(urls.map((url) => limit(() => downloadOne({
      url, output, ytdlpPath, archiveFile, signal,
      onPercent: (p) => { inflight.set(url, p); refreshProgress(); },
      onLog: (level, line) => runner.onLog?.(level, line),
      registerChild: (c) => liveChildren.add(c),
      unregisterChild: (c) => liveChildren.delete(c),
    }))));

    for (let i = 0; i < results.length; i++) {
      const url = urls[i];
      inflight.delete(url);
      const r = results[i];
      if (r.status === "rejected") {
        if (r.reason?.name === "AbortError") throw r.reason;
        errors.push({ url, message: r.reason?.message ?? String(r.reason), stderrTail: r.reason?.stderrTail });
      }
      completed++;
      refreshProgress();
    }
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
  }

  throwIfAborted(signal);

  // Phase 3: sanitize filenames
  const outputs = renameSanitized(output);
  runner.setProgress(100, `Đã tải ${outputs.length}/${total}`);

  return { ok: errors.length === 0, outputs, errors };
}

function downloadOne({ url, output, ytdlpPath, archiveFile, signal, onPercent, onLog, registerChild, unregisterChild }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError());

    const args = [
      "-f", "bestvideo+bestaudio/best",
      "--merge-output-format", "mp4",
      "-o", path.join(output, "%(title)s.%(ext)s"),
      "--write-thumbnail",
      "--convert-thumbnails", "jpg",
      "--no-overwrites",
      "--download-archive", archiveFile,
      url,
    ];

    const child = spawn(ytdlpPath, args, { windowsHide: true });
    registerChild(child);

    const stderrChunks = [];

    const handleLine = (line) => {
      const m = PCT_RE.exec(line);
      if (m) onPercent(parseFloat(m[1]).toFixed(0));
      onLog?.("debug", line);
    };

    let stdoutBuf = "";
    child.stdout.on("data", (b) => {
      stdoutBuf += b.toString();
      let idx;
      while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
        const line = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        handleLine(line);
      }
    });

    let stderrBuf = "";
    child.stderr.on("data", (b) => {
      const s = b.toString();
      stderrBuf += s;
      stderrChunks.push(s);
      let idx;
      while ((idx = stderrBuf.indexOf("\n")) >= 0) {
        const line = stderrBuf.slice(0, idx);
        stderrBuf = stderrBuf.slice(idx + 1);
        handleLine(line);
      }
    });

    child.on("error", (err) => {
      unregisterChild(child);
      reject(err);
    });

    child.on("close", (code) => {
      unregisterChild(child);
      if (signal?.aborted) return reject(new AbortError());
      if (code !== 0) {
        const tail = stderrChunks.join("").split("\n").slice(-20).join("\n");
        const err = new Error(`yt-dlp exit ${code}: ${url}`);
        err.stderrTail = tail;
        return reject(err);
      }
      resolve();
    });
  });
}

function shortUrl(u) {
  const m = /v=([^&]+)/.exec(u);
  return m ? m[1] : u.slice(0, 30);
}

function renameSanitized(folder) {
  const out = [];
  for (const ext of [".mp4", ".jpg"]) {
    const files = fs.readdirSync(folder).filter((n) => n.toLowerCase().endsWith(ext));
    for (const file of files) {
      const base = file.slice(0, file.length - ext.length);
      const safe = sanitizeFilename(base);
      if (safe === base) {
        if (ext === ".mp4") out.push(path.join(folder, file));
        continue;
      }
      const newName = safe + ext;
      const newPath = path.join(folder, newName);
      if (!fs.existsSync(newPath)) {
        fs.renameSync(path.join(folder, file), newPath);
      }
      if (ext === ".mp4") out.push(newPath);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/download.test.js`
Expected: PASS all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/download.js tests/download.test.js
git commit -m "feat(download): add yt-dlp parallel download task module"
```

---

## Task 7: Audio fixture generator

**Files:**
- Modify: `tests/fixtures/generate.js`

- [ ] **Step 1: Read existing generator**

Run: `cat tests/fixtures/generate.js` (or use Read tool). Identify the existing pattern.

- [ ] **Step 2: Add fixture generation for audio variants**

Append to `tests/fixtures/generate.js` (or wrap existing logic so the new fixtures are produced when the script runs):

```js
import { spawn } from "child_process";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function ff(args) {
  return new Promise((res, rej) => {
    const c = spawn(ffmpegPath, args, { windowsHide: true });
    c.on("error", rej);
    c.on("close", (code) => code === 0 ? res() : rej(new Error("ffmpeg " + code)));
  });
}

const audioPath = path.join(__dirname, "tiny-with-audio.mp4");
if (!fs.existsSync(audioPath)) {
  // 2 sec, 320x240, sine 440Hz audio
  await ff([
    "-y",
    "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=25:d=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest",
    audioPath,
  ]);
}

const silentPath = path.join(__dirname, "tiny-silent.mp4");
if (!fs.existsSync(silentPath)) {
  await ff([
    "-y",
    "-f", "lavfi", "-i", "color=c=red:s=320x240:r=25:d=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an",
    silentPath,
  ]);
}
```

- [ ] **Step 3: Run generator**

```bash
node tests/fixtures/generate.js
```

Expected: `tests/fixtures/tiny-with-audio.mp4` and `tests/fixtures/tiny-silent.mp4` exist (~50–200 KB each).

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/generate.js tests/fixtures/tiny-with-audio.mp4 tests/fixtures/tiny-silent.mp4
git commit -m "test(fixtures): add audio + silent fixtures for concat tests"
```

---

## Task 8: `src/concat.js` — task module

**Files:**
- Create: `src/concat.js`
- Test: `tests/concat.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/concat.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { runConcat } from "../src/concat.js";
import { spawn } from "child_process";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const audio  = path.join(__dirname, "fixtures", "tiny-with-audio.mp4");
const silent = path.join(__dirname, "fixtures", "tiny-silent.mp4");

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-concat-")); });
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function probeStreams(file) {
  return new Promise((res, rej) => {
    const c = spawn(ffmpegPath, ["-i", file], { windowsHide: true });
    let err = "";
    c.stderr.on("data", (b) => { err += b.toString(); });
    c.on("close", () => res(err));
  });
}

describe("runConcat", () => {
  it("concats two audio inputs and keeps audio", async () => {
    const out = path.join(tmpDir, "out.mp4");
    const ticks = [];
    const r = await runConcat({
      inputs: [audio, audio],
      output: out,
      onProgress: (p) => ticks.push(p),
    });
    expect(r.ok).toBe(true);
    expect(fs.existsSync(out)).toBe(true);
    const info = await probeStreams(out);
    expect(info).toMatch(/Stream #\d:\d.*Audio/);
    expect(ticks.at(-1)).toBe(100);
  }, 30_000);

  it("concats mixed (silent + audio) and synthesises audio for silent", async () => {
    const out = path.join(tmpDir, "out.mp4");
    const r = await runConcat({ inputs: [silent, audio], output: out });
    expect(r.ok).toBe(true);
    const info = await probeStreams(out);
    expect(info).toMatch(/Stream #\d:\d.*Audio/);
  }, 30_000);

  it("rejects with < 2 inputs", async () => {
    await expect(runConcat({ inputs: [audio], output: path.join(tmpDir, "x.mp4") }))
      .rejects.toThrow(/ít nhất 2/);
  });

  it("rejects on missing input", async () => {
    await expect(runConcat({
      inputs: [audio, path.join(tmpDir, "no.mp4")],
      output: path.join(tmpDir, "x.mp4"),
    })).rejects.toThrow(/không tồn tại/i);
  });

  it("aborts when signal fires", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(runConcat({ inputs: [audio, audio], output: path.join(tmpDir, "x.mp4"), signal: ctrl.signal }))
      .rejects.toThrow(/Aborted/);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/concat.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/concat.js`**

```js
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import { TaskRunner } from "./_lib/runner.js";
import { AbortError, throwIfAborted } from "./_lib/abortError.js";

ffmpeg.setFfmpegPath(ffmpegPath);

export async function runConcat(config) {
  const runner = new TaskRunner(config);
  const { inputs, output } = config;
  const { signal } = config;

  if (!Array.isArray(inputs) || inputs.length < 2) {
    throw new Error("Cần ít nhất 2 video để nối.");
  }
  for (const p of inputs) {
    if (!fs.existsSync(p)) throw new Error(`File không tồn tại: ${p}`);
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });

  runner.checkAborted();
  runner.setProgress(0, "Phân tích input...");

  const probes = await Promise.all(inputs.map((p) => probe(p)));
  const totalDur = probes.reduce((a, b) => a + b.duration, 0);
  const allHaveAudio = probes.every((p) => p.hasAudio);

  const args = ["-y"];
  for (const p of inputs) { args.push("-i", p); }

  let filter;
  if (allHaveAudio) {
    const inp = inputs.map((_, i) => `[${i}:v:0][${i}:a:0]`).join("");
    filter = `${inp}concat=n=${inputs.length}:v=1:a=1[v][a]`;
  } else {
    const inp = inputs.map((_, i) => `[${i}:v:0]`).join("");
    filter = `${inp}concat=n=${inputs.length}:v=1:a=0[v];anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=${totalDur},asetpts=PTS-STARTPTS[a]`;
  }

  args.push(
    "-filter_complex", filter,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "44100", "-ac", "2",
    "-movflags", "+faststart",
    output,
  );

  await runFfmpeg(args, totalDur, runner, signal);
  runner.setProgress(100, "Done");

  return { ok: true, outputs: [output], errors: [] };
}

function probe(file) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, meta) => {
      if (err) return reject(err);
      const duration = meta.format?.duration ?? 0;
      const hasAudio = (meta.streams || []).some((s) => s.codec_type === "audio");
      resolve({ duration, hasAudio });
    });
  });
}

const TIME_RE = /time=(\d+):(\d+):(\d+\.\d+)/;
function runFfmpeg(args, totalDur, runner, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError());
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    const stderr = [];
    let aborted = false;
    const onAbort = () => { aborted = true; try { child.kill("SIGTERM"); } catch {} };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    child.stderr.on("data", (b) => {
      const s = b.toString();
      stderr.push(s);
      runner.onLog?.("debug", s);
      const m = TIME_RE.exec(s);
      if (m && totalDur > 0) {
        const sec = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
        const pct = Math.min(99, (sec / totalDur) * 100);
        runner.setProgress(pct);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      if (aborted) return reject(new AbortError());
      if (code !== 0) return reject(new Error(`FFmpeg exit ${code}\n${stderr.join("").slice(-1000)}`));
      resolve();
    });
  });
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/concat.test.js`
Expected: PASS all 5 tests (the 2 ffmpeg-real ones may take ~10s each).

- [ ] **Step 5: Commit**

```bash
git add src/concat.js tests/concat.test.js
git commit -m "feat(concat): add audio-preserving video concat task"
```

---

## Task 9: Extend `electron/ipc/fs.js`

**Files:**
- Modify: `electron/ipc/fs.js`

- [ ] **Step 1: Replace contents**

```js
import { ipcMain } from "electron";
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import pLimit from "p-limit";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";

ffmpeg.setFfmpegPath(ffmpegPath);

function probeDuration(file) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(file, (err, meta) => resolve(err ? 0 : (meta.format?.duration ?? 0)));
  });
}

export function registerFsIpc() {
  ipcMain.handle("fs:exists", (_, p) => {
    if (!p) return { exists: false };
    try {
      const s = fs.statSync(p);
      return { exists: true, isFolder: s.isDirectory(), isFile: s.isFile() };
    } catch { return { exists: false }; }
  });

  ipcMain.handle("fs:listMp4", async (_, folder) => {
    if (!folder || !fs.existsSync(folder)) return [];
    const names = fs.readdirSync(folder).filter((n) => /\.mp4$/i.test(n)).sort();
    const limit = pLimit(4);
    return Promise.all(names.map((name) => limit(async () => {
      const fullPath = path.join(folder, name);
      const st = fs.statSync(fullPath);
      const durationSec = await probeDuration(fullPath);
      return { name, fullPath, sizeBytes: st.size, durationSec };
    })));
  });

  ipcMain.handle("fs:readUrlsFile", (_, p) => {
    if (!p || !fs.existsSync(p)) return [];
    return fs.readFileSync(p, "utf8")
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  });

  ipcMain.handle("fs:readVideoInfos", (_, p) => {
    if (!p || !fs.existsSync(p)) return [];
    return fs.readFileSync(p, "utf8")
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      .map((line) => {
        const [publishedAt, url, viewCount, title, duration] = line.split("\t");
        return { publishedAt, url, viewCount, title, duration };
      });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/ipc/fs.js
git commit -m "feat(ipc/fs): add listMp4, readUrlsFile, readVideoInfos handlers"
```

---

## Task 10: Create `electron/ipc/ytdlp.js`

**Files:**
- Create: `electron/ipc/ytdlp.js`

- [ ] **Step 1: Write file**

```js
import { ipcMain } from "electron";
import { getStatus, updateBinary } from "../../src/_lib/ytdlp.js";

export function registerYtdlpIpc(getSettings, getQueue) {
  ipcMain.handle("ytdlp:getStatus", async () => {
    const settings = getSettings();
    const targetPath = settings.get("download.ytdlpPath");
    return getStatus(targetPath);
  });

  ipcMain.handle("ytdlp:update", async () => {
    const settings = getSettings();
    const targetPath = settings.get("download.ytdlpPath");
    const queue = getQueue();
    return queue.add({ type: "_ytdlpUpdate", config: { targetPath } });
  });
}

export async function runYtdlpUpdate(config) {
  const { targetPath, signal, onProgress, onLog } = config;
  await updateBinary({ targetPath, signal, onProgress, onLog });
  return { ok: true, outputs: [targetPath], errors: [] };
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/ipc/ytdlp.js
git commit -m "feat(ipc/ytdlp): add getStatus and queue-tracked update handlers"
```

---

## Task 11: Wire runners + register IPC in main + queue

**Files:**
- Modify: `electron/ipc/queue.js`
- Modify: `electron/main.js`

- [ ] **Step 1: Update `electron/ipc/queue.js`**

```js
import { ipcMain } from "electron";
import { QueueManager } from "../queue.js";
import { runRender } from "../../src/render.js";
import { runSnow } from "../../src/snow.js";
import { runTrim } from "../../src/trim.js";
import { runCutBg } from "../../src/cutBg.js";
import { runGetUrls } from "../../src/getUrls.js";
import { runDownload } from "../../src/download.js";
import { runConcat } from "../../src/concat.js";
import { runYtdlpUpdate } from "./ytdlp.js";

export function registerQueueIpc(getMainWindow) {
  const runners = {
    render: runRender, snow: runSnow, trim: runTrim, cutBg: runCutBg,
    getUrls: runGetUrls, download: runDownload, concat: runConcat,
    _ytdlpUpdate: runYtdlpUpdate,
  };

  const queue = new QueueManager({
    runners,
    onUpdate: (state) => {
      const win = getMainWindow();
      win?.webContents.send("queue:update", state);
    },
  });

  ipcMain.handle("queue:add", (_, spec) => queue.add(spec));
  ipcMain.handle("queue:cancel", (_, jobId) => queue.cancel(jobId));
  ipcMain.handle("queue:clear", () => queue.clear());
  ipcMain.handle("queue:getState", () => queue.getState());

  return queue;
}
```

- [ ] **Step 2: Update `electron/main.js`**

Add the import, register IPC, and add the auto-update hook:

```js
// Add to existing imports near the top:
import { registerYtdlpIpc } from "./ipc/ytdlp.js";
import { existsSync } from "fs";
import { ensureBinary, updateBinary } from "../src/_lib/ytdlp.js";
```

Inside `app.whenReady().then(async () => {`, **after** `registerFsIpc()` and **before** `createWindow()`:

```js
  registerYtdlpIpc(() => settings, () => queue);

  // Auto-update yt-dlp on app start (background, non-blocking)
  if (settings.get("download.autoUpdateYtDlp")) {
    const ytdlpPath = settings.get("download.ytdlpPath");
    if (existsSync(ytdlpPath)) {
      updateBinary({ targetPath: ytdlpPath })
        .then(() => log.info("yt-dlp.exe updated on startup"))
        .catch((err) => log.warn("yt-dlp auto-update failed:", err.message));
    }
  }
```

- [ ] **Step 3: Run all tests**

```bash
npx vitest run
```

Expected: PASS — no regressions.

- [ ] **Step 4: Commit**

```bash
git add electron/ipc/queue.js electron/main.js
git commit -m "feat(electron): wire new task runners + yt-dlp auto-update on startup"
```

---

## Task 12: Extend preload.mjs

**Files:**
- Modify: `electron/preload.mjs`

- [ ] **Step 1: Replace contents**

```js
import { contextBridge, ipcRenderer } from "electron";

const subscribers = { "queue:update": new Set(), "settings:change": new Set() };
ipcRenderer.on("queue:update", (_, s) => subscribers["queue:update"].forEach((cb) => cb(s)));
ipcRenderer.on("settings:change", (_, s) => subscribers["settings:change"].forEach((cb) => cb(s)));

contextBridge.exposeInMainWorld("api", {
  queue: {
    add: (spec) => ipcRenderer.invoke("queue:add", spec),
    cancel: (id) => ipcRenderer.invoke("queue:cancel", id),
    clear: () => ipcRenderer.invoke("queue:clear"),
    getState: () => ipcRenderer.invoke("queue:getState"),
    onUpdate: (cb) => { subscribers["queue:update"].add(cb); return () => subscribers["queue:update"].delete(cb); },
  },
  settings: {
    get: (key) => ipcRenderer.invoke("settings:get", key),
    set: (patch) => ipcRenderer.invoke("settings:set", patch),
    onChange: (cb) => { subscribers["settings:change"].add(cb); return () => subscribers["settings:change"].delete(cb); },
  },
  dialog: {
    pickFolder: (defaultPath) => ipcRenderer.invoke("dialog:pickFolder", defaultPath),
    pickFile: (opts) => ipcRenderer.invoke("dialog:pickFile", opts),
  },
  shell: {
    openFolder: (p) => ipcRenderer.invoke("shell:openFolder", p),
    openLogFile: () => ipcRenderer.invoke("shell:openLogFile"),
  },
  app: {
    getVersion: () => ipcRenderer.invoke("app:getVersion"),
    getWorkspace: () => ipcRenderer.invoke("app:getWorkspace"),
    ensureWorkspace: (root) => ipcRenderer.invoke("app:ensureWorkspace", root),
  },
  fs: {
    exists: (p) => ipcRenderer.invoke("fs:exists", p),
    listMp4: (folder) => ipcRenderer.invoke("fs:listMp4", folder),
    readUrlsFile: (p) => ipcRenderer.invoke("fs:readUrlsFile", p),
    readVideoInfos: (p) => ipcRenderer.invoke("fs:readVideoInfos", p),
  },
  ytdlp: {
    getStatus: () => ipcRenderer.invoke("ytdlp:getStatus"),
    update: () => ipcRenderer.invoke("ytdlp:update"),
  },
  log: {
    getRecent: (jobId) => ipcRenderer.invoke("log:getRecent", jobId),
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add electron/preload.mjs
git commit -m "feat(preload): expose ytdlp + extended fs APIs to renderer"
```

---

## Task 13: progressBar component supports sub-text

**Files:**
- Modify: `electron/renderer/components/progressBar.js`

- [ ] **Step 1: Replace contents**

```js
export function progressBar(percent, subText) {
  const p = Math.max(0, Math.min(100, Math.round(percent || 0)));
  const sub = subText
    ? `<pre class="progress-sub" style="margin:4px 0 0 0;font-size:12px;white-space:pre-wrap">${escape(subText)}</pre>`
    : "";
  return `<div class="progress" style="flex:1;max-width:240px"><div class="bar" style="width:${p}%"></div></div><span style="min-width:42px;text-align:right">${p}%</span>${sub}`;
}

function escape(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/renderer/components/progressBar.js
git commit -m "feat(progressBar): support sub-status text under bar"
```

---

## Task 14: `reorderableList.js` component

**Files:**
- Create: `electron/renderer/components/reorderableList.js`

- [ ] **Step 1: Write file**

```js
/**
 * Render an in-place reorderable, checkable list.
 * @param {HTMLElement} mountEl
 * @param {Array<{key:string,label:string,meta?:string,checked?:boolean}>} initialItems
 * @param {(items)=>void} onChange  — fires after every reorder/check toggle.
 * @returns {{ getItems(): Array }}
 */
export function mountReorderableList(mountEl, initialItems, onChange) {
  let items = initialItems.map((i) => ({ checked: true, ...i }));
  let dragKey = null;

  function render() {
    mountEl.innerHTML = items.map((it, i) => `
      <div class="rl-row" data-key="${it.key}" draggable="true" style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid #eee;cursor:move">
        <span class="rl-handle" style="user-select:none;color:#888">⋮⋮</span>
        <input type="checkbox" data-act="toggle" ${it.checked ? "checked" : ""}>
        <span style="flex:1">${escape(it.label)}</span>
        <span style="color:#888;font-size:12px">${escape(it.meta || "")}</span>
      </div>
    `).join("");
  }

  mountEl.addEventListener("change", (e) => {
    if (e.target.dataset.act === "toggle") {
      const row = e.target.closest(".rl-row");
      const k = row.dataset.key;
      const idx = items.findIndex((i) => i.key === k);
      if (idx >= 0) {
        items[idx].checked = e.target.checked;
        onChange?.(getItems());
      }
    }
  });

  mountEl.addEventListener("dragstart", (e) => {
    const row = e.target.closest(".rl-row");
    if (!row) return;
    dragKey = row.dataset.key;
    e.dataTransfer.effectAllowed = "move";
  });

  mountEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    const row = e.target.closest(".rl-row");
    if (!row || row.dataset.key === dragKey) return;
    const dropKey = row.dataset.key;
    const from = items.findIndex((i) => i.key === dragKey);
    const to = items.findIndex((i) => i.key === dropKey);
    if (from < 0 || to < 0) return;
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    render();
    onChange?.(getItems());
  });

  function getItems() { return items.slice(); }
  function escape(s) { return String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }

  render();
  return { getItems };
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/renderer/components/reorderableList.js
git commit -m "feat(renderer): add reorderable + checkable list component"
```

---

## Task 15: Sidebar — add 3 new nav items

**Files:**
- Modify: `electron/renderer/components/sidebar.js`

- [ ] **Step 1: Update NAV_ITEMS**

Replace the `NAV_ITEMS` constant:

```js
const NAV_ITEMS = [
  { group: "Tasks", items: [
    { id: "render",   icon: "🎬", label: "Render Video" },
    { id: "snow",     icon: "❄️", label: "Tạo video từ ảnh" },
    { id: "trim",     icon: "✂️", label: "Cắt video 30s" },
    { id: "cutBg",    icon: "🎞️", label: "Chia nhỏ video nền" },
    { id: "getUrls",  icon: "🔗", label: "Lấy link kênh" },
    { id: "download", icon: "⬇️", label: "Tải video" },
    { id: "concat",   icon: "🪡", label: "Nối video" },
  ]},
  { group: "Hệ thống", items: [
    { id: "queue",    icon: "📋", label: "Hàng đợi" },
    { id: "settings", icon: "⚙️", label: "Cài đặt" },
  ]},
];
```

- [ ] **Step 2: Commit**

```bash
git add electron/renderer/components/sidebar.js
git commit -m "feat(sidebar): add Get URLs, Download, Concat nav items"
```

---

## Task 16: `screens/getUrls.js` — form + viewer

**Files:**
- Create: `electron/renderer/screens/getUrls.js`

- [ ] **Step 1: Write file**

```js
import { toast } from "../components/toast.js";

export async function renderGetUrls(el) {
  const s = await window.api.settings.get();
  const ws = await window.api.app.getWorkspace();
  const handleLast = s.lastConfig?.getUrls?.handle ?? "";

  el.innerHTML = `
    <div class="screen-header">🔗 Lấy link kênh</div>
    <p class="screen-subtitle">Lấy danh sách video từ một YouTube channel theo handle.</p>
    <form id="task-form">
      <div class="field" data-path="handle" data-kind="text">
        <label>Handle YouTube</label>
        <input id="handle" type="text" name="handle" placeholder="@MrBeast" value="${escape(handleLast)}" required>
        <div class="help">Bắt buộc. Bắt đầu bằng @ hoặc tên handle thuần.</div>
      </div>
      <div class="field">
        <div class="help">ⓘ Min duration: <strong>${s.youtube.minDurationMinutes}</strong> phút · Sort: <strong>${s.youtube.sortOrder}</strong> (đổi trong Settings → YouTube)</div>
      </div>
      <button type="submit" class="primary">▶ Thêm vào hàng đợi</button>
    </form>
    <div id="viewer" style="margin-top:24px"></div>
  `;

  el.querySelector("#task-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    let handle = el.querySelector("#handle").value.trim();
    if (!handle) return;
    if (!handle.startsWith("@")) handle = "@" + handle;

    const config = {
      handle,
      apiKey: s.youtube.apiKey,
      minDurationMinutes: s.youtube.minDurationMinutes,
      sortOrder: s.youtube.sortOrder,
      workspace: ws,
    };
    await window.api.queue.add({ type: "getUrls", config });
    await window.api.settings.set({ "lastConfig.getUrls": { handle } });
    toast({ kind: "success", message: "✅ Đã thêm vào hàng đợi" });
  });

  // Subscribe to queue updates so we can render the viewer when our job finishes.
  window.api.queue.onUpdate(async (state) => {
    const last = state.completed.find((j) => j.type === "getUrls" && j.status === "done");
    if (!last) return;
    const infosPath = last.result?.outputs?.[1];
    if (!infosPath) return;
    const viewer = el.querySelector("#viewer");
    if (!viewer || viewer.dataset.jobId === last.id) return;
    viewer.dataset.jobId = last.id;
    const infos = await window.api.fs.readVideoInfos(infosPath);
    const urlsPath = last.result?.outputs?.[0];
    const folder = urlsPath?.replace(/[/\\][^/\\]+$/, "");
    viewer.innerHTML = `
      <h3>Kết quả (${infos.length} video)</h3>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button id="vw-open-folder">📂 Mở folder</button>
        <button id="vw-open-urls">📄 Mở file urls.txt</button>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="text-align:left;border-bottom:2px solid #ccc">
          <th>Title</th><th>Duration</th><th>Views</th><th>URL</th>
        </tr></thead>
        <tbody>${infos.map((i) => `<tr style="border-bottom:1px solid #eee">
          <td>${escape(i.title)}</td>
          <td>${escape(i.duration)}</td>
          <td>${escape(i.viewCount)}</td>
          <td><a href="${escape(i.url)}" target="_blank">${escape(i.url)}</a></td>
        </tr>`).join("")}</tbody>
      </table>
    `;
    viewer.querySelector("#vw-open-folder")?.addEventListener("click", () => folder && window.api.shell.openFolder(folder));
    viewer.querySelector("#vw-open-urls")?.addEventListener("click", () => urlsPath && window.api.shell.openFolder(urlsPath));
  });
}

function escape(s) {
  return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/renderer/screens/getUrls.js
git commit -m "feat(renderer): add Get URLs screen with in-app viewer"
```

---

## Task 17: `screens/download.js`

**Files:**
- Create: `electron/renderer/screens/download.js`

- [ ] **Step 1: Write file**

```js
import { toast } from "../components/toast.js";

export async function renderDownload(el) {
  const s = await window.api.settings.get();
  const ws = await window.api.app.getWorkspace();
  const last = s.lastConfig?.download ?? {};
  const lastUrlsFile = last.urlsFile ?? "";
  const lastOutput = last.output ?? `${ws}\\downloads`;
  const lastConcurrent = last.maxConcurrent ?? s.download.maxConcurrent;

  el.innerHTML = `
    <div class="screen-header">⬇️ Tải video</div>
    <p class="screen-subtitle">Đọc file URLs (.txt) và tải video bằng yt-dlp.</p>
    <form id="task-form">
      <div class="field">
        <label>📄 File URLs (.txt)</label>
        <div class="field-row">
          <input id="urls-file" type="text" name="urlsFile" value="${escape(lastUrlsFile)}" required>
          <button type="button" id="pick-urls">📂 Chọn…</button>
        </div>
        <div class="help">Mặc định: file Get URLs gần nhất.</div>
      </div>
      <div class="field">
        <label>📁 Folder output</label>
        <div class="field-row">
          <input id="output" type="text" name="output" value="${escape(lastOutput)}" required>
          <button type="button" id="pick-output">📂 Chọn…</button>
        </div>
      </div>
      <div class="field">
        <label>🔢 Số tải song song <span id="cc-val">${lastConcurrent}</span></label>
        <input id="concurrent" type="range" min="1" max="5" value="${lastConcurrent}">
        <div class="help">Default từ Settings · range 1–5.</div>
      </div>
      <button type="submit" class="primary">▶ Thêm vào hàng đợi</button>
    </form>
  `;

  const cc = el.querySelector("#concurrent");
  cc.addEventListener("input", () => { el.querySelector("#cc-val").textContent = cc.value; });

  el.querySelector("#pick-urls").addEventListener("click", async () => {
    const r = await window.api.dialog.pickFile({
      filters: [{ name: "URL list", extensions: ["txt"] }],
    });
    if (r) el.querySelector("#urls-file").value = r;
  });
  el.querySelector("#pick-output").addEventListener("click", async () => {
    const cur = el.querySelector("#output").value;
    const p = await window.api.dialog.pickFolder(cur);
    if (p) el.querySelector("#output").value = p;
  });

  el.querySelector("#task-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const urlsFile = el.querySelector("#urls-file").value.trim();
    const output = el.querySelector("#output").value.trim();
    const maxConcurrent = parseInt(cc.value, 10);
    if (!urlsFile || !output) return;

    const config = {
      urlsFile, output, maxConcurrent,
      ytdlpPath: s.download.ytdlpPath,
    };
    await window.api.queue.add({ type: "download", config });
    await window.api.settings.set({ "lastConfig.download": { urlsFile, output, maxConcurrent } });
    toast({ kind: "success", message: "✅ Đã thêm vào hàng đợi" });
  });
}

function escape(s) {
  return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/renderer/screens/download.js
git commit -m "feat(renderer): add Download screen"
```

---

## Task 18: `screens/concat.js` — 3-stage form

**Files:**
- Create: `electron/renderer/screens/concat.js`

- [ ] **Step 1: Write file**

```js
import { mountReorderableList } from "../components/reorderableList.js";
import { toast } from "../components/toast.js";

export async function renderConcat(el) {
  const s = await window.api.settings.get();
  const ws = await window.api.app.getWorkspace();
  const last = s.lastConfig?.concat ?? {};
  const lastFolder = last.folder ?? `${ws}\\done`;
  const lastName = last.outputName ?? "output";

  el.innerHTML = `
    <div class="screen-header">🪡 Nối video</div>
    <p class="screen-subtitle">Nối các .mp4 trong một folder thành một video duy nhất, giữ nguyên audio.</p>
    <form id="task-form">
      <div class="field">
        <label>📁 Folder input</label>
        <div class="field-row">
          <input id="folder" type="text" value="${escape(lastFolder)}" required>
          <button type="button" id="pick-folder">📂 Chọn…</button>
          <button type="button" id="reload">↻</button>
        </div>
      </div>

      <div class="field">
        <label>Danh sách video <span id="count">(0/0 chọn)</span></label>
        <div id="rl" style="border:1px solid #ccc;border-radius:4px;max-height:360px;overflow:auto"></div>
        <div class="help">Kéo ⋮⋮ để đổi thứ tự. Bỏ check để loại trừ.</div>
      </div>

      <div class="field">
        <label>📝 Tên file output</label>
        <div class="field-row">
          <input id="output-name" type="text" value="${escape(lastName)}" required>
          <span>.mp4</span>
        </div>
        <div class="help" id="output-preview"></div>
      </div>

      <button type="submit" class="primary" id="submit" disabled>▶ Thêm vào hàng đợi</button>
    </form>
  `;

  const folderInput = el.querySelector("#folder");
  const rlMount = el.querySelector("#rl");
  const countLabel = el.querySelector("#count");
  const submitBtn = el.querySelector("#submit");
  const outputNameInput = el.querySelector("#output-name");
  const outputPreview = el.querySelector("#output-preview");

  let rl = null;

  function refreshOutputPreview() {
    const folder = folderInput.value.trim();
    const name = outputNameInput.value.trim() || "output";
    outputPreview.textContent = `→ ${folder}\\${name}.mp4`;
  }

  function refreshSubmitState() {
    const items = rl?.getItems() ?? [];
    const checked = items.filter((i) => i.checked).length;
    countLabel.textContent = `(${checked}/${items.length} chọn)`;
    submitBtn.disabled = checked < 2;
  }

  async function reload() {
    const folder = folderInput.value.trim();
    if (!folder) return;
    const files = await window.api.fs.listMp4(folder);
    rl = mountReorderableList(rlMount, files.map((f) => ({
      key: f.fullPath,
      label: f.name,
      meta: `${(f.sizeBytes / (1024*1024)).toFixed(1)} MB · ${formatDur(f.durationSec)}`,
      checked: true,
    })), refreshSubmitState);
    refreshSubmitState();
    refreshOutputPreview();
  }

  el.querySelector("#pick-folder").addEventListener("click", async () => {
    const p = await window.api.dialog.pickFolder(folderInput.value);
    if (p) { folderInput.value = p; await reload(); }
  });
  el.querySelector("#reload").addEventListener("click", reload);
  outputNameInput.addEventListener("input", refreshOutputPreview);
  folderInput.addEventListener("change", refreshOutputPreview);

  el.querySelector("#task-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const folder = folderInput.value.trim();
    const items = rl.getItems().filter((i) => i.checked);
    if (items.length < 2) return;
    const name = outputNameInput.value.trim() || "output";
    const output = `${folder}\\${name}.mp4`;
    const exists = (await window.api.fs.exists(output)).exists;
    if (exists) {
      if (!confirm(`File ${output} đã tồn tại. Ghi đè?`)) return;
    }

    await window.api.queue.add({
      type: "concat",
      config: { inputs: items.map((i) => i.key), output },
    });
    await window.api.settings.set({ "lastConfig.concat": { folder, outputName: name } });
    toast({ kind: "success", message: "✅ Đã thêm vào hàng đợi" });
  });

  await reload();
}

function formatDur(sec) {
  if (!sec) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
function escape(s) {
  return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/renderer/screens/concat.js
git commit -m "feat(renderer): add Concat screen with reorderable file list"
```

---

## Task 19: Register screens in renderer/main.js

**Files:**
- Modify: `electron/renderer/main.js`

- [ ] **Step 1: Add imports + register**

Append the new imports near the existing screen imports:

```js
import { renderGetUrls } from "./screens/getUrls.js";
import { renderDownload } from "./screens/download.js";
import { renderConcat } from "./screens/concat.js";
```

Update the `screens` object:

```js
const screens = {
  render: renderRender, snow: renderSnow, trim: renderTrim, cutBg: renderCutBg,
  getUrls: renderGetUrls, download: renderDownload, concat: renderConcat,
  queue: renderQueue, settings: renderSettings,
};
```

Update `TASK_LABELS`:

```js
const TASK_LABELS = {
  render: "Render Video", snow: "Snow", trim: "Trim", cutBg: "Cut BG",
  getUrls: "Lấy link kênh", download: "Tải video", concat: "Nối video",
};
```

- [ ] **Step 2: Commit**

```bash
git add electron/renderer/main.js
git commit -m "feat(renderer): register Get URLs, Download, Concat screens"
```

---

## Task 20: Settings UI — YouTube + Download/yt-dlp groups

**Files:**
- Modify: `electron/renderer/screens/settings.js`

- [ ] **Step 1: Add new sections inside `renderSettings`**

Insert these blocks **before** the `<h3>Log</h3>` heading in the `el.innerHTML` template:

```html
    <h3>YouTube</h3>
    <div class="field">
      <label>API key</label>
      <div class="field-row">
        <input id="yt-key" type="password" value="${escape(s.youtube.apiKey)}">
        <button type="button" id="yt-key-show">👁</button>
      </div>
    </div>
    <div class="field">
      <label>Min duration (phút)</label>
      <input id="yt-min" type="number" min="0" value="${s.youtube.minDurationMinutes}">
    </div>
    <div class="field">
      <label>Sort order</label>
      <select id="yt-sort">
        ${["LATEST","VIEW","MIX"].map((v) => `<option value="${v}" ${v === s.youtube.sortOrder ? "selected" : ""}>${v}</option>`).join("")}
      </select>
    </div>

    <h3>Download / yt-dlp</h3>
    <div class="field">
      <label>yt-dlp path</label>
      <div class="field-row">
        <input id="yt-path" type="text" value="${escape(s.download.ytdlpPath)}">
        <button type="button" id="yt-path-pick">📂 Đổi…</button>
      </div>
    </div>
    <div class="field"><label><input id="yt-auto" type="checkbox" ${s.download.autoUpdateYtDlp ? "checked" : ""}> Tự cập nhật yt-dlp khi mở app</label></div>
    <div class="field">
      <label>Max parallel downloads <span id="dl-cc-val">${s.download.maxConcurrent}</span></label>
      <input id="dl-cc" type="range" min="1" max="5" value="${s.download.maxConcurrent}">
    </div>
    <div class="field">
      <label>yt-dlp status</label>
      <div id="yt-status" class="help">Đang kiểm tra...</div>
      <button type="button" id="yt-update">⬇️ Cập nhật ngay</button>
    </div>
```

Add the field bindings inside `renderSettings`, **before** the existing `#open-log` binding:

```js
  const elSet = (id, fn) => el.querySelector("#" + id)?.addEventListener("change", fn);
  elSet("yt-key", (e) => window.api.settings.set({ "youtube.apiKey": e.target.value }));
  elSet("yt-min", (e) => window.api.settings.set({ "youtube.minDurationMinutes": parseInt(e.target.value, 10) }));
  elSet("yt-sort", (e) => window.api.settings.set({ "youtube.sortOrder": e.target.value }));
  elSet("yt-path", (e) => window.api.settings.set({ "download.ytdlpPath": e.target.value }));
  elSet("yt-auto", (e) => window.api.settings.set({ "download.autoUpdateYtDlp": e.target.checked }));

  el.querySelector("#yt-key-show")?.addEventListener("click", () => {
    const i = el.querySelector("#yt-key");
    i.type = i.type === "password" ? "text" : "password";
  });
  el.querySelector("#yt-path-pick")?.addEventListener("click", async () => {
    const p = await window.api.dialog.pickFile({
      filters: [{ name: "yt-dlp", extensions: ["exe"] }],
    });
    if (p) {
      el.querySelector("#yt-path").value = p;
      await window.api.settings.set({ "download.ytdlpPath": p });
      refreshYtdlpStatus();
    }
  });
  const ccSlider = el.querySelector("#dl-cc");
  ccSlider?.addEventListener("input", () => {
    el.querySelector("#dl-cc-val").textContent = ccSlider.value;
    window.api.settings.set({ "download.maxConcurrent": parseInt(ccSlider.value, 10) });
  });
  el.querySelector("#yt-update")?.addEventListener("click", async () => {
    await window.api.ytdlp.update();
    setTimeout(refreshYtdlpStatus, 500);
  });

  async function refreshYtdlpStatus() {
    const st = await window.api.ytdlp.getStatus();
    const txt = st.exists
      ? `Đã cài (version ${st.version ?? "?"}, cập nhật ${st.lastModified?.toString().slice(0, 24) ?? "?"})`
      : `Chưa cài tại ${st.path}`;
    const node = el.querySelector("#yt-status");
    if (node) node.textContent = txt;
  }
  refreshYtdlpStatus();
```

Add `escape` helper at the bottom of the file (if not already present):

```js
function escape(s) {
  return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}
```

- [ ] **Step 2: Update reset handler defaults**

Inside the existing `#reset` listener `confirm(...)` block, add `youtube` and `download` to the patch:

```js
      youtube: {
        apiKey: "AIzaSyDZTsPGvG0u5du3t7YGueGgnNi7IiulMus",
        minDurationMinutes: 8,
        sortOrder: "VIEW",
      },
      download: {
        ytdlpPath: (await window.api.settings.get("download.ytdlpPath")),
        autoUpdateYtDlp: false,
        maxConcurrent: 3,
      },
```

- [ ] **Step 3: Commit**

```bash
git add electron/renderer/screens/settings.js
git commit -m "feat(settings-ui): add YouTube + Download/yt-dlp configuration groups"
```

---

## Task 21: Manual smoke test

**Files:** none — manual verification.

- [ ] **Step 1: Run the dev app**

```bash
npm run dev
```

- [ ] **Step 2: Verify each new screen mounts**

Click each sidebar item in turn. Expect no console errors. The forms render. yt-dlp status in Settings reads "Chưa cài".

- [ ] **Step 3: Get URLs end-to-end**

In **Lấy link kênh**, enter `@MrBeast` (or any real handle). Submit. Wait. Expect:
- Queue progress bar advances 5% → 90% → 100%.
- `<workspace>/channels/MrBeast/only_video_urls.txt` exists.
- Viewer table appears with rows.

- [ ] **Step 4: Download end-to-end**

In **Tải video**, file = the path from Step 3, output = `<workspace>/downloads/MrBeast`, concurrent = 1. Submit. Expect:
- Progress 0–5% during yt-dlp install (binary appears at the configured path).
- Progress climbs to 100%.
- `.mp4` and `.jpg` files appear in output folder, with sanitized filenames.

- [ ] **Step 5: Concat end-to-end**

In **Nối video**, folder = the download output. Verify the list shows mp4s with size + duration. Uncheck one, drag-reorder others. Submit. Expect output `.mp4` plays with audio.

- [ ] **Step 6: Cancel during Download**

Re-queue Download. Hit Cancel mid-job in Queue dock. Expect:
- yt-dlp child processes disappear from Task Manager.
- Job status = "cancelled".
- Partial files may remain in output (acceptable).

- [ ] **Step 7: Auto-update yt-dlp toggle**

Settings → enable "Tự cập nhật yt-dlp khi mở app". Restart app. Expect log line `yt-dlp.exe updated on startup` in `%APPDATA%\VidMaster\logs\main.log`.

- [ ] **Step 8: Run all unit tests**

```bash
npx vitest run
```

Expected: PASS — including pre-existing tests for render/snow/trim/cutBg.

- [ ] **Step 9: Commit any manual-test fixes**

If smoke testing reveals bugs, fix them with focused commits referencing the failing step.

---

## Self-Review

After implementation, run this checklist:

1. Spec coverage: Each spec section maps to one or more tasks above.
   - §1 Overview → Tasks 1, 5, 6, 8
   - §2 File layout → Task structure
   - §3 Settings → Task 1 (schema), Task 20 (UI)
   - §4 yt-dlp manager → Task 4 (lib), Task 10 (IPC), Task 11 (auto-update hook)
   - §5 Get URLs → Task 5 (module), Task 16 (screen)
   - §6 Download → Task 6 (module), Task 17 (screen)
   - §7 Concat → Task 8 (module), Task 14 (component), Task 18 (screen)
   - §8 IPC → Tasks 9, 10, 12
   - §9 Errors → covered inline (each module throws Vietnamese-summary errors; modal already exists)
   - §10 Testing → Tasks 2, 3, 4, 5, 6, 7, 8, 21
   - §11 Dependencies → no new npm deps; verified.
   - §12 Out of scope → no tasks needed.
2. Placeholder scan: no TBD/TODO/"add appropriate" present.
3. Type consistency: `runGetUrls` returns `{ ok, outputs, videos, errors }`; `runDownload`, `runConcat` return `{ ok, outputs, errors }` — all match QueueManager's expectations.
