"""Launcher/splash assets in the aurora-glass brand.

Glyph: a chat bubble (the WhatsApp CRM) with a house cut out of it
(real estate) — lime gradient fill, on the deep aurora green. Writes
mobile/assets/images/{icon,adaptive-icon,splash-icon,favicon}.png.

Run: python3 scratch/gen_app_icons.py
"""

import math

from PIL import Image, ImageChops, ImageDraw

OUT = "mobile/assets/images"
SS = 4  # supersample factor

DEEP = (4, 24, 17)
MID = (8, 61, 46)
GREEN = (37, 211, 102)
LIME = (198, 246, 141)
LIME_DK = (124, 224, 118)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def aurora_bg(size):
    n = 160
    im = Image.new("RGB", (n, n))
    px = im.load()
    for y in range(n):
        for x in range(n):
            t = (x + y) / (2 * (n - 1))
            c = lerp(DEEP, MID, t)
            # lime aurora glow, upper right
            g = smoothstep(1 - math.hypot(x / (n - 1) - 0.80, y / (n - 1) - 0.18) / 0.62)
            c = lerp(c, GREEN, 0.30 * g)
            c = lerp(c, LIME, 0.16 * g * g)
            # faint counter-glow, lower left
            g2 = smoothstep(1 - math.hypot(x / (n - 1) - 0.12, y / (n - 1) - 0.92) / 0.55)
            c = lerp(c, MID, 0.5 * g2)
            px[x, y] = c
    return im.resize((size, size), Image.BICUBIC)


def lime_fill(w, h):
    n = 96
    im = Image.new("RGB", (1, n))
    px = im.load()
    for y in range(n):
        px[0, y] = lerp(LIME, LIME_DK, y / (n - 1))
    return im.resize((w, h), Image.BICUBIC)


def glyph_mask(size, scale=1.0):
    """Bubble-minus-house mask, glyph centered, sized by `scale`."""
    W = size * SS
    s = scale

    bubble = Image.new("L", (W, W), 0)
    d = ImageDraw.Draw(bubble)
    bw = W * 0.74 * s
    bh = W * 0.60 * s
    x0 = (W - bw) / 2
    y0 = (W - (bh + W * 0.10 * s)) / 2  # leave room for the tail below
    r = bw * 0.24
    d.rounded_rectangle([x0, y0, x0 + bw, y0 + bh], radius=r, fill=255)
    # tail: bottom-left, sweeping down-left
    tx = x0 + bw * 0.10
    ty = y0 + bh - r * 0.55
    d.polygon(
        [
            (tx, ty - bh * 0.16),
            (tx + bw * 0.26, ty),
            (tx - bw * 0.045, ty + bh * 0.22),
        ],
        fill=255,
    )

    house = Image.new("L", (W, W), 0)
    hd = ImageDraw.Draw(house)
    cx = x0 + bw / 2
    hw = bw * 0.46  # house body width
    roof_w = bw * 0.60
    body_h = bh * 0.30
    roof_h = bh * 0.26
    base_y = y0 + bh * 0.78
    # body
    hd.rectangle([cx - hw / 2, base_y - body_h, cx + hw / 2, base_y], fill=255)
    # roof
    hd.polygon(
        [
            (cx - roof_w / 2, base_y - body_h),
            (cx, base_y - body_h - roof_h),
            (cx + roof_w / 2, base_y - body_h),
        ],
        fill=255,
    )
    # door notch (kept as bubble color)
    dw = hw * 0.30
    dh = body_h * 0.62
    hd.rectangle([cx - dw / 2, base_y - dh, cx + dw / 2, base_y], fill=0)

    return ImageChops.subtract(bubble, house).resize((size, size), Image.LANCZOS)


def compose(size, background, scale=1.0):
    mask = glyph_mask(size, scale)
    fill = lime_fill(size, size)
    if background is None:
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        out.paste(fill, (0, 0), mask)
        return out
    out = background.convert("RGBA")
    out.paste(fill, (0, 0), mask)
    return out


icon = compose(1024, aurora_bg(1024), scale=0.92)
icon.save(f"{OUT}/icon.png")

# Adaptive foreground: glyph must stay inside the 66% safe circle.
adaptive = compose(1024, None, scale=0.60)
adaptive.save(f"{OUT}/adaptive-icon.png")

splash = compose(512, None, scale=0.94)
splash.save(f"{OUT}/splash-icon.png")

icon.resize((48, 48), Image.LANCZOS).save(f"{OUT}/favicon.png")
print("wrote icon, adaptive-icon, splash-icon, favicon")
