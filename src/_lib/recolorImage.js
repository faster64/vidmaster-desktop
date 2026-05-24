const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export function hexToRgb(hex) {
  if (typeof hex !== "string" || !HEX_RE.test(hex)) {
    throw new Error("Màu sai format (cần #RRGGBB)");
  }
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

export function rgbToHex({ r, g, b }) {
  const h = (n) => n.toString(16).padStart(2, "0").toUpperCase();
  return `#${h(r)}${h(g)}${h(b)}`;
}

// Mutates rgba in-place. Returns undefined.
export function recolorPixels(rgba, width, height, params) {
  const { sourceColor, tolerance, gradientStart, gradientEnd, gradientDirection } = params;
  const sR = sourceColor.r, sG = sourceColor.g, sB = sourceColor.b;
  const rMin = sR - tolerance, rMax = sR + tolerance;
  const gMin = sG - tolerance, gMax = sG + tolerance;
  const bMin = sB - tolerance, bMax = sB + tolerance;
  const startR = gradientStart.r, startG = gradientStart.g, startB = gradientStart.b;
  const deltaR = gradientEnd.r - startR;
  const deltaG = gradientEnd.g - startG;
  const deltaB = gradientEnd.b - startB;
  const horizontal = gradientDirection === "horizontal";

  for (let y = 0; y < height; y++) {
    const ratioY = horizontal ? 0 : y / height;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const R = rgba[i], G = rgba[i + 1], B = rgba[i + 2];
      if (R >= rMin && R <= rMax && G >= gMin && G <= gMax && B >= bMin && B <= bMax) {
        const ratio = horizontal ? x / width : ratioY;
        rgba[i]     = Math.round(startR + deltaR * ratio);
        rgba[i + 1] = Math.round(startG + deltaG * ratio);
        rgba[i + 2] = Math.round(startB + deltaB * ratio);
      }
    }
  }
}
