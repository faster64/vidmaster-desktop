import { describe, it, expect } from "vitest";
import { sanitizeFilename } from "../../src/_lib/sanitize.js";

describe("sanitizeFilename", () => {
  it("replaces invalid Windows chars with underscore", () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j");
  });

  it("trims trailing dots and spaces", () => {
    expect(sanitizeFilename("name. ")).toBe("name");
    expect(sanitizeFilename("name...")).toBe("name");
  });

  it("replaces unicode ellipsis and fullwidth question mark with space", () => {
    expect(sanitizeFilename("title…end")).toBe("title end");
    expect(sanitizeFilename("question？mark")).toBe("question mark");
  });

  it("appends underscore to Windows reserved names", () => {
    expect(sanitizeFilename("CON")).toBe("CON_");
    expect(sanitizeFilename("com1")).toBe("com1_");
    expect(sanitizeFilename("LPT9")).toBe("LPT9_");
  });

  it("normalises NFC", () => {
    const combining = "é";
    expect(sanitizeFilename(combining)).toBe("é");
  });

  it("preserves valid unicode", () => {
    expect(sanitizeFilename("Tiếng Việt")).toBe("Tiếng Việt");
  });
});
