# Ledgerlings — Marketplace & Artist Platform (future roadmap, post-hackathon v2)

*The revenue engine. The pet is the free, viral funnel; wearables + backgrounds + artist collabs are the money.
This turns Ledgerlings from a game into a platform. NOT in the 90-day MVP — spec'd here so the MVP doesn't
accidentally foreclose it.*

## The vision
A pet you own (dNFT) + an open marketplace of **artist-made wearables, accessories, and backgrounds**, all
dNFTs on XRPL, with Ledgerlings taking a protocol cut on every sale. Verification = credibility, the pet =
funnel, the marketplace = revenue. The more artists, the more to buy → more reasons to play → more pets →
more accessory demand. A real network-effect flywheel.

## The products (all XRPL dNFTs)
- **Clothes / accessories** — hats, scarves, wings, auras, held items. Equipped onto a pet; the rendered
  pet composites its equipped items.
- **Backgrounds / scenes** — the pet's "home" backdrop (artist-designed).
- **Skins / palettes** — recolors of the base creature (alternate cores, body ramps) for collectors.
- Later: **UGC** — players design their own (start curated, open the studio once moderation/tooling exist).

## The revenue model (how Dane takes a cut)
- **Primary sale** — mint the item dNFT, sell via `NFTokenCreateOffer` at a set price. Ledgerlings (or the
  artist) is the seller → keeps the proceeds (minus a platform/artist split).
- **Secondary royalty — NATIVE + automatic.** XRPL `NFTokenMint` has a **`transfer_fee`** field (0–50% in
  0.001% steps; requires `tfTransferable`). On *every resale* of that item, the ledger auto-routes the fee
  to the **issuer**. So if Ledgerlings (or a Ledgerlings-controlled issuer) mints the items, it earns a cut on
  every secondary trade, enforced on-chain — no marketplace middleman, no trust. This is the clean recurring cut.
- **Artist splits** — collab items minted via a shared issuer / agreed split (primary revenue share +
  transfer-fee share). On-chain, auditable — fits the "verifiable" brand: artists can *prove* their royalty.

## Artist collaborations (the network-effect engine — your instinct is right)
XRPL has a real NFT art scene (xrp.cafe, onXRP, collections + creators). Pitch each: *"Ledgerlings is a
canvas with built-in distribution (Xaman xApp) and a hungry pet-owner audience. Drop a wearable/background
collection; you keep the bulk of primary + a verifiable royalty on every resale."*
- **Collab drops** — limited artist accessory/background collections (scarcity + hype).
- **Cross-collection** — holders of partner XRPL collections get a matching pet accessory (composability;
  drives their community into your xApp).
- **Seasonal / event** — artist-made limited backgrounds tied to events (the Make Waves win itself = a drop).
Every collab brings its community → pet adoptions → accessory demand. The flywheel.

## How items attach (tech sketch — keeps the provable-fairness brand)
- Each item = a dNFT held by the player. **Equipping** writes the equipped item IDs into the pet's dNFT URI
  (or a small linked "loadout" record). The render composites base pet + equipped sprites in z-order.
- **Verifiable**: ownership of every item is on-chain; the equip-set is in the pet's on-ledger state; the
  replay verifier already proves the pet's core state wasn't tampered — extend it so "you can only equip
  what you own" is checkable too. Cosmetics stay honest, same as the game.
- Items must NOT affect the fairness-critical state (stats/evolution) — cosmetic only — or they'd become a
  pay-to-win channel that breaks the "provably fair" claim. **Hard rule: accessories are cosmetic.**

## Honest scoping
- **Post-hackathon.** The 90-day MVP stays: pet + interactions + provable fairness + a thin Xaman xApp. The
  marketplace is v2 — but design the pet's loadout field + the issuer model now so v2 doesn't need a migration.
- **Start curated, not UGC.** A handful of hand-picked artist collabs first (quality + moderation + hype).
  Open the "design studio" only once tooling + content moderation exist.
- **Distribution-before-build:** the buyers are pet owners (cosmetics for a pet they're attached to) +
  XRPL NFT collectors + artists wanting a canvas. The cut is the model — confirm `transfer_fee` mechanics
  + a clean artist-split structure before building.
- **Verify the cosmetic-only rule holds** — the moment an accessory buffs stats, the fairness story dies.

## First concrete steps (when v2 starts)
1. Add a cosmetic `loadout` field to the pet dNFT state (reserve it in the MVP schema now).
2. Mint one test wearable dNFT with `transfer_fee` set; confirm the issuer earns on a simulated resale (testnet).
3. Composite-render a pet with one equipped accessory (extend render_stages.py z-ordering).
4. Line up ONE XRPL artist for a pilot background/accessory drop; agree the split.
