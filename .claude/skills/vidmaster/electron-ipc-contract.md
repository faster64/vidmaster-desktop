---
name: electron-ipc-contract
description: contextBridge IPC pattern — namespaced window.api, Promise-returning invoke handlers, push events with subscribe/unsubscribe, security defaults.
---

# Electron IPC contract

## When to use

When designing or extending the renderer↔main communication surface in an Electron app with `contextIsolation: true` and `nodeIntegration: false` (the secure defaults).

## Process

1. **Single namespace:** expose one object as `window.api`. Group calls into sub-namespaces (`api.queue`, `api.settings`, `api.dialog`, …). Never expose `ipcRenderer` directly.

2. **Two patterns only:**
   - **invoke/handle** for request/response: `ipcRenderer.invoke("foo:bar", arg) → Promise<result>` paired with `ipcMain.handle("foo:bar", (_, arg) => result)`.
   - **on/send** for push events: `webContents.send("foo:update", state)` from main, captured by a single `ipcRenderer.on(...)` in preload that fans out to subscribers.

3. **Subscribe/unsubscribe pattern for push events:**

   ```js
   const subs = new Set();
   ipcRenderer.on("queue:update", (_, s) => subs.forEach((cb) => cb(s)));
   contextBridge.exposeInMainWorld("api", {
     queue: {
       onUpdate: (cb) => { subs.add(cb); return () => subs.delete(cb); },
     },
   });
   ```
   The returned function is the unsubscribe handle — store it and call on screen unmount.

4. **Channel naming:** `<namespace>:<verb>`. Verbs: `get`, `set`, `add`, `cancel`, `clear`, `pickFolder`, `openFolder`, etc. Stay imperative; avoid `do-foo` prefixes.

5. **Security defaults (non-negotiable):**
   - `contextIsolation: true`
   - `nodeIntegration: false`
   - `sandbox: false` only because preload uses Node modules; never pair with `nodeIntegration: true`.
   - CSP `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';">` in `index.html`.

6. **Schema discipline:** the renderer never trusts main-process data, but main never trusts renderer args either. Validate inputs in `ipcMain.handle`.

## Examples

```js
// preload.js
contextBridge.exposeInMainWorld("api", {
  queue: {
    add: (spec) => ipcRenderer.invoke("queue:add", spec),
    onUpdate: (cb) => { subs.add(cb); return () => subs.delete(cb); },
  },
  dialog: {
    pickFolder: (defaultPath) => ipcRenderer.invoke("dialog:pickFolder", defaultPath),
  },
});

// main (handler)
ipcMain.handle("dialog:pickFolder", async (_, defaultPath) => {
  const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
    properties: ["openDirectory", "createDirectory"],
    defaultPath,
  });
  return r.canceled ? null : r.filePaths[0];
});
```

## Pitfalls

- **Exposing `ipcRenderer` directly.** Defeats `contextIsolation`. Always wrap in named, typed methods.
- **Forgetting the unsubscribe return.** Memory leak: every screen mount adds a subscriber that is never removed.
- **Returning non-cloneable objects from handlers** (functions, classes with private fields, `AbortController`). Strip before returning.
- **Mixing invoke and send.** Pick one per channel — don't `webContents.send` *and* `ipcMain.handle` the same channel name.
