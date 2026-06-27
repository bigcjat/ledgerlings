"""Render Ledgerlings lifecycle stages + states from the ART_BIBLE palette. python render_stages.py
Stages: egg baby teen adult elder.  States: happy sad (baby-based)."""
from PIL import Image

INK   = (0x0B, 0x1B, 0x2B, 255)
B_SHA = (0x0E, 0x3A, 0x4A, 255)
B_DRK = (0x12, 0x58, 0x6B, 255)
B_BAS = (0x1E, 0x8A, 0x9C, 255)
B_LGT = (0x3F, 0xB6, 0xC4, 255)
B_HI  = (0x7F, 0xE0, 0xE6, 255)
C_DEEP= (0x0A, 0x6E, 0x8C, 255)
C_GLOW= (0x19, 0xC3, 0xE6, 255)
C_HOT = (0x6F, 0xF0, 0xFF, 255)
C_WHT = (0xE8, 0xFF, 0xFF, 255)
EYE_W = (0xF2, 0xFB, 0xFC, 255)
BLUSH = (0xE8, 0x6A, 0x8A, 255)
T     = (0, 0, 0, 0)
S = 32

TEAL = (B_SHA, B_DRK, B_BAS, B_LGT, B_HI)
# desaturated "hungry/sad" ramp (greyed teal, ART_BIBLE hungry-desat family)
SAD  = ((0x24, 0x3A, 0x42, 255), (0x3A, 0x55, 0x5E, 255), (0x5A, 0x7A, 0x82, 255),
        (0x78, 0x96, 0xA0, 255), (0xA8, 0xC0, 0xC8, 255))


def new(): return [[T for _ in range(S)] for _ in range(S)]
def setp(px, x, y, c):
    if 0 <= x < S and 0 <= y < S: px[int(y)][int(x)] = c


def save(px, name):
    img = Image.new("RGBA", (S, S))
    for y in range(S):
        for x in range(S): img.putpixel((x, y), px[y][x])
    img.save(f"ledgerlings_{name}_32.png")
    img.resize((S * 12, S * 12), Image.NEAREST).save(f"ledgerlings_{name}_x12.png")
    print(f"saved ledgerlings_{name}")


def outline(px, inb):
    for y in range(S):
        for x in range(S):
            if inb(x, y) and not (inb(x-1, y) and inb(x+1, y) and inb(x, y-1) and inb(x, y+1)):
                setp(px, x, y, INK)


def body(px, cx, cy, rx, ry, ramp=TEAL, n=2.6):
    sha, drk, bas, lgt, hi = ramp
    inb = lambda x, y: (abs((x-cx)/rx)**n + abs((y-cy)/ry)**n) <= 1.0
    for y in range(S):
        for x in range(S):
            if inb(x, y):
                t = (y-(cy-ry))/(2*ry)
                c = hi if t < .16 else lgt if t < .34 else bas if t < .66 else drk if t < .86 else sha
                if (x-(cx-4))**2 + (y-(cy-5))**2 < 7: c = hi
                setp(px, x, y, c)
    outline(px, inb)
    return inb


def core(px, ccx, ccy, r, mode="normal"):
    for dx in range(-r, r+1):
        for dy in range(-r, r+1):
            d = abs(dx)+abs(dy); c = None
            if mode == "serene":                       # calm deep glow, 1px hot, no white
                c = C_HOT if d == 0 else C_GLOW if d <= r-2 else C_DEEP if d <= r else None
            else:
                hot = 2 if mode == "bright" else 1
                if d == 0: c = C_WHT
                elif d <= hot: c = C_HOT
                elif d <= r-1: c = C_GLOW
                elif d <= r: c = C_DEEP
            if c: setp(px, ccx+dx, ccy+dy, c)


def eyes(px, exs, ey, style="normal"):
    for ex in exs:
        if style in ("normal", "sad"):
            yoff = 1 if style == "sad" else 0
            for dx in range(-2, 3):
                for dy in range(-3, 4):
                    if (dx*dx)/4.6 + (dy*dy)/9.0 <= 1.0:
                        setp(px, ex+dx, ey+dy+yoff, INK)
            setp(px, ex-1, ey-2+yoff, EYE_W); setp(px, ex, ey-2+yoff, EYE_W); setp(px, ex-1, ey-1+yoff, EYE_W)
            setp(px, ex+1, ey+1+yoff, C_GLOW)
            if style == "sad":                          # drooping brow
                setp(px, ex-3, ey-3, INK); setp(px, ex-2, ey-3, INK)
        elif style == "happy":                          # closed upward arc ^_^
            for dx, dy in [(-2, 0), (-1, -1), (0, -1), (1, -1), (2, 0)]:
                setp(px, ex+dx, ey+dy, INK)
        elif style == "content":                        # gentle closed line (elder)
            for dx, dy in [(-2, 0), (-1, 0), (0, 0), (1, 1), (2, 1)]:
                setp(px, ex+dx, ey+dy, INK)


def feet(px, fxs, fy):
    for fx in fxs:
        for dx in range(0, 4):
            setp(px, fx+dx, fy, B_DRK); setp(px, fx+dx, fy+1, B_DRK)
        for dx in range(-1, 5): setp(px, fx+dx, fy+2, INK)
        for ddx in (-1, 4):
            setp(px, fx+ddx, fy, INK); setp(px, fx+ddx, fy+1, INK)


def blush(px, xs, y, col=BLUSH):
    for bx in xs: setp(px, bx, y, col); setp(px, bx, y+1, col)


def heart(px, x, y):                                    # 3x3 mini heart
    for dx, dy in [(-1, -1), (1, -1), (-1, 0), (0, 0), (1, 0), (0, 1)]:
        setp(px, x+dx, y+dy, BLUSH)


# ── STAGES ──
def egg():
    px = new(); cx, cy = 16.0, 18.0
    def inb(x, y):
        ry = 12.0; ny = (y-cy)/ry
        if abs(ny) > 1: return False
        rx = 8.5*(1.0-0.30*max(0.0, (cy-y)/ry))
        return ((x-cx)/rx)**2 + ny**2 <= 1.0
    for y in range(S):
        for x in range(S):
            if inb(x, y):
                t = (y-(cy-12))/24.0
                c = B_HI if t < .18 else B_LGT if t < .40 else B_BAS if t < .72 else B_DRK
                if (x-(cx-3))**2 + (y-(cy-6))**2 < 6: c = B_HI
                setp(px, x, y, c)
    outline(px, inb)
    for sx, sy in ((12, 12), (20, 14), (11, 20), (21, 21), (16, 24), (13, 16)):
        if inb(sx, sy): setp(px, sx, sy, C_DEEP)
    core(px, 16, 19, 3, "serene"); setp(px, 22, 9, C_WHT)
    save(px, "egg")


def baby(state="idle"):
    px = new(); ramp = SAD if state == "sad" else TEAL
    body(px, 15.5, 17.0, 10.0, 10.5, ramp)
    core(px, 16, 20, 4, "serene" if state == "sad" else "normal")
    eyes(px, (11, 20), 12, {"happy": "happy", "sad": "sad"}.get(state, "normal"))
    blush(px, (8, 23), 16, (0x9A, 0xA8, 0xB0, 255) if state == "sad" else BLUSH)
    feet(px, (11, 19), 27)
    if state == "happy":
        heart(px, 6, 7); heart(px, 26, 8)
    if state == "sad":
        setp(px, 22, 16, C_GLOW); setp(px, 22, 17, C_HOT)   # tear
    save(px, "baby" if state == "idle" else state)


def teen():
    px = new(); body(px, 15.5, 16.5, 10.5, 11.5)
    setp(px, 16, 4, C_GLOW); setp(px, 16, 3, C_HOT); setp(px, 16, 5, INK)   # single crest nub
    core(px, 16, 19, 4, "normal")
    eyes(px, (11, 20), 12); blush(px, (8, 23), 15); feet(px, (10, 19), 27)
    save(px, "teen")


def adult():
    px = new(); body(px, 15.5, 16.0, 11.5, 12.5)
    for sx, h in ((13, 3), (16, 4), (19, 3)):
        for k in range(h): setp(px, sx, 4-k, C_GLOW if k < h-1 else C_HOT)
        setp(px, sx, 5-h, INK)
    core(px, 16, 19, 5, "bright")
    eyes(px, (10, 21), 12); blush(px, (7, 24), 15); feet(px, (10, 19), 27)
    save(px, "adult")


def elder():
    px = new(); body(px, 15.5, 16.5, 10.5, 11.0)
    core(px, 16, 19, 5, "serene")
    eyes(px, (11, 20), 12, "content")
    for wx, wy in ((9, 22), (22, 23), (12, 24)): setp(px, wx, wy, B_SHA)    # worn pixels
    setp(px, 16, 5, B_HI); setp(px, 15, 6, B_HI)                            # soft tuft
    feet(px, (11, 19), 27)
    save(px, "elder")


if __name__ == "__main__":
    egg(); baby("idle"); teen(); adult(); elder(); baby("happy"); baby("sad")
