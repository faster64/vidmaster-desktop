import { describe, it, expect, beforeEach, vi } from "vitest";
import { analyzeWhyHot } from "../../src/_lib/geminiAnalyze.js";
import { KeyRotator, AllKeysExhausted } from "../../src/_lib/keyRotator.js";

const VIDEO = {
  id: "v1", title: "Cat does flip", channelTitle: "Cats", channelSubs: 1000,
  velocity: 5000, viewCount: 50000, likeCount: 1000, commentCount: 200,
  publishedAt: "2026-05-01T00:00:00Z",
  thumbnailUrl: "https://example.com/thumb.jpg",
};

function fetchJson(json, status = 200) {
  return { ok: status >= 200 && status < 300, status, statusText: "", json: async () => json };
}

describe("analyzeWhyHot", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("returns parsed reason and factors on happy path", async () => {
    global.fetch = vi.fn(async (url) => {
      if (url.includes("example.com/thumb")) return { ok: true, arrayBuffer: async () => Buffer.from("fakejpeg").buffer };
      return fetchJson({ candidates: [{ content: { parts: [{ text: '{"reason":"viral title","factors":["hook","timing"]}' }] } }] });
    });
    const rotator = new KeyRotator(["k1"]);
    const result = await analyzeWhyHot({ rotator, video: VIDEO });
    expect(result).toEqual({ reason: "viral title", factors: ["hook", "timing"] });
  });

  it("rotates key on 429 and retries with the next key", async () => {
    let call = 0;
    global.fetch = vi.fn(async (url) => {
      if (url.includes("example.com/thumb")) return { ok: true, arrayBuffer: async () => Buffer.from("x").buffer };
      call++;
      if (call === 1) return fetchJson({ error: { message: "rate" } }, 429);
      return fetchJson({ candidates: [{ content: { parts: [{ text: '{"reason":"r","factors":[]}' }] } }] });
    });
    const rotator = new KeyRotator(["k1", "k2"]);
    const result = await analyzeWhyHot({ rotator, video: VIDEO });
    expect(result.reason).toBe("r");
  });

  it("throws AllKeysExhausted when all keys hit 429", async () => {
    global.fetch = vi.fn(async (url) => {
      if (url.includes("example.com/thumb")) return { ok: true, arrayBuffer: async () => Buffer.from("x").buffer };
      return fetchJson({ error: { message: "rate" } }, 429);
    });
    const rotator = new KeyRotator(["k1", "k2"]);
    await expect(analyzeWhyHot({ rotator, video: VIDEO })).rejects.toBeInstanceOf(AllKeysExhausted);
  });

  it("strips ```json fences and parses", async () => {
    global.fetch = vi.fn(async (url) => {
      if (url.includes("example.com/thumb")) return { ok: true, arrayBuffer: async () => Buffer.from("x").buffer };
      return fetchJson({ candidates: [{ content: { parts: [{ text: '```json\n{"reason":"x","factors":["a"]}\n```' }] } }] });
    });
    const result = await analyzeWhyHot({ rotator: new KeyRotator(["k"]), video: VIDEO });
    expect(result).toEqual({ reason: "x", factors: ["a"] });
  });

  it("returns parse_failed error on invalid JSON", async () => {
    global.fetch = vi.fn(async (url) => {
      if (url.includes("example.com/thumb")) return { ok: true, arrayBuffer: async () => Buffer.from("x").buffer };
      return fetchJson({ candidates: [{ content: { parts: [{ text: "not json at all" }] } }] });
    });
    const result = await analyzeWhyHot({ rotator: new KeyRotator(["k"]), video: VIDEO });
    expect(result).toEqual({ error: "parse_failed" });
  });

  it("includes inline_data part when thumbnail fetch succeeds", async () => {
    let geminiBody = null;
    global.fetch = vi.fn(async (url, opts) => {
      if (url.includes("example.com/thumb")) return { ok: true, arrayBuffer: async () => Buffer.from("img").buffer };
      geminiBody = JSON.parse(opts.body);
      return fetchJson({ candidates: [{ content: { parts: [{ text: '{"reason":"r","factors":[]}' }] } }] });
    });
    await analyzeWhyHot({ rotator: new KeyRotator(["k"]), video: VIDEO });
    const parts = geminiBody.contents[0].parts;
    expect(parts).toContainEqual(expect.objectContaining({ inline_data: expect.objectContaining({ mime_type: "image/jpeg" }) }));
  });

  it("proceeds text-only when thumbnail fetch fails", async () => {
    global.fetch = vi.fn(async (url, opts) => {
      if (url.includes("example.com/thumb")) return { ok: false, status: 404, statusText: "NF" };
      const body = JSON.parse(opts.body);
      const parts = body.contents[0].parts;
      expect(parts.some((p) => p.inline_data)).toBe(false);
      return fetchJson({ candidates: [{ content: { parts: [{ text: '{"reason":"r","factors":[]}' }] } }] });
    });
    const result = await analyzeWhyHot({ rotator: new KeyRotator(["k"]), video: VIDEO });
    expect(result.reason).toBe("r");
  });
});
