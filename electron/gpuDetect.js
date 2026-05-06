import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { spawn } from "child_process";

const PRIORITY = ["h264_nvenc", "h264_qsv", "h264_amf", "libx264"];

export function pickEncoderFromFfmpegOutput(text) {
  for (const enc of PRIORITY) {
    if (text.includes(enc)) return enc;
  }
  return "libx264";
}

export function detectEncoder() {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-encoders"], { windowsHide: true });
    let out = "";
    child.stdout.on("data", (b) => { out += b.toString(); });
    child.stderr.on("data", (b) => { out += b.toString(); });
    child.on("error", () => resolve("libx264"));
    child.on("close", () => resolve(pickEncoderFromFfmpegOutput(out)));
  });
}
