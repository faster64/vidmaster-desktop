import { describe, it, expect } from "vitest";
import { bumpPatch } from "../../scripts/bump-version.mjs";

describe("bumpPatch", () => {
  it("increments patch on 0.1.0", () => {
    expect(bumpPatch("0.1.0")).toBe("0.1.1");
  });

  it("increments patch on 1.0.0", () => {
    expect(bumpPatch("1.0.0")).toBe("1.0.1");
  });

  it("does not overflow into minor on 0.1.9", () => {
    expect(bumpPatch("0.1.9")).toBe("0.1.10");
  });

  it("handles two-digit patch", () => {
    expect(bumpPatch("2.3.99")).toBe("2.3.100");
  });

  it("throws on non-semver input", () => {
    expect(() => bumpPatch("abc")).toThrow(/Cannot parse version/);
  });

  it("throws on missing segment", () => {
    expect(() => bumpPatch("1.2")).toThrow(/Cannot parse version/);
  });
});
