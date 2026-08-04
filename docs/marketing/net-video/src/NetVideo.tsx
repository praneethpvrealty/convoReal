import { useEffect, useRef } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';

export const DURATION_MS = 29800;

const S2 = 10600;
const S3 = 18600;
const FD = 1600;
const RD = 450;
const LD = 2100;
const TD = 1100;
const Y_START = 470;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const easeOut = (p: number) => 1 - (1 - p) ** 3;
const easeOutBack = (p: number) =>
  1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2);
const rnd = (seed: number) => {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const font = (weight: number | string, size: number) =>
  `${weight} ${size}px Manrope, "DejaVu Sans", sans-serif`;

const CAM = { y: 150, z: -260, tilt: 0.45, f: 420, cx: 480, cy: 340 };
const CT = Math.cos(CAM.tilt);
const ST = Math.sin(CAM.tilt);
function project(x: number, y: number, z: number) {
  const Y = y - CAM.y;
  const Z = z - CAM.z;
  const Y2 = Y * CT + Z * ST;
  const Z2 = -Y * ST + Z * CT;
  const s = CAM.f / Z2;
  return { x: CAM.cx + x * s, y: CAM.cy - Y2 * s, s };
}

const NX = 16;
const NZ = 8;
const xAt = (i: number) => -336 + i * 42;
const zAt = (j: number) => 100 + j * 40;
const HOLE = { x: 0, z: 260, rx: 185, rz: 110 };
const SAG = 70;
const holeVal = (x: number, z: number) =>
  (x - HOLE.x) ** 2 / HOLE.rx ** 2 + (z - HOLE.z) ** 2 / HOLE.rz ** 2;
const inHole = (x: number, z: number) =>
  holeVal(x, z) < 1 + 0.18 * Math.sin(x * 0.113 + z * 0.071);

interface Node {
  x: number;
  z: number;
  hole: boolean;
}
interface Line {
  nodes: Node[];
  mid: number;
  broken: boolean;
  gapA: number;
  gapB: number;
  weaveStart: number;
}

function analyzeLines(): Line[] {
  const lines: Line[] = [];
  for (let j = 0; j <= NZ; j++) {
    const nodes: Node[] = [];
    for (let i = 0; i <= NX; i++)
      nodes.push({ x: xAt(i), z: zAt(j), hole: inHole(xAt(i), zAt(j)) });
    lines.push({ nodes, mid: Math.abs(zAt(j) - HOLE.z), broken: false, gapA: 0, gapB: 0, weaveStart: 0 });
  }
  for (let i = 0; i <= NX; i++) {
    const nodes: Node[] = [];
    for (let j = 0; j <= NZ; j++)
      nodes.push({ x: xAt(i), z: zAt(j), hole: inHole(xAt(i), zAt(j)) });
    lines.push({ nodes, mid: Math.abs(xAt(i) - HOLE.x), broken: false, gapA: 0, gapB: 0, weaveStart: 0 });
  }
  for (const ln of lines) {
    const first = ln.nodes.findIndex((n) => n.hole);
    if (first === -1) continue;
    let last = first;
    for (let k = first; k < ln.nodes.length; k++) if (ln.nodes[k].hole) last = k;
    ln.broken = true;
    ln.gapA = first - 1;
    ln.gapB = last + 1;
  }
  lines
    .filter((l) => l.broken)
    .sort((a, b) => a.mid - b.mid)
    .forEach((ln, k) => {
      ln.weaveStart = S2 + 1600 + k * 200;
    });
  return lines;
}
const LINES = analyzeLines();

interface Strand {
  x: number;
  z: number;
  ux: number;
  uz: number;
  inLen: number;
  len: number;
  phase: number;
}
const STRANDS: Strand[] = [];
for (const ln of LINES) {
  if (!ln.broken) continue;
  const isCol = ln.nodes[0].x === ln.nodes[1].x;
  for (const [idx, dir] of [
    [ln.gapA, 1],
    [ln.gapB, -1],
  ] as const) {
    const n = ln.nodes[idx];
    const h1 = Math.abs(Math.sin(n.x * 7 + n.z * 3));
    const h2 = Math.abs(Math.sin(n.x * 3.3 + n.z * 5.1));
    STRANDS.push({
      x: n.x,
      z: n.z,
      ux: isCol ? 0 : dir,
      uz: isCol ? dir : 0,
      inLen: 16 + h2 * 34,
      len: 46 + h1 * 42,
      phase: (n.x + n.z) * 0.05,
    });
  }
}

const LOST_RAW = [
  { type: 'House', title: '3 BHK House', loc: 'Koramangala', spec: '₹2.4 Cr · 1,850 sqft', wx: -250, wz: 185 },
  { type: 'Plot', title: 'Vacant Plot', loc: 'HSR Layout', spec: '2,400 sqft · East facing', wx: 245, wz: 205 },
  { type: 'Flat', title: '2 BHK Flat', loc: 'Indiranagar', spec: '₹95 L · 1,120 sqft', wx: -175, wz: 335 },
  { type: 'Villa', title: '3 BHK Villa', loc: 'Sarjapur Road', spec: '₹1.9 Cr · 2,400 sqft', wx: 175, wz: 345 },
  { type: 'Flat', title: '1 BHK Flat', loc: 'BTM Layout', spec: '₹52 L · 650 sqft', wx: -85, wz: 148 },
  { type: 'House', title: 'Duplex House', loc: 'JP Nagar', spec: '₹1.6 Cr · 1,600 sqft', wx: 60, wz: 380 },
];
const LOST = LOST_RAW.map((l, i) => {
  let thrRp = 1;
  let thrX = l.wx * 0.06;
  let thrZ = 260 + (l.wz - 260) * 0.08;
  for (let rp = 0; rp <= 1; rp += 0.0005) {
    const q = rp * rp;
    const x = lerp(l.wx, l.wx * 0.06, q);
    const z = lerp(l.wz, 260 + (l.wz - 260) * 0.08, q);
    if (holeVal(x, z) < 0.85) {
      thrRp = rp;
      thrX = x;
      thrZ = z;
      break;
    }
  }
  return { ...l, t0: 700 + i * 820, thrAge: FD + RD + thrRp * LD, thrX, thrZ };
});

const CAUGHT = [
  { type: 'Flat', title: '3 BHK Flat', loc: 'Koramangala', spec: '₹1.35 Cr · 1,540 sqft', wx: -185, wz: 235, matches: '3 buyer matches' },
  { type: 'Plot', title: 'Corner Plot', loc: 'HSR Layout', spec: '2,000 sqft · North', wx: 5, wz: 268, matches: '5 buyer matches' },
  { type: 'Villa', title: '4 BHK Villa', loc: 'Whitefield', spec: '₹3.1 Cr · 3,200 sqft', wx: 195, wz: 232, matches: '2 buyer matches' },
].map((l, i) => ({ ...l, t0: S3 + 600 + i * 2000, impact: S3 + 600 + i * 2000 + 1300 }));

const REQ_LABELS = [
  { text: '3 BHK · Koramangala', wx: -250, wz: 310 },
  { text: 'Plot ≥ 2,000 sqft · HSR', wx: 285, wz: 280 },
  { text: '₹90 L – 1.4 Cr · Flats', wx: -60, wz: 152 },
  { text: 'Villa · Whitefield', wx: 128, wz: 392 },
].map((r, i) => ({ ...r, showT: S2 + 5900 + i * 180 }));

interface Ripple {
  x: number;
  z: number;
  t0: number;
  A: number;
}
const RIPPLES: Ripple[] = [];
for (const l of LOST) {
  RIPPLES.push({ x: l.wx, z: l.wz, t0: l.t0 + FD, A: 20 });
  for (let k = 1; k * 320 < l.thrAge - FD - RD; k++) {
    const rp = (k * 320) / LD;
    if (rp <= 0.05) continue;
    const q = rp * rp;
    RIPPLES.push({
      x: lerp(l.wx, l.wx * 0.06, q),
      z: lerp(l.wz, 260 + (l.wz - 260) * 0.08, q),
      t0: l.t0 + FD + RD + k * 320,
      A: 4,
    });
  }
  RIPPLES.push({ x: l.thrX, z: l.thrZ, t0: l.t0 + l.thrAge, A: 9 });
}
RIPPLES.push({ x: 0, z: 260, t0: S2 + 1400, A: 26 });
RIPPLES.push({ x: 0, z: 260, t0: S2 + 5600, A: 20 });
for (const l of CAUGHT) RIPPLES.push({ x: l.wx, z: l.wz, t0: l.impact, A: 34 });

function bowlY(x: number, z: number) {
  const r2 = (x / 340) ** 2 + ((z - 260) / 170) ** 2;
  return -SAG * (1 - Math.min(r2, 1));
}
function netY(x: number, z: number, t: number) {
  let y = bowlY(x, z) + 2.5 * Math.sin(t * 0.0011 + (x + z) * 0.004);
  for (const r of RIPPLES) {
    const age = t - r.t0;
    if (age < 0 || age > 2600) continue;
    const d = Math.hypot(x - r.x, z - r.z);
    y += r.A * Math.sin(age * 0.014 - d * 0.05) * Math.exp(-d / 160) * Math.exp(-age / 700);
  }
  return y;
}

const RINGS = [
  { x: 0, z: 260, t0: S2 + 1400, rmax: 330, dur: 1100, color: 'rgba(139,92,246,0.85)' },
  { x: 0, z: 260, t0: S2 + 5600, rmax: 360, dur: 1300, color: 'rgba(167,139,250,0.7)' },
  ...CAUGHT.map((l) => ({ x: l.wx, z: l.wz, t0: l.impact, rmax: 130, dur: 750, color: 'rgba(245,192,68,0.9)' })),
];

interface Burst {
  t0: number;
  wx: number;
  wz: number;
  yOff: number;
  n: number;
  color: string;
  size: number;
  grav: number;
}
const BURSTS: Burst[] = [];
for (const ln of LINES) {
  if (!ln.broken) continue;
  const end = ln.nodes[ln.gapB];
  BURSTS.push({ t0: ln.weaveStart + 950, wx: end.x, wz: end.z, yOff: 0, n: 7, color: '#c4b5fd', size: 2.5, grav: 0 });
}
for (const l of CAUGHT) {
  BURSTS.push({ t0: l.impact, wx: l.wx, wz: l.wz, yOff: 40, n: 26, color: '#ffe9ad', size: 2.6, grav: 0.16 });
}

const retract = (t: number) => clamp01((t - (S2 + 1400)) / 1200);
const energize = (t: number) => clamp01((t - (S2 + 5600)) / 800);
const weaveProgress = (ln: Line, t: number) => easeOut(clamp01((t - ln.weaveStart) / 950));
const threadColor = (e: number) =>
  `rgb(${Math.round(lerp(70, 116, e))},${Math.round(lerp(83, 100, e))},${Math.round(lerp(107, 195, e))})`;

type Ctx = CanvasRenderingContext2D;
type Pt = { x: number; y: number; s: number };

function drawSmooth(ctx: Ctx, pts: Pt[]) {
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let k = 1; k < pts.length - 1; k++) {
    const xc = (pts[k].x + pts[k + 1].x) / 2;
    const yc = (pts[k].y + pts[k + 1].y) / 2;
    ctx.quadraticCurveTo(pts[k].x, pts[k].y, xc, yc);
  }
  if (pts.length > 1) ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
}

function drawPartial(ctx: Ctx, pts: Pt[], p: number) {
  let total = 0;
  const segs: number[] = [];
  for (let k = 1; k < pts.length; k++) {
    const d = Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
    segs.push(d);
    total += d;
  }
  let target = total * p;
  let end = pts[0];
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let k = 1; k < pts.length; k++) {
    if (target >= segs[k - 1]) {
      ctx.lineTo(pts[k].x, pts[k].y);
      end = pts[k];
      target -= segs[k - 1];
    } else {
      const f = target / segs[k - 1];
      end = { x: lerp(pts[k - 1].x, pts[k].x, f), y: lerp(pts[k - 1].y, pts[k].y, f), s: pts[k].s };
      ctx.lineTo(end.x, end.y);
      break;
    }
  }
  return end;
}

function renderBackground(ctx: Ctx) {
  const lg = ctx.createLinearGradient(0, 0, 0, 540);
  lg.addColorStop(0, '#0b1020');
  lg.addColorStop(1, '#070a14');
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, 960, 540);
  ctx.save();
  ctx.translate(480, 590);
  ctx.scale(1, 0.45);
  const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, 700);
  rg.addColorStop(0, 'rgba(139,92,246,0.09)');
  rg.addColorStop(1, 'rgba(139,92,246,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(-960, -700, 1920, 1400);
  ctx.restore();
  ctx.strokeStyle = 'rgba(148,163,184,0.028)';
  ctx.lineWidth = 1;
  for (let x = 52; x < 960; x += 52) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 540);
    ctx.stroke();
  }
}

function renderNet(ctx: Ctx, t: number) {
  const e = energize(t);
  const rp = retract(t);

  ctx.save();
  ctx.translate(480, 300);
  ctx.scale(1, 0.32);
  const g = ctx.createRadialGradient(0, 0, 40, 0, 0, 360);
  g.addColorStop(0, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 360, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const base = threadColor(e);
  ctx.lineCap = 'round';

  for (const ln of LINES) {
    const proj = ln.nodes.map((n) => project(n.x, netY(n.x, n.z, t), n.z));
    const midS = proj[Math.floor(proj.length / 2)].s;
    ctx.strokeStyle = base;
    ctx.lineWidth = (2.1 * midS) / 0.8;
    ctx.globalAlpha = Math.min(1, 0.55 + midS * 0.5);
    if (!ln.broken) {
      ctx.beginPath();
      drawSmooth(ctx, proj);
      ctx.stroke();
    } else {
      ctx.beginPath();
      drawSmooth(ctx, proj.slice(0, ln.gapA + 1));
      ctx.stroke();
      ctx.beginPath();
      drawSmooth(ctx, proj.slice(ln.gapB));
      ctx.stroke();
      const p = weaveProgress(ln, t);
      if (p > 0) {
        const bridge = proj.slice(ln.gapA, ln.gapB + 1);
        ctx.save();
        ctx.strokeStyle = e > 0 ? base : '#8b5cf6';
        ctx.shadowColor = '#8b5cf6';
        ctx.shadowBlur = e > 0 ? 6 : 12;
        ctx.lineWidth = (2.3 * midS) / 0.8;
        ctx.beginPath();
        const head = drawPartial(ctx, bridge, p);
        ctx.stroke();
        if (p < 1) {
          ctx.fillStyle = '#e9dfff';
          ctx.shadowBlur = 18;
          ctx.beginPath();
          ctx.arc(head.x, head.y, 4.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }
  ctx.globalAlpha = 1;

  if (rp < 1) {
    ctx.strokeStyle = threadColor(0);
    ctx.globalAlpha = 0.9 * (1 - rp);
    for (const s of STRANDS) {
      const yTop = netY(s.x, s.z, t);
      const lenNow = s.len * (1 - rp);
      const inNow = s.inLen * (1 - rp);
      const sway = Math.sin(t * 0.0025 + s.phase) * 10;
      const pts: Pt[] = [];
      for (let k = 0; k <= 5; k++) {
        const f = k / 5;
        pts.push(
          project(s.x + s.ux * inNow * f + sway * f * f, yTop - lenNow * Math.pow(f, 1.35), s.z + s.uz * inNow * f)
        );
      }
      ctx.lineWidth = (2 * pts[0].s) / 0.8;
      ctx.beginPath();
      drawSmooth(ctx, pts);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  for (const r of RINGS) {
    const p = clamp01((t - r.t0) / r.dur);
    if (p <= 0 || p >= 1) continue;
    const rad = r.rmax * easeOut(p);
    ctx.strokeStyle = r.color;
    ctx.globalAlpha = (1 - p) * 0.9;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = r.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    for (let k = 0; k <= 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      const wx = r.x + Math.cos(a) * rad;
      const wz = r.z + Math.sin(a) * rad * 0.8;
      const pt = project(wx, netY(wx, wz, t), wz);
      k === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
}

function renderParticles(ctx: Ctx, t: number) {
  for (const b of BURSTS) {
    const bAge = t - b.t0;
    if (bAge < 0 || bAge > 950) continue;
    const oPt = project(b.wx, netY(b.wx, b.wz, b.t0), b.wz);
    const ox = oPt.x;
    const oy = oPt.y - b.yOff;
    for (let j = 0; j < b.n; j++) {
      const s0 = b.t0 * 0.013 + j * 7.7;
      const life = 500 + rnd(s0 + 2) * 420;
      if (bAge > life) continue;
      const a = rnd(s0) * Math.PI * 2;
      const v = 1.2 + rnd(s0 + 1) * 3.2;
      const T = bAge / 16;
      const px = ox + Math.cos(a) * v * T;
      const py = oy + (Math.sin(a) * v - 1.6) * T + (b.grav * T * T) / 2;
      ctx.globalAlpha = 1 - bAge / life;
      ctx.fillStyle = b.color;
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(px, py, b.size * (0.7 + rnd(s0 + 3) * 0.7), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const chargeStart = S2 + 300;
  const chargeEnd = S2 + 1400;
  const target = project(0, 118, HOLE.z);
  for (let k = 0; k * 6 + chargeStart < chargeEnd; k++) {
    const ts = chargeStart + k * 6;
    const age = t - ts;
    if (age < 0 || age > 620) continue;
    const r0 = 70 + rnd(k * 3.1) * 60;
    const a = rnd(k * 3.1 + 1) * Math.PI * 2;
    const d = r0 * Math.pow(0.91, age / 16);
    ctx.globalAlpha = 1 - age / 620;
    ctx.fillStyle = '#a78bfa';
    ctx.shadowColor = '#a78bfa';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(target.x + Math.cos(a) * d, target.y + Math.sin(a) * d * 0.7, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

interface CardState {
  x: number;
  y: number;
  z: number;
  rotX: number;
  rotZ: number;
  op: number;
  behind: boolean;
}

function lostCardState(l: (typeof LOST)[number], t: number): CardState | null {
  const age = t - l.t0;
  if (age < 0) return null;
  let x = l.wx;
  let z = l.wz;
  let y: number;
  let rotX = 6;
  let rotZ = 0;
  let op = 1;
  if (age < l.thrAge) {
    if (age < FD) {
      const p = age / FD;
      y = lerp(Y_START, netY(x, z, t) + 4, Math.pow(p, 1.6));
      rotX = 5 + p * 4;
      op = p < 0.05 ? p * 20 : 1;
    } else if (age < FD + RD) {
      const bt = age - FD;
      y = netY(x, z, t) + 4 + 15 * Math.exp(-bt / 260) * Math.cos(bt * 0.021);
      rotX = 9;
    } else {
      const rp = clamp01((age - FD - RD) / LD);
      const q = rp * rp;
      x = lerp(l.wx, l.wx * 0.06, q);
      z = lerp(l.wz, 260 + (l.wz - 260) * 0.08, q);
      y = netY(x, z, t) + 4 + 3 * Math.abs(Math.sin(q * 24)) * (1 - q);
      rotX = 9;
      rotZ = Math.sign(-l.wx) * 6 * Math.sin(rp * Math.PI);
    }
  } else {
    const tp = clamp01((age - l.thrAge) / TD);
    if (tp >= 1) return null;
    x = lerp(l.thrX, l.thrX * 0.72, tp);
    z = lerp(l.thrZ, 260 + (l.thrZ - 260) * 0.72, tp);
    y = netY(l.thrX, l.thrZ, l.t0 + l.thrAge) + 4 - 880 * Math.pow(tp, 1.75);
    rotX = 9 + tp * 26;
    op = tp < 0.12 ? 1 : Math.max(0, 1 - (tp - 0.12) / 0.75);
  }
  return { x, y, z, rotX, rotZ, op, behind: y < netY(x, z, t) - 6 };
}

function caughtCardState(l: (typeof CAUGHT)[number], t: number) {
  const age = t - l.t0;
  if (age < 0) return null;
  const p = clamp01(age / 1300);
  const netYs = netY(l.wx, l.wz, t) + 3;
  const bt = Math.max(0, age - 1300);
  const y = p < 1 ? lerp(Y_START, netYs, Math.pow(p, 1.7)) : netYs + 24 * Math.exp(-bt / 360) * Math.cos(bt * 0.019);
  const rotZ = p < 1 ? -2 + p * 3 : 1.2 * Math.exp(-bt / 500) * Math.sin(bt * 0.012);
  const op = p < 0.05 ? p * 20 : 1;
  const chipP = clamp01((age - 1540) / 350);
  return { x: l.wx, y, z: l.wz, rotX: 12, rotZ, op, caught: p >= 1, chipP };
}

interface CardText {
  type: string;
  title: string;
  loc: string;
  spec: string;
}

function drawCard(
  ctx: Ctx,
  st: { x: number; y: number; z: number; rotX: number; rotZ: number; op: number },
  card: CardText,
  opts: { caught?: boolean; chipP?: number; matches?: string } = {}
) {
  const pt = project(st.x, st.y, st.z);
  const sc = pt.s;
  ctx.save();
  ctx.translate(pt.x, pt.y - 58 * sc);
  ctx.rotate((st.rotZ * Math.PI) / 180);
  ctx.scale(sc, sc * Math.cos((st.rotX * Math.PI) / 180));
  ctx.globalAlpha = st.op;

  ctx.beginPath();
  ctx.roundRect(-64, -64, 128, 128, 14);
  ctx.fillStyle = 'rgba(15,23,42,0.92)';
  if (opts.caught) {
    ctx.shadowColor = 'rgba(245,192,68,0.55)';
    ctx.shadowBlur = 26;
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 18;
  }
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = opts.caught ? 'rgba(245,192,68,0.8)' : '#33415c';
  ctx.lineWidth = opts.caught ? 1.6 : 1.1;
  ctx.stroke();

  const c = ctx as Ctx & { letterSpacing: string };
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#a78bfa';
  ctx.font = font(700, 9);
  c.letterSpacing = '1.4px';
  ctx.fillText(card.type.toUpperCase(), -51, -40);
  c.letterSpacing = '0px';
  ctx.fillStyle = '#e6eaf3';
  ctx.font = font(700, 15);
  ctx.fillText(card.title, -51, -21);
  ctx.fillStyle = '#8d99b2';
  ctx.font = font(400, 11.5);
  ctx.fillText(card.loc, -51, -5);
  ctx.strokeStyle = '#26334c';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-51, 30);
  ctx.lineTo(51, 30);
  ctx.stroke();
  ctx.fillStyle = '#c3cbdc';
  ctx.font = font(600, 11.5);
  ctx.fillText(card.spec, -51, 47);

  if (opts.chipP && opts.chipP > 0 && opts.matches) {
    const cp = opts.chipP;
    const scale = 0.6 + 0.4 * easeOutBack(cp);
    ctx.save();
    ctx.translate(0, 71);
    ctx.scale(scale, scale);
    ctx.globalAlpha = st.op * cp;
    ctx.font = font(700, 10);
    const txt = '✓ ' + opts.matches;
    const w = ctx.measureText(txt).width + 20;
    const grad = ctx.createLinearGradient(0, -10, 0, 10);
    grad.addColorStop(0, '#ffe9ad');
    grad.addColorStop(1, '#f5c044');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -10, w, 20, 10);
    ctx.shadowColor = 'rgba(245,192,68,0.7)';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#100c02';
    ctx.textAlign = 'center';
    ctx.fillText(txt, 0, 3.5);
    ctx.restore();
  }
  ctx.restore();
}

function renderLabels(ctx: Ctx, t: number) {
  const c = ctx as Ctx & { letterSpacing: string };
  for (const r of REQ_LABELS) {
    const a = clamp01((t - r.showT) / 500);
    if (a <= 0) continue;
    const dim = t >= S3 ? 0.45 : 1;
    const pt = project(r.wx, netY(r.wx, r.wz, t) + 6, r.wz);
    const scale = (0.75 + pt.s * 0.45) * (0.7 + 0.3 * easeOutBack(a));
    ctx.save();
    ctx.translate(pt.x, pt.y - 16);
    ctx.scale(scale, scale);
    ctx.globalAlpha = a * dim;
    ctx.font = font(600, 10.5);
    const w = ctx.measureText(r.text).width + 34;
    ctx.fillStyle = 'rgba(139,92,246,0.2)';
    ctx.strokeStyle = 'rgba(139,92,246,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -12, w, 24, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#a78bfa';
    ctx.shadowColor = '#8b5cf6';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(-w / 2 + 12, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#d9d3f5';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    c.letterSpacing = '0.2px';
    ctx.fillText(r.text, -w / 2 + 21, 1);
    c.letterSpacing = '0px';
    ctx.restore();
  }
  ctx.textBaseline = 'alphabetic';
}

function renderEngine(ctx: Ctx, t: number) {
  const onT = S2 + 300;
  const offT = S3 - 800;
  if (t < onT || t > offT + 600) return;
  const aIn = easeOutBack(clamp01((t - onT) / 600));
  const aOut = clamp01((t - offT) / 600);
  const alpha = clamp01(aIn) * (1 - aOut);
  if (alpha <= 0) return;
  const scale = lerp(0.4, 1, aIn) * (1 - 0.5 * aOut);
  ctx.save();
  ctx.translate(480, 148);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;

  const th1 = ((t % 1600) / 1600) * Math.PI * 2;
  ctx.strokeStyle = '#8b5cf6';
  ctx.lineWidth = 2.6;
  ctx.shadowColor = '#8b5cf6';
  ctx.shadowBlur = 8;
  for (let i = 0; i < 3; i++) {
    ctx.globalAlpha = alpha * (1 - i * 0.32);
    ctx.beginPath();
    ctx.arc(0, 0, 42, th1 - 0.5 - i * 0.5, th1 - i * 0.5);
    ctx.stroke();
  }
  const th2 = -((t % 2400) / 2400) * Math.PI * 2;
  ctx.globalAlpha = alpha * 0.6;
  ctx.beginPath();
  ctx.arc(0, 0, 33, th2 - 0.9, th2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = alpha;

  const grad = ctx.createLinearGradient(-20, -20, 20, 20);
  grad.addColorStop(0, '#7c4fe8');
  grad.addColorStop(1, '#5b34b8');
  ctx.fillStyle = grad;
  ctx.shadowColor = 'rgba(139,92,246,0.55)';
  ctx.shadowBlur = 30;
  ctx.beginPath();
  ctx.roundRect(-20, -20, 40, 40, 12);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#f2edff';
  ctx.font = font(800, 20);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('C', 0, 2);

  ctx.font = font(700, 13);
  const parts: Array<[string, string]> = [
    ['Convo', '#e6eaf3'],
    ['Real', '#a78bfa'],
    [' engine', '#e6eaf3'],
  ];
  const total = parts.reduce((w, [txt]) => w + ctx.measureText(txt).width, 0);
  let px = -total / 2;
  ctx.textAlign = 'left';
  for (const [txt, color] of parts) {
    ctx.fillStyle = color;
    ctx.fillText(txt, px, 66);
    px += ctx.measureText(txt).width;
  }
  ctx.restore();
  ctx.textBaseline = 'alphabetic';
}

const CAPTIONS = [
  { t0: 100, tone: '', eyebrow: '01 · Today', head: 'Listings land all over the net… and every one slips through the tear.' },
  { t0: S2, tone: 'violet', eyebrow: '02 · The ConvoReal engine', head: 'Buyer requirements are woven back into the net.' },
  { t0: S3, tone: 'gold', eyebrow: '03 · After ConvoReal', head: 'Every new listing is caught — and matched.' },
  { t0: S3 + 7400, tone: 'gold', eyebrow: 'ConvoReal', head: 'The WhatsApp deal engine that never lets a listing slip.' },
];

function wrapText(ctx: Ctx, text: string, maxW: number) {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? cur + ' ' + w : w;
    if (ctx.measureText(trial).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = trial;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function renderCaption(ctx: Ctx, t: number) {
  const c = ctx as Ctx & { letterSpacing: string };
  let idx = -1;
  for (let i = 0; i < CAPTIONS.length; i++) if (t >= CAPTIONS[i].t0) idx = i;
  if (idx < 0) return;
  const cap = CAPTIONS[idx];
  let alpha = clamp01((t - cap.t0 - 420) / 450);
  const next = CAPTIONS[idx + 1];
  if (next) alpha = Math.min(alpha, 1 - clamp01((t - next.t0) / 1) * 0);
  if (next && t > next.t0 - 420) alpha = Math.min(alpha, clamp01((next.t0 - t) / 420));
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const eyeColor = cap.tone === 'gold' ? '#f5c044' : cap.tone === 'violet' ? '#a78bfa' : '#8d99b2';
  ctx.font = font(700, 23);
  const lines = wrapText(ctx, cap.head, 430);
  const headH = lines.length * 28;
  const baseY = 540 - 34;
  ctx.font = font(700, 10.5);
  c.letterSpacing = '2.3px';
  ctx.fillStyle = eyeColor;
  ctx.textAlign = 'left';
  ctx.fillText(cap.eyebrow.toUpperCase(), 44, baseY - headH - 12);
  c.letterSpacing = '0px';
  ctx.font = font(700, 23);
  ctx.fillStyle = '#e6eaf3';
  lines.forEach((ln, i) => {
    ctx.fillText(ln, 44, baseY - headH + 22 + i * 28);
  });
  ctx.restore();
}

function renderBrand(ctx: Ctx) {
  ctx.save();
  ctx.globalAlpha = 0.9;
  const x = 960 - 36;
  const y = 26;
  ctx.font = font(700, 14);
  const tw = ctx.measureText('ConvoReal').width;
  const grad = ctx.createLinearGradient(x - tw - 30, y, x - tw - 8, y + 22);
  grad.addColorStop(0, '#8b5cf6');
  grad.addColorStop(1, '#5b34b8');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(x - tw - 30, y, 22, 22, 7);
  ctx.fill();
  ctx.fillStyle = '#f2edff';
  ctx.font = font(800, 12);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('C', x - tw - 19, y + 12);
  ctx.fillStyle = '#e6eaf3';
  ctx.font = font(700, 14);
  ctx.textAlign = 'left';
  ctx.fillText('ConvoReal', x - tw, y + 12);
  ctx.restore();
  ctx.textBaseline = 'alphabetic';
}

function draw(ctx: Ctx, t: number) {
  ctx.save();
  ctx.scale(2, 2);
  renderBackground(ctx);

  const lostStates = LOST.map((l) => ({ l, st: lostCardState(l, t) }));
  for (const { l, st } of lostStates) {
    if (st && st.behind) drawCard(ctx, st, l);
  }

  renderNet(ctx, t);
  renderParticles(ctx, t);
  renderLabels(ctx, t);

  for (const { l, st } of lostStates) {
    if (st && !st.behind) drawCard(ctx, st, l);
  }
  for (const l of CAUGHT) {
    const st = caughtCardState(l, t);
    if (st) drawCard(ctx, st, l, { caught: st.caught, chipP: st.chipP, matches: l.matches });
  }

  renderEngine(ctx, t);
  renderCaption(ctx, t);
  renderBrand(ctx);
  ctx.restore();
}

export const NetVideo = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 1920, 1080);
    draw(ctx, (frame / fps) * 1000);
  }, [frame, fps]);
  return <canvas ref={ref} width={1920} height={1080} style={{ width: '100%', height: '100%' }} />;
};
