import { describe, it, expect, beforeEach, vi } from "vitest";
import { KeyRotator, AllKeysExhausted } from "../../src/_lib/keyRotator.js";

describe("KeyRotator", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-05-09T00:00:00Z")); });

  it("round-robins through keys", () => {
    const r = new KeyRotator(["a", "b", "c"]);
    expect(r.next()).toBe("a");
    expect(r.next()).toBe("b");
    expect(r.next()).toBe("c");
    expect(r.next()).toBe("a");
  });

  it("skips a key in cooldown", () => {
    const r = new KeyRotator(["a", "b", "c"]);
    r.next(); // a
    r.markCooldown("b", 60_000);
    expect(r.next()).toBe("c");
    expect(r.next()).toBe("a");
    expect(r.next()).toBe("c"); // b still in cooldown
  });

  it("re-enters key after cooldown expires", () => {
    const r = new KeyRotator(["a", "b"]);
    r.markCooldown("a", 1000);
    expect(r.next()).toBe("b");
    vi.advanceTimersByTime(1500);
    expect(r.next()).toBe("a");
  });

  it("throws AllKeysExhausted when all on cooldown", () => {
    const r = new KeyRotator(["a", "b"]);
    r.markCooldown("a", 60_000);
    r.markCooldown("b", 60_000);
    expect(() => r.next()).toThrow(AllKeysExhausted);
  });

  it("throws AllKeysExhausted when constructed empty", () => {
    const r = new KeyRotator([]);
    expect(() => r.next()).toThrow(AllKeysExhausted);
  });

  it("isolates state across instances", () => {
    const r1 = new KeyRotator(["a", "b"]);
    const r2 = new KeyRotator(["a", "b"]);
    r1.markCooldown("a", 60_000);
    expect(r2.next()).toBe("a");
  });
});
