"""Render the PagePay monogram to PNGs at the required sizes.

We draw the icon directly in Pillow (PIL) because:
1. The composition is simple: a squircle, a P glyph, a coin, two sparkles.
2. We avoid the cairo / rlPyCairo / sharp / puppeteer dependency chain.
3. Pixel-perfect control over the chamfer, ring, and shadow.

The math here mirrors the SVGs in client/assets/brand/ — when you
edit the SVGs, edit the constants below to match.
"""
from PIL import Image, ImageDraw, ImageFilter
import os
import math

# Brand tokens (from client/constants/theme.ts)
MINT      = (14, 124, 102, 255)   # #0E7C66
MINT_SOFT = (230, 241, 237, 255)  # #E6F1ED
CREAM     = (251, 250, 246, 255)  # #FBFAF6
MINT_DEEP = (11, 92, 75, 255)     # #0B5C4B

OUT = 'client/assets/images'
os.makedirs(OUT, exist_ok=True)

# P glyph coordinates (from monogram.svg, in the 1024-artboard space)
P_OUTER = [
    (248, 192), (600, 192), (788, 192), (912, 312),
    (912, 432), (912, 552), (788, 672), (600, 672),
    (420, 672), (420, 832), (360, 892), (248, 892),
]
P_COUNTER = [
    (420, 360), (600, 360), (676, 360), (736, 392),
    (736, 432), (736, 472), (676, 504), (600, 504),
    (420, 504),
]
P_CHAMFER = [(360, 892), (420, 832), (420, 892)]

# Coin in counter
COIN_CX, COIN_CY = 580, 432
COIN_R_OUTER = 56
COIN_R_INNER = 48
COIN_HIGHLIGHT = (566, 418, 6)

# Sparkles
SPARKLES = [
    # (cx, cy, outer_radius, inner_radius)
    (760, 320, 28, 6),
    (800, 360, 12, 3),
]


def star_polygon(cx, cy, r_outer, r_inner, points=8):
    """Return the vertex list for an N-point star centered at (cx,cy)."""
    verts = []
    for i in range(points * 2):
        angle = (i * math.pi / points) - math.pi / 2
        r = r_outer if i % 2 == 0 else r_inner
        verts.append((cx + r * math.cos(angle),
                      cy + r * math.sin(angle)))
    return verts


def make_squircle(size, radius, fill):
    """A rounded-square (iOS-style squircle approximation) of `size`x`size`
    filled with `fill`. Returns an RGBA Image.
    """
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=fill)
    return img


def draw_p_on_bg(canvas, glyph_color, with_coin, with_sparkles, drop_shadow):
    """Draw the P glyph on top of an existing canvas that has the
    squircle background (mint) already painted. The counter and
    chamfer are punched out using the canvas's current pixel color
    (which is the squircle bg = mint).
    """
    d = ImageDraw.Draw(canvas)
    bg_at_center = canvas.getpixel((COIN_CX, COIN_CY))  # mint

    if drop_shadow:
        # Subtle shadow under the P
        shadow = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
        sd = ImageDraw.Draw(shadow)
        sd.polygon(P_OUTER, fill=(0, 0, 0, 50))
        shadow = shadow.filter(ImageFilter.GaussianBlur(radius=8))
        canvas.alpha_composite(shadow)

    # P outer
    d.polygon(P_OUTER, fill=glyph_color)
    # Counter — punch out using the squircle bg color (mint)
    d.polygon(P_COUNTER, fill=bg_at_center)
    # Chamfer — also punch out
    d.polygon(P_CHAMFER, fill=bg_at_center)

    if with_coin:
        # Outer disc in bg color
        d.ellipse((COIN_CX - COIN_R_OUTER, COIN_CY - COIN_R_OUTER,
                   COIN_CX + COIN_R_OUTER, COIN_CY + COIN_R_OUTER),
                  fill=bg_at_center)
        # Inner ring in glyph color
        d.ellipse((COIN_CX - COIN_R_INNER, COIN_CY - COIN_R_INNER,
                   COIN_CX + COIN_R_INNER, COIN_CY + COIN_R_INNER),
                  outline=glyph_color, width=3)
        # Highlight dot
        hx, hy, hr = COIN_HIGHLIGHT
        d.ellipse((hx - hr, hy - hr, hx + hr, hy + hr), fill=glyph_color)

    if with_sparkles:
        for (cx, cy, so, si) in SPARKLES:
            d.polygon(star_polygon(cx, cy, so, si), fill=glyph_color)


def draw_p_transparent(size):
    """Draw the P glyph + coin + sparkles on a transparent background.
    Used for android-icon-foreground.png and android-icon-monochrome.png.
    """
    internal = 1024
    canvas = Image.new('RGBA', (internal, internal), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)

    # P outer in mint
    d.polygon(P_OUTER, fill=MINT)
    # Counter — punch through to transparent
    d.polygon(P_COUNTER, fill=(0, 0, 0, 0))
    # Chamfer — punch through
    d.polygon(P_CHAMFER, fill=(0, 0, 0, 0))

    # Coin (mint on transparent)
    d.ellipse((COIN_CX - COIN_R_OUTER, COIN_CY - COIN_R_OUTER,
               COIN_CX + COIN_R_OUTER, COIN_CY + COIN_R_OUTER),
              fill=MINT)
    # Ring (mint stroke, no fill)
    d.ellipse((COIN_CX - COIN_R_INNER, COIN_CY - COIN_R_INNER,
               COIN_CX + COIN_R_INNER, COIN_CY + COIN_R_INNER),
              outline=MINT, width=3)
    # Highlight
    hx, hy, hr = COIN_HIGHLIGHT
    d.ellipse((hx - hr, hy - hr, hx + hr, hy + hr), fill=MINT)

    # Sparkles
    for (cx, cy, so, si) in SPARKLES:
        d.polygon(star_polygon(cx, cy, so, si), fill=MINT)

    if size != internal:
        canvas = canvas.resize((size, size), Image.LANCZOS)
    return canvas


def make_monogram_mint_bg(size, with_coin=True, with_sparkles=True,
                          drop_shadow=True):
    """Full app icon: mint squircle + cream P."""
    internal = 1024
    squircle = make_squircle(internal, radius=224, fill=MINT)
    draw_p_on_bg(squircle, CREAM, with_coin, with_sparkles, drop_shadow)
    if size != internal:
        squircle = squircle.resize((size, size), Image.LANCZOS)
    return squircle


def make_monochrome_p(size):
    """Mint P silhouette only, on transparent. For themed icon slots."""
    internal = 1024
    canvas = Image.new('RGBA', (internal, internal), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    d.polygon(P_OUTER, fill=MINT)
    if size != internal:
        canvas = canvas.resize((size, size), Image.LANCZOS)
    return canvas


def make_splash_icon(w, h):
    """iOS splash: cream paper + monogram centered, no text (the RN
    splash overlay can render the wordmark in-app, or the static
    splash image can be exported with a baked-in wordmark later).
    """
    canvas = Image.new('RGBA', (w, h), CREAM)
    mark_size = int(w * 0.32)
    mark = make_monogram_mint_bg(mark_size)
    ox = (w - mark_size) // 2
    oy = int(h * 0.38)
    canvas.alpha_composite(mark, (ox, oy))
    return canvas


# --- Render all the assets ------------------------------------------------

print('Rendering PagePay icon set...')

# 1. icon.png — 1024x1024 (iOS App Store + Play Store icon)
make_monogram_mint_bg(1024, drop_shadow=True)\
    .save(os.path.join(OUT, 'icon.png'), 'PNG', optimize=True)
print('  monogram -> icon.png (1024x1024)')

# 2. android-icon-foreground.png — 1024x1024 transparent
draw_p_transparent(1024)\
    .save(os.path.join(OUT, 'android-icon-foreground.png'), 'PNG', optimize=True)
print('  monogram -> android-icon-foreground.png (1024x1024 transparent)')

# 3. android-icon-monochrome.png — 1024x1024 transparent mint P
make_monochrome_p(1024)\
    .save(os.path.join(OUT, 'android-icon-monochrome.png'), 'PNG', optimize=True)
print('  monochrome -> android-icon-monochrome.png (1024x1024 transparent)')

# 4. splash-icon.png — 1242x2436 iOS splash
make_splash_icon(1242, 2436)\
    .save(os.path.join(OUT, 'splash-icon.png'), 'PNG', optimize=True)
print('  monogram -> splash-icon.png (1242x2436)')

# 5. favicon.png — 48x48
make_monogram_mint_bg(48, drop_shadow=False)\
    .save(os.path.join(OUT, 'favicon.png'), 'PNG', optimize=True)
print('  monogram -> favicon.png (48x48)')

print('done')
