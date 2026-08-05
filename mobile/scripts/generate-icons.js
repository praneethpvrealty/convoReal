/* eslint-disable */
// Regenerates the mobile icon + aurora asset set from the ConvoReal
// mark. The geometry mirrors `public/brand/convoreal-mark.svg` — a
// pitched roof and a message bubble sharing one silhouette, with a
// left-aligned enquiry bar and a right-aligned reply bar in gold.
//
// Run: node scripts/generate-icons.js   (rewrites assets/images/*)
//
// Colours mirror the `brand` constants in lib/theme.ts; keep the two in
// step rather than editing hexes here.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const BRAND = {
  violet: [124, 58, 237],
  violetLight: [139, 92, 246],
  violetDeep: [76, 42, 158],
  gold: [245, 192, 68],
  white: [255, 255, 255],
  ink: [11, 16, 32],
  paper: [239, 237, 248],
};

const SS = 4; // supersampling factor — the edges are all diagonals

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// ---------------------------------------------------------------- geometry
// All shapes are expressed in the mark's own 64x64 space.

function inTriangle(px, py, [x1, y1], [x2, y2], [x3, y3]) {
  const d1 = (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
  const d2 = (px - x3) * (y2 - y3) - (x2 - x3) * (py - y3);
  const d3 = (px - x1) * (y3 - y1) - (x3 - x1) * (py - y1);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Rounded rect with the radius only on the bottom (the roof covers the top). */
function inBody(x, y, x1, y1, x2, y2, r) {
  if (x < x1 || x > x2 || y < y1 || y > y2) return false;
  if (y < y2 - r) return true;
  const cx = Math.max(x1 + r, Math.min(x2 - r, x));
  return (x - cx) ** 2 + (y - (y2 - r)) ** 2 <= r * r;
}

/** Pill: distance to a horizontal centre segment. */
function inPill(x, y, x1, x2, cy, r) {
  const cx = Math.max(x1, Math.min(x2, x));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

const ROOF = [
  [32, 4.6],
  [6.4, 25.2],
  [57.6, 25.2],
];
const TAIL = [
  [20, 52],
  [8.6, 60.8],
  [7, 49],
];

/** 'bar-in' | 'bar-out' | 'mark' | null for a point in mark space. */
function markAt(x, y) {
  if (inPill(x, y, 19.5, 38.5, 31.5, 3)) return 'bar-in';
  if (inPill(x, y, 28.5, 44.5, 42, 3)) return 'bar-out';
  const solid =
    inBody(x, y, 7, 24, 57, 52, 9) || inTriangle(x, y, ...ROOF) || inTriangle(x, y, ...TAIL);
  return solid ? 'mark' : null;
}

// ---------------------------------------------------------------- painting

/**
 * @param size          output edge in px
 * @param opts.tile     'gradient' | 'flat' | null — background treatment
 * @param opts.radius   rounded-corner radius for the tile, in px
 * @param opts.scale    fraction of the canvas the mark occupies
 * @param opts.barInColor enquiry bar colour, or null to punch a hole
 */
function render(size, opts) {
  const {
    tile = null,
    radius = 0,
    scale = 0.74,
    markColor = BRAND.white,
    barInColor = null,
    barOutColor = BRAND.gold,
    flatColor = BRAND.violet,
  } = opts;

  const png = new PNG({ width: size, height: size });
  const span = size * scale;
  const ox = (size - span) / 2;
  const oy = (size - span) / 2;
  const toMark = (v, o) => ((v - o) / span) * 64;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          let rgba = null;

          if (tile) {
            let inside = true;
            if (radius > 0) {
              const cx = Math.max(radius, Math.min(size - radius, px));
              const cy = Math.max(radius, Math.min(size - radius, py));
              inside = (px - cx) ** 2 + (py - cy) ** 2 <= radius * radius;
            }
            if (inside) {
              rgba =
                tile === 'gradient'
                  ? [...mix(BRAND.violetLight, BRAND.violetDeep, (px + py) / (2 * size)), 255]
                  : [...flatColor, 255];
            }
          }

          const hit = markAt(toMark(px, ox), toMark(py, oy));
          if (hit === 'mark') rgba = [...markColor, 255];
          else if (hit === 'bar-in') rgba = barInColor ? [...barInColor, 255] : rgba;
          else if (hit === 'bar-out') rgba = [...barOutColor, 255];

          if (rgba) {
            r += rgba[0] * rgba[3];
            g += rgba[1] * rgba[3];
            b += rgba[2] * rgba[3];
            a += rgba[3];
          }
        }
      }

      const n = SS * SS;
      const idx = (size * y + x) << 2;
      png.data[idx] = a ? Math.round(r / a) : 0;
      png.data[idx + 1] = a ? Math.round(g / a) : 0;
      png.data[idx + 2] = a ? Math.round(b / a) : 0;
      png.data[idx + 3] = Math.round(a / n);
    }
  }
  return PNG.sync.write(png);
}

/** Pre-baked aurora wash — RN cannot render radial gradients natively. */
function renderAurora(w, h, base, blobs) {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let [r, g, b] = base;
      for (const [bx, by, br, color, strength] of blobs) {
        const d = Math.hypot((x - bx * w) / (br * w), (y - by * h) / (br * h));
        const f = Math.max(0, 1 - d) ** 2 * strength;
        if (f > 0) [r, g, b] = mix([r, g, b], color, f);
      }
      const idx = (w * y + x) << 2;
      png.data[idx] = Math.round(r);
      png.data[idx + 1] = Math.round(g);
      png.data[idx + 2] = Math.round(b);
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

const out = path.join(__dirname, '..', 'assets', 'images');
const write = (name, buf) => {
  fs.writeFileSync(path.join(out, name), buf);
  console.log('  ', name);
};

// Store icon — full bleed, no rounding (the platform masks it).
write('icon.png', render(1024, { tile: 'gradient', scale: 0.72, barInColor: BRAND.violetDeep }));

// Android adaptive foreground — the launcher crops to the inner 66%, and
// app.json paints Violet Deep behind, so the enquiry bar is a hole.
write('adaptive-icon.png', render(1024, { scale: 0.46, barInColor: null }));

// Splash — mark alone over the Ink background set in app.json.
write('splash-icon.png', render(512, { scale: 0.82, barInColor: BRAND.ink }));

// Web favicon for the Expo web build.
write('favicon.png', render(48, { tile: 'flat', radius: 10, scale: 0.66, barInColor: BRAND.violet }));

write(
  'aurora-light.png',
  renderAurora(720, 1280, BRAND.paper, [
    [0.16, 0.08, 0.62, [196, 181, 253], 0.55],
    [0.92, 0.3, 0.55, [221, 214, 254], 0.5],
    [0.5, 1.02, 0.75, [167, 139, 250], 0.28],
  ])
);

write(
  'aurora-dark.png',
  renderAurora(720, 1280, BRAND.ink, [
    [0.14, 0.06, 0.6, [76, 42, 158], 0.72],
    [0.95, 0.26, 0.5, [46, 30, 96], 0.6],
    [0.5, 1.04, 0.8, [91, 52, 184], 0.34],
  ])
);

console.log('Assets written to', out);
