import fs from "fs";
import path from "path";
import sharp from "sharp";
import { TaskRunner } from "./_lib/runner.js";
import { recolorPixels, hexToRgb } from "./_lib/recolorImage.js";

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export async function runRecolorThumb(config) {
  const runner = new TaskRunner(config);
  const {
    inputDir, output,
    sourceColor, tolerance,
    gradientStart, gradientEnd, gradientDirection,
  } = config;
  runner.checkAborted();

  if (!inputDir || !fs.existsSync(inputDir)) {
    throw new Error("Folder thumbnail không tồn tại.");
  }
  if (!output) {
    throw new Error("Thiếu folder output.");
  }
  if (!HEX_RE.test(sourceColor) || !HEX_RE.test(gradientStart) || !HEX_RE.test(gradientEnd)) {
    throw new Error("Màu sai format (cần #RRGGBB)");
  }
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 255) {
    throw new Error("Tolerance phải là số nguyên 0–255.");
  }
  if (gradientDirection !== "vertical" && gradientDirection !== "horizontal") {
    throw new Error(`gradientDirection không hợp lệ: ${gradientDirection}`);
  }

  const files = fs.readdirSync(inputDir)
    .filter((n) => /\.(jpe?g|png)$/i.test(n))
    .sort();
  if (files.length === 0) {
    throw new Error("Folder không có file ảnh (.jpg/.png).");
  }

  fs.mkdirSync(output, { recursive: true });

  const params = {
    sourceColor: hexToRgb(sourceColor),
    tolerance,
    gradientStart: hexToRgb(gradientStart),
    gradientEnd: hexToRgb(gradientEnd),
    gradientDirection,
  };

  const total = files.length;
  const outputs = [];
  const errors = [];

  for (let i = 0; i < total; i++) {
    runner.checkAborted();
    const name = files[i];
    const inPath = path.join(inputDir, name);
    const outPath = path.join(output, name);
    const message = `${i + 1}/${total} ${name}`;
    runner.setProgress((i / total) * 100, message);
    try {
      const { data, info } = await sharp(inPath)
        .rotate()
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      recolorPixels(data, info.width, info.height, params);
      const ext = path.extname(name).toLowerCase();
      const isJpeg = ext === ".jpg" || ext === ".jpeg";
      const pipeline = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
      if (isJpeg) {
        await pipeline.jpeg({ quality: 90 }).toFile(outPath);
      } else {
        await pipeline.png().toFile(outPath);
      }
      outputs.push(outPath);
      runner.log("info", `Saved: ${name}`);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      errors.push({ file: name, message: err.message, stack: err.stack });
      runner.log("error", `${name} failed: ${err.message}`);
    }
    runner.setProgress(((i + 1) / total) * 100, message);
  }

  runner.setProgress(100, "Done");
  return { ok: errors.length === 0, outputs, errors };
}
