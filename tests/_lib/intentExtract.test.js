import { describe, it, expect, beforeEach, vi } from "vitest";
import { extractIntent } from "../../src/_lib/intentExtract.js";
import { KeyRotator, AllKeysExhausted } from "../../src/_lib/keyRotator.js";

function fetchJson(json, status = 200) {
  return { ok: status >= 200 && status < 300, status, statusText: "", json: async () => json };
}

function geminiOk(payload) {
  // Groq returns OpenAI-compatible chat completions
  return fetchJson({ choices: [{ message: { content: JSON.stringify(payload) } }] });
}

describe("extractIntent", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("returns sanitized queries + filterHints + interpretation on happy path", async () => {
    global.fetch = vi.fn().mockResolvedValue(geminiOk({
      queries: ["K-drama 2026", "Korean series", "phim Hàn"],
      filterHints: { timeWindowDays: 30, sortBy: "date", minDurationMinutes: 0 },
      interpretation: "Tìm K-drama mới ra trong 30 ngày",
    }));
    const result = await extractIntent({
      rotator: new KeyRotator(["k1"]),
      userInput: "drama Hàn mới ra trong tháng",
      regionCode: "KR", relevanceLanguage: "ko",
    });
    expect(result.queries).toEqual(["K-drama 2026", "Korean series", "phim Hàn"]);
    expect(result.filterHints).toEqual({ timeWindowDays: 30, sortBy: "date", minDurationMinutes: 0 });
    expect(result.interpretation).toContain("K-drama");
  });

  it("caps queries to 3", async () => {
    global.fetch = vi.fn().mockResolvedValue(geminiOk({
      queries: ["q1", "q2", "q3", "q4", "q5"],
      filterHints: { timeWindowDays: null, sortBy: null, minDurationMinutes: null },
      interpretation: "x",
    }));
    const result = await extractIntent({ rotator: new KeyRotator(["k"]), userInput: "test" });
    expect(result.queries.length).toBe(3);
  });

  it("falls back to raw input when AI returns no usable queries", async () => {
    global.fetch = vi.fn().mockResolvedValue(geminiOk({
      queries: [],
      filterHints: { timeWindowDays: null, sortBy: null, minDurationMinutes: null },
      interpretation: "",
    }));
    const result = await extractIntent({ rotator: new KeyRotator(["k"]), userInput: "raw input here" });
    expect(result.queries).toEqual(["raw input here"]);
  });

  it("falls back to raw input when JSON parse fails", async () => {
    global.fetch = vi.fn().mockResolvedValue(fetchJson({
      choices: [{ message: { content: "not json at all" } }],
    }));
    const result = await extractIntent({ rotator: new KeyRotator(["k"]), userInput: "fallback test" });
    expect(result.queries).toEqual(["fallback test"]);
  });

  it("rotates key on 429 and retries with next key", async () => {
    let call = 0;
    global.fetch = vi.fn(async () => {
      call++;
      if (call === 1) return fetchJson({ error: { message: "rate" } }, 429);
      return geminiOk({ queries: ["ok"], filterHints: { timeWindowDays: null, sortBy: null, minDurationMinutes: null }, interpretation: "" });
    });
    const rotator = new KeyRotator(["k1", "k2"]);
    const result = await extractIntent({ rotator, userInput: "x" });
    expect(result.queries).toEqual(["ok"]);
  });

  it("throws AllKeysExhausted when all keys hit 429", async () => {
    global.fetch = vi.fn().mockResolvedValue(fetchJson({ error: { message: "rate" } }, 429));
    const rotator = new KeyRotator(["k1", "k2"]);
    await expect(extractIntent({ rotator, userInput: "x" })).rejects.toBeInstanceOf(AllKeysExhausted);
  });

  it("rejects empty userInput", async () => {
    global.fetch = vi.fn();
    await expect(extractIntent({ rotator: new KeyRotator(["k"]), userInput: "" })).rejects.toThrow(/Thiếu keyword/);
    await expect(extractIntent({ rotator: new KeyRotator(["k"]), userInput: "   " })).rejects.toThrow(/Thiếu keyword/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("filters out invalid sortBy from filterHints", async () => {
    global.fetch = vi.fn().mockResolvedValue(geminiOk({
      queries: ["q"],
      filterHints: { timeWindowDays: 7, sortBy: "garbage", minDurationMinutes: 5 },
      interpretation: "",
    }));
    const result = await extractIntent({ rotator: new KeyRotator(["k"]), userInput: "x" });
    expect(result.filterHints).toEqual({ timeWindowDays: 7, sortBy: null, minDurationMinutes: 5 });
  });
});
