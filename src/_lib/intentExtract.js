import { throwIfAborted, AbortError } from "./abortError.js";
import { AllKeysExhausted } from "./keyRotator.js";

const DEFAULT_MODEL = "llama-3.1-70b-versatile";
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const COOLDOWN_429_MS = 60_000;
const COOLDOWN_403_MS = 24 * 60 * 60 * 1000;

const SORT_VALUES = new Set(["velocity", "totalViews", "date"]);

function buildPrompt(userInput, regionCode, relevanceLanguage) {
  return [
    "Bạn là công cụ phân tích keyword search YouTube. Người dùng nhập một câu hỏi/keyword tự nhiên (Việt/Anh/Nhật/Hàn).",
    `Người dùng nhập: "${userInput}"`,
    `Region target: ${regionCode || "(toàn cầu)"} · Language: ${relevanceLanguage || "(auto)"}`,
    "",
    "Nhiệm vụ:",
    "1. Trả 1-3 query string YouTube. **QUAN TRỌNG: query PHẢI viết bằng NGÔN NGỮ CỦA REGION TARGET** để YouTube ưu tiên kết quả từ kênh quốc gia đó.",
    "   - Region KR / lang ko → query bằng TIẾNG HÀN (Hangul). VD: \"드라마 한국 2026\", \"신작 한드\"",
    "   - Region JP / lang ja → query bằng TIẾNG NHẬT (Kanji/Hiragana/Katakana). VD: \"アニメ 新作 2026\"",
    "   - Region US / lang en → query bằng TIẾNG ANH",
    "   - Region VN / lang vi → query bằng TIẾNG VIỆT",
    "   - Region trống → query bằng ngôn ngữ phù hợp nhất với chủ đề",
    "2. Nếu user ngụ ý filter (vd \"tháng này\", \"video dài\", \"mới nhất\"), điền filterHints; nếu không, để null.",
    "3. interpretation: 1 câu tóm tắt bằng tiếng Việt user đang muốn tìm gì.",
    "",
    "Trả JSON đúng định dạng:",
    `{
  "queries": ["q1", "q2", "q3"],
  "filterHints": {
    "timeWindowDays": null | number,
    "sortBy": null | "velocity" | "totalViews" | "date",
    "minDurationMinutes": null | number
  },
  "interpretation": "..."
}`,
  ].join("\n");
}

function stripFences(s) {
  return String(s).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function tryParse(text) {
  try { return JSON.parse(stripFences(text)); } catch { return null; }
}

function sanitize(parsed) {
  const queries = Array.isArray(parsed?.queries)
    ? parsed.queries.filter((q) => typeof q === "string" && q.trim()).map((q) => q.trim()).slice(0, 3)
    : [];
  const hints = parsed?.filterHints || {};
  const filterHints = {
    timeWindowDays: Number.isFinite(hints.timeWindowDays) && hints.timeWindowDays > 0 ? hints.timeWindowDays : null,
    sortBy: SORT_VALUES.has(hints.sortBy) ? hints.sortBy : null,
    minDurationMinutes: Number.isFinite(hints.minDurationMinutes) && hints.minDurationMinutes >= 0 ? hints.minDurationMinutes : null,
  };
  const interpretation = typeof parsed?.interpretation === "string" ? parsed.interpretation : "";
  return { queries, filterHints, interpretation };
}

export async function extractIntent({ rotator, userInput, regionCode, relevanceLanguage, signal, model = DEFAULT_MODEL }) {
  throwIfAborted(signal);
  if (!userInput || !userInput.trim()) throw new Error("Thiếu keyword.");

  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: buildPrompt(userInput, regionCode, relevanceLanguage) }],
    response_format: { type: "json_object" },
    temperature: 0.3,
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
      console.log(`[trend] POST ${ENDPOINT} [intent] → ERROR ${err.message} (${Date.now() - t0}ms)`);
      throw err;
    }
    console.log(`[trend] POST ${ENDPOINT} [intent ${model}] → ${res.status} (${Date.now() - t0}ms)`);
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
    if (!parsed) {
      return { queries: [userInput.trim()], filterHints: { timeWindowDays: null, sortBy: null, minDurationMinutes: null }, interpretation: "" };
    }
    const sanitized = sanitize(parsed);
    if (sanitized.queries.length === 0) sanitized.queries = [userInput.trim()];
    return sanitized;
  }
}

export { AllKeysExhausted };
