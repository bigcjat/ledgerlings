"""Render the Ledgerlings pixel creature (baby idle) to PNG from the ART_BIBLE palette.
Hand-built 32x32 sprite -> scaled x12 for viewing. python render_pet.py"""
from PIL import Image

# ART_BIBLE "XRPL Teal" palette
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
px = [[T for _ in range(S)] for _ in range(S)]


def setp(x, y, c):
    if 0 <= x < S and 0 <= y < S:
        px[int(y)][int(x)] = c


cx, cy, rx, ry, n = 15.5, 17.0, 10.0, 10.5, 2.6


def inbody(x, y):
    return (abs((x - cx) / rx) ** n + abs((y - cy) / ry) ** n) <= 1.0


# 1) body fill with vertical shading + top-left highlight
for y in range(S):
    for x in range(S):
        if inbody(x, y):
            t = (y - (cy - ry)) / (2 * ry)            # 0 top .. 1 bottom
            c = B_HI if t < 0.16 else B_LGT if t < 0.34 else B_BAS if t < 0.66 else B_DRK if t < 0.86 else B_SHA
            # soft top-left glossy highlight
            if (x - (cx - 4)) ** 2 + (y - (cy - 5)) ** 2 < 7:
                c = B_HI
            setp(x, y, c)

# 2) 1px ink outline (body pixel adjacent to a non-body pixel)
edge = []
for y in range(S):
    for x in range(S):
        if inbody(x, y):
            if not (inbody(x - 1, y) and inbody(x + 1, y) and inbody(x, y - 1) and inbody(x, y + 1)):
                edge.append((x, y))
for x, y in edge:
    setp(x, y, INK)

# 3) the glowing PROOF-CORE in the belly (visible through translucent body) — concentric diamonds
ccx, ccy = 16, 20
for dx in range(-4, 5):
    for dy in range(-4, 5):
        d = abs(dx) + abs(dy)
        c = None
        if d == 0:
            c = C_WHT
        elif d <= 1:
            c = C_HOT
        elif d <= 2:
            c = C_GLOW
        elif d <= 3:
            c = C_DEEP
        if c:
            setp(ccx + dx, ccy + dy, c)

# 4) eyes — big, clean, cute: solid dark oval + white shine + cyan glint
for ex in (11, 20):
    for dx in range(-2, 3):
        for dy in range(-3, 4):
            if (dx * dx) / 4.6 + (dy * dy) / 9.0 <= 1.0:
                setp(ex + dx, 13 + dy, INK)             # big dark eye
    setp(ex - 1, 11, EYE_W); setp(ex, 11, EYE_W)        # white shine (top-left)
    setp(ex - 1, 12, EYE_W)
    setp(ex + 1, 14, C_GLOW)                            # small cyan glint (ties to the core)

# 5) blush cheeks
for bx in (8, 23):
    setp(bx, 16, BLUSH); setp(bx, 17, BLUSH)

# 6) stubby feet
for fx in (11, 19):
    for dx in range(0, 4):
        setp(fx + dx, 27, B_DRK); setp(fx + dx, 28, B_DRK)
    for dx in range(-1, 5):
        setp(fx + dx, 29, INK)
    setp(fx - 1, 27, INK); setp(fx - 1, 28, INK); setp(fx + 4, 27, INK); setp(fx + 4, 28, INK)

# build + save (1x master + 12x view)
img = Image.new("RGBA", (S, S))
for y in range(S):
    for x in range(S):
        img.putpixel((x, y), px[y][x])
img.save("ledgerlings_baby_32.png")
img.resize((S * 12, S * 12), Image.NEAREST).save("ledgerlings_baby_x12.png")
print("saved ledgerlings_baby_32.png + ledgerlings_baby_x12.png")
