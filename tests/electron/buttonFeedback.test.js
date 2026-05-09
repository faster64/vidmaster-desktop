import { describe, it, expect, vi } from "vitest";
import { runWithFeedback } from "../../electron/renderer/components/buttonFeedback.js";

function makeButton(initial = { innerHTML: "▶  Thực hiện", disabled: false }) {
  return { ...initial };
}

describe("runWithFeedback", () => {
  it("returns the result of asyncFn", async () => {
    const btn = makeButton();
    const result = await runWithFeedback(btn, async () => "queued", { spinnerMs: 5, okMs: 5 });
    expect(result).toBe("queued");
  });

  it("restores original innerHTML and disabled after completion", async () => {
    const btn = makeButton({ innerHTML: "▶  Thực hiện", disabled: false });
    await runWithFeedback(btn, async () => {}, { spinnerMs: 5, okMs: 5 });
    expect(btn.innerHTML).toBe("▶  Thực hiện");
    expect(btn.disabled).toBe(false);
  });

  it("shows spinner and disables button while asyncFn runs", async () => {
    const btn = makeButton();
    let resolveFn;
    const asyncFn = () => new Promise((r) => { resolveFn = r; });
    const promise = runWithFeedback(btn, asyncFn, { spinnerMs: 0, okMs: 0 });
    await Promise.resolve();
    await Promise.resolve();
    expect(btn.disabled).toBe(true);
    expect(btn.innerHTML).toContain("btn-spinner");
    resolveFn();
    await promise;
  });

  it("shows OK text between spinner and restore", async () => {
    const btn = makeButton();
    const seen = [];
    const originalHtml = btn.innerHTML;
    const proxy = new Proxy(btn, {
      set(target, prop, value) {
        if (prop === "innerHTML") seen.push(value);
        target[prop] = value;
        return true;
      },
    });
    await runWithFeedback(proxy, async () => {}, { spinnerMs: 5, okMs: 5, okHtml: "✅ OK" });
    expect(seen).toEqual([
      expect.stringContaining("btn-spinner"),
      "✅ OK",
      originalHtml,
    ]);
  });

  it("respects spinnerMs as a minimum (waits even if asyncFn finishes instantly)", async () => {
    const btn = makeButton();
    const start = Date.now();
    const spinnerMs = 100;
    await runWithFeedback(btn, async () => {}, { spinnerMs, okMs: 10 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(spinnerMs - 20);
  });

  it("restores button state when asyncFn throws and propagates the error", async () => {
    const btn = makeButton({ innerHTML: "▶ X", disabled: false });
    const boom = new Error("nope");
    await expect(
      runWithFeedback(btn, async () => { throw boom; }, { spinnerMs: 5, okMs: 5 })
    ).rejects.toBe(boom);
    expect(btn.innerHTML).toBe("▶ X");
    expect(btn.disabled).toBe(false);
  });

  it("preserves the originalDisabled value if button was already disabled", async () => {
    const btn = makeButton({ innerHTML: "▶", disabled: true });
    await runWithFeedback(btn, async () => {}, { spinnerMs: 5, okMs: 5 });
    expect(btn.disabled).toBe(true);
  });

  it("uses default spinnerHtml and okHtml when not overridden", async () => {
    const btn = makeButton();
    const seen = [];
    const proxy = new Proxy(btn, {
      set(target, prop, value) {
        if (prop === "innerHTML") seen.push(value);
        target[prop] = value;
        return true;
      },
    });
    await runWithFeedback(proxy, async () => {}, { spinnerMs: 5, okMs: 5 });
    expect(seen[0]).toContain('class="btn-spinner"');
    expect(seen[1]).toBe("✅ OK");
  });
});
