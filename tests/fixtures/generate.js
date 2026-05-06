import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1. tiny.mp4 — 1s silent black 320×180
const mp4 = path.join(__dirname, "tiny.mp4");
if (fs.existsSync(mp4)) fs.unlinkSync(mp4);
const r1 = spawnSync(ffmpegPath, [
  "-y",
  "-f", "lavfi", "-i", "color=size=320x180:rate=30:duration=1:color=black",
  "-pix_fmt", "yuv420p",
  mp4,
]);
if (r1.status !== 0) {
  console.error(r1.stderr.toString());
  process.exit(1);
}
console.log("✓ tiny.mp4");

// 2. tiny.png — solid 320×180
const png = path.join(__dirname, "tiny.png");
await sharp({
  create: { width: 320, height: 180, channels: 3, background: { r: 64, g: 128, b: 200 } },
}).png().toFile(png);
console.log("✓ tiny.png");
