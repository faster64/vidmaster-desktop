import { describe, it, expect } from "vitest";
import { AbortError, throwIfAborted } from "../../src/_lib/abortError.js";

describe("AbortError", () => {
  it("identifies itself by name", () => {
    const err = new AbortError();
    expect(err.name).toBe("AbortError");
    expect(err).toBeInstanceOf(Error);
  });

  it("accepts an optional message", () => {
    expect(new AbortError("stopped").message).toBe("stopped");
    expect(new AbortError().message).toBe("Aborted");
  });
});

describe("throwIfAborted", () => {
  it("does nothing when signal is not aborted", () => {
    const ctrl = new AbortController();
    expect(() => throwIfAborted(ctrl.signal)).not.toThrow();
  });

  it("throws AbortError when signal is aborted", () => {
    const ctrl = new AbortController();
    ctrl.abort();
    expect(() => throwIfAborted(ctrl.signal)).toThrow(AbortError);
  });

  it("is a no-op when signal is undefined", () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
  });
});
