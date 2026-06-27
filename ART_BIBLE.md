# Ledgerlings — Art Bible (pixel-art, Xaman xApp)

Canonical palette + animation plan. Every sprite/stage must use these so the pet stays consistent.

## Format
- Master sprite **64×64**, transparent PNG, integer scaling only (no anti-alias / no blur).
- Mini **32×32** for list/leaderboard thumbnails.
- Limited palette below (16 colors). Retro Tamagotchi / GBC style. Dark navy outline, never pure black.

## Palette — "XRPL Teal" (16 colors)
```
OUTLINE
  #0B1B2B  ink          outline, pupils, dark gaps
BODY (translucent teal ramp dark→light)
  #0E3A4A  body-shadow  underside / occlusion
  #12586B  body-dark    lower body
  #1E8A9C  body-base    main fill (XRPL teal)
  #3FB6C4  body-light   upper curve
  #7FE0E6  body-hi      rim highlight / glossy top
CORE / PROOF-HEART (cyan glow ramp — the visible heart)
  #0A6E8C  core-deep    core edge in shadow
  #19C3E6  core-glow    core body (brand cyan)
  #6FF0FF  core-hot     core center
  #E8FFFF  core-white   hottest 1px + sparkle
EYES + ACCENT
  #F2FBFC  eye-white    eye shine / highlights
  #E86A8A  blush        cheeks, happy-state hearts
STATE TINTS (swap body-base/light when in-state)
  #5A7A82  hungry-desat hungry / low stats
  #8FB36A  sick-green   low health
  #9AA8B0  ghost-grey   dead / ghost
```
Rules: outline always `#0B1B2B`. Core ALWAYS uses the cyan ramp in every state (even sick/dead glows
faintly — the proof never lies). Rarity of an evolved form = count of `core-hot`/`core-white` pixels.

## Animation plan (sprite frames, xApp webview)
| State | Frames | ms/frame | Loop | Notes |
|---|---|---|---|---|
| idle | 2 | 600 | loop | default resting "breathing"; all states return here |
| happy | 4 | 120 | play 2× → idle | bounce + blush hearts; after feed/play |
| hungry/sad | 2 | 700 | loop | droop; body → hungry-desat |
| sick | 2 | 500 | loop | wobble + sweat drop; body → sick-green |
| sleeping | 2 | 800 | loop | rising Zzz; night / idle-too-long |
| eating | 4 | 150 | play 1× | chomp; precedes happy |
| evolving | 6–8 | 100 | play 1× → swap stage sprite | core-white flash + sparkle burst |
| dead | 2 | 900 | loop | ghost float / cracked core in ghost-grey |
Budget: ≤ ~12 fps (Tamagotchi slowness = the charm). Most states 2 frames. ~18 frames per lifecycle stage.

## Lifecycle stages (one sprite set each — same creature, ages up)
egg (glowing pixel egg, faint core through shell) · baby (tiny, huge head/eyes) · teen (taller, brighter
core) · adult (full body, pixel crest, strong core) · elder (serene, deep core, a few worn pixels).

## Master prompt (regenerate consistently)
Pixel art sprite of a cute virtual pet "Ledgerlings", 1990s Tamagotchi/GBC style. Small round translucent
jelly creature with a single bright glowing pixel-cluster core at its center (its visible heart), big
2-pixel eyes, tiny stubby feet, cheerful. Palette: XRPL teals/deep blues + luminous cyan core, dark navy
outline, clean dithering. Crisp readable silhouette, centered, front view, transparent background, 64×64,
no anti-aliasing, no text.
