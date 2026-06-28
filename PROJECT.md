# Ledgerlings — provably-fair on-chain virtual pet

*Project started 2026-06-16. Living idea-tracking doc. Separate brand from Kairo-pon.*

> **⚡ PIVOT 2026-06-25 — building for XRPL Commons "Make Waves" hackathon (90 days from 06-21).**
> Now **XRPL-NATIVE via Dynamic NFTs** (DynamicNFT amendment verified mainnet-active): pet state in a mutable
> NFToken (`NFTokenModify`), interactions = Payments+memos, fairness = open versioned rules anchored on XRPL +
> a client-side **replay verifier** (cheating detectable). The Xahau-**Hook** version (rules ENFORCED + xahc-prover
> proofs) is the optional stronger variant if Xahau qualifies. **Name now reads Xaman+Tamagotchi** — ship as a
> **Xaman xApp** for built-in distribution. Build plan + entry: `MAKE_WAVES_MVP.md` · `STATE_MACHINE.md` ·
> `MAKE_WAVES_ENTRY.md` · `.claude/queue.md` (resumable build queue). The Xahau-first content below is the original
> framing, now the "stronger variant."

## ✅ BUILD STATUS (2026-06-25) — registered + testnet-proven + xApp built
REGISTERED + announced for Make Waves. In `build/`:
- dNFT mint + `NFTokenModify` loop — **proven on XRPL testnet** (`mint_pet.py`).
- Rules engine `pet_rules.py` (+ shared `pet_rules.js`) — sim-validated (loved→evolves, neglected→dies, owner-only).
- Replay verifier `replay_verify.py` ("Verify my pet") — teeth-proven (catches operator cheating, names fields).
- Interaction pipeline `interaction.py` (Payment+memo → rules → NFTokenModify; live run faucet-throttled).
- **xApp frontend** `app.html` — pet + live stats + feed/play/clean/heal + tap-to-beat dance + verify panel.
- **Real Xaman SDK integration** — `xaman_bridge.js` + `server.js` (issuer) + `package.json` + `XAMAN_SETUP.md` (drop-in).
- Art: 7 sprites (`render_stages.py`) + `ART_BIBLE.md`.
- Roadmaps: `MARKETPLACE_ROADMAP.md` (v2) · `BREEDING_ROADMAP.md` (v3) · `FUN_INTERACTIVITY.md`. Queue: `.claude/queue.md`.

Next: live Xaman keys + deploy · re-run on-ledger pipeline when faucet cools · webview mic for live music-dance.

---

## The one-liner

A Tamagotchi-style virtual pet that lives **entirely on Xahau** — every rule is a Hook,
and **xahc-prover mathematically proves the rules are fair**. The pet can't be rigged,
rugged, secretly nerfed, or resurrected. *Its fairness isn't a promise — it's a theorem.*

## Why it matters (not a toy)

- **Killer differentiator:** the first *provably-fair* on-chain pet. Every web2 pet game can
  change rules / rug / shut down a server. This one's ruleset is on-ledger and formally
  verified — trustless by construction.
- **Viral showcase for xahc-prover.** Nobody outside crypto-sec shares "formal verification
  of money-Hooks." Everybody shares "my on-chain pet whose fairness is mathematically
  guaranteed." Fun front door → serious verification tooling (feeds the VaaS business).
- **Exercises the whole quartet:** write the Hook (xahc) → simulate an interaction
  (xahau-mcp) → prove it fair (xahc-prover) → host the frontend (evernode-mcp) → live in
  KairoVault.

## Identity (decided + open)

- **DECIDED: separate brand from Kairo-pon** — its own character + name. (Kairo-pon stays its
  own thing / Saga game.)
- **OPEN:** project/character name (working title "Ledgerlings" = Xahau + Tamagotchi), the
  creature design, art direction. Could be a species/family of pets, not one mascot.

## Core mechanics

- **State (HookState):** hunger, happiness, health, **age**, lifecycle stage, alive/dead,
  last-interaction ledger (+ maybe care-score / XP).
- **Interactions** (txns → the pet's account, e.g. Invoke + memo): feed / play / clean / heal.
  Each triggers the Hook to update state per the rules.
- **Time decay:** stats decay by ledger-time since the last interaction; sustained neglect →
  the pet dies.
- **AGING (core — the user's ask):** the pet ages with ledger-time through **lifecycle stages**
  — e.g. egg → baby → teen → adult → elder → (death of old age). Age only ever increases.
  - **Care-driven evolution:** which adult/elder *form* the pet becomes depends on how well it
    was cared for (classic Tamagotchi — neglect → a lesser form, great care → a rarer form).
    Deterministic + on-chain, so the evolution is provably fair (no hidden RNG rug).
  - **Lifespan:** bounded; an elder eventually passes of old age (distinct from neglect-death).
- Fully on-chain. No server. The Hook *is* the game.

## What xahc-prover proves (the "provably fair" claims)

The pet is a **stateful Hook evolving over time** — exactly what the new stateful-hook proving
(the period-budget inductive proof) handles. Candidate invariants:

1. **Bounded stats** — hunger/happiness/health ∈ [0, max]; no overflow/underflow.
2. **Age monotonicity** — age only increases; an elder can never revert to baby; lifecycle
   stage transitions are one-directional.
3. **No resurrection** — a dead pet stays dead (or revives only by the one explicitly allowed
   rule, proven to be the only path).
4. **Decay/interaction integrity** — feeding only raises fullness, time only decays; no
   interaction corrupts state into an invalid value; stage matches age.
5. **Owner-only** — nobody can hijack, grief, or interact with a pet they don't own.
6. **No infinite farming** — feed/reward/XP cooldowns can't be bypassed (the cumulative-cap
   proof from the budget Hook maps 1:1).
7. **Fair evolution** — the adult/elder form is a deterministic function of on-chain care
   history; no hidden RNG, no path that mints a rare form unfairly.

## MVP scope (phased)

- **Phase 1 — the differentiated core (start here):** a pet Hook with hunger + happiness +
  alive + **age/stage**, feed/play interactions, time-decay, death-on-neglect, age progression.
  Prove ~4–5 core invariants (bounds, age-monotonicity, no-resurrection, owner-only, no-farm).
  This is the "provably-fair pet" proof — the headline.
- **Phase 2 — frontend:** a tiny web UI that reads the pet's HookState + signs interaction txns
  (feed/play). Show the pet, its stats, its stage — with the **proof certificate displayed
  next to it**.
- **Phase 3 — testnet demo:** deploy on Xahau testnet; demo a pet living, being fed, aging
  through stages, evolving by care, and dying if neglected — all on-ledger, real hashes.
- **Phase 4 — depth (backlog):** evolution forms, breeding (supply-bounded + proven),
  collectibility (each pet a URIToken?), social (visit/play with others' pets), leaderboards.

## Stack synergy

write Hook = **xahc** · simulate = **xahau-mcp** · prove fair = **xahc-prover** · host frontend =
**evernode-mcp** · home = **KairoVault**. A flagship that uses the entire toolchain in a fun,
shareable artifact.

## CORE PRINCIPLE: the on-chain / off-chain boundary

**The provably-fair guarantee covers the on-chain GAME RULES (HookState + the Hook). Real-world
or app-side inputs live in an OFF-CHAIN engagement layer and must NEVER be inside the fairness
guarantee.** Real-world data (steps, sensors) is inherently spoofable; if it could rig the proven
mechanics, "provably fair" becomes a lie. Keep the proven core (bounds, aging, evolution odds,
death) independent of any off-chain input. This is what lets us add ANY fun real-world feature
without breaking the brand.

## Engagement & interaction features

- **Play with it:**
  - Petting/touch → happiness, with a **Hook-enforced cooldown** (provably can't spam to max).
  - Mini-games (rock-paper-scissors, reflex/timing, puzzle) → win → happiness/XP; outcome posts a
    result-txn the Hook validates within bounds.
  - **Provably-fair mini-games** — a chance/coin-flip game whose odds are on-chain + proven (same
    as the breeding gacha) — another spot where xahc-prover IS the feature.
  - Training/care quality shapes which **evolution branch** the pet takes (cute↔ugly-cute).
- **Real-world tie-ins (OFF-CHAIN engagement layer, per the core principle):**
  - **Step counter** (HealthKit / Google Fit) → steps convert to off-chain "energy/food" you spend
    on on-chain care actions. The "walk to keep your pet alive/happy" loop = strong retention +
    virality (precedent: Pokémon Pikachu pedometer, Pokémon GO Adventure Sync, STEPN). Spoofing
    steps only cheats yourself — it can't rig the proven mechanics.
  - **Anti-cheat (best-effort, NOT a fairness claim):** device attestation (Apple App Attest /
    Play Integrity) + signed step submissions raise the spoofing bar. Labeled honestly.
  - **Or steps purely cosmetic/social** — fitness streak badge, step leaderboard, walk-earned
    cosmetics — zero fairness tension.
  - Extends to: sleep tracking (pet rests), time-of-day (sleeps at night), weather, etc. — all
    off-chain flavor, never inside the proof.

## Art = a mechanic (not just visuals)

"Cute AND not-so-cute pets people show their friends" is the **collectibility + virality
engine**, not decoration. Care-driven evolution produces a spectrum of forms — adorable,
weird, ugly-cute, rare/legendary. The variety is what makes a pet worth owning, showing off,
and trading. "Show your friends" is the growth loop; rare/weird forms drive the marketplace +
breeding economy. Dane will make the art. Direction: a *species/family* with many evolution
forms across the cute↔grotesque spectrum, rarity tiers, flex-worthy legendaries.

## Art & NFT tech

**Style: pixel sprites.** Tamagotchi charm = low-res sprite art — easy to make solo, tiny
files (matters for dynamic/on-chain), and fits Dane's skills (Kairo-pon Saga pixel game,
isometric-tokyo). Tools: Aseprite (pixel + animation standard) or Piskel (free); optionally
AI-assisted concepts (Qwen/LoRA like isometric-tokyo) cleaned up by hand for a cohesive family.
Production: build a `stages × evolution forms` sprite template (egg/baby/teen/adult-forms/elder);
ship ONE full pet line for the MVP (all stages + a couple branches), expand later. The
cute↔ugly-cute spectrum = different adult/elder branches off the same baby.

**Animated: yes.** Tiny looping sprite animations per state — idle bob, eating, happy bounce,
sick wobble, sleeping, death (2–4 frames each). **The animation is chosen CLIENT-SIDE from the
on-chain state**: the app reads the pet's HookState (stage + mood) and plays the matching loop.
No frames stored on-chain.

**Dynamic NFT — the architecture (separate truth from art):**
- **On-chain truth:** the pet's STATE (hunger/age/stage/mood) lives in **HookState** — the thing
  xahc-prover proves fair. Source of truth.
- **The collectible:** each pet is a **URIToken** (Xahau NFT) — the ownership/tradability wrapper.
- **Dynamism = a state-aware renderer.** The URIToken's metadata URI points to an endpoint that
  reads the live HookState and returns the current image/metadata (baby→elder, happy→sick). The
  NFT looks dynamic everywhere WITHOUT constantly mutating the token — the dynamism comes from the
  on-chain Hook state the renderer reads.
- **Art assets** live off-chain (IPFS / Evernode / CDN — on-chain image storage isn't practical);
  **state** is on-chain. Standard correct split.
- **Stack tie-in:** the renderer (HookState → animated sprite + metadata) is a natural **Evernode
  HotPocket dApp** → stays decentralized + uses evernode-mcp. The art literally reflects the
  formally-proven state.

**Open confirmations (verify against Xahau docs before building):**
- [ ] Xahau URIToken **mutable-URI** support — the renderer approach avoids needing it, but
      confirm if we ever want the stage baked into the token directly.
- [ ] How marketplaces render an **animated** URIToken (GIF/SVG vs a static frame) — affects
      whether the collectible itself animates or just the app.

## Monetization (no token, provably-fair must NOT break)

Guardrails: **no project token ever** (bootstrap rule) — fees in XAH + URIToken sales only.
Provably-fair must hold — odds transparent + proven, cosmetics never pay-to-win, **death stays
real**. The moment it feels rigged the differentiator dies. Honest sizing: Xahau is small, so
this is a **viral funnel + modest revenue + xahc-prover showcase**, not the ¥12M engine.

1. **Provably-fair breeding / gacha (THE MOAT).** Breed two pets → offspring traits inherited
   with odds that are **on-chain and formally proven** by xahc-prover. Charge a breeding fee.
   Only possible with this tech: the gacha industry runs on HIDDEN odds (and is increasingly
   regulated for it) — Ledgerlings is the *ethical, transparent* gacha: every rarity rate
   published + mathematically proven, no rigged pulls. Rare/ugly-cute forms are what people pay
   to chase. Turns "provably fair" from a feature into the monetization moat.
2. **Adoption / mint fee** — minting a new egg costs XAH; the pet is a URIToken you own. Simple,
   immediate.
3. **Marketplace royalties** — pets are tradable URITokens; small cut on secondary sales. Rare
   pets gain value → secondary market → royalties. Rewards the show-off/collect loop directly.
4. **Cosmetics** — hats/skins/backgrounds as URITokens. Optional, COSMETIC-ONLY (never touches
   the proven rules), recurring.
5. **Premium eggs / starter traits** — pay for a rarer starting egg with PUBLISHED, PROVEN odds
   (transparent, not hidden).
6. **Legacy egg** — on death, a paid "lineage continues" egg — keeps death real, gives a soft
   continuation path.
7. **(Later, B2B)** "provably-fair game mechanics as a service" — license the verified-fairness
   framework to other Xahau game devs. Ties to the xahc-prover VaaS plan.

## Open questions / decisions to make

- [ ] Name + character/species design (separate from Kairo-pon).
- [ ] Interaction tx shape — Invoke + memo? a custom Payment? cost per interaction (fee/burn)?
- [ ] Is each pet its own Xahau account (Hook installed on it), or one Hook managing many pets
      in state keyed by owner? (Affects scale + the proof.)
- [ ] Aging clock: pure ledger-time, or care-adjusted? Lifespan length.
- [ ] Is the pet itself a collectible (URIToken) you own/trade, or account-bound?
- [ ] Death = permanent, or hatch a new egg? Legacy/lineage?

---

## Idea log (append new ideas here)

- 2026-06-16 — Project started. Provably-fair angle + Kairo-pon-separate identity + aging
  with lifecycle stages + care-driven evolution. Phase-1 = pet Hook + fairness proof.
- 2026-06-16 — Art = mechanic: cute↔ugly-cute spectrum + rarity = collectibility/virality
  ("show your friends" growth loop). Dane makes the art.
- 2026-06-16 — Monetization explored: **provably-fair breeding/gacha = the moat** (transparent
  proven odds vs the hidden-odds gacha industry); + mint fee, marketplace royalties, cosmetics,
  premium/legacy eggs; no token; fairness/death stay real; treat as funnel+modest-revenue.
- 2026-06-16 — Art & NFT tech decided: pixel sprites (Aseprite), client-side animation driven by
  on-chain state, dynamic NFT = URIToken + state-aware renderer reading HookState (truth on-chain,
  art off-chain), renderer as an Evernode dApp. Open: URIToken mutable-URI + marketplace animation.
- 2026-06-16 — Engagement: play (petting w/ Hook-enforced cooldown, mini-games, provably-fair
  chance games, training→evolution) + **step-counter "walk to care" loop**. CORE PRINCIPLE locked:
  on-chain rules = provably fair; real-world inputs (steps/sensors) = off-chain engagement layer,
  NEVER inside the fairness guarantee (spoofable → would break the brand). Steps→energy you spend
  on on-chain actions; best-effort device attestation; or steps purely cosmetic.

## Collaborator dress-up discipline (LOCKED RULE 2026-06-28)
The dress-up system only works if the base is fixed. Non-negotiable:
1. Generate the BASE character first, then LOCK it: same pose, size, canvas, art style, and SEED every time.
2. Accessories/clothes/backgrounds only line up if collaborators draw to a fixed TEMPLATE (the locked base + grid).
3. Hand collaborators a REFERENCE SHEET (front + side, neutral T-pose, on a grid) as the spec.
4. STYLE DECISION (decide once, then never drift): the shipped game is PIXEL sprites (render_stages.py / ART_BIBLE).
   For in-game overlay consistency, the canonical base + accessories should be pixel-art too (clean chibi/vector
   is marketing-only). The collaborator canvas (build/canvas.html) is currently freeform paint — upgrade to a
   pixel-grid mode if pixel is the canonical style, so drawn accessories align to the sprite grid.
