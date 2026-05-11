# VidMaster — Thumbnail × Avatar Composite + Settings Tabs Design Spec

- **Date:** 2026-05-07
- **Status:** Draft (awaiting user approval)
- **Branch base:** master @ `be0dfd8`
- **Target project:** `d:\Programming\projects\vidmaster-desktop`
- **Scope:** Add 7th task `thumbAvatar` (overlay channel avatar onto thumbnails, n × m output) + refactor Settings screen from single-page to tabbed UI.

## 1. Overview & Goals

Two related changes shipped together (touch the Settings screen):

1. **`thumbAvatar` task** — overlay each avatar (m images) onto each thumbnail (n images), output n × m result images grouped by avatar (m folders, n files each). Avatars are auto-circular-cropped and resized to a configurable size (default 80×80 px) before compositing.
2. **Settings UI tabs** — replace the existing single-page Settings layout with a horizontal tab bar (one tab per group). The new "Avatar" tab is added in this same change. No schema changes for existing groups beyond the additive avatar/ui keys.

**Goals**

1. Run an `n × m` batch with progress tracking; cancel cleanly mid-run.
2. Output organized so each output folder maps 1:1 to an avatar (use case: 1 channel = 1 avatar = 1 folder of finished thumbnails).
3. Settings becomes scannable as the number of groups continues to grow (currently 8 sections; will be 9 with Avatar).

**Non-goals**

- Avatar borders / glow / drop shadow.
- One thumbnail × all 4 corners + center in a single run (5× output) — out of scope.
- Resizing the source thumbnail. The thumbnail dimensions are preserved; only the avatar is resized.
- Configurable per-task position default in lastConfig (we use a single `avatar.lastPosition` global).

## 2. Architecture

### 2.1 Files

```
src/
├── thumbAvatar.js        # NEW — export runThumbAvatar(config)
└── _lib/
    └── circleCrop.js     # NEW — sharp helper: resize square + alpha-circle mask

electron/renderer/
├── components/
│   └── tabs.js           # NEW — minimal horizontal tab strip
├── screens/
│   ├── thumbAvatar.js    # NEW — task form with 5 position radios
│   └── settings.js       # MODIFY — refactor body into tabs

electron/
├── ipc/queue.js          # MODIFY — register thumbAvatar runner
├── settings.js           # MODIFY — bump SCHEMA_VERSION 4 → 5; add `avatar.{size,margin,lastPosition}` + ui.lastSettingsTab; v4→v5 migration
└── renderer/
    ├── components/sidebar.js  # MODIFY — add 7th nav item
    └── main.js                # MODIFY — register screen + label

tests/
├── thumbAvatar.test.js   # NEW
└── _lib/
    └── circleCrop.test.js # NEW
```

### 2.2 Module signature

`runThumbAvatar(config) → { ok, outputs, errors }` matches the existing 6 task modules. Receives `signal`, `onProgress`, `onLog` per `TaskRunner` contract.

```js
runThumbAvatar({
  thumbDir,       // folder of .jpg thumbnails (input A)
  avatarDir,      // folder of .jpg/.png avatars (input B)
  output,         // root output folder
  position,       // "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center"
  size,           // px (from settings; default 80)
  margin,         // px (from settings; default 16)
  signal, onProgress, onLog,
})
```

## 3. `thumbAvatar` task — flow

### 3.1 Input enumeration

- Thumbnails: `fs.readdirSync(thumbDir).filter(/\.jpe?g$/i).sort()` → array of n absolute paths.
- Avatars: `fs.readdirSync(avatarDir).filter(/\.(jpe?g|png)$/i).sort()` → array of m absolute paths.
- Reject task with clear Vietnamese error if either folder is missing or empty.

### 3.2 Avatar pre-processing (once per avatar)

For each avatar j, build an in-memory Buffer of the round, resized avatar:

```js
// _lib/circleCrop.js
const mask = Buffer.from(
  `<svg width="${size}" height="${size}">
     <circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="white"/>
   </svg>`
);
return sharp(srcPath)
  .resize(size, size, { fit: "cover" })
  .composite([{ input: mask, blend: "dest-in" }])  // alpha mask
  .png()                                           // preserve alpha
  .toBuffer();
```

The result is a PNG buffer with circular alpha. `dest-in` blend keeps source pixels only where mask is opaque.

### 3.3 Composite onto each thumbnail

For each (avatar j, thumbnail i):

1. `sharp(thumbPath).metadata()` → `{ width: W, height: H }`.
2. Compute `(left, top)` from `position`:
   - `top-left`     → `(margin, margin)`
   - `top-right`    → `(W - size - margin, margin)`
   - `bottom-left`  → `(margin, H - size - margin)`
   - `bottom-right` → `(W - size - margin, H - size - margin)`
   - `center`       → `(round((W - size) / 2), round((H - size) / 2))`
3. `sharp(thumbPath).composite([{ input: avatarBuffer, left, top }]).jpeg({ quality: 90 }).toFile(outPath)`.

### 3.4 Output naming + folder structure

```
<output>/
├── <avatarBaseName_1>/
│   ├── <thumbName_1>.jpg
│   ├── <thumbName_2>.jpg
│   └── ... (n files)
├── <avatarBaseName_2>/
│   └── ... (n files)
└── ... (m folders)
```

- `avatarBaseName` = avatar filename without extension. Sanitized via existing `_lib/sanitize.js` to handle Windows-invalid chars.
- `thumbName` = thumbnail filename without extension, also sanitized.
- Output folder created with `fs.mkdirSync(... , { recursive: true })`.
- If output file already exists, **overwrite** (no prompt — batch jobs need to re-run without UI interaction).

### 3.5 Edge cases

- **Avatar larger than thumbnail**: validate `size + 2*margin <= min(W, H)` per thumbnail. If avatar wouldn't fit, skip the (i, j) pair, log a warning, and add to `result.errors`. Other pairs continue.
- **Thumbnail with EXIF rotation**: `sharp().rotate()` (auto-orient) before getting metadata. Keeps positioning correct on photos with portrait EXIF flag.
- **Avatar with transparency already**: `composite` with `dest-in` still produces correct result.
- **0 thumbnails or 0 avatars**: error early with "Folder không có thumbnail / avatar".

### 3.6 Progress

Total operations = `n × m` composites + `m` avatar pre-processings. We weight pre-processing as 5% total, composites as 95%.

- After each avatar pre-process: `progress = (j / m) * 5`.
- After each composite: `progress = 5 + ((j-1)*n + i) / (n*m) * 95`.

Throttling per existing `TaskRunner` (default 500 ms).

### 3.7 Cancel

`signal.aborted` checked between avatars and between composites. No child process to kill (sharp is sync inside Node). The current operation completes; subsequent pairs are skipped; `runner.checkAborted()` throws `AbortError`.

## 4. Form (renderer)

### 4.1 Sidebar (current state on master + new item)

Existing 6 task items on master:
- 🤩 Render Video
- 😋 Chia nhỏ video nền (cutBg)
- 😘 Cắt đầu/cuối (trimEnds)
- 😍 Nối đầu/cuối (concatHeadTail)
- 😅 Lấy link kênh (getUrls)
- 🤣 Tải video (download)

Add as 7th item:
- 😂 Gắn avatar vào thumbnail (thumbAvatar)

### 4.2 Form

```
😂  Gắn avatar vào thumbnail
 ──────────────────────────────────────
 📁 Folder thumbnail (.jpg)   [📂 …\thumbs ]
 📁 Folder avatar (.jpg/.png) [📂 …\avatars]
 📁 Folder output             [📂 …\output ]

 📍 Vị trí avatar
   ( ) Trên trái   ( ) Trên phải
   ( ) Dưới trái   (•) Dưới phải
   ( ) Giữa

 ⓘ Avatar size: 80×80 px (đổi trong Settings → Avatar)

       [ ▶  Thực hiện ]
```

- Default `position` = `avatar.lastPosition` from settings (default `"bottom-right"`).
- On submit, persist to `lastConfig.thumbAvatar` (folders) and `avatar.lastPosition` (5-way choice — single global, not per-task).

## 5. Settings UI refactor — single-page → tabs

### 5.1 Current state on master (single-page sections)

Sections in order on master `electron/renderer/screens/settings.js`:

1. Workspace
2. Identifier (Mã định danh — folded into Workspace tab in the new layout, since they're related metadata)
3. FFmpeg
4. Render defaults
5. YouTube
6. Download / yt-dlp
7. Telegram (with hidden group/tracking IDs unlocked by Ctrl+Q)
8. Log
9. About (version + Reset settings + Reset all)

### 5.2 New layout (9 tabs, including new "Avatar")

Tab strip top-to-bottom, click switches body content:

```
[Workspace] [FFmpeg] [Render] [YouTube] [Download] [Telegram] [Avatar] [Log] [About]
─────────────────────────────────────────────────────────────────────────────────
(active tab body)
```

Tab order chosen by frequency of use: Workspace first (always-needed), task-related groups middle, infra (Telegram, Log, About) at end.

### 5.3 Component: `electron/renderer/components/tabs.js`

```js
mountTabs(el, [
  { id: "workspace", label: "Workspace", render: (containerEl) => { ... } },
  { id: "ffmpeg",    label: "FFmpeg",    render: ... },
  { id: "render",    label: "Render",    render: ... },
  { id: "youtube",   label: "YouTube",   render: ... },
  { id: "download",  label: "Download",  render: ... },
  { id: "telegram",  label: "Telegram",  render: ... },
  { id: "avatar",    label: "Avatar",    render: ... },     // NEW
  { id: "log",       label: "Log",       render: ... },
  { id: "about",     label: "About",     render: ... },
], { activeId, onChange })
```

- Renders one tab strip on top, one body container below.
- Click a tab → calls the active tab's `render(containerEl)` (clearing the previous).
- Active tab id stored in `settings.ui.lastSettingsTab` and restored on next open.

### 5.4 Existing handlers preserved

The Settings screen breaks the existing inline DOM construction into 9 small render functions (one per tab). Each function uses the same `window.api.settings.set(...)` calls — no behavior changes, only layout. Existing dynamic features keep working:

- `Ctrl+Q` toggle for hidden Telegram fields → moved into the Telegram tab's render fn (only attached when Telegram tab is active).
- `yt-dlp` status auto-refresh → triggered when Download tab activates.
- Reset / Reset-all buttons → live on the About tab.

### 5.5 Workspace tab content

Keeps both Workspace path (with Đổi… button) and Identifier text input together — they're both "this machine's identity" metadata.

### 5.6 New Avatar tab content

```
Avatar size (px):       [  80  ]   (range 16–512)
Margin từ mép (px):     [  16  ]   (range 0–256)
```

Both bind to `avatar.size` and `avatar.margin` settings paths.

## 6. Settings schema additions (v4 → v5)

### 6.1 New keys

```jsonc
{
  "avatar": {
    "size": 80,
    "margin": 16,
    "lastPosition": "bottom-right"
  },
  "ui": {
    "theme": "light",
    "logLevel": "info",
    "completedHistorySize": 50,
    "lastSettingsTab": "workspace"   // NEW
  }
}
```

### 6.2 Migration v4 → v5

`SCHEMA_VERSION` constant in `electron/settings.js` bumps from `4` to `5`. The existing `migrate(store)` function gains a fourth sequential branch; existing branches stay put:

```js
function migrate(store) {
  const v = store.get("version") ?? 1;
  if (v >= SCHEMA_VERSION) return;
  if (v < 2) { /* existing: youtube + download */ }
  if (v < 3) { /* existing: telegram */ }
  if (v < 4) { /* existing: tracking */ }
  if (v < 5) {
    store.set("avatar", {
      size: store.get("avatar.size") ?? 80,
      margin: store.get("avatar.margin") ?? 16,
      lastPosition: store.get("avatar.lastPosition") ?? "bottom-right",
    });
    store.set("ui.lastSettingsTab", store.get("ui.lastSettingsTab") ?? "workspace");
  }
  store.set("version", SCHEMA_VERSION);
}
```

`buildDefaults()` adds the `avatar` block and the new `ui.lastSettingsTab` field. `resetAll()` (existing in master) doesn't need changes — `clear()` + `migrate()` reapplies all defaults including the new ones.

## 7. IPC contract

No new IPC handlers. The task uses the existing `queue:add({ type: "thumbAvatar", config })` shape. Settings access uses existing `settings:get/set`.

## 8. Errors

| Scenario | Vietnamese summary | Raw detail |
|---|---|---|
| `thumbDir` missing | "Folder thumbnail không tồn tại." | path |
| `avatarDir` missing | "Folder avatar không tồn tại." | path |
| 0 thumbnails | "Folder không có file .jpg." | folder path |
| 0 avatars | "Folder không có file .jpg/.png." | folder path |
| avatar > thumbnail dimensions | (per-pair) "Avatar quá lớn so với thumbnail X" | dimensions |
| sharp processing error | (per-pair) "Lỗi xử lý ảnh: \<file\>" | sharp error message |

Per-pair errors do not abort the task — they accumulate in `result.errors`. `ok` is `false` if any pair failed.

## 9. Tests

### 9.1 Unit (Vitest)

| File | Coverage |
|---|---|
| `tests/_lib/circleCrop.test.js` | helper produces 80×80 PNG with alpha=0 at corners (verify pixels) and full alpha at center |
| `tests/thumbAvatar.test.js` | (a) 2 thumbs × 2 avatars → 4 output files in 2 folders; (b) all 5 positions place avatar correctly (probe alpha at expected coords); (c) abort signal stops mid-run; (d) avatar-too-large skips pair, returns error in `errors[]`; (e) overwrite existing output |

### 9.2 Fixtures

Reuse existing `tests/fixtures/tiny.png` (320×180) for thumbnails. Add small avatars via `tests/fixtures/generate.js`:

```js
// tiny-avatar-square.png — 100×100 solid red
// tiny-avatar-square.jpg — 100×100 solid blue
```

(Two avatars to exercise the m=2 branch.)

### 9.3 Settings tabs

Light DOM-shape test in `tests/electron/settings.test.js` for the new schema. Tab interaction is renderer-only and covered by manual smoke.

## 10. Manual smoke checklist

- [ ] Settings opens on the last-selected tab; clicking each tab swaps body without errors.
- [ ] Avatar tab shows size=80, margin=16; changing values persists across app restart.
- [ ] `thumbAvatar` task with 2 thumbnails + 3 avatars → 6 output files in 3 folders, each named `<thumb>.jpg`.
- [ ] All 5 positions visually correct on a 1280×720 thumbnail.
- [ ] Cancel mid-run leaves partial output; status = "cancelled".
- [ ] Avatar PNG with transparency: round result is preserved, no halo.
- [ ] Telegram tab's Ctrl+Q reveal still works (regression check after refactor).

## 11. Out of scope / future

- Per-task position default (using global `avatar.lastPosition` instead).
- Border / glow / drop shadow on avatar.
- Multi-position output (4 corners + center in 1 run).
- Configurable JPEG quality (hardcoded 90).
- Preview pane in form before queuing.

## 12. Branch / merge note

Implementation happens on a fresh worktree branched from current master `be0dfd8` (branch `worktree-feat-thumb-avatar`). No mixing with the YouTube PR (already merged as `1ffa6a1`). Per user's standing instruction: no auto-commit during implementation — final commit + push only on explicit request.
