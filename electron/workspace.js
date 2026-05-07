import fs from "fs";
import path from "path";

export const REQUIRED_SUBFOLDERS = [
  "overlays", "backgrounds", "done",
];

const CHROMA_KEY_TEMPLATE = ``;

export function ensureWorkspace(root) {
  fs.mkdirSync(root, { recursive: true });
  for (const sub of REQUIRED_SUBFOLDERS) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
  const chromaPath = path.join(root, "chromaKey.txt");
  if (!fs.existsSync(chromaPath)) {
    fs.writeFileSync(chromaPath, CHROMA_KEY_TEMPLATE, "utf-8");
  }
}

export function defaultsForTask(ws, type) {
  const p = (sub) => path.join(ws, sub);
  switch (type) {
    case "render":
      return {
        inputs: { overlays: p("overlays"), backgrounds: p("backgrounds") },
        output: p("done"),
      };
    case "snow":
      return { input: "", output: p("done"), snowAsset: "" };
    case "trim":
      return { input: "", output: p("done") };
    case "trimEnds":
      return { input: "", output: p("done") };
    case "cutBg":
      return { input: p("backgrounds"), output: p("backgrounds") };
    default:
      throw new Error(`Unknown task type: ${type}`);
  }
}
