import { throwIfAborted } from "./abortError.js";
import { spawnFfmpeg } from "./ffmpeg.js";

const DEFAULT_THROTTLE_MS = 500;

export class TaskRunner {
  constructor({ signal, onProgress, onLog, throttleMs = DEFAULT_THROTTLE_MS } = {}) {
    this.signal = signal;
    this.onProgress = onProgress;
    this.onLog = onLog;
    this.throttleMs = throttleMs;
    this._lastProgressEmit = 0;
  }

  log(level, message) {
    this.onLog?.(level, message);
  }

  setProgress(percent, message) {
    if (!this.onProgress) return;
    const now = Date.now();
    const isFinal = percent >= 100;
    if (isFinal || now - this._lastProgressEmit >= this.throttleMs) {
      this._lastProgressEmit = now;
      this.onProgress(percent, message);
    }
  }

  checkAborted() {
    throwIfAborted(this.signal);
  }

  spawnFfmpeg(args, { totalDurationSec, stageWeight = 1, stageOffset = 0, message = "" } = {}) {
    return spawnFfmpeg(args, {
      signal: this.signal,
      totalDurationSec,
      onProgress: (pct) => this.setProgress(stageOffset + pct * stageWeight, message),
      onLogLine: (line) => this.onLog?.("debug", line),
    });
  }
}
