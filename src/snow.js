import fs from "fs";
import path from "path";
import { TaskRunner } from "./_lib/runner.js";

const CONFIG = {
  processing: {
    maxConcurrent: 3,
  },
  video: {
    fps: 30,
  },
  ffmpeg: {
    preset: "veryfast",
    crf: 23,
  },
};

const getRandomInt = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const getDynamicFilter = (durationInSeconds, fps) => {
  const totalFrames = durationInSeconds * fps + 50;
  const commonParams = `:d=${totalFrames}:s=1280x720:fps=${fps}`;
  const ZOOM_SPEED = 0.001;
  const MAX_ZOOM = 1.6;
  const PAN_ZOOM = 1.4;

  const effects = [
    {
      name: "Zoom In Center",
      filter: `zoompan=z='min(zoom+${ZOOM_SPEED},${MAX_ZOOM})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${commonParams}`,
    },
    {
      name: "Zoom Out Center",
      filter: `zoompan=z='if(eq(on,1),${MAX_ZOOM},max(1.001,zoom-${ZOOM_SPEED}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${commonParams}`,
    },
    {
      name: "Pan Right",
      filter: `zoompan=z='${PAN_ZOOM}':x='(iw-iw/zoom)*(on/${totalFrames})':y='(ih-ih/zoom)/2'${commonParams}`,
    },
    {
      name: "Pan Left",
      filter: `zoompan=z='${PAN_ZOOM}':x='(iw-iw/zoom)*(1-on/${totalFrames})':y='(ih-ih/zoom)/2'${commonParams}`,
    },
  ];

  return effects[getRandomInt(0, effects.length - 1)];
};

export async function runSnow(config) {
  const {
    input,
    output,
    snowAsset,
    duration,
  } = config;

  const runner = new TaskRunner(config);

  // Abort check before any work
  runner.checkAborted();

  // Validate snowAsset exists upfront
  if (!fs.existsSync(snowAsset)) {
    throw new Error(`snowAsset not found: ${snowAsset}`);
  }

  fs.mkdirSync(output, { recursive: true });

  const fps = CONFIG.video.fps;
  const outputs = [];
  const errors = [];

  runner.log("info", `Starting snow overlay rendering`);
  runner.log("info", `FPS: ${fps}`);

  // Collect all subfolders (or treat input dir directly if it has images)
  const entries = fs.readdirSync(input);
  const subFolders = entries.filter((e) =>
    fs.lstatSync(path.join(input, e)).isDirectory()
  );

  // If no subfolders, treat the input dir itself as a flat image directory
  const folderList = subFolders.length > 0
    ? subFolders.map((f) => ({ folderName: f, inputFolderPath: path.join(input, f), outputFolderPath: path.join(output, f) }))
    : [{ folderName: ".", inputFolderPath: input, outputFolderPath: output }];

  // Build task list
  const allImages = [];
  for (const { folderName, inputFolderPath, outputFolderPath } of folderList) {
    runner.checkAborted();

    fs.mkdirSync(outputFolderPath, { recursive: true });

    const images = fs
      .readdirSync(inputFolderPath)
      .filter((file) =>
        [".jpg", ".jpeg", ".png"].includes(path.extname(file).toLowerCase())
      );

    if (images.length === 0) continue;

    runner.log("info", `Folder "${folderName}": ${images.length} image(s)`);

    for (const imageFile of images) {
      const imagePath = path.join(inputFolderPath, imageFile);
      const segDuration = duration !== undefined ? duration : getRandomInt(10, 15);
      const imageNameWithoutExt = path.parse(imageFile).name;
      const outputFileName = `${imageNameWithoutExt}.mp4`;
      const outputPath = path.join(outputFolderPath, outputFileName);
      allImages.push({ imagePath, imageFile, outputPath, segDuration });
    }
  }

  for (let i = 0; i < allImages.length; i++) {
    runner.checkAborted();

    const { imagePath, imageFile, outputPath, segDuration } = allImages[i];

    if (fs.existsSync(outputPath)) {
      runner.log("info", `Skipped (exists): ${imageFile}`);
      outputs.push(outputPath);
      runner.setProgress(((i + 1) / allImages.length) * 100, `Skip ${imageFile}`);
      continue;
    }

    try {
      const effect = getDynamicFilter(segDuration, fps);

      const args = [
        "-i", imagePath,
        "-i", snowAsset,
        "-stream_loop", "-1",
        "-filter_complex",
        [
          `[0:v]scale=1920:-2,${effect.filter}[bg]`,
          `[1:v]scale=1280:720,setsar=1,colorkey=0x000000:0.1:0.3[snow]`,
          `[bg][snow]overlay=0:0[out]`,
        ].join(";"),
        "-map", "[out]",
        "-t", String(segDuration),
        "-r", String(fps),
        "-preset", CONFIG.ffmpeg.preset,
        "-crf", String(CONFIG.ffmpeg.crf),
        "-movflags", "+faststart",
        "-pix_fmt", "yuv420p",
        "-y",
        outputPath,
      ];

      await runner.spawnFfmpeg(args, { totalDurationSec: segDuration });
      runner.log("info", `Done [${effect.name}]: ${imageFile}`);
      outputs.push(outputPath);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      errors.push({ file: imageFile, message: err.message, stack: err.stack });
      runner.log("error", `Failed ${imageFile}: ${err.message}`);
    }

    runner.setProgress(((i + 1) / allImages.length) * 100, `Snow ${imageFile}`);
  }

  runner.setProgress(100, "Snow done");
  return { ok: errors.length === 0, outputs, errors };
}
