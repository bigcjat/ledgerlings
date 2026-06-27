# Ledgerlings — Treats as Consumables (MPToken economy layer)

*A fungible "treat" token (XRPL **MPToken**, live on mainnet) that you spend to feed your pet. Buying treats is
the revenue sink: the issuer sells treats, Dane takes a cut. The pet's care RULES are unchanged — a treat is the
**cost/permission** to perform a feed, never a stat boost. This is a v2 economy layer; the MVP keeps free feeds.*

> **THE ONE HARD RULE (read this before anything else):** A treat-fed feed must equal a normal feed *exactly*.
> Treats gate **whether you may submit a feed**, not **what the feed does**. The deterministic `step()` in
> `build/pet_rules.js` is the single source of truth for care-state; it **never reads a treat balance**. Buying
> 1,000 treats cannot over-care, bypass a cooldown, raise a stat cap, or buy a rarer evolution. If treats ever
> touch the care-state transition, the "provably fair" brand dies. (Same rule the marketplace uses for
> cosmetics — see `MARKETPLACE_ROADMAP.md` "accessories are cosmetic"; here it's "treats are economic.")

---

## 0. TL;DR pattern

- Treats = one (or a few) **MPTokenIssuance**(s) on a Ledgerlings issuer account. Players hold **MPToken** balances.
- A **feed** = a single owner-signed transaction that **(a) spends exactly one treat** and **(b) carries the
  `op=feed` memo** the rules engine already understands. The treat spend and the feed-intent are the *same* tx.
- The rules engine runs the **unchanged `step(state, FEED, now, sender)`** and writes the new pet state via
  `NFTokenModify` — identical to a free feed. Treat balances live on a **separate ledger** (the MPT issuance);
  the replay verifier reproduces the **pet**, not the treat economy.
- Revenue: players **buy treats** from the issuer (primary sale). That's the sink. Secondary treat trading, if
  enabled, can earn the issuer a transfer-fee analog — but the clean money is the primary sale.

---

## 1. MPToken mechanics relevant here

XRPL Multi-Purpose Tokens (XLS-33, live on mainnet) give us a **fungible, issuer-controlled** token without the
trustline ceremony of IOUs and far cheaper than an NFT per treat.

Two object types matter:

- **`MPTokenIssuance`** — created once by the issuer with `MPTokenIssuanceCreate`. It defines the treat token:
  `AssetScale` (we use **0** — treats are whole units, indivisible), `MaximumAmount` (optional supply cap),
  `TransferFee` (only meaningful if transfers between non-issuers are allowed), and a flags bitfield. The
  issuance has a stable **`MPTokenIssuanceID`** (the currency identity used in `Amount` objects).
- **`MPToken`** — a per-holder balance object. A holder must **opt in** with `MPTokenAuthorize` before they can
  receive the token (analogous to a trustline, but lighter). The xApp does this for the player on first treat
  purchase.

Relevant issuance **flags** (set at create; some immutable):
- `tfMPTCanTransfer` — can holders send the token to *each other*? For the cleanest sink we can leave this
  **OFF** initially (treats only move player↔issuer), eliminating a P2P treat market and grey-market farming.
- `tfMPTCanClawback` — can the issuer claw back balances? Useful but **not** our feed mechanism (see below).
- `tfMPTRequireAuth` — issuer must authorize each holder. Optional; adds friction. Default OFF for smooth UX.
- `tfMPTCanEscrow` / `tfMPTCanLock` — not needed for treats.

### How a "feed" consumes a treat — three candidate patterns

| Pattern | Mechanic | Pros | Cons |
|---|---|---|---|
| **A. Pay-to-issuer** | Player sends a `Payment` of 1 treat **back to the issuer**, with the `op=feed` memo. | One owner-signed tx = spend + intent atomically; source AID proves owner; trivially auditable; treat supply returns to issuer to resell. | Treat must be transferable *to the issuer* (always allowed: holders can always send the issuer's own MPT back to it, even with `tfMPTCanTransfer` off — issuer is always a valid counterparty). |
| **B. Burn-on-feed** | Player burns 1 treat (send to issuer who then `MPTokenIssuanceDestroy`-style retires, or a future MPT burn). | Deflationary; clean "consumed" semantics. | No native holder-initiated burn for MPT; you'd still route through the issuer, so it collapses into Pattern A + an issuer-side retire. Extra tx, no real gain. |
| **C. Clawback-on-feed** | Player signs only the feed memo; issuer `Clawback`s 1 treat server-side. | Player tx stays tiny (no Amount). | **Breaks owner-only atomicity & trust**: the spend is now issuer-initiated, so "I paid for this feed" isn't provable from one owner-signed tx; requires `tfMPTCanClawback`; issuer could claw arbitrarily. Rejected. |

**CHOSEN: Pattern A — Payment of 1 treat to the issuer, carrying the `op=feed` memo.**

Justification:
1. **One owner-signed tx is both the payment and the interaction.** This preserves the existing security model
   exactly: the rules engine already treats "owner-signed Payment to issuer with `op` memo" as the canonical
   interaction (`STATE_MACHINE.md` §interaction). We're just attaching a 1-treat `Amount` to that same Payment
   instead of a tiny XRP amount. Owner-only is still by construction (memo source == owner).
2. **The treat returns to the issuer** → re-sellable inventory, naturally circular, supply stays bounded.
3. **No clawback authority needed** → smaller trust surface, cleaner "verifiable" story.
4. **Works with `tfMPTCanTransfer` OFF** — a holder can always pay the issuer back in the issuer's own MPT, so
   we can disable P2P transfer (kills the farming/grey-market vector) and still ship Pattern A.

Burn (Pattern B) is a cosmetic variant of A; we can retire returned treats later if we want a deflationary
narrative, but it's not required and adds a tx. Clawback (C) is rejected on trust grounds.

---

## 2. The economy

### Treat types (each is a distinct `op` the rules engine ALREADY has — treats don't add new ops)

| Treat | Maps to existing op | What it does (UNCHANGED rule) | Price tier |
|---|---|---|---|
| **Kibble** (basic food) | `FEED` | `step(…, FEED, …)` — +RESTORE hunger, cooldown-gated, care if low. | cheapest |
| **Toy** (play token) | `PLAY` | `step(…, PLAY, …)` — +RESTORE happiness, cooldown-gated. | cheap |
| **Snack** (premium) | `FEED` | **Exactly the same `FEED` transition.** Premium = cosmetic flavor (nicer feed animation / a non-stat "fed a snack" render flag), NOT a bigger stat gain. | mid |
| **Soap** (clean) | `CLEAN` | `step(…, CLEAN, …)` — +health, no cooldown (matches engine). | cheap |
| **Medicine** (heal) | `HEAL` | `step(…, HEAL, …)` — +30 health. | premium |

Key honesty point baked into the table: **"premium" treats buy flavor, not power.** A Snack and Kibble both run
the identical `FEED` branch of `step()`. The premium tier's only differentiator is cosmetic (animation, a
"last fed: snack" cosmetic tag rendered client-side, collectible flavor) — never a larger `RESTORE`, never a
care multiplier. (If you want premium to *feel* worthwhile without being pay-to-win, lean cosmetic: special feed
animation, a snack-themed background unlock, a collectible "snack wrapper" cosmetic dNFT — all marketplace-side.)

### How treats are bought (primary sale = the revenue)

Two clean primary-sale rails; pick per UX:

1. **Direct issuer sale (recommended for MVP of the economy).** The xApp shows a "Buy treats" shelf. Player
   taps a bundle → signs a `Payment` of **XRP (or RLUSD)** to the issuer → the issuer (server.js) responds by
   sending the corresponding MPT treat amount to the player (and `MPTokenAuthorize`-ing them on first buy if
   needed). This is a simple two-leg flow the server already has the shape for (it watches for Payments today).
   Proceeds in XRP/RLUSD land in the issuer account = **Dane's cut** (minus any artist/partner split).
2. **On-ledger offers (later).** If MPT DEX offers are enabled, list treats as standing sell offers; players
   buy without a server round-trip. More decentralized; revenue still routes to the issuer account.

### Pricing / sink design

- **Bundles, not singles** (reduce tx overhead + nudge bulk): e.g. 10 / 50 / 200 treats, mild bulk discount.
- **Treats are pure consumables, indivisible** (`AssetScale = 0`).
- **The sink is real:** every feed consumes a treat that flows back to the issuer; the player must re-buy to
  keep feeding. Demand is paced by the **feed cooldown** (a player physically cannot consume treats faster than
  the cooldown allows on a single pet) → this *protects* the sink from being a whale dump: buying 1,000 treats
  doesn't let you feed 1,000 times today; the cooldown rate-limits consumption regardless of inventory.
- **Death is the demand engine, honestly:** neglect → death is already in the rules. Treats make consistent care
  a small recurring cost, which is the point — but care *quality* (and thus evolution) is still gated by the
  cooldown-bounded `care_max`, so spending more never buys a better outcome, only the *ability to keep playing*.
- **Free-tier floor (anti-gate):** consider a small **daily free treat drip** (issuer sends N free treats/day to
  active pets) so a player is never *locked out of caring for their pet* by money — they can always keep the pet
  alive for free; treats are convenience/flavor/scale, not a paywall on survival. (Design choice; flag for Dane.)

---

## 3. THE CRITICAL FAIRNESS NUANCE — treats are NOT pay-to-win

This is the load-bearing section. The whole brand depends on it.

### What stays *exactly* the same (the deterministic core)

- **`step()` is unchanged.** It takes `(state, op, now, sender)`. It has **no `treat` parameter and never reads
  one.** Feed cooldowns (`COOLDOWN`), stat clamps (`clamp` → `[0,100]`), decay, death, `care`/`care_max`
  accounting, and `evolve(care, care_max)` are byte-for-byte the same code path whether the feed was free or
  treat-paid.
- **Cooldowns can't be bought past.** `step()` only awards care + restores hunger if
  `now - s.last_feed >= COOLDOWN`. A treat-paid `FEED` submitted inside the cooldown runs the **same** branch:
  the cooldown check fails, **no care is awarded, no stat moves**, and `last_feed` is unchanged. *The treat is
  still spent* (it was the cost of attempting the action) — so spamming treats inside cooldown just **burns the
  player's treats for nothing**. Buying 1,000 treats and feeding 1,000 times in one ledger yields **one**
  effective feed, exactly as a free pet would. The economy can't outrun the rules.
- **Stat caps hold.** `clamp(…, 0, 100)`. A treat can't push hunger past 100; over-feeding is a no-op gain, same
  as free.
- **Evolution is unbuyable.** `evolve()` reads only `care_score` and `care_max`, and `care_max` climbs **once
  per cooldown window**. Since treats can't add care outside a cleared cooldown (previous bullet), no amount of
  treat-spend raises `care_score/care_max`. A LEGENDARY still requires *sustained, timely* care across the pet's
  youth. **Money buys participation, not the ratio.**

### The precise contract: treat-spend ⟂ care-transition

```
  feed_tx  =  [ spend 1 treat → issuer ]   +   [ op=feed memo ]      (one owner-signed Payment)
                       │                                │
            economy ledger (MPT)              fairness ledger (dNFT)
                       │                                │
        issuer's treat balance changes     step(state, FEED, now, owner) → NFTokenModify
                       │                                │
           NOT part of replay verify        IS the replay verifier's check set
```

The treat leg and the care leg are **orthogonal**. The economy can fail/refund/vary without ever changing what
`step()` computes. Formally: for any pet history, **strip every treat amount** from the interaction Payments and
re-run the rules — you get the **identical** pet state. Treats are invisible to fairness by construction.

### Server obligation (the one place to not screw up)

The issuer/server MUST apply `step()` **purely from `(current pet state, op, ledger time, owner)`** — it must
**never** branch on "this feed was premium / bulk / paid-more" to give a bigger effect. The premium tier changes
only **client-side cosmetics**. This is a code-review invariant: grep the server for any treat field reaching the
state transition; there must be none. (A test asserts: free-feed result == treat-feed result for identical
`(state, op, now)`.)

---

## 4. Architecture — tying a treat-spend to a feed, and keeping replay intact

### The feed flow (Pattern A)

1. Player taps **Feed** in the xApp. Client checks local treat balance; if zero, routes to **Buy treats**.
2. xApp builds one **`Payment`**: `Account = owner`, `Destination = issuer`,
   `Amount = { mpt_issuance_id: <Kibble ID>, value: "1" }`, `Memos = [{ op: FEED, pet_id }]`. Player signs in
   Xaman.
3. Issuer's watcher sees the Payment. It validates: (a) source == pet owner; (b) exactly 1 treat of the right
   type was received; (c) the `op` memo. Then it runs the **unchanged** `step(petState, FEED, validatedLedger,
   owner)` and writes the result via **`NFTokenModify`** — one on-ledger pet-state tx, exactly like a free feed.
4. The returned treat sits in the issuer's MPT balance as re-sellable inventory.

Notes:
- **Atomicity:** treat-spend and feed-intent are the *same* tx, so there's no "paid but didn't feed" race on the
  player side. If the cooldown blocks the effect, the engine still records the interaction (per existing rules);
  the spent treat is the cost of the attempt. If `Batch` is live, the buy+feed could be bundled, but it's not
  needed for the core flow.
- **`op` memo unchanged:** the rules engine's existing memo contract (`1=feed 2=play 3=clean 4=heal`) is reused
  verbatim. Treats don't add a protocol; they add an `Amount` to an existing message.

### How the replay verifier stays intact

The verifier's job (per `STATE_MACHINE.md`) is unchanged: pull the pet's full on-ledger history, re-execute the
**anchored, open rules** over the interaction sequence from genesis, assert the re-derived state equals each
on-ledger `NFTokenModify`. **Treat balances are a separate ledger (the MPT issuance) and are NOT part of this
check.** Concretely:

- The verifier reads each interaction Payment's **source + `op` memo + ledger index** — the exact inputs `step()`
  needs. It **ignores the `Amount`** (whether it was 1 treat, an XRP dust, or a premium snack — all yield the
  same `FEED`).
- Because `step()` never took a treat as input, the re-derivation is **bit-identical** whether or not treats
  exist. So **shipping treats requires zero change to the replay verifier and zero change to the anchored
  rules.** That's the proof the economy is non-invasive.
- **Optional honesty add-on (nice-to-have, not fairness-critical):** a *separate* "treat economy is solvent"
  audit could check that treats sold == treats issued (no phantom inflation). This is an economic-transparency
  panel, distinct from the fairness verifier, and explicitly out of scope for the care-state proof.

### Schema impact on the pet record

- **None required for fairness.** The 64-byte care record (`STATE_MACHINE.md`) is untouched; no treat field
  enters fairness state.
- **Optional cosmetic-only:** if you want a "last fed: snack" badge, store it in the same **cosmetic loadout
  lane** as wearables (already reserved, already proven `step()` never reads it). Keep it out of the 64-byte
  fairness record. Treats follow the cosmetic rule: render-layer only.

---

## 5. Honest status & gotchas to verify

MPTokens are **live on XRPL mainnet** (XLS-33), so this is buildable today — but verify these before committing:

- **Transfer-to-issuer with `tfMPTCanTransfer` OFF.** Pattern A relies on a holder always being able to send the
  issuer's own MPT *back to the issuer* even when P2P transfer is disabled. This is the expected XRPL behavior
  (the issuer is a privileged counterparty), but **confirm on testnet** before locking the flag. If it doesn't
  hold, enable `tfMPTCanTransfer` and accept a P2P treat market (then watch for grey-market farming — though the
  cooldown still neutralizes pay-to-win regardless).
- **Burn-on-feed vs pay-to-issuer.** There is no clean holder-initiated MPT burn; "burn" = send-to-issuer +
  issuer-side retire. So Pattern A (pay-to-issuer, keep as inventory) is strictly simpler than burn. Only add a
  retire step if a deflationary narrative is wanted. **Decision: pay-to-issuer; burn deferred.**
- **Clawback flag.** We do **not** need `tfMPTCanClawback` for feeding (Pattern C rejected). Leaving it OFF
  shrinks the trust surface and strengthens the "verifiable" story. Only turn it on if a separate
  refund/anti-fraud need appears — and document it loudly if so.
- **`MPTokenAuthorize` opt-in friction.** First treat purchase must authorize the holder. Verify whether
  `tfMPTRequireAuth` is OFF (so the player can self-authorize in one tx) vs ON (issuer must counter-authorize,
  extra round-trip). Recommend **OFF** for smooth onboarding.
- **`AssetScale = 0`** (indivisible treats) — confirm the issuance create encodes whole-unit amounts as intended.
- **`MaximumAmount`** — decide whether to cap treat supply. A cap is collector-friendly but complicates resale;
  for a pure sink, leave generous/uncapped and let the buy→feed→issuer loop bound circulation.
- **Xaman MPT support.** Confirm the Xaman xApp can render/sign an MPT `Payment` and show MPT balances in the
  player's wallet view. If not yet, the xApp shows balances from the issuer's own index and signs the raw
  Payment — verify the signing UX.
- **RLUSD vs XRP for primary sale.** If pricing treats in fiat-stable terms matters, accept RLUSD; otherwise XRP
  is simplest. Confirm whichever the xApp audience prefers.

---

## 6. Scoping

- **MVP (90-day / Make Waves): free feeds, no treats.** The pet + interactions + provable fairness + thin Xaman
  xApp ship with **free** feeds (a tiny XRP-dust Payment carrying the `op` memo, as today). Treats are **not** in
  the MVP. The MVP must only avoid foreclosing treats — and it already does, because `step()` is treat-agnostic
  and the interaction is already "owner Payment + `op` memo." **No schema migration needed to add treats later.**
- **v2 (ties to the marketplace):** introduce the treat MPT economy alongside cosmetics. Treats (economic
  consumable) and wearables/backgrounds (cosmetic dNFTs) are the two revenue rails on the **same issuer model**,
  both governed by the same hard rule: *never touch fairness state.* Treats = "cost to play"; cosmetics = "stuff
  to buy." Together they form the platform sink + the network-effect flywheel from `MARKETPLACE_ROADMAP.md`.
- **First concrete v2 steps:**
  1. `MPTokenIssuanceCreate` for **Kibble** on testnet (`AssetScale=0`, `tfMPTCanTransfer` OFF, `tfMPTCanClawback`
     OFF, `tfMPTRequireAuth` OFF). Confirm pay-to-issuer works with transfer OFF.
  2. Wire the **Buy treats** flow (XRP/RLUSD → issuer → MPT to player, auto-authorize on first buy).
  3. Change the xApp **Feed** button to attach `Amount: 1 Kibble` to the existing `op=feed` Payment. Confirm
     `step()` output is **identical** to a free feed (add the equality test).
  4. Confirm the **replay verifier still passes unchanged** (it ignores `Amount`).
  5. Add treat types (Toy/Snack/Soap/Medicine) mapping to existing ops; keep premium = cosmetic only.
  6. (Optional) treat-economy solvency panel — separate from the fairness verifier.

---

## Appendix — the invariant that protects the brand

> **For every pet, deleting all treat amounts from its interaction history and re-running the anchored rules
> yields the identical pet state.** Treats are an economy layer bolted *beside* the deterministic care machine,
> never *inside* it. That single property is why "buy 1,000 treats" can never over-care, skip a cooldown, lift a
> cap, or buy a rarer evolution — and why the replay verifier needs zero changes to keep proving the pet is fair.
