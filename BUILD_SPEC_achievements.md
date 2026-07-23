# BUILD SPEC — On-Chain Achievements (Make Waves hackathon idea #11)
Draft 2026-07-23. For approval before build. Maps to `MAKE_WAVES_IDEA_LISTS.md` #11 (On-Chain Achievements).

## Goal
When a Ledgerling crosses a milestone (hatches, evolves, lives a full life, is well cared for), mint an
**achievement NFT**. Adds visible on-chain activity through normal play (judge criterion #2) and more
NFT mints judges can test live (criterion #3) — without touching the pet-state schema or the fairness core.

## Core principle — achievements are a PROJECTION of the same replay (not a new trust surface)
The engine already re-derives pet state by replaying `R.step()` over the pet's on-ledger interaction history
(`verifyPet`). **Achievements are computed from that same replay trace.** An achievement is a pure predicate
over the state sequence; it is "earned" at the `ledger_index` of the step where the predicate first turns true.
Therefore:
- The issuer **cannot mint a fake achievement** — anyone re-derives the earned set and sees it wasn't earned.
- The issuer **cannot withhold one undetectably** — the earned set is a deterministic function of public history.
Same trust model as pet state: **detectable, ruleset-anchored, un-fakeable.** That is the whole selling point —
this is the only achievements system whose every badge is a checkable on-ledger fact.

## Achievement catalog v1 (all derivable from the trace; earnedLedger = step `now`)
Lifecycle (from `stage` / `death_cause`):
- `hatch`   — stage first ≥ BABY (left the egg)
- `teen`    — stage first ≥ TEEN
- `adult`   — stage first ≥ ADULT  (record `form` 1–4 in the badge meta)
- `elder`   — stage first ≥ ELDER
- `full_life` — `death_cause == 2` (reached PASSED by old age, not neglect) — the prestige badge
Care quality (from `care` / `care_max`):
- `devoted` — at ADULT, `care/care_max ≥ 0.92` (i.e. evolved to top form 4)
- `nurturer` — ≥ N cooldown-valid care awards accrued (count `care_max` increments; N tunable, e.g. 20)
Cadence:
- `first_bond` — first interaction that changed state (owner's first real action)
(6–8 badges is v1. All are pure predicates over the replay trace — no off-ledger input.)

## Substrate
- New `ACHIEVEMENT_TAXON = 7780`.
- **Non-transferable / soulbound**: mint with `Flags = 0` (no `tfTransferable`) → holder can't list it for
  sale. **No royalty** (achievements aren't traded). Distinct from pets (7777) / accessories (7778) / characters (7779).
- Compact URI codec (hex(JSON) ≤ 256 bytes, same cap as pets): `{t:'ach', p:<pet NFTokenID>, i:<achId>, L:<earnedLedger>, rv:<rulesetVersionHash8>}`.
  Full pet nid kept (needed to replay); owner is looked up from the pet, not duplicated. `rv` ties the badge to the
  anchored open ruleset so rules can't be swapped to justify a fake badge.
- **MVP delivery**: issuer holds the achievement NFT (URI anchors pet+achId+ledger). Delivering it to the owner's
  wallet is a production follow-up — identical posture to the existing `/mint-accessory` MVP.

## Endpoints (additive; reuse existing helpers)
- `POST /claim-achievement {nid, achId?}` (admin) — replay the pet's history, compute the earned set, mint any
  newly-earned badge(s) not already on-ledger. **Idempotent**: skip (pet nid, achId) already minted at ACHIEVEMENT_TAXON.
  Returns `{minted:[...], skipped:[...]}`. SourceTag-stamped via `tag()`.
- `GET  /achievements/:nid` — list a pet's minted badges (filter issuer NFTs at ACHIEVEMENT_TAXON where `p == nid`).
- `GET  /verify-achievement/:achNid` — read the badge URI `{p,i,L}`, replay pet `p`, assert `achId i` is in the earned
  set **and** its earnedLedger `== L` → `PASS` / `FAIL`. Same shape as `/verify/:nid`. **This is the fairness proof.**
- (optional) auto-award inside `/interact` after `step()`: if the interaction crossed a milestone, mint its badge in the
  same flow → more on-chain txns through normal usage (criterion #2). Flag-gated (`AUTO_AWARD=1`), off by default.

## New module `build/achievements.js` (pure, testable without a ledger)
- `ACH` catalog: `{ id, earnedAt(traceState, prevState, now) -> ledger|null }` predicates.
- `achievementsFor(genesis, interactions) -> [{ id, earnedLedger }]` — replays with `R.step`, evaluates each
  predicate at each step, records first-true ledger. Mirrors `replay()`; reuses `R`.
- Exported so a harness drives it with zero I/O (like `pet_rules.js`).

## Security / invariants
- Mint is `requireAdmin` (fail-closed) — no anon minting, same as every other mint endpoint.
- Idempotent — never double-mint a (pet, achId).
- Non-transferable — can't be sold or laundered.
- `rv` anchors the ruleset version — badge is meaningless against a different ruleset, so rules can't be backdated.
- **No change** to `pet_rules.js`, the pet URI schema, `step()`, or `/verify` — achievements are strictly additive.
  The `loadout`-style HARD RULE holds: achievements never feed back into `step()` (no pay-to-win).

## Acceptance criteria
- A1 `achievementsFor` is a pure function of (genesis, interactions) — identical trust model to `step`/`replay`.
- A2 `/claim-achievement`: admin-gated, idempotent (no double-mint), SourceTag-stamped, non-transferable mint.
- A3 `/verify-achievement`: earned badge → PASS; a hand-minted unearned badge (or wrong earnedLedger) → FAIL.
  **Proven on testnet with tx hashes**, both directions.
- A4 Zero regression: existing `/adopt`, `/interact`, `/verify`, pet schema unchanged (existing smoke tests pass).

## Scope / checkpoints / budget
1. `achievements.js` catalog + `achievementsFor` + unit tests over synthetic traces. **✔ tests green**
2. Endpoints + `ACHIEVEMENT_TAXON` in `server.js` (reuse `withClient`/`submit`/`readState`/`enc`).
3. Testnet smoke (extend `verify_smoke.js`): adopt → interactions crossing `hatch`+`adult` → claim → `/verify-achievement` PASS;
   hand-mint an unearned badge → `/verify-achievement` FAIL. **✔ tx hashes captured (evidence).**
4. `ACHIEVEMENTS.md` (catalog + verify story for the entry writeup).
Budget: ~half day. No new deps. No mainnet action (testnet only) until Dane says.

## Non-goals (v1)
Delivering the badge to the owner's wallet (issuer holds, MVP); badge artwork; leaderboard UI; new op codes.

## Open question for Dane before build
- `nurturer` threshold N (default 20 care awards) and whether `devoted` = top-form (form 4) or a separate care bar.
- Auto-award in `/interact` on by default for the demo (more live txns for judges) or keep manual `/claim-achievement`?
