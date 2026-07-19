#!/usr/bin/env python3
"""Generate aurora gradient background PNGs (no third-party deps).

v2 — fixes the visible banding/seams from the first render:
- Phone-aspect canvas (810x1755, ~9:19.5) so `cover` barely crops or
  upscales on a real device (v1 was 512x640: 3.7x upscale + 44% crop,
  which magnified every artifact and shifted the glows).
- Triangular-PDF dither noise before 8-bit quantization. The dark base
  stops are only a few RGB levels apart, so without dithering the
  near-horizontal gradient collapses into wide vertical stripes — the
  "seam" visible on device.
- Smoothstep radial falloff so glow rims vanish instead of ringing.
"""
import math
import random
import struct
import zlib

W, H = 810, 1755


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def lerp(a, b, t):
    return a + (b - a) * t


def gradient_stops(stops, t):
    # stops: [(pos, (r,g,b)), ...] sorted by pos
    if t <= stops[0][0]:
        return stops[0][1]
    if t >= stops[-1][0]:
        return stops[-1][1]
    for i in range(len(stops) - 1):
        p0, c0 = stops[i]
        p1, c1 = stops[i + 1]
        if p0 <= t <= p1:
            f = (t - p0) / (p1 - p0)
            return tuple(lerp(c0[k], c1[k], f) for k in range(3))
    return stops[-1][1]


def render(path, axis_deg, stops, glows):
    # Gradient axis: project each pixel onto the axis vector, normalized
    # by the min/max projection of the four corners.
    rad = math.radians(axis_deg)
    ax, ay = math.cos(rad), math.sin(rad)
    corners = [(0, 0), (W, 0), (0, H), (W, H)]
    projs = [ax * x + ay * y for x, y in corners]
    pmin, pmax = min(projs), max(projs)
    span = pmax - pmin

    # Glow geometry is expressed in fractions of W/H so the same recipe
    # renders identically at any resolution.
    resolved = [
        ((fx * W, fy * H), fr * W, color, alpha)
        for (fx, fy), fr, color, alpha in glows
    ]

    rng = random.Random(42)
    rows = []
    for y in range(H):
        row = bytearray([0])  # filter type 0
        for x in range(W):
            t = ((ax * x + ay * y) - pmin) / span
            r, g, b = gradient_stops(stops, t)
            for (gx, gy), gr, (cr, cg, cb), alpha in resolved:
                d = math.hypot(x - gx, y - gy)
                if d < gr:
                    s = 1.0 - d / gr
                    f = (s * s * (3.0 - 2.0 * s)) ** 1.3  # smoothstep, concentrated
                    a = alpha * f
                    r = lerp(r, cr, a)
                    g = lerp(g, cg, a)
                    b = lerp(b, cb, a)
            # Triangular dither (±1 level) kills 8-bit banding stripes.
            n = rng.random() + rng.random() - 1.0
            row += bytes(
                (
                    max(0, min(255, int(r + n + 0.5))),
                    max(0, min(255, int(g + n + 0.5))),
                    max(0, min(255, int(b + n + 0.5))),
                )
            )
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)
    print("wrote", path, len(png), "bytes")


# Dark theme (Option 4): deep forest/glass with lime-mint-teal glows
render(
    "mobile/assets/images/aurora-dark.png",
    158,
    [(0.0, hex_rgb("#0A1F16")), (0.42, hex_rgb("#0E2E22")), (1.0, hex_rgb("#0B2233"))],
    [
        ((0.85, -0.02), 0.66, hex_rgb("#C6F68D"), 0.22),
        ((-0.10, 0.30), 0.59, hex_rgb("#7BE3B0"), 0.16),
        ((0.60, 1.04), 0.74, hex_rgb("#2EA0BE"), 0.22),
    ],
)

# Light theme (Option 7): soft WhatsApp-tinted daylight with green/teal/sky glows
render(
    "mobile/assets/images/aurora-light.png",
    160,
    [(0.0, hex_rgb("#EAF4EE")), (0.46, hex_rgb("#F4F8F5")), (1.0, hex_rgb("#E6F0F4"))],
    [
        ((0.90, -0.02), 0.63, hex_rgb("#25D366"), 0.20),
        ((-0.12, 0.26), 0.59, hex_rgb("#075E54"), 0.13),
        ((0.55, 1.03), 0.66, hex_rgb("#53BDEB"), 0.18),
    ],
)
