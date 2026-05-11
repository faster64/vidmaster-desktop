import { autoUpdater } from "electron-updater";
import { app } from "electron";

const TIMEOUT_MS = 10_000;

function classifyError(err) {
  const msg = err?.message || String(err);
  const code = err?.code || "";
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN/.test(code) || /ENOTFOUND|getaddrinfo/.test(msg)) {
    return "network";
  }
  if (/rate limit|API rate/i.test(msg)) return "rate-limit";
  if (/signature|checksum|sha512/i.test(msg)) return "signature";
  return "unknown";
}

export function createUpdater({ send, log, isPackaged }) {
  let timeoutHandle = null;
  let disposed = false;

  const currentVersion = app?.getVersion?.() ?? "0.0.0";

  function clearPendingTimeout() {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  }

  function safeSend(event) {
    if (disposed) return;
    try { send(event); } catch (err) { log.warn(`updater send failed: ${err.message}`); }
  }

  function attachListeners() {
    autoUpdater.on("checking-for-update", () => log.info("updater: checking-for-update"));

    autoUpdater.on("update-not-available", () => {
      clearPendingTimeout();
      log.info(`updater: up to date (v${currentVersion})`);
      safeSend({ type: "not-available", currentVersion });
    });

    autoUpdater.on("update-available", (info) => {
      clearPendingTimeout();
      log.info(`updater: available v${info?.version}`);
      safeSend({ type: "available", currentVersion, nextVersion: info?.version });
    });

    autoUpdater.on("download-progress", (p) => {
      safeSend({
        type: "download-progress",
        percent: p?.percent ?? 0,
        bytesPerSecond: p?.bytesPerSecond ?? 0,
        transferred: p?.transferred ?? 0,
        total: p?.total ?? 0,
      });
    });

    autoUpdater.on("update-downloaded", (info) => {
      log.info(`updater: downloaded v${info?.version}`);
      safeSend({ type: "downloaded", nextVersion: info?.version });
      try { autoUpdater.quitAndInstall(); } catch (err) {
        log.error(`quitAndInstall failed: ${err.message}`);
        safeSend({ type: "error", code: "unknown", message: err.message });
      }
    });

    autoUpdater.on("error", (err) => {
      clearPendingTimeout();
      const code = classifyError(err);
      log.warn(`updater error (${code}): ${err?.message}`);
      safeSend({ type: "error", code, message: err?.message || "Unknown error" });
    });
  }

  attachListeners();

  return {
    async check() {
      if (disposed) return;

      if (!isPackaged) {
        log.info("updater: dev mode, skipping check");
        safeSend({ type: "not-available", currentVersion });
        return;
      }

      safeSend({ type: "checking" });

      clearPendingTimeout();
      timeoutHandle = setTimeout(() => {
        timeoutHandle = null;
        log.warn("updater: check timed out");
        safeSend({ type: "error", code: "timeout", message: "Quá thời gian kiểm tra (10s)" });
      }, TIMEOUT_MS);

      try {
        await autoUpdater.checkForUpdates();
      } catch (err) {
        clearPendingTimeout();
        const code = classifyError(err);
        log.warn(`updater checkForUpdates threw (${code}): ${err?.message}`);
        safeSend({ type: "error", code, message: err?.message || "Unknown error" });
      }
    },

    dispose() {
      disposed = true;
      clearPendingTimeout();
      autoUpdater.removeAllListeners();
    },
  };
}
