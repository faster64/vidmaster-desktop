import { throwIfAborted, AbortError } from "./abortError.js";
import { AllKeysExhausted } from "./keyRotator.js";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
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

async function fetchThumbnailBase64(url, signal) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  } catch (err) {
    if (err.name === "AbortError" || signal?.aborted) throw new AbortError();
    return null;
  }
}

function stripFences(s) {
  return String(s).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function tryParse(text) {
  try { return JSON.parse(stripFences(text)); } catch { return null; }
}

export async function analyzeWhyHot({ rotator, video, signal }) {
  throwIfAborted(signal);
  const thumbB64 = await fetchThumbnailBase64(video.thumbnailUrl, signal);
  throwIfAborted(signal);

  const parts = [{ text: buildPrompt(video) }];
  if (thumbB64) parts.push({ inline_data: { mime_type: "image/jpeg", data: thumbB64 } });

  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
  });

  while (true) {
    throwIfAborted(signal);
    const key = rotator.next(); // throws AllKeysExhausted
    let res;
    try {
      res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body, signal,
      });
    } catch (err) {
      if (err.name === "AbortError" || signal?.aborted) throw new AbortError();
      throw err;
    }
    if (res.status === 429) {
      rotator.markCooldown(key, COOLDOWN_429_MS);
      continue;
    }
    if (res.status === 403) {
      rotator.markCooldown(key, COOLDOWN_403_MS);
      continue;
    }
    if (!res.ok) {
      let detail = "";
      try { detail = JSON.stringify(await res.json()); } catch {}
      throw new Error(`Gemini API ${res.status}: ${detail || res.statusText}`);
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = tryParse(text);
    if (parsed && typeof parsed.reason === "string" && Array.isArray(parsed.factors)) {
      return { reason: parsed.reason, factors: parsed.factors };
    }
    return { error: "parse_failed" };
  }
}
