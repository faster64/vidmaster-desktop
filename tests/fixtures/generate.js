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

// 3. tiny-with-audio.mp4 — 2s blue 320×240 + 440Hz sine audio
const audio = path.join(__dirname, "tiny-with-audio.mp4");
if (fs.existsSync(audio)) fs.unlinkSync(audio);
const r3 = spawnSync(ffmpegPath, [
  "-y",
  "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=25:d=2",
  "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
  "-c:v", "libx264", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-shortest",
  audio,
]);
if (r3.status !== 0) {
  console.error(r3.stderr.toString());
  process.exit(1);
}
console.log("✓ tiny-with-audio.mp4");

// 4. tiny-silent.mp4 — 2s red 320×240 video-only (no audio stream)
const silent = path.join(__dirname, "tiny-silent.mp4");
if (fs.existsSync(silent)) fs.unlinkSync(silent);
const r4 = spawnSync(ffmpegPath, [
  "-y",
  "-f", "lavfi", "-i", "color=c=red:s=320x240:r=25:d=2",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an",
  silent,
]);
if (r4.status !== 0) {
  console.error(r4.stderr.toString());
  process.exit(1);
}
console.log("✓ tiny-silent.mp4");

// 5. tiny-avatar-square.png — 100×100 solid red (avatar fixture)
const avatarPng = path.join(__dirname, "tiny-avatar-square.png");
await sharp({
  create: { width: 100, height: 100, channels: 4, background: { r: 220, g: 30, b: 30, alpha: 1 } },
}).png().toFile(avatarPng);
console.log("✓ tiny-avatar-square.png");

// 6. tiny-avatar-square.jpg — 100×100 solid blue (avatar fixture, JPG variant)
const avatarJpg = path.join(__dirname, "tiny-avatar-square.jpg");
await sharp({
  create: { width: 100, height: 100, channels: 3, background: { r: 30, g: 30, b: 220 } },
}).jpeg({ quality: 90 }).toFile(avatarJpg);
console.log("✓ tiny-avatar-square.jpg");
