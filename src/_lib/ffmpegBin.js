import path from "node:path";
import { path as installerPath } from "@ffmpeg-installer/ffmpeg";

/**
 * Resolved ffmpeg.exe path, safe to spawn both in dev and inside an Electron
 * asar bundle.
 *
 * The @ffmpeg-installer package lives inside `app.asar` after build, but its
 * binary was unpacked to `app.asar.unpacked/` via `package.json >
 * build.asarUnpack`. Node's `fs` is asar-aware so the package's own
 * `verifyFile` check passes — but `child_process.spawn` is NOT asar-aware and
 * needs the real on-disk path, hence ENOENT when launched from inside
 * `app.asar`. Redirect to the unpacked location.
 */
function resolveFfmpegPath() {
  const sep = path.sep;
  const asarMarker = `app.asar${sep}`;
  const unpackedMarker = `app.asar.unpacked${sep}`;

  if (!installerPath.includes(asarMarker)) return installerPath;
  if (installerPath.includes(unpackedMarker)) return installerPath;

  return installerPath.replace(asarMarker, unpackedMarker);
}

export const ffmpegPath = resolveFfmpegPath();
