# BUILD SPEC — Provably-Fair Pet Battles + Wager (Make Waves hackathon idea #10)
Draft 2026-07-23. For approval before build. Maps to `MAKE_WAVES_IDEA_LISTS.md` #10 (NFT Battle Cards + wager).

## Goal
Two owners pit their Ledgerlings against each other, optionally staking XRP; the winner takes the pot (minus a
platform fee). The catch that fits the brand: **the outcome is a checkable on-ledger fact** — nobody, not even the
issuer, can rig it, and anyone can re-derive the winner from public data + the open rules. Generates real on-chain
txns through normal play (Make Waves criterion #2) and is live-testable by judges (criterion #3).

## The hard part: randomness nobody can bias. Solution = a pinned FUTURE ledger hash.
A battle outcome must depend on randomness that neither player nor the issuer can steer, yet everyone can reproduce.
- At challenge time, the challenger pins a **future ledger index `N`** (must be ≥ current + K margin, e.g. K=20 so its
  hash is unknowable to anyone when the battle is created).
- The battle **seed = SHA-256( ledgerHash(N) || battleId || petA || petB )**. `ledgerHash(N)` is a validated XRPL
  ledger hash — no player and no issuer controls a future ledger's hash, and anyone can fetch it later. Unbiasable
  at commit, re-derivable forever. (This extends Ledgerlings' existing "ledger data as the deterministic input" pattern
  — same idea as `ledger_index`-as-`now`.)
- Rejected alternatives: commit-reveal (last-revealer can grief/abort); issuer-chosen seed (riggable); block/tx the
  issuer submits (issuer could grind timing). Pinned future-ledger-hash avoids all three.

## The battle rules (pure, open, versioned — like pet_rules.js)
`resolveBattle(stateA, stateB, seed) -> { winner, rollA, rollB }`, a pure function:
- `power(pet)` = base + modest bonuses from `care/care_max`, `form`, `stage` (bounded — see anti-whale below).
- seeded rolls: `rollX = (H(seed || nid) mod 1000) * power(petX) / SCALE` → higher total wins; exact-tie broken by seed.
- **Seed-dominant, stat-light on purpose**: care/form give an edge, not a lock, so an underdog can win (more fun, no
  pay-to-win — the same HARD RULE as `loadout`: stats influence, never determine). Rules are open-source + versioned;
  the version hash is stamped into the battle record so they can't be swapped to justify a result.
- States used = each pet's state **as of ledger N** (re-derivable from its own history), so the whole thing replays.

## On-ledger flow (mirrors the existing marketplace offer/accept pattern)
1. **Challenge** — A signs a Payment to issuer, memo `battle/challenge` = `A_nid|stakeDrops|N`. Stakes A's XRP (0 = friendly, no-wager). Issuer records an open challenge (a soulbound battle-record NFT, status OPEN).
2. **Accept** — B signs a Payment to issuer, memo `battle/accept` = `battleId|B_nid`, staking the matching amount.
3. **Resolve** (any time after ledger N closes) — issuer fetches `ledgerHash(N)`, re-derives stateA@N + stateB@N,
   computes seed + `resolveBattle` → winner, then (a) updates the battle-record NFT to RESOLVED with
   `{N, winner, rollA, rollB, rulesetVersion}` and (b) pays the winner `pot - fee`. Idempotent per battleId.
4. **Expire/refund** — if no accept by ledger N, the challenge expires; A's stake is refunded (memo'd refund).

## Wager settlement — MVP vs non-custodial (an explicit trade-off for Dane)
- **MVP (recommended for the hackathon): issuer-settled, publicly verifiable.** Stakes go to the issuer; on resolve
  the issuer pays the winner. Custody is brief and the payout is **checkable**: the winner is provably determined and
  the payout Payment is on-ledger, so a wrong/absent payout is *detectable by anyone* (same "detectable-not-preventable"
  honesty as pet state). Honest-scope disclosure in the docs. Fast to build, no exotic primitives.
- **v2 (non-custodial, stronger): conditional Escrow / atomic Batch.** Stakes locked so the loser can't withhold and the
  issuer can't abscond. XRPL Escrow's destination is fixed at creation (can't target "the winner" dynamically), so this
  needs crypto-condition escrows keyed to the result, or `Batch` (when live on mainnet) for atomic pot→winner. Deferred.

## Verification (the pitch)
`GET /verify-battle/:battleId` — read the battle record `{A,B,N,winner,rollA,rollB,rv}`; re-derive stateA@N + stateB@N
from each pet's on-ledger history; fetch `ledgerHash(N)`; recompute seed + `resolveBattle`; assert the recorded winner
+ rolls match. PASS/FAIL, exactly like `/verify` and `/verify-achievement`. This is why it's *provably* fair.

## Anti-abuse invariants
- Both pets **alive** at N and each **owned by its staking signer** (owner-only, by the memo's source account).
- `N ≥ challengeLedger + K` (unknowable-hash margin); resolve only after N is validated.
- One resolution per battleId (idempotent); stakes bounded (min/max, env); platform fee bps (env).
- Power bounded so age/whale pets can't auto-win; optional stage brackets (only same-stage may battle) — Dane's call.
- Self-battle blocked (or forced 0-stake). Friendly (0-stake) battles allowed for the demo.

## Endpoints (additive; reuse withClient/loadHistory/submit/tag; new BATTLE_TAXON 7781, soulbound record)
- `POST /battle/challenge {ownerSig payload, aNid, stakeXrp, N}` → open a challenge (record NFT OPEN). Xaman-signed stake.
- `POST /battle/accept   {ownerSig payload, battleId, bNid}` → join (stake). 
- `POST /battle/resolve  {battleId}` (admin) → resolve + pay winner. Idempotent.
- `GET  /battle/:battleId` → state; `GET /battles` → open/live list; `GET /verify-battle/:battleId` → the fairness proof.
- New module `build/battle_rules.js`: pure `power`, `resolveBattle`, `seedFor` — unit-tested vs an independent oracle
  (same method as achievements.test.js), incl. determinism (same inputs → same winner) and unbiasability sanity.

## Acceptance criteria
- B1 `resolveBattle` is a pure function of (stateA, stateB, seed); identical inputs → identical winner. Unit-tested.
- B2 Seed derives only from `ledgerHash(N)` + battle/pet ids; `N` pinned at challenge with a ≥K margin (no foreknowledge).
- B3 `/verify-battle` re-derives the winner from on-ledger data; a tampered record (swapped winner) → FAIL. Testnet proof.
- B4 Settlement: winner paid `pot - fee`; refund on expiry; idempotent resolve. Testnet end-to-end with tx hashes.
- B5 Zero regression: pets/achievements/verify untouched; battles strictly additive; no pay-to-win (stat-light rolls).

## Scope / checkpoints / budget
1. `battle_rules.js` (power/seed/resolve) + unit tests (determinism + oracle + underdog-can-win). **✔ green**
2. Battle-record codec + challenge/accept/resolve/verify endpoints in server.js (reuse loadHistory to snapshot state@N).
3. Testnet smoke: two funded owners, two pets, challenge→accept→(reach N)→resolve→winner paid; `/verify-battle` PASS;
   tampered record → FAIL. **✔ tx hashes captured.**
4. `BATTLES.md` (rules + fairness story for the entry).
Budget: ~1 day (bigger than #11 — adds settlement + a 2-party flow). Testnet only; no mainnet until Dane says.

## Open questions for Dane before build
1. **Settlement**: MVP issuer-settled-but-verifiable (fast), or invest now in non-custodial escrow (slower, stronger)? (Rec: MVP.)
2. **Stat influence**: seed-dominant with a light care/form edge (rec — fun + no pay-to-win), or make stats matter more?
3. **Brackets**: restrict battles to same stage, or open (any vs any)?
4. **Wager**: XRP only, friendly-0-stake only for the demo, or both (rec: both — 0-stake default, optional XRP wager)?
5. Reaching ledger `N` on testnet is ~seconds×K (fine); mainnet same. OK to keep K small (e.g. 20) for a snappy demo?
