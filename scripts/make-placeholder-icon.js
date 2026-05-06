import sharp from "sharp";
import path from "path";
import fs from "fs";

const buildDir = path.resolve("build");
fs.mkdirSync(buildDir, { recursive: true });

const svg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <rect width="1024" height="1024" rx="160" fill="#3b82f6"/>
  <text x="50%" y="58%" font-family="Segoe UI, sans-serif" font-size="500" font-weight="700"
        text-anchor="middle" fill="#fff">VM</text>
</svg>`);
await sharp(svg).png().toFile(path.join(buildDir, "icon.png"));
console.log("✓ icon.png");
