import pngToIco from "png-to-ico";
import sharp from "sharp";
import fs from "fs";
import path from "path";

const sizes = [16, 32, 48, 64, 128, 256];
const src = path.resolve("build", "icon.png");
const buffers = await Promise.all(
  sizes.map((s) => sharp(src).resize(s, s).png().toBuffer())
);
const ico = await pngToIco(buffers);
fs.writeFileSync(path.resolve("build", "icon.ico"), ico);
console.log("✓ icon.ico");
