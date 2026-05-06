import fs from "fs";
import path from "path";

export const REQUIRED_SUBFOLDERS = [
  "overlays", "backgrounds", "combined_videos", "done",
  "input", "output", "thumbs", "temp", "overlays_convert",
];

export function ensureWorkspace(root) {
  fs.mkdirSync(root, { recursive: true });
  for (const sub of REQUIRED_SUBFOLDERS) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
}

export function defaultsForTask(ws, type) {
  const p = (sub) => path.join(ws, sub);
  switch (type) {
    case "render":
      return {
        inputs: { overlays: p("overlays"), backgrounds: p("backgrounds"), combined: p("combined_videos") },
        output: p("done"),
      };
    case "snow":
      return { input: p("input"), output: p("output"), snowAsset: "" };
    case "trim":
      return { input: p("input"), output: p("done") };
    case "cutBg":
      return { input: p("backgrounds"), output: p("backgrounds") };
    case "thumb":
      return { input: p("overlays"), overlays: p("overlays_convert"), output: p("thumbs") };
    case "concat":
      return { thumbsDir: p("thumbs"), doneDir: p("done"), output: p("output"), tempDir: p("temp") };
    case "rename":
      return { folder: p("thumbs") };
    default:
      throw new Error(`Unknown task type: ${type}`);
  }
}
