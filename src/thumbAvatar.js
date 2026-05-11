import fs from "fs";
import path from "path";
import sharp from "sharp";
import { TaskRunner } from "./_lib/runner.js";
import { circleCrop } from "./_lib/circleCrop.js";
import { sanitizeFilename } from "./_lib/sanitize.js";

const POSITIONS = new Set(["top-left", "top-right", "bottom-left", "bottom-right", "center"]);

export async function runThumbAvatar(config) {
  const runner = new TaskRunner(config);
  const {
    thumbDir, avatarDir, output,
    position = "bottom-right",
    size = 80,
    margin = 16,
  } = config;

  if (!thumbDir || !fs.existsSync(thumbDir)) throw new Error("Folder thumbnail không tồn tại.");
  if (!avatarDir || !fs.existsSync(avatarDir)) throw new Error("Folder avatar không tồn tại.");
  if (!output) throw new Error("Thiếu folder output.");
  if (!POSITIONS.has(position)) throw new Error(`Vị trí không hợp lệ: ${position}`);

  const thumbs = fs.readdirSync(thumbDir).filter((n) => /\.jpe?g$/i.test(n)).sort();
  if (thumbs.length === 0) throw new Error("Folder không có file thumbnail (.jpg).");

  const avatars = fs.readdirSync(avatarDir).filter((n) => /\.(jpe?g|png)$/i.test(n)).sort();
  if (avatars.length === 0) throw new Error("Folder không có file avatar (.jpg/.png).");

  runner.checkAborted();
  fs.mkdirSync(output, { recursive: true });

  const n = thumbs.length;
  const m = avatars.length;
  const outputs = [];
  const errors = [];

  for (let j = 0; j < m; j++) {
    runner.checkAborted();
    const avatarName = avatars[j];
    const avatarPath = path.join(avatarDir, avatarName);
    const avatarBase = sanitizeFilename(path.parse(avatarName).name);

    let avatarBuffer;
    try {
      avatarBuffer = await circleCrop(avatarPath, size);
    } catch (err) {
      errors.push({ avatar: avatarName, message: `Lỗi xử lý avatar: ${err.message}` });
      runner.log("error", `Avatar ${avatarName} failed: ${err.message}`);
      continue;
    }
    runner.setProgress(((j + 1) / m) * 5, `Pre-process avatar ${j + 1}/${m}`);

    const avatarOut = path.join(output, avatarBase);
    fs.mkdirSync(avatarOut, { recursive: true });

    for (let i = 0; i < n; i++) {
      runner.checkAborted();
      const thumbName = thumbs[i];
      const thumbPath = path.join(thumbDir, thumbName);
      const thumbBase = sanitizeFilename(path.parse(thumbName).name);
      const outPath = path.join(avatarOut, `${thumbBase}.jpg`);

      try {
        const meta = await sharp(thumbPath).rotate().metadata();
        const W = meta.width ?? 0;
        const H = meta.height ?? 0;
        if (size + 2 * margin > Math.min(W, H)) {
          errors.push({
            thumb: thumbName, avatar: avatarName,
            message: `Avatar quá lớn so với thumbnail (${W}×${H}, cần ≥ ${size + 2 * margin}px)`,
          });
          runner.log("warn", `Skip ${thumbName} × ${avatarName}: too small`);
          continue;
        }
        const [left, top] = positionXY(position, W, H, size, margin);
        await sharp(thumbPath)
          .rotate()
          .composite([{ input: avatarBuffer, left, top }])
          .jpeg({ quality: 90 })
          .toFile(outPath);
        outputs.push(outPath);
      } catch (err) {
        errors.push({
          thumb: thumbName, avatar: avatarName,
          message: `Lỗi xử lý ảnh: ${err.message}`,
        });
        runner.log("error", `${thumbName} × ${avatarName} failed: ${err.message}`);
      }

      const done = j * n + i + 1;
      runner.setProgress(5 + (done / (n * m)) * 95, `${done}/${n * m}`);
    }
  }

  runner.setProgress(100, `Đã ghi ${outputs.length}/${n * m}`);
  return { ok: errors.length === 0, outputs, errors };
}

function positionXY(position, W, H, size, margin) {
  switch (position) {
    case "top-left":     return [margin, margin];
    case "top-right":    return [W - size - margin, margin];
    case "bottom-left":  return [margin, H - size - margin];
    case "bottom-right": return [W - size - margin, H - size - margin];
    case "center":       return [Math.round((W - size) / 2), Math.round((H - size) / 2)];
    default: throw new Error(`Unknown position: ${position}`);
  }
}
