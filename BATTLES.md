# Ledgerlings — Provably-Fair Battles + Wager (Make Waves #10)

Two owners duel their Ledgerlings, optionally staking XRP; the winner takes the pot minus a platform fee.
The outcome is a **checkable on-ledger fact** — nobody, not even the issuer, can rig it, and anyone can re-derive it.

## Unriggable randomness = a pinned FUTURE ledger hash
At challenge time the challenger pins a future ledger index `N` (≥ current + margin K, default 20). The battle
**seed = SHA-256( ledgerHash(N) ‖ battleId ‖ petA ‖ petB )**. No player and no issuer controls a future XRPL
ledger's hash, and anyone can fetch it once it closes → unbiasable at commit, re-derivable forever. (Same idea
as the pet engine's `ledger_index`-as-`now`.) This beats commit-reveal (a losing party can grief by not revealing)
and any issuer-chosen seed (riggable).

## The rules (pure, open, versioned — `build/battle_rules.js`)
`resolveBattle(seed, stateA@N, stateB@N, nidA, nidB) -> winner`:
- `power(pet)` = 100 + bounded bonuses from care, form, stage → range **100..212**.
- seeded roll per pet (0..999) from the seed → `score = roll + power`; higher wins; dead pet forfeits; exact tie → lexicographic nid.
- **Seed-dominant on purpose**: the roll (0..999) outweighs the power spread (max ~112), so care/form give an edge,
  not a lock — a weak pet still wins ~40% of random seeds (measured). No pay-to-win, same HARD RULE as `loadout`.
- States used = each pet's state **as of ledger N**, re-derived from its own on-ledger history.

## Flow (three memo'd Payments on the issuer — reuses the marketplace unsigned-tx pattern)
1. **Challenge** — `POST /battle/challenge {owner, aNid, stakeXrp, N?}` → unsigned stake Payment (owner signs via Xaman).
   `battleId` = that Payment's tx hash. `stakeXrp` omitted / 0 → friendly (1-drop) battle.
2. **Accept** — `POST /battle/accept {owner, battleId, bNid}` → unsigned matching-stake Payment.
3. **Resolve** — `POST /battle/resolve {battleId}` (admin, idempotent) after N closes → fetch `ledgerHash(N)`, re-derive
   both states@N + seed + winner, pay the winner `pot - fee`, mint a soulbound "battle card" keepsake. (Draw → refund both.)
4. **Status / verify** — `GET /battle/:battleId` (OPEN/LIVE/RESOLVED) · `GET /verify-battle/:battleId` (the fairness proof).

## Verification (why it's *provably* fair)
`/verify-battle` reads the three memos, re-derives stateA@N + stateB@N from each pet's on-ledger history, fetches
`ledgerHash(N)`, recomputes seed + `resolveBattle`, and asserts the recorded winner + scores match **and** the payout
Payment went to the winner's owner. A rigged record → FAIL. Same trust model as pets/achievements: detectable, ruleset-anchored.

## Settlement — MVP vs non-custodial (honest scope)
- **MVP (shipped): issuer-settled, publicly verifiable.** Stakes go to the issuer; on resolve it pays the winner. Custody
  is brief and the payout is on-ledger, so a wrong/absent payout is *detectable by anyone* (detectable-not-preventable).
- **v2 (stronger): non-custodial** via crypto-condition Escrow keyed to the result, or atomic `Batch` (when live on mainnet).

## Anti-abuse invariants
Owner-only (staker must own the pet, checked at challenge/accept) · both pets alive · `N ≥ challenge + K` (unknowable hash) ·
one resolution per battleId (idempotent) · a pet can't battle itself · power bounded (no whale auto-win) · brackets = any-vs-any
in v1 (same-stage brackets are a v2 option).

## Tests / evidence
- `build/battle_rules.test.js` — pure: determinism, oracle-match over 200 seeds, **seed-dominance (weak wins ~41%)**, power
  bounds, forfeit/draw/tiebreak. `node build/battle_rules.test.js` → ALL PASS.
- `build/battle_smoke.js` — XRPL testnet end-to-end: challenge → accept → pinned-ledger wait → resolve (winner paid, card
  minted) → verify PASS; a **tampered result (winner flipped) → verify FAIL**. Ran green (real battleId on altnet).

## Non-goals (v1)
Non-custodial escrow settlement, matchmaking/brackets/ELO, spectator wagers, mainnet action. Card is a cosmetic keepsake
(authoritative result = the on-ledger result memo).
