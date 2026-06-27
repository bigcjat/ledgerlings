# Ledgerlings — Xaman xApp Build Plan

**Date:** 2026-06-27 · Consolidates today's design work (accessory marketplace, pixel pets, verification, xApp infra).
**North star:** ship the provably-fair pet as a polished Xaman xApp for **Make Waves** (90 days from 2026-06-21 →
~2026-09-19), then layer the marketplace **only once there are players** (distribution before build).

**Chain:** Ledgerlings = **XRPL XLS-20** (the dNFT uses `NFTokenModify`; accessories use `TransferFee`). XRPL
mainnet = NetworkID 0 → no `NetworkID` field needed on txns (unlike the Xahau lesson from the Quantum xApp). CONFIRM
this before Phase 1 — if any of it runs on Xahau, the NFT mechanics (URIToken, no TransferFee) change.

---

## What already exists (from prior work — audit before building)
- Testnet **mint + `NFTokenModify`** loop (pet dNFT lifecycle), **rules engine** (state transitions), **replay
  verifier** ("Verify my pet" — the provable-fairness core), **xApp frontend** (`build/app.html`: stats +
  tap-to-beat + verify), **real Xaman SDK** integration, **sprites** (`ledgerlings_*.png`), **market-mood** feature.
- So Phase 1 is mostly **harden + properly xApp-package** what's built, not greenfield.

---

## Phase 0 — Foundations (1 week)
1. **Confirm chain + accounts:** XRPL mainnet vs testnet path; create the **issuer account** (for the pet dNFTs +,
   later, accessories). Secure its key — **cold / multisig / RegularKey** (non-negotiable; it's the catalog authority).
2. **xApp infra (reuse the Quantum Key Scanner patterns, already proven):**
   - `new Xumm(apiKey)`, `xumm.on('ready'/'success')`, `xumm.user.account` + `xumm.user.networkId`.
   - **Network-aware** RPC + a visible **network badge** (XRPL green / Xahau amber) — same as the scanner.
   - Sign flow via `xumm.payload.create(...)` → `xumm.xapp.openSignRequest(p)` → `on('payload')`.
   - `selectDestination` for any account-pick UX.
   - API key = **public client id only**, set in deploy, placeholder in repo.
3. **Repo + hosting:** `git init` Ledgerlings, private GitHub repo, a static host for the xApp URL, register in the
   Xaman dev console. (Also unblocks cloud `/ultraplan` later.)

## Phase 1 — Make Waves MVP: the pet as a real Xaman xApp (4–6 weeks) — SHIP THIS
The provably-fair pet, polished and native in Xaman. Goal: a judge can mint, care for, and **verify** a pet.
1. **Onboarding / mint:** one-tap mint of a Ledgerling dNFT from the issuer to the user (signed in Xaman).
2. **Care loop:** the rules engine drives feed/play/sleep state; actions that mutate on-chain state go through
   `NFTokenModify` sign requests; off-chain ticks for the live feel. Tap-to-beat / dance UX from `app.html`.
3. **"Verify my pet":** surface the replay verifier in-app — anyone re-derives the pet's state from its history →
   provable fairness. **This is the differentiator; make it front-and-center, not buried.**
4. **Market-mood** feature wired in (already built).
5. **Polish:** sprites/stages, mobile webview layout, error/loading states, "not in Xaman" browser fallback.
6. **Honesty/UX bar:** apply the Quantum xApp audit lessons — no false claims, disclose data flow, privacy policy,
   aria-labels, graceful failure, fetch timeouts.
7. **Submit to Make Waves.** Everything past here is post-launch.

## Phase 2 — Accessory marketplace (post-launch, demand-gated) — see ACCESSORY_MARKETPLACE.md
Build only once Phase 1 has players who want cosmetics.
1. **Issuer-mint + `TransferFee` royalty** model (we mint, artist keeps primary, we keep perpetual secondary royalty).
2. **`artist_id` unification** — one uint32 = artist identity = `NFTokenTaxon` = collection = Destination Tag.
   Reserve 0, start at 1.
3. **Canvas tool** for artists → **mint-time review gate** (content/IP) → `NFTokenMint(taxon=artist_id, TransferFee,
   URI)` → deliver to artist.
4. **Catalog read path:** Clio `nfts_by_issuer`+taxon / Bithomp / XRPLData; `parseNFTokenID` (taxon is scrambled);
   app filters by **issuer + taxon** (provenance — random NFTs can't impersonate the catalog).
5. **Equip accessories** on the pet (display + on-chain where it matters).

## Phase 3 — Trait-derived pixel pets (partner-gated) — see ACCESSORY_MARKETPLACE.md §11
1. **Equip/display** a pixel skin generated from an NFT the user owns (no mint, low risk) — broad + fun.
2. **Mint-to-sell** gated to **CC0 + opt-in partner collections** only. The IP gate = a BD/cross-promo pipeline.
3. **Per-collection trait→pixel mapping** (curated art/config per collection) — the real cost, and it *enforces* the
   gate (we only support collections we've deliberately cleared). CC0 pixel collections = first targets.
4. Generative **skin** keyed off NFT metadata `attributes`; core provably-fair pet unchanged.

## Phase 4 — Economy + verification + polish
1. **Boost payments** — artists pay the issuer to feature a collection; Destination Tag = artist_id;
   `asfRequireDest` on the wallet (reject untagged).
2. **Verification-record integration** (the Kairo Vault edge) — attest accessory/pixel-pet provenance: "minted by
   Ledgerlings issuer, taxon=artist_id, creator=X, derived-from NFT Y, edition N." Provable, re-checkable. Ties
   Ledgerlings into the verification-record standard authored this week.
3. Marketplace UX, artist profiles (artist_id → name/links), secondary-market surfaces.

---

## Open decisions / risks (resolve as you go)
- **Chain (XRPL vs Xahau)** — confirm before Phase 1 (drives all NFT mechanics).
- **Artist incentive** — primary-sale only, no resale royalty (we keep it). Pressure-test that volume + audience
  pull artists in. *The make-or-break, and it's non-technical.*
- **IP / content** — mint-time gate + content policy from day one (the Tamagotchi-rebrand lesson). Pixel-pets +
  accessories both = derivative-IP risk → CC0/partner gate for mint-to-sell.
- **Issuer key security** — one account = catalog authority + payment sink. Cold/multisig/RegularKey.
- **Sequencing discipline** — do NOT build Phase 2+ before Phase 1 has users. The canvas tool *can* seed artist
  supply pre-launch to soften the chicken-and-egg, but the pet ships first.

## Immediate next actions
1. Audit the existing Ledgerlings build (what works, what's stale post-rebrand).
2. Confirm chain + create/secure the issuer account.
3. Stand up the xApp shell (Xaman SDK + network-aware + badge, from the Quantum xApp patterns).
4. Wire mint + care-loop + "Verify my pet" into the xApp → Make Waves MVP.
