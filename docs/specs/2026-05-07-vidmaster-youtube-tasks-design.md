# VidMaster â€” YouTube Tasks (Get URLs / Download / Concat) Design Spec

- **Date:** 2026-05-07
- **Status:** Draft (awaiting user approval)
- **Reference project:** `D:\Programming\projects\ytb` (C# .NET 8 CLI â€” pattern source)
- **Target project:** `d:\Programming\projects\vidmaster-desktop`
- **Scope:** Add 3 new tasks (Get URLs from channel, Download videos, Concat videos with audio) plus a yt-dlp binary manager service.

## 1. Overview & Goals

Port four pieces of functionality from the reference C# project into VidMaster:

1. **Get URLs from channel (ref `OptionEnum.GetVideoUrlsFromChannel = 1`)** â€” fetch all uploaded videos from a YouTube handle that meet a minimum duration, sort, write to `.txt` files, and display in-app.
2. **Download videos (ref `OptionEnum.DownloadVideo = 3`)** â€” read a URL list file, download each via `yt-dlp.exe` in parallel, with per-video progress.
3. **Auto-update yt-dlp (ref `OptionEnum.SwitchAutoUpdateYtDlp = 5`)** â€” Settings toggle (default **false**); when on, app refreshes `yt-dlp.exe` from GitHub on startup.
4. **Concat videos** â€” replace the previously-dropped concat task. New version preserves audio (uses FFmpeg `concat` filter with `[v][a]` mapping) and offers a preview list with drag-reorder + per-file checkbox.

Each new task plugs into the existing Queue Manager, IPC contract, and Settings store with no architectural changes. Progress bars are mandatory for all new tasks.

**Non-goals**
- yt-dlp cookies support (no `--cookies` flag, no cookie file picker).
- Per-video format/quality selection in the Download form.
- Download throttling / rate-limit configuration.
- Video-type filter (live, short, premiere). Only minimum duration is filtered.
- ETA or speed display in progress bars (only %).
- Multi-handle batch fetching in a single Get URLs run.

## 2. Architecture

### 2.1 New file layout

```
src/
â”œâ”€â”€ getUrls.js            # export runGetUrls(config)
â”œâ”€â”€ download.js           # export runDownload(config)
â”œâ”€â”€ concat.js             # export runConcat(config)
â””â”€â”€ _lib/
    â”œâ”€â”€ youtube.js        # YouTube Data API REST client (uses fetch)
    â””â”€â”€ ytdlp.js          # yt-dlp path resolver, ensureBinary, updateBinary

electron/
â”œâ”€â”€ ipc/
â”‚   â”œâ”€â”€ ytdlp.js          # IPC: getStatus, ensureBinary, update
â”‚   â””â”€â”€ fs.js             # IPC: listMp4, readUrlsFile, readVideoInfos
â””â”€â”€ renderer/
    â”œâ”€â”€ components/
    â”‚   â””â”€â”€ reorderableList.js   # drag/drop list (concat input)
    â””â”€â”€ screens/
        â”œâ”€â”€ getUrls.js
        â”œâ”€â”€ download.js
        â””â”€â”€ concat.js

tests/
â”œâ”€â”€ getUrls.test.js
â”œâ”€â”€ download.test.js
â”œâ”€â”€ concat.test.js
â””â”€â”€ _lib/
    â”œâ”€â”€ youtube.test.js
    â””â”€â”€ ytdlp.test.js
```

### 2.2 Module signature (uniform with existing 4 tasks)

```js
async function runX(config) {
  // config: { signal, onProgress, onLog, ...taskFields }
  // returns: { ok, outputs: string[], errors: [...] }
}
```

No changes to Queue Manager, runner.js, or IPC core. New tasks register through the same path as Render/Snow/Trim/CutBg.

### 2.3 Sidebar additions

Three new entries in the **Tasks** group, total 7:

- ðŸ”— Láº¥y link kÃªnh (Get URLs)
- â¬‡ï¸ Táº£i video (Download)
- ðŸª¡ Ná»‘i video (Concat)

Existing: Render, Snow, Trim, CutBg.

## 3. Settings additions

### 3.1 New keys

```jsonc
{
  "youtube": {
    "apiKey": "REDACTED_GOOGLE_API_KEY",
    "minDurationMinutes": 8,
    "sortOrder": "VIEW"           // "LATEST" | "VIEW" | "MIX"
  },
  "download": {
    "ytdlpPath": "<APPDATA>/VidMaster/bin/yt-dlp.exe",
    "autoUpdateYtDlp": false,
    "maxConcurrent": 3            // range 1â€“5
  }
}
```

`<APPDATA>` is resolved at runtime via `app.getPath('appData')`. The default is computed lazily; the stored value remains a literal path so user changes persist.

### 3.2 Settings UI additions

A new **YouTube** group in the Settings screen:

- **API key** (text input, masked-by-default with show/hide toggle).
- **Min duration (minutes)** (number, â‰¥ 0).
- **Sort order** (dropdown: LATEST / VIEW / MIX).

A new **Download / yt-dlp** group:

- **yt-dlp path** (read-only display + `[Äá»•iâ€¦]` file picker; default = computed path).
- **Auto-update yt-dlp on app start** (checkbox, default false).
- **Max parallel downloads** (slider 1â€“5, default 3).
- **yt-dlp status:** "ÄÃ£ cÃ i (version X.Y.Z, cáº­p nháº­t DD/MM)" / "ChÆ°a cÃ i" + button **[Cáº­p nháº­t ngay]**.

### 3.3 Migration

Bump `settings.version` from 1 â†’ 2. Migration adds new keys with defaults; no removals. Existing keys untouched.

## 4. yt-dlp manager (`src/_lib/ytdlp.js`)

### 4.1 Responsibilities

Single source of truth for yt-dlp binary lifecycle. Exposed as a plain module (no IPC dependency); IPC handlers in `electron/ipc/ytdlp.js` wrap it for the renderer.

### 4.2 API

```js
// Resolve absolute path from settings (or compute default).
getYtdlpPath(): string

// Probe: returns binary state without side-effects.
async getStatus(): Promise<{
  exists: boolean,
  path: string,
  version: string | null,        // null if not installed or `--version` failed
  lastModified: Date | null,
}>

// Download latest binary to settings path. Atomic: write to .tmp then rename.
// Re-runnable; overwrites existing file.
async ensureBinary({ signal, onProgress, onLog }): Promise<string>   // returns path

// Force-download regardless of existence (used by Settings "Cáº­p nháº­t ngay" button).
async updateBinary({ signal, onProgress, onLog }): Promise<string>
```

### 4.3 Download URL

`https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe` (matches ref project).

Implementation uses Node's built-in `fetch` (Node 20). Stream the response body to a temp file (`<path>.tmp`), report progress via `Content-Length` if present (else indeterminate spinner), then atomic rename to final path. Cleanup `.tmp` on abort.

### 4.4 Auto-update on startup

In `electron/main.js`, on `app.whenReady`:

```js
if (settings.get('download.autoUpdateYtDlp') && existsSync(getYtdlpPath())) {
  // background; do not block window creation
  ytdlp.updateBinary({ onLog: ... }).catch(log.warn);
}
```

If the binary does not exist yet, do **not** auto-fetch on startup â€” wait for the user's first Download task to trigger lazy install. Rationale: avoid surprise network use; first-time users see a clear "preparing yt-dlp" step inside their job.

### 4.5 Lazy bootstrap during Download

`runDownload` first call:

```js
const status = await ytdlp.getStatus();
if (!status.exists) {
  runner.log('info', 'yt-dlp.exe chÆ°a cÃ³, Ä‘ang táº£i...');
  await ytdlp.ensureBinary({ signal, onProgress: p => runner.setProgress(p * 0.05) });
  // boot phase consumes 0â€“5% of overall task progress
}
// then proceed to download URLs (5â€“100%)
```

## 5. Get URLs task

### 5.1 Module: `src/getUrls.js`

```js
export async function runGetUrls(config) {
  const {
    handle,                       // required: "@handlename" or "handlename"
    minDurationMinutes,           // from settings
    sortOrder,                    // from settings
    apiKey,                       // from settings
    workspace,                    // from settings (for output dir)
    signal, onProgress, onLog,
  } = config;
  // returns { ok, outputs: [urlsTxt, infosTxt], videos: [...], errors: [] }
}
```

### 5.2 Flow

1. Normalize handle: strip leading `@` for path, but pass back `@handle` to API as `forHandle`.
2. `GET https://www.googleapis.com/youtube/v3/channels?part=id,contentDetails&forHandle=@xxx&key=KEY` â†’ uploads playlist ID. Error on empty `items`.
3. Paginate `GET .../playlistItems?part=snippet&playlistId=...&maxResults=50&pageToken=...` until no `nextPageToken`. Collect video IDs.
4. For each chunk of 50 IDs: `GET .../videos?part=contentDetails,snippet,statistics&id=...`. Parse `contentDetails.duration` (ISO 8601, e.g. `PT15M30S`).
5. Filter by `duration > minDurationMinutes * 60` seconds.
6. Sort:
   - `LATEST` â†’ desc by `snippet.publishedAt`.
   - `VIEW` â†’ desc by `statistics.viewCount` (parse to number; missing = 0).
   - `MIX` â†’ shuffle (`Math.random()` based â€” fine for non-cryptographic use).
7. Write `<workspace>/channels/<handle-no-at>/only_video_urls.txt` (one URL per line, `https://www.youtube.com/watch?v=ID`).
8. Write `<workspace>/channels/<handle-no-at>/video_infos.txt` (tab-separated: `publishedAt\turl\tviewCount\ttitle\tduration`).

### 5.3 Form (renderer)

```
ðŸ”—  Láº¥y link kÃªnh
 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 Handle  [@handlename                  ]
   (Báº¯t buá»™c. VÃ­ dá»¥: @MrBeast)

 â“˜ Min duration: 8 phÃºt Â· Sort: VIEW (read-only)
   (Äá»•i trong Settings â†’ YouTube náº¿u cáº§n)

       [ â–¶  Thá»±c hiá»‡n ]
```

### 5.4 In-app viewer (post-run)

After job completes successfully, the Get URLs screen replaces the form area with a results table:

| Title | Duration | Views | URL |
|---|---|---|---|

- Read from the just-written `video_infos.txt` via `window.api.fs.readVideoInfos(path)`.
- Buttons: **[Má»Ÿ folder]**, **[Má»Ÿ file urls.txt]**, **[Quay láº¡i form]**.
- Persists in-memory only (closed when leaving screen).

### 5.5 Progress signal

Use `pageInfo.totalResults` from the **first** `playlistItems.list` response as the denominator. Each iteration fetches one playlist page **plus** one `videos.list` call for those IDs â€” count both as one logical "page".

```
total_pages   = ceil(totalResults / 50)   // captured from first response
pages_done   += 1                         // after each playlistItems + videos pair
fetch_progress = pages_done / total_pages // 0..1
```

Number of videos passing the duration filter is irrelevant to progress â€” every page counts equally because the API work is per-page, not per-kept-video.

Map: `0 â†’ 5%` start, fetching = `5â€“90%`, sort + write files = `90â€“100%`.

### 5.6 Cancel

Between pagination calls, check `signal.aborted` and bail out cleanly. Already-fetched data is discarded; no partial files written (write happens at end).

### 5.7 Errors (Vietnamese summary + raw)

- **403 quotaExceeded** â†’ "VÆ°á»£t quota YouTube API. Äá»•i key trong Settings hoáº·c Ä‘á»£i reset (00:00 UTC). [raw: 403 quotaExceeded]"
- **404 channel not found** / empty `items` â†’ "KhÃ´ng tÃ¬m tháº¥y channel cho handle: @xxx"
- **400 invalid handle** â†’ "Handle khÃ´ng há»£p lá»‡. Pháº£i báº¯t Ä‘áº§u báº±ng @ hoáº·c tÃªn handle thuáº§n."
- **Network timeout** â†’ "Lá»—i máº¡ng khi gá»i YouTube API. [raw error preserved]"

## 6. Download task

### 6.1 Module: `src/download.js`

```js
export async function runDownload(config) {
  const {
    urlsFile,                 // path to .txt file
    output,                   // folder
    maxConcurrent,            // override of settings; default = settings value
    signal, onProgress, onLog,
  } = config;
  // returns { ok, outputs: string[], errors: [...] }
}
```

### 6.2 Flow

1. **Pre-flight**: `ytdlp.ensureBinary({ onProgress: p => setProgress(p * 0.05) })`. Bootstrap consumes 0â€“5%.
2. Read URL file lines, trim, drop empties â†’ `urls[]`.
3. `mkdirSync(output, { recursive: true })`.
4. `pLimit(maxConcurrent)` â†’ for each URL, schedule a `downloadOne(url)` task.
5. `downloadOne(url)`:
   ```
   yt-dlp.exe
     -f "bestvideo+bestaudio/best"
     --merge-output-format mp4
     -o "<output>\%(title)s.%(ext)s"
     --write-thumbnail --convert-thumbnails jpg
     --no-overwrites
     --download-archive "<output>\downloaded.txt"
     <url>
   ```
   - Spawn via `child_process.spawn`, stdio = pipe.
   - Track child for cancel (collect in a `Set<ChildProcess>`).
   - Parse stderr **and** stdout line-by-line for `[download]   X.X% of ...` to extract per-URL `%`.
   - On exit code 0 â†’ success; otherwise error with stderr tail.
6. After `Promise.allSettled` of all URLs:
   - Sanitize output filenames (port `SanitizeFileName` from ref): replace invalid chars with `_`, trim trailing `.` / spaces, replace `â€¦`/`ï¼Ÿ`, escape Windows reserved names (`CON`, `PRN`, `AUX`, â€¦, `COM1`, `LPT1` etc).
   - Apply same sanitization to thumbnail `.jpg` files.

### 6.3 Form (renderer)

```
â¬‡ï¸  Táº£i video
 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 ðŸ“„ File URLs           [ðŸ“‚ â€¦\only_video_urls.txt]
   (Default: file Get URLs gáº§n nháº¥t; cÃ³ thá»ƒ chá»n file khÃ¡c)

 ðŸ“ Folder output       [ðŸ“‚ â€¦\downloads\<handle>]

 ðŸ”¢ Sá»‘ táº£i song song    [â”€â”€â”€â”€â—â”€] 3
   (Default tá»« Settings Â· range 1â€“5)

       [ â–¶  Thá»±c hiá»‡n ]
```

The "default = most recent" logic: store `lastConfig.getUrls.outputUrlsFile` after each Get URLs run; pre-fill on Download form open.

### 6.4 Progress (hybrid per Q8)

- **Main bar**: `5 + (completed_count / total) * 95` (after bootstrap phase).
- **Sub-status text**: rendered under bar by Download screen, listing each in-flight URL with its parsed `%`. E.g.:
  ```
  Äang táº£i:
    â€¢ Title-1.mp4              45%
    â€¢ Title-2.mp4              70%
    â€¢ Title-3.mp4              12%
  ```
- The Queue Manager remains agnostic; the renderer concat-bar component reads `progress.message` (existing field) which `runDownload` formats as a multi-line string.

### 6.5 Cancel

```js
signal.addEventListener('abort', () => {
  for (const child of liveChildren) child.kill('SIGTERM');
});
```

`p-limit` queue is drained on rejection; outstanding URLs become `cancelled` errors. Already-downloaded files remain (matches CutBg/Render cancel behavior in spec Â§4.3).

### 6.6 Partial success

Per-URL errors collected into `result.errors[]` with `{ url, message, stderrTail }`. Task returns `ok: errors.length === 0` but does not throw â€” the queue records the job as "done with errors", not "error".

## 7. Concat task

### 7.1 Module: `src/concat.js`

```js
export async function runConcat(config) {
  const {
    inputs,                   // string[] of absolute .mp4 paths in order
    output,                   // absolute .mp4 path
    signal, onProgress, onLog,
  } = config;
  // returns { ok, outputs: [output], errors: [] }
}
```

The renderer handles the "folder + checkboxes + reorder" UX and submits the final ordered `inputs` array to the queue. The module itself only deals with a flat array.

### 7.2 Flow

1. Validate: â‰¥ 2 inputs, all exist, output writable.
2. **Probe audio per input**: `ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of csv=p=0` â†’ empty if no audio.
3. **Probe duration per input** to compute total for progress denominator.
4. Build `filter_complex`:
   - **All-audio path**:
     ```
     [0:v:0][0:a:0][1:v:0][1:a:0]â€¦concat=n=N:v=1:a=1[v][a]
     ```
   - **Mixed (any input lacks audio)**:
     ```
     [0:v:0][1:v:0]â€¦concat=n=N:v=1:a=0[v];
     anullsrc=channel_layout=stereo:sample_rate=44100,
     atrim=duration=<TOTAL>,asetpts=PTS-STARTPTS[a]
     ```
   This matches ref `RenderService.ConcatVideosAsync` logic.
5. Run FFmpeg:
   ```
   -y <-i for each input>
   -filter_complex "..."
   -map "[v]" -map "[a]"
   -c:v libx264 -preset ultrafast -crf 23 -pix_fmt yuv420p
   -c:a aac -ar 44100 -ac 2
   -movflags +faststart
   <output>
   ```
6. Parse stderr `time=HH:MM:SS.ms` â†’ `progress = time / total_duration`.

### 7.3 Form (renderer) â€” 3 stages

```
ðŸª¡  Ná»‘i video
 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 [Stage 1] ðŸ“ Folder input   [ðŸ“‚ â€¦\done]

 [Stage 2] Danh sÃ¡ch video (3/5 chá»n)
   â˜‘ â‹®â‹® video01.mp4   12.3 MB Â· 00:30
   â˜‘ â‹®â‹® video02.mp4    9.8 MB Â· 00:25
   â˜ â‹®â‹® video03.mp4   15.1 MB Â· 00:35
   â˜‘ â‹®â‹® video04.mp4   11.0 MB Â· 00:28
   â˜ â‹®â‹® video05.mp4    8.2 MB Â· 00:20
   â†³ KÃ©o â‹®â‹® Ä‘á»ƒ Ä‘á»•i thá»© tá»±. Bá» check Ä‘á»ƒ loáº¡i trá»«.

 [Stage 3] ðŸ“ TÃªn file output  [output         ].mp4
   â†’ sáº½ ghi vÃ o: â€¦\done\output.mp4

       [ â–¶  Thá»±c hiá»‡n ]
```

- `reorderableList.js` is a small drag/drop component (HTML5 `dragstart/dragover/drop` events; no library).
- "Äá»•i folder" re-loads the list; selections reset.
- Output path = `<inputFolder>/<filename>.mp4`. If file exists, prompt "Ghi Ä‘Ã¨?" before queueing.
- Submit button disabled if `< 2` items checked.

### 7.4 Progress

Single FFmpeg invocation; standard `time=` parsing against total input duration sum.

### 7.5 Cancel

Standard `signal.aborted` â†’ `kill('SIGTERM')`. Output `.mp4` left as-is (probably truncated/invalid; user is told in cancel notice).

## 8. IPC contract additions

```js
window.api.ytdlp = {
  getStatus(),                 // â†’ { exists, path, version, lastModified }
  update(),                    // triggers Queue-tracked update job; resolves on finish
}

window.api.fs = {
  listMp4(folder),             // â†’ [{ name, fullPath, sizeBytes, durationSec }]
  readUrlsFile(path),          // â†’ string[] of URLs
  readVideoInfos(path),        // â†’ [{ publishedAt, url, viewCount, title, duration }]
}
```

`fs.listMp4` runs `ffprobe` per file for duration; throttle parallel probes to 4 to keep responsive.

`window.api.queue.add` accepts the new `type` values: `"getUrls"`, `"download"`, `"concat"`. Queue Manager dispatch table extended in `electron/queue.js`.

## 9. Error handling

Follows existing Section 3.8 of the master spec (error modal with VN summary + raw stack + paths). Specifics for new tasks:

| Scenario | Vietnamese summary | Raw detail preserved |
|---|---|---|
| YouTube API key invalid | "API key khÃ´ng há»£p lá»‡. Kiá»ƒm tra Settings â†’ YouTube." | HTTP body |
| YouTube quota exceeded | "VÆ°á»£t quota YouTube API." | `403 quotaExceeded` |
| Channel not found | "KhÃ´ng tÃ¬m tháº¥y channel cho handle: @xxx" | API response |
| yt-dlp download fail | "KhÃ´ng táº£i Ä‘Æ°á»£c yt-dlp.exe. Kiá»ƒm tra máº¡ng." | HTTP error / disk error |
| yt-dlp exit non-zero | "Táº£i video tháº¥t báº¡i: <url>" | last 20 lines of stderr |
| Concat input missing | "File khÃ´ng tá»“n táº¡i: <path>" | path |
| Concat codec error | "FFmpeg lá»—i khi ná»‘i video." | full stderr |

Per memory feedback: end-user messages in Vietnamese, but raw error codes/stderr stay inline.

## 10. Testing

### 10.1 Unit tests (Vitest)

| File | Coverage |
|---|---|
| `tests/_lib/ytdlp.test.js` | path resolution, mock fetch returning bytes â†’ ensureBinary writes + renames .tmp; abort mid-download cleans up |
| `tests/_lib/youtube.test.js` | URL builder, pagination loop with mocked fetch, ISO 8601 duration parser, sort variants |
| `tests/getUrls.test.js` | mock `_lib/youtube`, verify file outputs match ref format byte-for-byte |
| `tests/download.test.js` | mock `child_process.spawn` to emit canned `[download]` lines, verify p-limit â‰¤ maxConcurrent, cancel kills children, sanitization |
| `tests/concat.test.js` | real ffmpeg + 2 fixture videos (with audio) + 1 silent fixture; verify output exists, has audio stream, duration â‰ˆ sum |

### 10.2 Fixture additions

`tests/fixtures/`:
- `tiny-with-audio.mp4` (~0.5 MB, 2 sec, 25 fps + tone)
- `tiny-silent.mp4` (~0.4 MB, 2 sec, no audio stream)
- `urls-sample.txt` (3 lines)
- `video-infos-sample.txt` (3 lines)

Generate via `tests/fixtures/generate.js` (existing pattern).

### 10.3 Manual smoke checklist additions

Append to existing pre-release checklist:
- [ ] Get URLs runs against a real handle, writes both files, viewer renders.
- [ ] Download runs against a 3-URL list, all 3 files appear, names sanitized.
- [ ] yt-dlp auto-update toggle ON â†’ next launch updates binary in background.
- [ ] Concat with 5 mixed-codec inputs â†’ output plays with audio.
- [ ] Cancel during Download kills all yt-dlp children (Task Manager check).

## 11. Dependencies

**Added:**
- `p-limit` â€” already in `package.json`. Reused.

No other new npm deps. YouTube REST uses Node 20 built-in `fetch`. yt-dlp download uses built-in `fetch` + `fs.createWriteStream`.

## 12. Out of scope / future work

- Cookies / authenticated download (yt-dlp `--cookies`).
- Per-video quality selector.
- Download queue resume across app restarts.
- Multi-handle batch in one Get URLs run.
- ETA / speed indicators (only % per Q9 decision).

### 12.1 Cross-task pre-fill (in scope)

After a successful `runGetUrls`, the renderer writes the produced `only_video_urls.txt` path to `lastConfig.download.urlsFile` via the existing `electron-store` `lastConfig.<task>` mechanism (master spec Â§3.4). The Download form pre-fills from there on next open. Persists across app restarts. No new schema needed.
