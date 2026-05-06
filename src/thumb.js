import fs from "fs";
import path from "path";
import sharp from "sharp";
import { TaskRunner } from "./_lib/runner.js";

export async function runThumb(config) {
  const runner = new TaskRunner(config);
  const {
    input,
    overlays: overlayImagesDir,
    output: outputBaseDir,
    overlaySize = 125,
  } = config;

  runner.checkAborted();

  const outputs = [];
  const errors = [];

  if (!fs.existsSync(input)) {
    runner.log("warn", `Missing base thumbnail dir: ${input}, skipping.`);
    return { ok: true, outputs, errors };
  }
  if (!fs.existsSync(overlayImagesDir)) {
    runner.log("warn", `Missing overlay images dir: ${overlayImagesDir}, skipping.`);
    return { ok: true, outputs, errors };
  }

  const overlayFiles = fs
    .readdirSync(overlayImagesDir)
    .filter((file) => /\.(jpg|jpeg|png|webp)$/i.test(file))
    .sort((a, b) => parseInt(path.parse(a).name) - parseInt(path.parse(b).name));

  if (overlayFiles.length === 0) {
    runner.log("warn", `No overlay images found in: ${overlayImagesDir}, skipping.`);
    return { ok: true, outputs, errors };
  }

  const inputThumbnailFiles = fs
    .readdirSync(input)
    .filter((file) => /\.(jpg|jpeg|png|webp)$/i.test(file));

  if (inputThumbnailFiles.length === 0) {
    runner.log("info", `No base thumbnails to process in ${input}.`);
    return { ok: true, outputs, errors };
  }

  runner.log(
    "info",
    `Processing ${inputThumbnailFiles.length} thumbnails with ${overlayFiles.length} overlay(s).`
  );

  const total = overlayFiles.length;

  for (let i = 0; i < overlayFiles.length; i++) {
    runner.checkAborted();

    const overlayFileName = overlayFiles[i];
    const overlayPath = path.join(overlayImagesDir, overlayFileName);
    const outputDirForThisOverlay = path.join(outputBaseDir, `${i + 1}`);

    if (!fs.existsSync(outputDirForThisOverlay)) {
      fs.mkdirSync(outputDirForThisOverlay, { recursive: true });
    }

    // Build circular overlay once per overlay file
    let overlayCircle;
    try {
      overlayCircle = await sharp(overlayPath)
        .resize(overlaySize, overlaySize)
        .composite([
          {
            input: Buffer.from(
              `<svg><circle cx="${overlaySize / 2}" cy="${overlaySize / 2}" r="${overlaySize / 2}" fill="white"/></svg>`
            ),
            blend: "dest-in",
          },
        ])
        .png()
        .toBuffer();
    } catch (err) {
      if (err.name === "AbortError") throw err;
      errors.push({ file: overlayFileName, message: err.message, stack: err.stack });
      runner.log("error", `Failed to build overlay circle for ${overlayFileName}: ${err.message}`);
      runner.setProgress(((i + 1) / total) * 100, `Overlay ${overlayFileName} failed`);
      continue;
    }

    // Apply this overlay to ALL base thumbnails
    for (const file of inputThumbnailFiles) {
      runner.checkAborted();
      const inputPath = path.join(input, file);
      const outputPath = path.join(outputDirForThisOverlay, file);
      try {
        const transformedBaseImage = await sharp(inputPath)
          .modulate({ brightness: 1.1, saturation: 1.2, hue: 20 })
          .toBuffer();
        const metadata = await sharp(transformedBaseImage).metadata();
        const x = metadata.width - overlaySize - 10;
        const y = 10;
        await sharp(transformedBaseImage)
          .composite([{ input: overlayCircle, top: y, left: x }])
          .toFile(outputPath);
        outputs.push(outputPath);
      } catch (err) {
        if (err.name === "AbortError") throw err;
        errors.push({ file, message: err.message, stack: err.stack });
        runner.log("error", `Error processing ${file} with overlay ${overlayFileName}: ${err.message}`);
      }
    }

    runner.setProgress(((i + 1) / total) * 100, `Overlay ${overlayFileName} done`);
  }

  runner.log("info", "All overlay thumbnail processing complete.");
  runner.setProgress(100, "Thumb done");
  return { ok: errors.length === 0, outputs, errors };
}
