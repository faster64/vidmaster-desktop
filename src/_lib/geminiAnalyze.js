import { throwIfAborted, AbortError } from "./abortError.js";
import { AllKeysExhausted } from "./keyRotator.js";

const DEFAULT_MODEL = "llama-3.1-70b-versatile";
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const COOLDOWN_429_MS = 60_000;
const COOLDOWN_403_MS = 24 * 60 * 60 * 1000;

function buildPrompt(video) {
  return [
    "Phân tích ngắn gọn (3-5 bullet) tại sao video này có thể đang hot:",
    `- Title: ${video.title}`,
    `- Channel: ${video.channelTitle} (subs: ${video.channelSubs ?? "?"})`,
    `- Views/ngày: ${video.velocity}`,
    `- Tổng views: ${video.viewCount}, likes: ${video.likeCount}, comments: ${video.commentCount}`,
    `- Upload: ${video.publishedAt}`,
    "",
    'Trả về JSON đúng định dạng: { "reason": "1 câu tóm tắt", "factors": ["yếu tố 1", "yếu tố 2"] }',
  ].join("\n");
}

function stripFences(s) {
  return String(s).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function tryParse(text) {
  try { return JSON.parse(stripFences(text)); } catch { return null; }
}

export async function analyzeWhyHot({ rotator, video, signal, model = DEFAULT_MODEL }) {
  throwIfAborted(signal);

  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: buildPrompt(video) }],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  while (true) {
    throwIfAborted(signal);
    const key = rotator.next(); // throws AllKeysExhausted
    const t0 = Date.now();
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body, signal,
      });
    } catch (err) {
      if (err.name === "AbortError" || signal?.aborted) throw new AbortError();
      console.log(`[trend] POST ${ENDPOINT} [analyze ${video.id}] → ERROR ${err.message} (${Date.now() - t0}ms)`);
      throw err;
    }
    console.log(`[trend] POST ${ENDPOINT} [analyze ${video.id} ${model}] → ${res.status} (${Date.now() - t0}ms)`);
    if (res.status === 429 || res.status === 403) {
      let detail = "";
      try { detail = JSON.stringify(await res.json()); } catch {}
      console.log(`[trend] Groq ${res.status} body: ${detail}`);
      rotator.markCooldown(key, res.status === 429 ? COOLDOWN_429_MS : COOLDOWN_403_MS);
      continue;
    }
    if (!res.ok) {
      let detail = "";
      try { detail = JSON.stringify(await res.json()); } catch {}
      console.log(`[trend] Groq ${res.status} body: ${detail}`);
      throw new Error(`Groq API ${res.status}: ${detail || res.statusText}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    const parsed = tryParse(text);
    if (parsed && typeof parsed.reason === "string" && Array.isArray(parsed.factors)) {
      return { reason: parsed.reason, factors: parsed.factors };
    }
    return { error: "parse_failed" };
  }
}
