import fs from "fs";
import path from "path";

export const REQUIRED_SUBFOLDERS = [
  "overlays", "backgrounds", "done",
  "input", "output",
];

const CHROMA_KEY_TEMPLATE = `# ChromaKey colors — mỗi dòng 1 mã hex 6 ký tự (không có dấu #)
# Dòng N áp cho overlay thứ N (theo thứ tự sort tên file overlay)
# Dòng bắt đầu bằng # hoặc dòng trống đều bị bỏ qua
# Ví dụ:
# D4F9D7
# FBFF02
`;

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
      return { input: p("input"), output: p("output"), snowAsset: "" };
    case "trim":
      return { input: p("input"), output: p("done") };
    case "cutBg":
      return { input: p("backgrounds"), output: p("backgrounds") };
    default:
      throw new Error(`Unknown task type: ${type}`);
  }
}
