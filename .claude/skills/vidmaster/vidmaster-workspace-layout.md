---
name: vidmaster-workspace-layout
description: Workspace folder layout, settings schema, and migration hook used by VidMaster — required subfolders, default paths per task, schema versioning.
---

# VidMaster workspace layout

## When to use

When changing the workspace folder layout, adding/removing a default subfolder, or evolving the settings schema (e.g., new fields, renames). Reference: `electron/workspace.js` and `electron/settings.js`.

## Process

### Workspace folders

The user's workspace is a single root directory containing the following subfolders. They are auto-created on workspace selection and on every app launch (idempotent).

| Subfolder | Used by |
|---|---|
| `overlays/` | Render (input) |
| `backgrounds/` | Render (input), CutBg (input + output) |
| `done/` | Render (output), Trim (output) |
| `input/` | Snow (input), Trim (input) |
| `output/` | Snow (output) |
| `chromaKey.txt` (file) | Render — per-overlay chroma colors (Line mode); auto-created with template if missing |

`REQUIRED_SUBFOLDERS` in `electron/workspace.js` is the source of truth for folders. The `chromaKey.txt` template is also written by `ensureWorkspace()` if the file doesn't already exist. To add a new subfolder, also update `defaultsForTask()`.

### Settings schema

`electron/settings.js > DEFAULTS` defines the schema. Layout:

```js
{
  version: 1,
  workspace: "",
  ffmpeg: { encoder: "auto", maxConcurrent: 2 },
  render: {
    useGPU: false,
    chromaKey: { color: "#D4F9D7", similarity: 0.2 },
    opacity: 0.7,
    crop: { height: 220, yOffset: 490 },
    keepColor: { enabled: false, list: ["#FBFF02"] },
  },
  ui: { theme: "light", logLevel: "info", completedHistorySize: 50 },
  lastUsedTask: "render",
  lastConfig: {},  // keyed by task type
}
```

### Schema migration

When changing the schema in a way that breaks compatibility:

1. Bump `SCHEMA_VERSION` in `electron/settings.js`.
2. Add a `migrate(old)` function that takes the previous schema and returns the new one.
3. In `createSettings()`, after loading: if `store.get("version") < SCHEMA_VERSION`, run `migrate` and write the result back.
4. Add a Vitest unit test that loads a v1 fixture and asserts the v2 result.

### Adding a per-task config field

1. Add the field to the relevant `runX(config)` signature in `src/<task>.js`. Update tests.
2. Add the default value to `electron/settings.js > DEFAULTS` if it's user-configurable.
3. Add a field row to the relevant `electron/renderer/screens/<task>.js` via the task form template.
4. (Optional) add to Settings screen if it's a global-default, not per-task.

## Examples

Add a `frameRate` config to Render:

1. `src/render.js`: read `config.frameRate`, default 30 inside the function.
2. `electron/settings.js`: add `render.frameRate: 30` under DEFAULTS, bump `SCHEMA_VERSION` to 2 since old configs lack it. Add a migration that fills it in.
3. `electron/renderer/screens/render.js`: add `{ type: "number", path: "frameRate", label: "FPS", min: 1 }` to the `advanced` array.
4. Run tests: settings test should still pass; render test should still pass; migration test (new) should pass.

## Pitfalls

- **Forgetting to update `REQUIRED_SUBFOLDERS`.** New subfolders won't be created; tasks using them fail with `ENOENT` for non-technical users.
- **Not bumping `version`.** Old config files mixed with new code cause subtle bugs (undefined fields, wrong defaults).
- **Migrating in-place.** Always return a new object, write back fully — don't mutate. Easier to test.
- **Putting per-job settings into the global schema.** If it's per-task config (`lastConfig.<type>`), keep it under `lastConfig`, not at the top level.
