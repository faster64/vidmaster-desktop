import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const ENV_FILE = join(ROOT, ".env");
const OUT_FILE = join(ROOT, "electron", "_defaults.json");

function loadEnv() {
  if (!existsSync(ENV_FILE)) return {};
  const text = readFileSync(ENV_FILE, "utf8");
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = loadEnv();

const payload = {
  youtubeApiKey: env.DEFAULT_YT_API_KEY ?? "",
  telegramToken: env.DEFAULT_TG_BOT_TOKEN ?? "",
  telegramGroupId: env.DEFAULT_TG_GROUP_ID ? Number(env.DEFAULT_TG_GROUP_ID) : 0,
  telegramTrackingChatId: env.DEFAULT_TG_TRACKING_CHAT_ID ? Number(env.DEFAULT_TG_TRACKING_CHAT_ID) : 0,
};

writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + "\n");

const missing = Object.entries(payload).filter(([, v]) => v === "" || v === 0).map(([k]) => k);
if (missing.length === Object.keys(payload).length) {
  console.warn(`generate-defaults: no DEFAULT_* keys in .env → wrote empty defaults to ${OUT_FILE}`);
} else if (missing.length > 0) {
  console.warn(`generate-defaults: missing in .env: ${missing.join(", ")} → those fields are empty in ${OUT_FILE}`);
} else {
  console.log(`generate-defaults: wrote ${OUT_FILE} from .env`);
}
