import { useEffect, useRef, useState } from 'react';
import { continueRender, delayRender, useCurrentFrame, useVideoConfig } from 'remotion';
import { injectFonts } from './fonts';

export const SWITCHBOARD_DURATION_MS = 32500;

const S2 = 12000;
const S3 = 20000;
const FALL1 = 2200;
const FALL3 = 2000;
const PHONE = { x: 480, y: 358 };
const PANEL = { x: 420, y: 316 };
const ENGINE = { x: 420, y: 150 };
const AGENT_ARRIVE_BASE = S2 + 2350;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const easeOut = (p: number) => 1 - (1 - p) ** 3;
const easeOutBack = (p: number) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2;
const rnd = (seed: number) => {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const font = (weight: number | string, size: number) =>
  `${weight} ${size}px Manrope, "DejaVu Sans", sans-serif`;

type Ctx = CanvasRenderingContext2D;
type Pt = { x: number; y: number };

const AGENTS = [
  { name: 'Priya', role: 'Buyer leads', color: '#a78bfa', x: 788, y: 196 },
  { name: 'Arjun', role: 'Site visits', color: '#34d399', x: 788, y: 322 },
  { name: 'Meera', role: 'Portal leads', color: '#f5c044', x: 788, y: 448 },
];
const arriveT = (i: number) => AGENT_ARRIVE_BASE + i * 300;

interface Msg {
  text: string;
  src?: string;
  sc?: string;
  land?: boolean;
  tag?: string;
  agent?: number;
  t0: number;
  x0: number;
  off: number;
  dir: number;
}

const MSGS1: Msg[] = [
  { text: 'Is the 3 BHK in Koramangala available?', land: true },
  { text: 'Can we visit the HSR plot on Sunday?', land: true },
  { text: 'New lead: Rahul', src: 'MagicBricks', sc: '#f97316', land: true },
  { text: 'Price for the Whitefield villa?', land: true },
  { text: 'Budget ₹1.2 Cr, need 2 BHK' },
  { text: 'Send brochure please' },
  { text: 'New lead: Ananya', src: '99acres', sc: '#3b82f6' },
  { text: 'Loan approved, ready to book!' },
  { text: 'Any 2 BHK near Indiranagar metro?' },
  { text: 'Is the plot RERA approved?' },
  { text: 'Photos of the Sarjapur villa?' },
  { text: 'Call me back please…' },
].map((m, i) => ({
  ...m,
  t0: 800 + i * 700,
  x0: 180 + rnd(i * 3.7) * 600,
  off: (rnd(i * 5.1) - 0.5) * 50,
  dir: rnd(i * 7.3) > 0.5 ? 1 : -1,
}));

const BADGE_VALUES = [3, 7, 12, 19, 27, 38, 52, 67, 81, 94, 99, 132];
const BADGE_STEPS = MSGS1.map((m, i) => ({ t: m.t0 + FALL1, v: BADGE_VALUES[i] }));

const MSGS3 = [
  { text: '3 BHK in Koramangala?', tag: 'Buyer · Koramangala', agent: 0 },
  { text: 'Visit Sunday 11 am?', tag: 'Site visit · HSR', agent: 1 },
  { text: 'New lead: Rahul', src: 'MagicBricks', sc: '#f97316', tag: 'Portal lead', agent: 2 },
  { text: 'Budget ₹1.2 Cr, 2 BHK', tag: 'Buyer · Indiranagar', agent: 0 },
  { text: 'Reschedule to 5 pm?', tag: 'Site visit · Whitefield', agent: 1 },
  { text: 'New lead: Ananya', src: '99acres', sc: '#3b82f6', tag: 'Portal lead', agent: 2 },
].map((m, i) => {
  const t0 = S3 + 600 + i * 1500;
  return { ...m, t0, x0: 220 + rnd(i * 11.3) * 360, stampT: t0 + 1410, absorbT: t0 + 2150, arrive: t0 + 3100 };
});

const bezier = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt => {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
};

const THREADS = AGENTS.map((a, i) => {
  const p0 = { x: PANEL.x + 155, y: PANEL.y - 16 + i * 16 };
  const p3 = { x: a.x - 94, y: a.y };
  const p1 = { x: p0.x + 85, y: p0.y };
  const p2 = { x: p3.x - 85, y: p3.y };
  const pts: Pt[] = [];
  for (let k = 0; k <= 40; k++) pts.push(bezier(p0, p1, p2, p3, k / 40));
  return { pts, p0, color: a.color, drawStart: S2 + 1600 + i * 300, mid: bezier(p0, p1, p2, p3, 0.5) };
});

const WIRE_LABELS = ['Buyers → Priya', 'Site visits → Arjun', 'Portals → Meera'].map((text, i) => ({
  text,
  x: THREADS[i].mid.x,
  y: THREADS[i].mid.y - 28,
  showT: S2 + 2400 + i * 200,
}));

const CAPTIONS = [
  { t0: 100, tone: '', eyebrow: '01 · Today', head: 'Every buyer pings one personal number. Chats pile up — and bounce.' },
  { t0: S2, tone: 'violet', eyebrow: '02 · The ConvoReal engine', head: 'One shared inbox. Rules route every chat to the right agent.' },
  { t0: S3, tone: 'gold', eyebrow: '03 · After ConvoReal', head: 'Answered, assigned, and tagged — in minutes, not hours.' },
  { t0: 29500, tone: 'gold', eyebrow: 'ConvoReal', head: 'One inbox. Whole team. Zero missed leads.' },
];

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

function bubbleWidth(ctx: Ctx, m: { text: string; src?: string }) {
  ctx.font = font(400, 12.5);
  let w = ctx.measureText(m.text).width;
  if (m.src) {
    ctx.font = font(800, 8.5);
    w += ctx.measureText(m.src).width + 12 + 6;
  }
  return w + 24;
}

function drawBubble(
  ctx: Ctx,
  m: { text: string; src?: string; sc?: string; tag?: string; agent?: number },
  x: number,
  y: number,
  opacity: number,
  opts: { scale?: number; rotate?: number; gray?: number; chipP?: number } = {}
) {
  const w = bubbleWidth(ctx, m);
  const h = 32;
  ctx.save();
  ctx.translate(x, y);
  if (opts.rotate) ctx.rotate((opts.rotate * Math.PI) / 180);
  if (opts.scale !== undefined) ctx.scale(opts.scale, opts.scale);
  ctx.globalAlpha = opacity;

  const gray = opts.gray ?? 0;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 11);
  ctx.fillStyle = gray > 0 ? `rgb(${lerp(31, 42, gray)},${lerp(44, 44, gray)},${lerp(52, 44, gray)})` : '#1f2c34';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 14;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#2a3942';
  ctx.lineWidth = 1;
  ctx.stroke();

  let tx = -w / 2 + 12;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  if (m.src) {
    ctx.font = font(800, 8.5);
    const sw = ctx.measureText(m.src).width + 12;
    ctx.fillStyle = gray > 0 ? '#4b5563' : (m.sc as string);
    ctx.beginPath();
    ctx.roundRect(tx, -8, sw, 16, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(m.src, tx + 6, 1);
    tx += sw + 6;
  }
  ctx.font = font(400, 12.5);
  ctx.fillStyle = gray > 0 ? `rgba(226,232,238,${1 - gray * 0.45})` : '#e2e8ee';
  ctx.fillText(m.text, tx, 1);

  if (m.tag && opts.chipP && opts.chipP > 0) {
    const cp = opts.chipP;
    ctx.save();
    ctx.translate(0, h / 2 + 3);
    const s = 0.7 + 0.3 * easeOutBack(clamp01(cp));
    ctx.scale(s, s);
    ctx.globalAlpha = opacity * clamp01(cp);
    ctx.font = font(700, 9);
    const cw = ctx.measureText(m.tag).width + 18;
    ctx.fillStyle = AGENTS[m.agent as number].color;
    ctx.beginPath();
    ctx.roundRect(-cw / 2, -9, cw, 18, 9);
    ctx.fill();
    ctx.fillStyle = '#0b1020';
    ctx.textAlign = 'center';
    ctx.fillText(m.tag, 0, 1);
    ctx.restore();
  }
  ctx.restore();
  ctx.textBaseline = 'alphabetic';
}

function drawPhone(ctx: Ctx, t: number) {
  const inP = easeOutBack(clamp01((t - 300) / 450));
  const outP = clamp01((t - (S2 + 300)) / 500);
  if (t < 300 || outP >= 1) return;
  const shakeRamp = clamp01((t - 4000) / 4000) * (1 - outP);
  const sx = Math.sin(t * 0.11) * 4 * shakeRamp;
  const sy = Math.cos(t * 0.13) * 2 * shakeRamp;
  const hot = t > 6200 && t < S2 + 300;
  const scale = Math.max(0.01, inP * (1 - 0.3 * outP));

  ctx.save();
  ctx.translate(PHONE.x + sx, PHONE.y + sy + outP * 60);
  ctx.scale(scale, scale);
  ctx.globalAlpha = Math.min(inP, 1 - outP);

  ctx.beginPath();
  ctx.roundRect(-69, -124, 138, 248, 22);
  ctx.fillStyle = '#0d1524';
  if (hot) {
    ctx.shadowColor = 'rgba(248,113,113,0.45)';
    ctx.shadowBlur = 30;
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 22;
  }
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = hot ? 'rgba(248,113,113,0.7)' : '#33415c';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#223047';
  ctx.beginPath();
  ctx.roundRect(-22, -116, 44, 6, 3);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(-60, -104, 120, 216, 12);
  ctx.clip();
  ctx.fillStyle = '#0b141a';
  ctx.fillRect(-60, -104, 120, 216);

  ctx.fillStyle = '#1f2c34';
  ctx.fillRect(-60, -104, 120, 26);
  ctx.fillStyle = '#25d366';
  ctx.beginPath();
  ctx.arc(-51, -91, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#cfd8dd';
  ctx.font = font(700, 9.5);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('My WhatsApp', -42, -90);

  const lands = MSGS1.filter((m) => m.land && t > m.t0 + FALL1).length;
  for (let i = 0; i < Math.min(lands, 4); i++) {
    const ry = -78 + i * 31;
    ctx.fillStyle = '#2a3942';
    ctx.beginPath();
    ctx.arc(-43, ry + 15, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(-29, ry + 10, 74, 4, 2);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(-29, ry + 17, 44, 4, 2);
    ctx.fill();
    ctx.strokeStyle = '#16222b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-60, ry + 31);
    ctx.lineTo(60, ry + 31);
    ctx.stroke();
  }
  ctx.restore();

  let bv = 0;
  let lastT = 0;
  for (const s of BADGE_STEPS)
    if (t >= s.t) {
      bv = s.v;
      lastT = s.t;
    }
  if (bv > 0) {
    const txt = bv > 99 ? '99+' : String(bv);
    const bs = 1 + 0.45 * Math.exp(-(t - lastT) / 160);
    ctx.save();
    ctx.translate(70, -121);
    ctx.scale(bs, bs);
    ctx.font = font(800, 11);
    const bw = Math.max(26, ctx.measureText(txt).width + 12);
    ctx.fillStyle = '#ef4444';
    ctx.shadowColor = 'rgba(239,68,68,0.8)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.roundRect(-bw / 2, -13, bw, 26, 13);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(txt, 0, 1);
    ctx.restore();
  }
  ctx.restore();
  ctx.textBaseline = 'alphabetic';
}

function drawBubbles1(ctx: Ctx, t: number) {
  MSGS1.forEach((m, i) => {
    const age = t - m.t0;
    if (age < 0 || t > S2) return;
    if (age < FALL1) {
      const p = age / FALL1;
      const x = lerp(m.x0, PHONE.x + m.off, easeOut(p));
      const y = lerp(-40, PHONE.y - 115, Math.pow(p, 1.3));
      drawBubble(ctx, m, x, y, p < 0.05 ? p * 20 : 1, { rotate: (1 - p) * m.dir * 5 });
    } else if (m.land) {
      const p = clamp01((age - FALL1) / 320);
      drawBubble(ctx, m, PHONE.x + m.off * (1 - p), PHONE.y - 115 + p * 40, 1 - p, { scale: 1 - 0.75 * p });
    } else {
      const dt = (age - FALL1) / 1000;
      if (dt > 1.15) return;
      const x = PHONE.x + m.off + m.dir * (150 + rnd(i * 9.7) * 90) * dt;
      const y = PHONE.y - 115 + 30 * dt + 420 * dt * dt;
      drawBubble(ctx, m, x, y, Math.max(0, 1 - dt / 1.1), {
        rotate: m.dir * dt * 40,
        gray: clamp01(dt * 1.6),
      });
    }
  });
}

function drawBubbles3(ctx: Ctx, t: number) {
  for (const m of MSGS3) {
    const age = t - m.t0;
    if (age < 0 || t > m.absorbT + 400) continue;
    if (t < m.absorbT) {
      const p = clamp01(age / FALL3);
      const x = lerp(m.x0, PANEL.x, easeOut(p));
      const y = lerp(-40, PANEL.y - 82, Math.pow(p, 1.25));
      drawBubble(ctx, m, x, y, p < 0.05 ? p * 20 : 1, { chipP: clamp01((t - m.stampT) / 300) });
    } else {
      const p = clamp01((t - m.absorbT) / 300);
      drawBubble(ctx, m, PANEL.x, PANEL.y - 82 + p * 36, 1 - p, { scale: 1 - 0.7 * p, chipP: 1 - p });
    }
  }
}

function drawPanel(ctx: Ctx, t: number) {
  const p = easeOutBack(clamp01((t - (S2 + 900)) / 500));
  if (p <= 0) return;
  ctx.save();
  ctx.translate(PANEL.x, PANEL.y);
  ctx.scale(Math.max(0.01, p), Math.max(0.01, p));
  ctx.globalAlpha = clamp01(p * 1.4);
  ctx.beginPath();
  ctx.roundRect(-160, -42, 320, 84, 16);
  ctx.fillStyle = 'rgba(15,23,42,0.88)';
  ctx.shadowColor = 'rgba(139,92,246,0.35)';
  ctx.shadowBlur = 34;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(139,92,246,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textBaseline = 'middle';
  ctx.font = font(700, 14.5);
  const parts: Array<[string, string]> = [
    ['Convo', '#e6eaf3'],
    ['Real', '#a78bfa'],
    [' · Shared Inbox', '#e6eaf3'],
  ];
  const total = parts.reduce((w, [txt]) => w + ctx.measureText(txt).width, 0);
  let px = -total / 2;
  ctx.textAlign = 'left';
  for (const [txt, color] of parts) {
    ctx.fillStyle = color;
    ctx.fillText(txt, px, -9);
    px += ctx.measureText(txt).width;
  }

  const c = ctx as Ctx & { letterSpacing: string };
  ctx.font = font(700, 10);
  c.letterSpacing = '1.4px';
  const sub = 'ROUTING RULES ACTIVE';
  const sw = ctx.measureText(sub).width;
  ctx.fillStyle = '#25d366';
  ctx.shadowColor = '#25d366';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(-sw / 2 - 10, 14, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#8d99b2';
  ctx.fillText(sub, -sw / 2, 14);
  c.letterSpacing = '0px';
  ctx.restore();
  ctx.textBaseline = 'alphabetic';
}

function drawThreads(ctx: Ctx, t: number) {
  for (const th of THREADS) {
    const p = easeOut(clamp01((t - th.drawStart) / 750));
    if (p <= 0) continue;
    const n = Math.max(2, Math.floor(p * th.pts.length));
    ctx.strokeStyle = 'rgba(139,92,246,0.85)';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#8b5cf6';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    th.pts.slice(0, n).forEach((pt, k) => (k === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
    ctx.stroke();
    if (p < 1) {
      const head = th.pts[n - 1];
      ctx.fillStyle = '#e9dfff';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(head.x, head.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#8b5cf6';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(th.p0.x, th.p0.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function drawFlashes(ctx: Ctx, t: number) {
  for (const m of MSGS3) {
    const age = t - m.stampT;
    if (age < 0 || age > 350) continue;
    const p = age / 350;
    const mp = clamp01((m.stampT - m.t0) / FALL3);
    const fy = lerp(-40, PANEL.y - 82, Math.pow(mp, 1.25));
    const fx = lerp(m.x0, PANEL.x, easeOut(mp));
    ctx.strokeStyle = `rgba(167,139,250,${(1 - p) * 0.9})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(fx, fy, 20 + p * 34, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawTravels(ctx: Ctx, t: number) {
  for (const m of MSGS3) {
    const start = m.absorbT + 250;
    const p = (t - start) / 700;
    if (p <= 0 || p >= 1) continue;
    const th = THREADS[m.agent];
    const idx = easeOut(p) * (th.pts.length - 1);
    const color = AGENTS[m.agent].color;
    for (let k = 0; k < 6; k++) {
      const bi = Math.max(0, Math.floor(idx) - k * 2);
      const pt = th.pts[bi];
      ctx.globalAlpha = (1 - k / 6) * 0.9;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, k === 0 ? 5 : 3.5 - k * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
}

function drawSparks(ctx: Ctx, t: number) {
  for (const m of MSGS3) {
    const age = t - m.arrive;
    if (age < 0 || age > 700) continue;
    const a0 = AGENTS[m.agent];
    for (let j = 0; j < 10; j++) {
      const s0 = m.arrive * 0.013 + j * 7.7;
      const life = 380 + rnd(s0 + 2) * 260;
      if (age > life) continue;
      const an = rnd(s0) * Math.PI * 2;
      const v = 1 + rnd(s0 + 1) * 2.4;
      const T = age / 16;
      ctx.globalAlpha = 1 - age / life;
      ctx.fillStyle = a0.color;
      ctx.shadowColor = a0.color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(a0.x - 94 + Math.cos(an) * v * T, a0.y + (Math.sin(an) * v - 1) * T, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
}

function drawAgents(ctx: Ctx, t: number) {
  AGENTS.forEach((a, i) => {
    const inP = easeOutBack(clamp01((t - arriveT(i)) / 450));
    if (inP <= 0) return;
    const arrivals = MSGS3.filter((m) => m.agent === i && t >= m.arrive);
    const last = arrivals.length ? arrivals[arrivals.length - 1].arrive : -1e9;
    const pulse = 1 + 0.13 * Math.exp(-(t - last) / 200);
    const s = Math.max(0.01, inP * pulse);
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.scale(s, s);
    ctx.globalAlpha = clamp01(inP);

    ctx.beginPath();
    ctx.roundRect(-84, -31, 168, 62, 14);
    ctx.fillStyle = 'rgba(15,23,42,0.86)';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 18;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#33415c';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = a.color;
    ctx.beginPath();
    ctx.arc(-56, 0, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0b1020';
    ctx.font = font(800, 13);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(a.name[0], -56, 1);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#e6eaf3';
    ctx.font = font(700, 12.5);
    ctx.fillText(a.name, -31, -8);
    ctx.fillStyle = '#8d99b2';
    ctx.font = font(400, 9.5);
    ctx.fillText(a.role, -31, 8);

    const cnt = String(arrivals.length);
    ctx.font = font(800, 10.5);
    const cw = Math.max(22, ctx.measureText(cnt).width + 12);
    ctx.fillStyle = 'rgba(139,92,246,0.18)';
    ctx.strokeStyle = 'rgba(139,92,246,0.5)';
    ctx.beginPath();
    ctx.roundRect(72 - cw, -11, cw, 22, 11);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#d9d3f5';
    ctx.textAlign = 'center';
    ctx.fillText(cnt, 72 - cw / 2, 1);

    const tickAge = t - last;
    if (tickAge >= 0 && tickAge < 900) {
      ctx.globalAlpha = clamp01(inP) * clamp01(tickAge / 120) * clamp01((900 - tickAge) / 300);
      ctx.fillStyle = '#53bdeb';
      ctx.font = font(800, 11);
      ctx.textAlign = 'right';
      ctx.fillText('✓✓', 74, -31);
    }
    ctx.restore();
  });
  ctx.textBaseline = 'alphabetic';
}

function drawWireLabels(ctx: Ctx, t: number) {
  for (const l of WIRE_LABELS) {
    const p = easeOutBack(clamp01((t - l.showT) / 450));
    if (p <= 0) continue;
    const s = Math.max(0.01, 0.7 + 0.3 * p);
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.scale(s, s);
    ctx.globalAlpha = clamp01(p) * (t >= S3 ? 0.55 : 1);
    ctx.font = font(600, 10);
    const w = ctx.measureText(l.text).width + 20;
    ctx.fillStyle = 'rgba(139,92,246,0.2)';
    ctx.strokeStyle = 'rgba(139,92,246,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -11, w, 22, 11);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#d9d3f5';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(l.text, 0, 1);
    ctx.restore();
  }
  ctx.textBaseline = 'alphabetic';
}

function drawEngine(ctx: Ctx, t: number) {
  const inP = easeOutBack(clamp01((t - (S2 + 300)) / 550));
  if (inP <= 0) return;
  const scale = lerp(0.4, 1, inP);
  ctx.save();
  ctx.translate(ENGINE.x, ENGINE.y);
  ctx.scale(scale, scale);
  ctx.globalAlpha = clamp01(inP);

  const th1 = ((t % 1600) / 1600) * Math.PI * 2;
  ctx.strokeStyle = '#8b5cf6';
  ctx.lineWidth = 2.6;
  ctx.shadowColor = '#8b5cf6';
  ctx.shadowBlur = 8;
  for (let i = 0; i < 3; i++) {
    ctx.globalAlpha = clamp01(inP) * (1 - i * 0.32);
    ctx.beginPath();
    ctx.arc(0, 0, 38, th1 - 0.5 - i * 0.5, th1 - i * 0.5);
    ctx.stroke();
  }
  const th2 = -((t % 2400) / 2400) * Math.PI * 2;
  ctx.globalAlpha = clamp01(inP) * 0.6;
  ctx.beginPath();
  ctx.arc(0, 0, 30, th2 - 0.9, th2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = clamp01(inP);

  const grad = ctx.createLinearGradient(-18, -18, 18, 18);
  grad.addColorStop(0, '#7c4fe8');
  grad.addColorStop(1, '#5b34b8');
  ctx.fillStyle = grad;
  ctx.shadowColor = 'rgba(139,92,246,0.55)';
  ctx.shadowBlur = 28;
  ctx.beginPath();
  ctx.roundRect(-18, -18, 36, 36, 11);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#f2edff';
  ctx.font = font(800, 18);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('C', 0, 1);

  ctx.font = font(700, 12);
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
    ctx.fillText(txt, px, 58);
    px += ctx.measureText(txt).width;
  }
  ctx.restore();
  ctx.textBaseline = 'alphabetic';
}

function drawStat(ctx: Ctx, t: number) {
  const showT = S3 + 1200;
  const flipT = S3 + 7200;
  const inP = clamp01((t - showT) / 450);
  if (inP <= 0) return;
  const fast = t >= flipT;
  const popAge = fast ? t - flipT : t - showT;
  const s = 1 + 0.25 * Math.exp(-popAge / 180);
  ctx.save();
  ctx.translate(924, 72);
  ctx.scale(s, s);
  ctx.globalAlpha = inP;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.font = font(800, 15);
  const val = fast ? '2 min' : '4 hrs';
  const vw = ctx.measureText(val).width;
  if (fast) {
    ctx.fillStyle = '#f5c044';
    ctx.shadowColor = 'rgba(245,192,68,0.5)';
    ctx.shadowBlur = 18;
  } else {
    ctx.fillStyle = '#c3cbdc';
  }
  ctx.fillText(val, 0, 0);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#8d99b2';
  ctx.font = font(600, 11);
  ctx.fillText('Avg. first reply', -vw - 7, 0);
  ctx.restore();
  ctx.textBaseline = 'alphabetic';
}

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

function drawCaption(ctx: Ctx, t: number) {
  const c = ctx as Ctx & { letterSpacing: string };
  let idx = -1;
  for (let i = 0; i < CAPTIONS.length; i++) if (t >= CAPTIONS[i].t0) idx = i;
  if (idx < 0) return;
  const cap = CAPTIONS[idx];
  let alpha = clamp01((t - cap.t0 - 380) / 420);
  const next = CAPTIONS[idx + 1];
  if (next && t > next.t0 - 380) alpha = Math.min(alpha, clamp01((next.t0 - t) / 380));
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
  lines.forEach((ln, i) => ctx.fillText(ln, 44, baseY - headH + 22 + i * 28));
  ctx.restore();
}

function drawBrand(ctx: Ctx) {
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
  drawThreads(ctx, t);
  drawTravels(ctx, t);
  drawSparks(ctx, t);
  drawWireLabels(ctx, t);
  drawAgents(ctx, t);
  drawPhone(ctx, t);
  drawBubbles1(ctx, t);
  drawPanel(ctx, t);
  drawFlashes(ctx, t);
  drawBubbles3(ctx, t);
  drawEngine(ctx, t);
  drawStat(ctx, t);
  drawCaption(ctx, t);
  drawBrand(ctx);
  ctx.restore();
}

export const SwitchboardVideo = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ref = useRef<HTMLCanvasElement>(null);
  const [handle] = useState(() => delayRender('Loading Manrope'));
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    injectFonts();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setFontsReady(true);
      continueRender(handle);
    };
    Promise.all(['400', '600', '700', '800'].map((w) => document.fonts.load(`${w} 16px Manrope`)))
      .then(finish)
      .catch(finish);
    const to = setTimeout(finish, 5000);
    return () => clearTimeout(to);
  }, [handle]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 1920, 1080);
    draw(ctx, (frame / fps) * 1000);
  }, [frame, fps, fontsReady]);
  return <canvas ref={ref} width={1920} height={1080} style={{ width: '100%', height: '100%' }} />;
};
