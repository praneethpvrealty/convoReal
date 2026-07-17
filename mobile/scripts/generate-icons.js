/* eslint-disable */
// Generates the branded placeholder icon set (until a designed asset
// lands): violet→fuchsia gradient, white chat bubble, violet house.
// Run: node scripts/generate-icons.js   (regenerates assets/images/*)
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const VIOLET = [124, 58, 237];
const FUCHSIA = [192, 38, 211];

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function inRoundedSquare(x, y, size, r) {
  const min = 0;
  const max = size - 1;
  if (x < min || x > max || y < min || y > max) return false;
  const cx = Math.max(min + r, Math.min(max - r, x));
  const cy = Math.max(min + r, Math.min(max - r, y));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function inCircle(x, y, cx, cy, r) {
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function inTriangle(px, py, [x1, y1], [x2, y2], [x3, y3]) {
  const d1 = (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
  const d2 = (px - x3) * (y2 - y3) - (x2 - x3) * (py - y3);
  const d3 = (px - x1) * (y3 - y1) - (x3 - x1) * (py - y1);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function inRect(x, y, x1, y1, x2, y2) {
  return x >= x1 && x <= x2 && y >= y1 && y <= y2;
}

/**
 * Draws the mark centered at (cx, cy) with bubble radius r.
 * Returns 'white' | 'violet' | null for a pixel.
 */
function markAt(x, y, cx, cy, r) {
  const s = r / 330; // shape scale relative to the reference radius
  const bubble =
    inCircle(x, y, cx, cy, r) ||
    inTriangle(
      x,
      y,
      [cx - 170 * s, cy + 250 * s],
      [cx - 10 * s, cy + 310 * s],
      [cx - 120 * s, cy + 430 * s]
    );
  if (!bubble) return null;

  const roof = inTriangle(
    x,
    y,
    [cx, cy - 170 * s],
    [cx - 180 * s, cy + 10 * s],
    [cx + 180 * s, cy + 10 * s]
  );
  const body = inRect(x, y, cx - 130 * s, cy + 10 * s, cx + 130 * s, cy + 180 * s);
  const door = inRect(x, y, cx - 40 * s, cy + 70 * s, cx + 40 * s, cy + 180 * s);
  if ((roof || body) && !door) return 'violet';
  return 'white';
}

function render(size, { gradientBg, cornerRadius }) {
  const png = new PNG({ width: size, height: size });
  const cx = size / 2;
  const cy = size * 0.46;
  const r = size * 0.32;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      let rgba = [0, 0, 0, 0];

      if (gradientBg && inRoundedSquare(x, y, size, cornerRadius ?? 0)) {
        const t = (x + y) / (2 * size);
        rgba = [
          lerp(VIOLET[0], FUCHSIA[0], t),
          lerp(VIOLET[1], FUCHSIA[1], t),
          lerp(VIOLET[2], FUCHSIA[2], t),
          255,
        ];
      }

      const mark = markAt(x, y, cx, cy, r);
      if (mark === 'white') rgba = [255, 255, 255, 255];
      else if (mark === 'violet') rgba = [...VIOLET, 255];

      png.data[idx] = rgba[0];
      png.data[idx + 1] = rgba[1];
      png.data[idx + 2] = rgba[2];
      png.data[idx + 3] = rgba[3];
    }
  }
  return PNG.sync.write(png);
}

const out = path.join(__dirname, '..', 'assets', 'images');
fs.writeFileSync(path.join(out, 'icon.png'), render(1024, { gradientBg: true, cornerRadius: 0 }));
fs.writeFileSync(
  path.join(out, 'adaptive-icon.png'),
  render(1024, { gradientBg: false })
);
fs.writeFileSync(path.join(out, 'splash-icon.png'), render(512, { gradientBg: false }));
fs.writeFileSync(
  path.join(out, 'favicon.png'),
  render(48, { gradientBg: true, cornerRadius: 10 })
);
console.log('Icons written to', out);
