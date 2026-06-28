# Ledgerlings — Character Template for NFT Creators

Bring your community's character into Ledgerlings as a **playable, provably-fair on-chain pet**.
Your art is a **skin**; every character runs the *same* open rules engine (`pet_rules`) + the same
"Verify my pet" check — so fairness is identical no matter whose character it is. You keep attribution — and resale royalties route to **you** when your character is minted with
**you as the on-chain Issuer** via XRPL *authorized minting* (you authorize Ledgerlings to mint on your
behalf; the NFT's `Issuer` is your address, so the 5% `TransferFee` pays you, not us).

> **Status:** creator-kept royalties require *authorized minting* (`Issuer` = your address). If a character
> is instead minted under the Ledgerlings issuer, the resale royalty supports the project — we'll always
> tell you which applies before minting.

---

## 1. What you provide
1. **Character art** to the template below (PNG, transparent background).
2. A **manifest** (JSON) describing your character + where accessories attach.
3. Your **creator handle + collection name** (for attribution + royalty).

## 2. Art template (so accessories from anyone line up)
- **Canvas:** 1024 × 1024 px, **transparent** background.
- **Pose:** upright / front-facing, neutral **A-pose**, arms at sides, centered, feet on the baseline.
- **Fit the safe box:** keep the character inside the central 880 × 940 area (margin for accessories).
- **Stages (optional but recommended):** 5 frames — egg → baby → teen → adult → elder — same pose, same
  canvas, scaled within the safe box. (Adult-only is fine for a v1 "skin".)
- **Style:** clean, readable silhouette. (Game-canonical art is pixel; high-res illustration is accepted
  and downscaled — see PROJECT.md "dress-up discipline".)

## 3. Anchor points (the trick — makes ANY accessory fit ANY character)
Declare where hats/outfits/held-items attach, as **normalized coords (0–1)** of the canvas, in the manifest.
Accessories are drawn against the same anchor grid, so they line up on every character that declares them:
- `head`  — top-center of the head (hats, halos)
- `face`  — center of the face (glasses, masks)
- `body`  — center of the torso (outfits, badges) + a `bodyBox` {x,y,w,h}
- `handL` / `handR` — paw/hand points (held items)
- `feet`  — baseline center (shoes, platforms)

## 4. Manifest schema (`character.json`)
```json
{
  "schema": "ledgerlings/character@1",
  "name": "Your Character Name",
  "creator": "@yourhandle",
  "collection": "Your Collection",
  "stages": ["egg.png","baby.png","teen.png","adult.png","elder.png"],
  "anchors": {
    "head":  {"x":0.50,"y":0.18},
    "face":  {"x":0.50,"y":0.34},
    "body":  {"x":0.50,"y":0.60},
    "bodyBox": {"x":0.32,"y":0.46,"w":0.36,"h":0.34},
    "handL": {"x":0.30,"y":0.62},
    "handR": {"x":0.70,"y":0.62},
    "feet":  {"x":0.50,"y":0.94}
  },
  "royaltyBps": 5000
}
```
Every character MUST use the same anchor *names*; tune the *coordinates* to your art. That's what makes a
"Wizard Hat" accessory sit correctly on a bear, a seal, or your character alike.

## 5. What stays fixed (non-negotiable — this is the trust core)
- The **rules engine is shared + open** (`pet_rules.js/.py`). You do NOT ship game logic — only art + anchors.
- State lives in the **dNFT URI**, updated by `NFTokenModify`; the **replay verifier** re-checks every pet.
- → Your character is provably fair the moment it's in, with zero extra work from you.

## 6. Submission flow
1. Draw your character to the template; export transparent PNG(s).
2. Fill `character.json` (above).
3. Submit art + manifest (channel TBD — repo PR / form / DM).
4. We review (style + anchors + IP rights — you must own the character), then we mint your character via
   **authorized minting** (`Issuer` = your address) into the character roster as a Ledgerlings-compatible
   pet — so attribution and the 5% resale royalty are **yours**.

## 7. Roadmap (engineering, not creator-facing)
- `roster.json` registry of approved characters (game reads it to offer them).
- `/register-character` issuer endpoint (mint + roster add), mirroring `/mint-accessory`.
- Canvas "character mode" with the anchor grid + safe box overlaid.
- Image hosting (IPFS/Arweave) for the art the URI references.
