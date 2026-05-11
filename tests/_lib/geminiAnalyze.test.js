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

function chatOk(text) {
  return fetchJson({ choices: [{ message: { content: text } }] });
}

describe("analyzeWhyHot (Groq)", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("returns parsed reason and factors on happy path", async () => {
    global.fetch = vi.fn().mockResolvedValue(chatOk('{"reason":"viral title","factors":["hook","timing"]}'));
    const result = await analyzeWhyHot({ rotator: new KeyRotator(["k1"]), video: VIDEO });
    expect(result).toEqual({ reason: "viral title", factors: ["hook", "timing"] });
  });

  it("rotates key on 429 and retries with the next key", async () => {
    let call = 0;
    global.fetch = vi.fn(async () => {
      call++;
      if (call === 1) return fetchJson({ error: { message: "rate" } }, 429);
      return chatOk('{"reason":"r","factors":[]}');
    });
    const result = await analyzeWhyHot({ rotator: new KeyRotator(["k1", "k2"]), video: VIDEO });
    expect(result.reason).toBe("r");
  });

  it("throws AllKeysExhausted when all keys hit 429", async () => {
    global.fetch = vi.fn().mockResolvedValue(fetchJson({ error: { message: "rate" } }, 429));
    await expect(analyzeWhyHot({ rotator: new KeyRotator(["k1", "k2"]), video: VIDEO })).rejects.toBeInstanceOf(AllKeysExhausted);
  });

  it("strips ```json fences and parses", async () => {
    global.fetch = vi.fn().mockResolvedValue(chatOk('```json\n{"reason":"x","factors":["a"]}\n```'));
    const result = await analyzeWhyHot({ rotator: new KeyRotator(["k"]), video: VIDEO });
    expect(result).toEqual({ reason: "x", factors: ["a"] });
  });

  it("returns parse_failed error on invalid JSON", async () => {
    global.fetch = vi.fn().mockResolvedValue(chatOk("not json at all"));
    const result = await analyzeWhyHot({ rotator: new KeyRotator(["k"]), video: VIDEO });
    expect(result).toEqual({ error: "parse_failed" });
  });

  it("sends OpenAI-style chat completion body with Bearer auth", async () => {
    let captured = null;
    global.fetch = vi.fn(async (url, opts) => {
      captured = { url, headers: opts.headers, body: JSON.parse(opts.body) };
      return chatOk('{"reason":"r","factors":[]}');
    });
    await analyzeWhyHot({ rotator: new KeyRotator(["mykey"]), video: VIDEO, model: "llama-3.1-8b-instant" });
    expect(captured.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(captured.headers.Authorization).toBe("Bearer mykey");
    expect(captured.body.model).toBe("llama-3.1-8b-instant");
    expect(captured.body.messages[0].role).toBe("user");
    expect(captured.body.response_format).toEqual({ type: "json_object" });
  });

  it("does not fetch thumbnail (text-only with Groq)", async () => {
    let urls = [];
    global.fetch = vi.fn(async (url) => {
      urls.push(url);
      return chatOk('{"reason":"r","factors":[]}');
    });
    await analyzeWhyHot({ rotator: new KeyRotator(["k"]), video: VIDEO });
    expect(urls).toEqual(["https://api.groq.com/openai/v1/chat/completions"]);
    expect(urls).not.toContainEqual(expect.stringContaining("example.com/thumb"));
  });
});
