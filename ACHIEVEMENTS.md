# Ledgerlings — On-Chain Achievements (Make Waves #11)

Milestone badges minted as NFTs when a Ledgerling hatches, evolves, is well cared for, or lives a full life.

## What makes these different: a badge is a checkable on-ledger fact
Ledgerlings already re-derives pet state by replaying the open rules over the pet's on-ledger interaction
history (`/verify`). **Achievements are a pure projection of that same replay** — each badge is a monotonic
predicate over the state trace, "earned" at the `ledger_index` of the step where it first turns true.
So the issuer **can't mint a fake badge** (anyone re-derives the earned set and sees it wasn't earned) and
**can't withhold a real one undetectably**. `GET /verify-achievement/:achNid` is the proof: it replays the
pet from genesis and asserts the badge was earned at the claimed ledger. Same trust model as pet state —
detectable, ruleset-anchored, un-fakeable.

## Catalog (v1)
| id | label | earned when |
|---|---|---|
| `first_bond` | First Bond | first owner interaction that moves state |
| `hatch` | Hatched | stage reaches BABY |
| `teen` | Growing Up | stage reaches TEEN |
| `adult` | All Grown Up | stage reaches ADULT (records `form`) |
| `elder` | Elder | stage reaches ELDER |
| `full_life` | A Full Life | passed of old age (`death_cause==2`), not neglect |
| `devoted` | Devoted Keeper | evolved to the top form (care/care_max ≥ 92%) |
| `nurturer` | Nurturer | 20+ cooldown-valid acts of care (`care_max ≥ 200`) |

All predicates are pure functions of `(genesis, interactions)` — no off-ledger input. See `build/achievements.js`.

## On-ledger form
- Taxon `7780`. **Soulbound**: minted with `Flags: 0` (non-transferable, no royalty) — a badge is earned, not traded.
- Compact URI (hex(JSON) ≤ 256 B): `{t:'ach', p:<pet nid>, i:<achId>, L:<earnedLedger>, rv:<rulesetVersion>}`.
- MVP: issuer holds the badge (URI anchors pet+id+ledger). Delivery to the owner's wallet is a production follow-up
  (same posture as `/mint-accessory`).

## API (additive — pet schema, `step()`, `/verify` unchanged)
- `POST /claim-achievement {nid, achId?}` — admin, idempotent, SourceTag-stamped. Mints any newly-earned badges.
- `GET  /achievements/:nid` — a pet's minted badges + the catalog.
- `GET  /verify-achievement/:achNid` — re-derive the badge (PASS/FAIL). The fairness proof.
- Auto-award: `/interact` mints milestone badges as they're crossed (default on; `AUTO_AWARD=0` disables) — more
  live on-chain txns through normal play (a Make Waves judging signal).

## Tests / evidence
- `build/achievements.test.js` — pure unit tests vs an **independent oracle** across 6 traces; all 8 badges covered,
  lifecycle ledgers monotonic. `node build/achievements.test.js` → ALL PASS.
- `build/achievements_smoke.js` — XRPL **testnet**: earned badge → verify PASS; a fabricated `adult` badge on an egg
  → verify FAIL ("this pet never earned this badge"); claim idempotent. Ran green (real nids on altnet).
- No regression: `build/verify_smoke.js` still PASSES/DIVERGES after the `loadHistory` refactor.

## Non-goals (v1)
Badge delivery to the owner wallet (issuer holds), badge artwork, leaderboard UI, new op codes. No mainnet action yet.
