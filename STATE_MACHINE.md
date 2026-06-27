# Ledgerlings — pet state machine + care→evolution (implementation sketch)

*The SAME deterministic state machine ships two ways. Pick by Make Waves eligibility:*
- **XRPL-NATIVE (default, no Hooks) — VERIFIABLE fairness.** State lives in a **Dynamic NFToken** (XLS-46);
  transitions are applied by the open rules engine and written on-ledger via **`NFTokenModify`**. Nobody but
  the issuer can modify a pet, and the issuer's honesty is *checkable* (see "Replay verifier" below).
- **XAHAU-HOOK (if Xahau qualifies) — ENFORCED fairness.** The same machine is a Hook; the ledger itself
  enforces it and xahc-prover proves it for all inputs. Strictly stronger; use only if allowed.

The state-machine logic + the `evolve()` function below are IDENTICAL in both modes — only the *substrate*
(dNFT URI vs HookState) and the *trust model* (verifiable vs enforced) differ.

---

## XRPL-NATIVE substrate (Dynamic NFToken)
- **Each pet = one Dynamic NFToken**, minted by the game-issuer account with the mutable flag. The 64-byte
  record below is encoded into the NFToken **URI** (hex), or the URI points to a content-addressed blob whose
  hash is in the URI (tamper-evident either way).
- **An interaction** = the owner sends a tiny **Payment to the issuer with a memo** `op` (1=feed 2=play 3=clean
  4=heal). Owner-signed ⇒ owner-only by construction (the memo's source account is the owner).
- **A transition** = the issuer's open rules engine reads the pet's current dNFT state + the new interaction,
  applies the EXACT function below, and writes the new state with **`NFTokenModify`** (one on-ledger tx per
  state change → a complete, public audit trail).
- **Optional XRPL primitives:** **Escrow (FinishAfter)** for deterministic time-gates (egg hatch / cooldown);
  **NFTokenCreateOffer/Accept** for adopt / gift / trade; **memo** carries a commit-reveal seed if a random
  hatch is wanted; **Batch** (if live) to make pay+modify atomic.

### Replay verifier — how "verifiable fairness" is real, not a slogan
The rules engine is **open-source + versioned, and its version hash is anchored to the XRP Ledger** (the
proof-transparency log from xahc-prover). Anyone runs `verify(pet)`:
1. pull the pet's full on-ledger history — every interaction Payment + every `NFTokenModify`;
2. **re-execute the open deterministic rules** over that interaction sequence from genesis;
3. assert the re-derived state at each step **equals** the on-ledger dNFT state at that step.
A mismatch = the operator deviated from the published rules → **detected by anyone**, pinned to the anchored
ruleset so the operator can't backdate or swap the rules. Players can't cheat (issuer-only modify); the issuer
can't cheat *undetectably*. That is the honest "provably fair" on XRPL: **detectable, not preventable** — the
Hook variant upgrades it to preventable.

---

## Reserved field — `loadout` (v2 marketplace, cosmetic-only)
The pet record carries a reserved `loadout` = list of equipped accessory/background NFTokenIDs (see
MARKETPLACE_ROADMAP.md). HARD RULE: **cosmetic-only** — `step()` never reads it (verified: transitions are
identical for any loadout), so wearables can never touch stats/evolution. Pay-to-win would break the
provably-fair brand. A separate v2 `equip` op manages it; the render composites base pet + loadout. Reserved
now so v2 needs no schema migration. (Hook variant: store loadout in a separate slot, outside fairness state.)

## The state-machine logic (shared by both modes)
*In the Hook mode every rule below is provable by an existing committed driver. In the dNFT mode the same
rules are the replay verifier's check set.*

## HookState record — one slot per pet (key = pet URIToken id, or owner AID for v1)
64-byte big-endian record. Offsets:

| off | size | field | notes |
|---|---|---|---|
| 0  | 8 | `birth_ledger`     | ledger seq at hatch; **immutable after creation** (set-once) |
| 8  | 8 | `last_ix_ledger`    | ledger of the last interaction; decay is measured from here |
| 16 | 1 | `hunger`            | 0..100  (0 = starving) |
| 17 | 1 | `happiness`         | 0..100 |
| 18 | 1 | `health`            | 0..100  (hits 0 ⇒ death) |
| 19 | 1 | `alive`             | 1 alive · 0 dead. **One-way 1→0 only** |
| 20 | 1 | `stage`             | 0 EGG · 1 BABY · 2 TEEN · 3 ADULT · 4 ELDER · 5 PASSED. **monotonic ↑** |
| 21 | 1 | `form`              | 0 = unset; else evolved form id. **set-once at ADULT** |
| 22 | 1 | `death_cause`       | 0 alive · 1 neglect · 2 old-age |
| 23 | 1 | _reserved_          | |
| 24 | 4 | `care_score`        | accumulated quality-of-care points. **monotonic ↑** |
| 28 | 4 | `care_max`          | max care achievable by now (cooldown-bounded ceiling). monotonic ↑ |
| 32 | 8 | `last_feed_ledger`  | for the feed cooldown (no-farming) |
| 40 | 8 | `last_play_ledger`  | for the play cooldown |
| 48 | 20| `owner`             | the owner AccountID; only this account may interact |

## Constants (tunable; ledgers ≈ 3–4 s on Xahau, so ~21,600/day at 4 s)
```
LEDGERS_PER_DAY      = 21600
DECAY_PER_LEDGER     = stat points lost per ledger of neglect (e.g. 100/LEDGERS_PER_DAY ≈ ~1/day-ish; tune)
FEED_COOLDOWN        = LEDGERS_PER_DAY / 6     (~4 h)   -- no-farming
PLAY_COOLDOWN        = LEDGERS_PER_DAY / 6
STAGE_AGE = [ 0, 1*DAY, 3*DAY, 7*DAY, 21*DAY ]          -- EGG/BABY/TEEN/ADULT/ELDER thresholds (in ledgers)
LIFESPAN             = 40*DAY                            -- ELDER → PASSED (old age)
CARE_PER_GOOD_IX     = 10        -- a timely interaction that actually helped (stat was low)
CARE_CEIL_PER_IX     = 10        -- care_max climbs by this each eligible (cooldown-cleared) interaction window
```

## The ONE handler (Invoke + 1-byte memo `op`: 1=feed 2=play 3=clean 4=heal)
Pure, deterministic, owner-gated. Pseudocode:

```
hook(reserved):
  require otxn_type == ttINVOKE
  read record R (state key = pet id); require present 64B            # absent ⇒ N/A
  require origin (otxn sfAccount) == R.owner                          # OWNER-ONLY  [prove_authz]
  now = current ledger seq                                           # ledger-time, deterministic

  # 1) AGE + STAGE (monotone, time-only)
  age = now - R.birth_ledger
  new_stage = stage_for_age(age)                                     # see below; >= R.stage always
  require new_stage >= R.stage                                       # AGE MONOTONIC  [prove_monotonic]

  # 2) DECAY since last interaction (deterministic, only ever lowers stats)
  elapsed = now - R.last_ix_ledger
  drop = min(100, elapsed * DECAY_PER_LEDGER)
  hunger'    = sat_sub(R.hunger, drop)                               # bounded [0,100], no underflow [prove_overflow]
  happiness' = sat_sub(R.happiness, drop)
  health'    = sat_sub(R.health, neglect_penalty(hunger',happiness',drop))

  # 3) DEATH — one-way, and final
  if R.alive == 0: ACCEPT("already gone")                            # NO-RESURRECTION  [prove_monotonic on alive]
  if age >= LIFESPAN: alive'=0; death_cause'=2; stage'=PASSED        # old age
  elif health' == 0:  alive'=0; death_cause'=1                       # neglect death
  else: alive'=1

  # 4) ACTION (only if still alive) — bounded, cooldown-gated
  if alive':
     if op == FEED:
        require now - R.last_feed_ledger >= FEED_COOLDOWN            # NO-FARMING  [prove_period_budget]
        was_low = hunger' < 50
        hunger' = sat_add(hunger', 40)                              # bounded [0,100]
        last_feed_ledger' = now
     elif op == PLAY: ... happiness' += 40; cooldown PLAY ...
     elif op == CLEAN/HEAL: ... health' += 30 ...
     # CARE accounting — only "good" (it actually helped) care counts, and only once per cooldown window
     care_max'   = R.care_max + CARE_CEIL_PER_IX                     # ceiling climbs each eligible window
     care_score' = R.care_score + (was_low ? CARE_PER_GOOD_IX : CARE_PER_GOOD_IX/2)
     require care_score' >= R.care_score                             # CARE MONOTONIC  [prove_monotonic]
     require care_score' <= care_max'                               # care can't exceed the cooldown-bounded ceiling

  # 5) EVOLUTION — happens ONCE, at the BABY/TEEN→ADULT crossing, frozen forever
  if new_stage == ADULT and R.form == 0:
     form' = evolve(care_score', care_max')                         # deterministic; see below
     require R.form == 0                                            # SET-ONCE: never re-rolled  [prove_set_once]
  else:
     form' = R.form                                                 # immutable once set

  stage' = new_stage
  last_ix_ledger' = now
  write R'
  ACCEPT
```

## `stage_for_age(age)` — monotone step function (provably one-directional)
```
if age < STAGE_AGE[1]: return EGG
if age < STAGE_AGE[2]: return BABY
if age < STAGE_AGE[3]: return TEEN
if age < STAGE_AGE[4]: return ADULT
if age < LIFESPAN:     return ELDER
return PASSED
```
Age only increases (now ≥ birth, now monotone with ledger time), so `stage_for_age` is non-decreasing →
`prove_monotonic` on `stage` closes "an elder can never revert to baby."

## `evolve(care_score, care_max)` — the DETERMINISTIC care→form function (no hidden RNG)
The headline "no-rug" theorem: a rare form can only be reached by a care record that earned it.
```
ratio = care_score * 100 / care_max          # 0..100, integer; care_max>0 guaranteed (>=1 eligible window to reach ADULT)
if ratio <  40: return RUNT        (1)        # neglected-but-survived → common
if ratio <  75: return STANDARD    (2)
if ratio <  92: return RARE        (3)
return            LEGENDARY (4)               # only sustained, near-perfect care
```
- **Deterministic** — pure function of two on-chain monotone counters; no `ledger_nonce`, no off-chain seed.
- **Ungameable** — `care_score ≤ care_max`, and `care_max` only climbs once per cooldown window (no-farming),
  so you cannot spam-feed to a LEGENDARY; the ratio reflects *sustained* care across the pet's whole youth.
- **Frozen** — written under `set_once`; once ADULT, `form` never changes. `prove_set_once` proves no path
  re-rolls it; the deterministic body proves LEGENDARY is unreachable below ratio 92.

## OPTIONAL randomness (only if you want a random hatch among same-tier forms)
If the EGG→BABY hatch should pick 1 of N cosmetic variants: **commit-reveal**.
- At creation the owner commits `H = sha512half(secret)`; the BABY variant = `f(secret, birth_ledger_hash)` revealed
  later, with the secret checked against `H` (`prove_commitment` / `prove_hashlock`) and written `set_once`.
- The owner can't grind it (the future ledger hash isn't known at commit; the variant is set-once). Fairness of
  the randomness is itself proven. **Lead with the deterministic care path; this is a bonus, not the core.**

## Invariant map — same checks, two enforcement modes
| Invariant | dNFT mode (XRPL): the replay verifier asserts… | Hook mode (Xahau): proven by… |
|---|---|---|
| `age`/`stage`/`alive`/`care_score` only move one way | each `NFTokenModify` never moves them backward | `prove_monotonic` |
| only `owner` interacts | each interaction Payment's source == the pet's owner | `prove_authz` |
| `form` set once, never re-rolled | `form` changes from 0 exactly once, at the ADULT crossing | `prove_set_once` |
| feed/play cooldown not bypassed (no farming) | consecutive same-op Payments are ≥ COOLDOWN ledgers apart | `prove_period_budget` |
| stats in [0,100]; no over/underflow | every modified stat ∈ [0,100] | `prove_overflow` |
| (optional) hatch variant bound to committed secret | the revealed variant == f(committed secret, ledger hash) | `prove_commitment` |

- **dNFT mode:** the **open rules engine version is anchored** to the XRP Ledger (proof-transparency log). The
  **"Verify my pet"** panel runs the replay verifier client-side: re-derive the state from the on-ledger
  interaction history + the anchored rules, assert it matches the on-ledger dNFT state. Any deviation by the
  operator is flagged, pinned to the anchored ruleset → cheating is **detectable**.
- **Hook mode:** every cert lands in the proof registry, head anchored; the panel binds the proof to the
  deployed **HookHash** → **PROOF_VOID** if the pet's code is ever swapped → cheating is **prevented**.

## Implementation order (matches the 90-day plan)
**dNFT mode (default, ship this for Make Waves):**
1. Mint a mutable pet dNFT; rules engine: decay + age/stage + death; one `NFTokenModify` per interaction → testnet pet living/dying.
2. Add care_score/care_max + `evolve()`; commit-reveal hatch (optional).
3. Open-source + version the rules engine; **anchor the version hash to XRPL**; build the client-side **replay verifier** ("Verify my pet"). *(Differentiator complete.)*
4. Frontend: adopt/feed/play, share links, gallery/leaderboard.

**Hook mode (only if Xahau qualifies):** same machine as a C Hook → prove monotonic / set_once / authz / period-budget / overflow → register + anchor certs → verify panel binds to the deployed HookHash.
