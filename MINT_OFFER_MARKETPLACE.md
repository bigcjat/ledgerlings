# Ledgerlings — Atomic Mint-and-List Marketplace (`NFTokenMintOffer`)

*Feature spec for the v2 marketplace (see MARKETPLACE_ROADMAP.md). Design doc, not code.*
*Brand-critical: nothing here touches the provably-fair care state. Read §4 before §5.*

---

## 0. TL;DR

XRPL's `NFTokenMintOffer` lets the issuer **mint an NFToken AND create its sell offer in a single
transaction**. We use it to:

- **List accessories/backgrounds** (cosmetic dNFTs) for primary sale in one tx, with the
  resale royalty (`transfer_fee`) baked in at mint — so Dane/the artist earns on every resale,
  enforced on-ledger.
- **Onboard new players** — mint a pet egg dNFT and either list it or deliver it directly, atomically.

The fairness story is untouched: accessories live in the reserved cosmetic `loadout`, isolated from
`step()`. Marketplace plumbing is pure commerce; it never reads or writes the care-state record.

---

## 1. `NFTokenMintOffer` mechanics

### The old two-step flow (what we replace)

```
tx1: NFTokenMint        → ledger creates the NFToken in the issuer's account
                          (issuer must read back the new NFTokenID from tx metadata)
tx2: NFTokenCreateOffer  → issuer creates a sell offer (tfSellNFToken) referencing that NFTokenID
```

Problems with two-step:
- **Half-state window.** Between tx1 and tx2 the NFT exists but is *not listed*. If tx2 fails,
  bounces, or the process crashes, you have an orphan minted NFT sitting unlisted — manual cleanup,
  inconsistent shop inventory, owner-reserve consumed for nothing.
- **NFTokenID round-trip.** tx2 needs the NFTokenID, which is only knowable *after* tx1 is validated
  (it's derived from issuer + sequence/taxon and surfaced in tx1 metadata). That forces a
  read-after-write: submit tx1 → wait for validation → parse meta → build tx2. Latency + a place to
  drop the ball.
- **Two fees, two signatures, two submissions.**

### The atomic flow (`NFTokenMintOffer`)

One transaction does both. It carries the **mint fields** *and* the **offer fields**:

| Field | Role | Notes for Ledgerlings |
|---|---|---|
| `URI` | dNFT content/state pointer | hex-encoded; the cosmetic's art/metadata (NOT pet care-state) |
| `NFTokenTaxon` | collection grouping | one taxon per drop / collection (e.g. "Season 1 Wings") |
| `Flags` | mint flags | **`tfTransferable` REQUIRED** (see below) + `tfMutable` if the cosmetic is itself a dNFT we may restyle |
| `TransferFee` | resale royalty | 0–50000 = 0.000%–50.000% in 0.001% steps; auto-routes to **issuer** on every resale. **Requires `tfTransferable`.** |
| `Amount` | the sell price | drops of XRP (or an issued-currency amount). `0` = a free/giveaway offer |
| `Destination` | restrict the buyer | optional; if set, **only that account can accept** the offer (use for reserved/whitelisted drops, artist allocations, or direct delivery — see §3) |
| `Expiration` | offer auto-expiry | optional ledger-time; offer self-cancels after it. Use for timed drops / limited windows |

On success, in **one** validated tx the ledger:
1. mints the NFToken (owned by the issuer/minting account),
2. creates a **sell offer** for it (implicitly `tfSellNFToken`, since the minter owns it),
3. and the new NFTokenID + the created OfferID are both in the tx metadata.

### Why atomic matters

- **No half-state.** Either the item is minted-and-listed, or nothing happened. Shop inventory is
  always consistent; no orphan unlisted NFTs.
- **Cleaner UX / simpler backend.** No read-after-write NFTokenID round-trip. The issuer endpoint is
  one build → one sign → one submit. Drops can be scripted as a flat list of one-tx-per-item.
- **Fewer fees.** One base tx fee instead of two. At scale (a 1,000-item drop) that's 1,000 fees
  instead of 2,000, and 1,000 submissions instead of 2,000 + 1,000 meta-parses.
- **Atomic royalty binding.** The `transfer_fee` is set *at mint*, in the same tx that lists it —
  there's never a moment where an item is sellable without its royalty attached.

---

## 2. v2 marketplace: issuer mints accessory + lists in one tx

### The artifact

Each shop item (wearable / background / palette) is **one cosmetic dNFT**. It is **not** a pet, has
**no** 64-byte care record, and never passes through `step()`. Its `URI` points to the cosmetic's
art + metadata (sprite layer, z-order hint, display name, artist credit).

### The single transaction (per item)

```
NFTokenMintOffer  (signed by the Ledgerlings issuer / shared artist issuer)
  Account:      <issuer>
  URI:          <hex art+meta pointer>
  NFTokenTaxon: <collection id>
  Flags:        tfTransferable        # MANDATORY for transfer_fee + secondary trade
  TransferFee:  <0..50000>            # e.g. 5000 = 5.000% royalty to issuer on every resale
  Amount:       <primary price, drops>   # the shop list price
  Destination:  <optional whitelist>     # omit for open sale
  Expiration:   <optional drop window>
```

For a limited drop of N items, the issuer endpoint emits N such transactions (same taxon, distinct
URIs / serials).

### Revenue flow

**Primary sale (one-time, at first purchase):**

```
Buyer  --NFTokenAcceptOffer-->  ledger
   buyer pays `Amount` (XRP) ───────────────►  goes to the offer's owner = the issuer (seller)
   NFT ownership ─────────────────────────────►  transfers issuer → buyer
```
The `Amount` of the sell offer is the primary revenue. If a collab artist is the seller (their
issuer or an agreed split account), they keep the primary; if Ledgerlings is the issuer, Dane keeps
it (minus the agreed artist share — settled per the split arrangement, on-ledger and auditable).

**Secondary royalty (recurring, automatic, on every resale):**

```
later... Owner A sells the same NFT to Owner B
   ledger auto-deducts TransferFee% of the sale ──►  ISSUER  (Dane / the minting account)
   remainder ─────────────────────────────────────►  seller (Owner A)
```
Because Ledgerlings mints the items, the **issuer is the royalty recipient by protocol**. No
marketplace middleman, no trust, no off-chain enforcement. This is the clean recurring cut from
MARKETPLACE_ROADMAP.md, now *bound at mint inside the same tx that lists the item*.

**Artist splits:** collab items are minted via a shared issuer (or an agreed split structure). The
primary revenue share and the transfer-fee share are both on-chain and auditable — artists can
*prove* their royalty, which fits the verifiable brand. (Mechanics of multi-party royalty splitting
are a separate design item — XRPL `transfer_fee` pays a *single* issuer account; see §6 gotchas.)

### Revenue summary

| Revenue | When | Who collects | Mechanism |
|---|---|---|---|
| Primary sale | first purchase | offer owner (issuer / artist) | `Amount` on the mint-offer → buyer pays on accept |
| Secondary royalty | every resale, forever | **issuer** (the minting account) | `TransferFee` set at mint, auto-routed by ledger |

---

## 3. Adoption flow: mint a pet egg + list (or deliver) atomically

Onboarding a new player can reuse the same atomic primitive — with one important distinction: a pet
**does** carry the fair care-state, so its `URI` encodes (or points to the hash of) the 64-byte
record at genesis (`birth_ledger` set, stats seeded, `owner` = the new player). The marketplace tx
only handles *delivery*; the care machine governs everything after.

Two onboarding modes, both single-tx:

**(a) Adopt-from-shop (paid egg / sellable adoption):**
```
NFTokenMintOffer
  URI:          <hex of genesis pet record / its hash>
  Flags:        tfTransferable
  Amount:       <adoption price>        # 0 for free adoptions
  Expiration:   <optional>
```
The new player accepts the offer → owns the pet egg. If the egg should hatch on a time-gate, pair
with Escrow (`FinishAfter`) per STATE_MACHINE.md — orthogonal to the mint-offer.

**(b) Direct delivery (gift / claim-code / free onboarding):**
```
NFTokenMintOffer
  URI:          <hex of genesis pet record>
  Flags:        tfTransferable
  Amount:       0
  Destination:  <the new player's account>   # ONLY they can accept → targeted delivery
```
Set `Destination` to the new player and `Amount: 0` so only that account can claim it — a clean,
atomic "here's your pet" with no orphan-mint risk and no two-step.

**Care-state note:** whichever mode, the pet's `owner` field in the care record must be set to the
adopting account at/just after delivery so the owner-only interaction gate (`prove_authz`) holds. The
genesis state is seeded by the issuer's rules engine; the mint-offer is purely the on-ledger handoff.

---

## 4. BRAND GUARD — accessories are COSMETIC-ONLY (restated, non-negotiable)

**Accessories and backgrounds NEVER touch the fairness-critical care state.** This is the same hard
rule already written into STATE_MACHINE.md, restated because this feature is the channel through
which cosmetics enter the system:

- Equipped items live **only** in the reserved cosmetic `loadout` (a list of cosmetic NFTokenIDs),
  which is **isolated from `step()`**. The state-machine transition function never reads `loadout` —
  verified: transitions are identical for any loadout. A wearable therefore **cannot** influence
  `hunger`, `happiness`, `health`, `care_score`, `care_max`, `stage`, `form`, or evolution.
- The marketplace plumbing (`NFTokenMintOffer`, offers, royalties, equip ops) is **pure commerce +
  rendering**. It does not feed any input into the deterministic care machine. Buying, selling, or
  equipping a cosmetic changes what the pet *looks like*, never how it *fares*.
- **The moment an accessory buffs a stat, the provably-fair claim dies.** That would be a
  pay-to-win channel. The replay verifier proves the care-state evolved only by the published rules;
  cosmetics sit entirely outside that proof boundary and must stay there.

The fairness substrate (dNFT replay verifier / Xahau Hook) and the marketplace substrate are
**separate by construction**. This feature adds revenue plumbing; it adds **zero** surface area to
the fairness model.

---

## 5. Architecture

### 5.1 Issuer mint-and-list endpoint (backend)

A single service endpoint owned by the Ledgerlings issuer account.

```
POST /shop/mint-list
  body: { kind: "accessory"|"background"|"palette"|"pet-egg",
          uri, taxon, transferFee, amount, destination?, expiration? }
  →  builds ONE NFTokenMintOffer tx
  →  signs with the issuer key (server-side custody / signer list)
  →  submits, waits for validation
  →  parses meta → { nftokenId, offerId }
  →  writes shop inventory row { nftokenId, offerId, kind, price, taxon, art, artist, status:"listed" }
```

Notes:
- **One tx per item.** A drop of N items = N calls (or a batched loop). No NFTokenID round-trip
  between mint and list — that's the whole point.
- **Validation:** reject `transferFee > 50000`; force `tfTransferable` whenever `transferFee > 0`
  (and in practice always, since shop items must be resellable); clamp `amount`.
- **Pet eggs** route through the rules engine first to seed the genesis care record, then deliver
  via mint-offer (§3). Accessories skip the care engine entirely (§4).

### 5.2 Shop UI (the xApp)

- Reads the shop inventory (the issuer's listed offers; cross-checkable on-ledger via the issuer's
  NFTokenPage + open offers).
- Renders each item by its `URI` art/meta. Shows price (`Amount`), collection (taxon), artist
  credit, royalty %, and expiry if any.
- "Buy" builds an **`NFTokenAcceptOffer`** for the buyer to sign in Xaman (the xApp's signing
  surface). The buyer pays `Amount`; the offer's `OfferID` comes straight from inventory — no
  on-the-fly offer discovery needed.

### 5.3 Buyer accepts the offer

```
Buyer (in Xaman xApp) signs:
  NFTokenAcceptOffer { NFTokenSellOffer: <offerId from shop inventory> }
→ ledger transfers the cosmetic NFT to the buyer
→ Amount routed to the seller (issuer/artist)
→ (on any FUTURE resale) TransferFee auto-routed to the issuer
```
If the listing used `Destination`, only that buyer's signature is valid — useful for whitelists and
direct delivery (§3b).

### 5.4 Ownership & equip (loadout)

- **Ownership** is on-ledger: the buyer now holds the cosmetic NFTokenID in their account. The xApp
  reads the buyer's NFTokenPage to populate their "inventory / closet."
- **Equip** is a separate **v2 `equip` op** (NOT a marketplace tx). It writes the chosen cosmetic
  NFTokenIDs into the pet's reserved `loadout` field. Per STATE_MACHINE.md this is outside the
  fairness state (dNFT mode: a field the replay verifier treats as cosmetic; Hook mode: a separate
  slot outside the proven care state).
- **"Equip only what you own" check:** extend the verifier so the loadout can only reference
  cosmetic NFTokenIDs the owner actually holds on-ledger — keeps cosmetics honest, same spirit as
  the care proof, without entangling the two.
- **Render** composites base pet sprite + each equipped cosmetic in z-order (extend
  `render_stages.py` z-ordering). The render reads `loadout`; `step()` does not.

```
   on-ledger ownership (buyer holds cosmetic NFTokenID)
        │  equip op (writes IDs, cosmetic-only)
        ▼
   pet.loadout = [ wingsID, bgID, ... ]      ── isolated from step() ──   care record (untouched)
        │  render composites in z-order
        ▼
   displayed pet  (looks different · fares identically)
```

---

## 6. Honest status & gotchas (verify before building)

**Status — `NFTokenMintOffer` is LIVE.** It ships as part of the XRPL `NFTokenMintOffer` amendment,
which is in the enabled amendment set on mainnet. The two-step `NFTokenMint` +
`NFTokenCreateOffer` path remains valid; the mint-offer is the atomic convenience that fuses them.
**Confirm on the target network** (XRPL mainnet vs Xahau) that the amendment is enabled there before
relying on it — Xahau and XRPL have divergent amendment sets, and Ledgerlings may ship on either
substrate (STATE_MACHINE.md). *(Use `/xahau-amendment` or a `server_state`/`feature` check to
confirm on the exact node you deploy against.)*

**`transfer_fee` mechanics to verify against live docs/testnet:**

| Item | What to confirm | Current understanding |
|---|---|---|
| `tfTransferable` requirement | a non-zero `TransferFee` is **rejected** unless `tfTransferable` is set | Yes — must set `tfTransferable` to use a royalty |
| Range / units | max value and step | 0–50000, i.e. 0%–50% in 0.001% steps (50000 = 50.000%) |
| Royalty recipient | who the ledger pays on resale | the **issuer** (the original minting account) — so mint from the account that should collect |
| When it applies | royalty triggers on *transfers via offers*, not the very first issuer→buyer sale | The primary sale's proceeds are the `Amount`; the `TransferFee` applies to *subsequent* resales |
| Brokered vs direct | royalty handling under brokered (3-party) sales | Verify the fee split math under `NFTokenAcceptOffer` brokered mode (broker fee + transfer fee interaction) |
| Multi-party splits | `transfer_fee` pays **one** issuer account | For artist splits, the single royalty lands at one account → an on-ledger or off-ledger split arrangement is a **separate** design item; the ledger won't natively fan-out the fee |
| Mutable + transferable | interaction of `tfMutable` (dNFT) with `tfTransferable` | Confirm a cosmetic can be both mutable (restylable) and transferable+royalty-bearing on the target network |
| `Destination`/`Expiration` semantics | exact field encoding + auto-cancel behavior on mint-offer | Confirm `Destination`-restricted accept + `Expiration` self-cancel behave identically to standalone `NFTokenCreateOffer` |

**Action before build (matches MARKETPLACE_ROADMAP §59 "First concrete steps"):**
1. On the target network's **testnet**, submit one `NFTokenMintOffer` with `TransferFee` set and
   `tfTransferable`; confirm one validated tx yields both an NFTokenID and an OfferID.
2. Buy it from a second account (`NFTokenAcceptOffer`), then resell to a third — confirm the
   **issuer** receives the `transfer_fee` cut on the resale.
3. Confirm `Destination` restricts the accepter and `Amount: 0` enables free targeted delivery.
4. Only then wire the issuer endpoint + shop UI.

**Honest scope:** this is the v2 revenue plumbing only. It does not change the 90-day MVP, does not
touch the fairness model, and does not require a schema migration (the `loadout` field is already
reserved in STATE_MACHINE.md). The cosmetic-only rule (§4) is the line that must not move.
