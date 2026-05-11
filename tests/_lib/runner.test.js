import { describe, it, expect, vi } from "vitest";
import { TaskRunner } from "../../src/_lib/runner.js";
import { AbortError } from "../../src/_lib/abortError.js";

describe("TaskRunner", () => {
  it("forwards log calls to onLog with level + message", () => {
    const onLog = vi.fn();
    const r = new TaskRunner({ onLog });
    r.log("info", "hello");
    expect(onLog).toHaveBeenCalledWith("info", "hello");
  });

  it("works with no callbacks (no-op)", () => {
    const r = new TaskRunner({});
    expect(() => r.log("info", "x")).not.toThrow();
    expect(() => r.setProgress(50, "y")).not.toThrow();
  });

  it("throttles progress to at most one call per 500ms by default", async () => {
    vi.useFakeTimers();
    const onProgress = vi.fn();
    const r = new TaskRunner({ onProgress });

    r.setProgress(10, "a");
    r.setProgress(20, "b");
    r.setProgress(30, "c");
    expect(onProgress).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500);
    r.setProgress(40, "d");
    expect(onProgress).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("always emits progress at 100 (final tick bypasses throttle)", () => {
    const onProgress = vi.fn();
    const r = new TaskRunner({ onProgress });
    r.setProgress(50, "halfway");
    r.setProgress(100, "done");
    expect(onProgress).toHaveBeenLastCalledWith(100, "done");
  });

  it("checkAborted throws AbortError when signal aborted", () => {
    const ctrl = new AbortController();
    const r = new TaskRunner({ signal: ctrl.signal });
    expect(() => r.checkAborted()).not.toThrow();
    ctrl.abort();
    expect(() => r.checkAborted()).toThrow(AbortError);
  });
});
