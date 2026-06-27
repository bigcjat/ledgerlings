# Ledgerlings — One-Tap Multi-Care via XRPL Batch (design doc)

*How "full care" (feed + play + clean, optionally heal) becomes ONE atomic, single-signature
interaction instead of 3–4 separate taps/signatures — without weakening provable fairness.
Companion to STATE_MACHINE.md (the dNFT substrate + `step()` rules + replay verifier),
`build/pet_rules.js` (the shared engine — the source of truth for every rule below), and
BREEDING_BATCH.md (the sibling Batch spec). **This doc covers only multi-care; for the live/voting
status of the Batch amendment and the non-Batch fallback, it DEFERS to BREEDING_BATCH.md §0/§7 —
it does not re-derive that.**

The thesis in one line: **bundling is a UX + atomicity change ONLY. Every op is still the exact same
deterministic `pet_rules.step()`, still owner-gated, still cooldown-gated, still stat-capped. You
cannot over-care or bypass a cooldown by bundling.**

---

## 0. Honesty banner — Batch status (defer to BREEDING_BATCH.md)

The XRPL Batch amendment (XLS-56d) is **NOT enabled on mainnet — in voting and in flux** (original
disabled in rippled v3.1.1 after the Feb-2026 inner-txn signature-validation disclosure; being
re-introduced as `BatchV1_1`). **See BREEDING_BATCH.md §0 for the authoritative status table and §7
for the non-Batch fallback.** Do not re-derive it here; that doc is the single source of truth and
this doc must not contradict it.

**What that means for multi-care:**
- **Today (Batch not live):** ship the **sequenced fallback (§6)** — 3–4 ordinary owner-signed
  Payments, one per op, exactly as today's single-care path already works. Multi-care is just a UI
  affordance over the existing per-interaction flow. No new on-ledger primitive required.
- **When `BatchV1_1` is live + re-audited:** flip on the **Batch path (§2)** — one outer Batch, one
  signature, all-or-nothing. Same `atomicCare()` interface (§7), so the cutover is a config flag,
  not a rewrite — mirroring BREEDING_BATCH.md §8.

Unlike breeding, multi-care's inner txns are **owner-signed** (the owner is the one caring for their
own pet), which touches the multi-account inner-signing surface differently than breeding's
issuer-authored model — see §2 "Inner-txn authorship" and §8 risk notes.

---

## 1. The UX — a "full care" button

### The problem today
Caring for a neglected pet means three round-trips: **Feed**, then **Play**, then **Clean** — each a
separate Payment-to-issuer with a memo, each its own sign prompt in the wallet (Xaman). On mobile
that's three app-switches, three signs, three confirmation waits. Friction kills the daily-care loop
that the whole game depends on.

### The fix
One primary button: **"Full Care 🍎🎾🧼"**. One tap → one sign prompt → the pet gets fed, played
with, and cleaned in a single confirmed interaction. Optional **"Full Care + Heal 💊"** variant adds
the heal op when the pet's health is low (or always, as a four-op bundle).

```
┌─────────────────────────────────────────┐
│   🥚→🐣  Mochi   ·  TEEN  ·  ❤ alive      │
│                                          │
│   Hunger     ████████░░  78              │
│   Happiness  ███░░░░░░░  31  ⚠ low       │
│   Health     █████████░  92              │
│                                          │
│   ┌────────────────────────────────┐     │
│   │      ✨  FULL CARE  ✨           │  ← one tap, one signature
│   │   feed · play · clean           │     │
│   └────────────────────────────────┘     │
│   ┌──────────┐ ┌──────────┐ ┌─────────┐  │
│   │ 🍎 Feed   │ │ 🎾 Play  │ │ 🧼 Clean │  ← individual ops still available
│   └──────────┘ └──────────┘ └─────────┘  │
│                                          │
│   ⏱ Play on cooldown — ready in ~38 min   │  ← preview (see below)
└─────────────────────────────────────────┘
```

### Honest pre-flight preview (no surprise no-ops)
Before the user signs, the UI runs `pet_rules.step()` **locally** for each op in the bundle at the
projected `now` and shows what will actually happen. Because `step()` is the shared, pure engine
(`build/pet_rules.js`), the client can predict the outcome exactly:

- "Feed: hunger 78 → 100 (+restore, cooldown ready) ✓"
- "Play: **on cooldown** — this op will be a no-op; happiness stays 31. Ready in ~38 min." ⏱
- "Clean: health 92 → 100 (+20) ✓"

So the user is never surprised that a cooldowned op did nothing. The button can either:
- **(A) include the cooldowned op anyway** (it's a deterministic no-op per the rules — harmless,
  and keeps the bundle shape stable), or
- **(B) auto-trim** cooldowned ops from the bundle so the user only pays fee for ops that do work.

**Recommendation: (B) auto-trim by default**, with a toggle to force the full bundle. Trimming is a
pure UX optimization — it never changes any pet state, since a trimmed op was provably a no-op
anyway (§4). The replay verifier doesn't care which choice was made (§5).

### Why this is better mobile UX
- 1 sign prompt instead of 3–4 → ~70% fewer wallet app-switches for the core daily action.
- 1 fee instead of 3–4 (Batch path) → cheaper to fully care.
- Atomic: the pet either gets the whole care round or (Batch path) none of it — no half-cared pet
  from a dropped second tap.

---

## 2. The Batch structure for multi-care (when `BatchV1_1` is enabled)

Multi-care is **one outer `Batch`**, mode **`tfAllOrNothing`**, wrapping the per-op interactions.

### Inner-txn authorship — the key difference from breeding
In BREEDING_BATCH.md the inner txns are **issuer-authored** (only the issuer may mint/modify pets).
In **multi-care the interactions are the OWNER's** — recall the substrate (STATE_MACHINE §"XRPL-NATIVE"):
an interaction = **the owner sends a tiny Payment to the issuer with a memo `op`**. Owner-signed ⇒
owner-only by construction. So the multi-care Batch is **owner-authored**: the owner wraps their own
feed/play/clean Payments into one Batch and signs the single outer envelope.

> **Re-audit gate (important):** owner-authored multi-account-free inner txns are simpler than
> breeding's surface, but the Feb-2026 disclosure was specifically about inner-txn signature
> validation. Per BREEDING_BATCH.md §8, the Batch path stays **OFF until `BatchV1_1` ships AND we
> re-verify inner-auth semantics on testnet.** Until then, §6 fallback is the production path.

### Inner transactions (in order)

```
Batch (outer, mode = tfAllOrNothing, signed + fee by the OWNER)
 ├─ inner[1]  Payment  owner → issuer,  amount = 1 drop,  Memo{ op: 1 (FEED) },  Memo{ pet_id }
 ├─ inner[2]  Payment  owner → issuer,  amount = 1 drop,  Memo{ op: 2 (PLAY) },  Memo{ pet_id }
 ├─ inner[3]  Payment  owner → issuer,  amount = 1 drop,  Memo{ op: 3 (CLEAN)},  Memo{ pet_id }
 └─ inner[4]  Payment  owner → issuer,  amount = 1 drop,  Memo{ op: 4 (HEAL) },  Memo{ pet_id }   (optional)
```

- Up to **8 inner txns** per Batch — multi-care needs at most 4, well within budget.
- Inner txns set **`tfInnerBatchTxn`**, **`Fee: "0"`**, no signature, empty `SigningPubKey` (`""`),
  no `TxnSignature`/`Signers`. The single outer Batch carries the fee and the **owner's** signature;
  the inner txns are authorized by the Batch envelope. (Same inner-txn mechanics as
  BREEDING_BATCH.md §1; only the signer differs — owner here, issuer there.)
- The `op` memo encoding (1=feed 2=play 3=clean 4=heal) is **identical** to the single-care path
  (STATE_MACHINE §"An interaction"; `OP` map in `pet_rules.js`). Inner Payments are byte-for-byte
  the same shape as standalone care Payments — that's what makes the verifier reuse trivial (§5).

### What the issuer does on seeing the Batch
The issuer's rules engine processes the inner Payments **in inner order, all at the Batch's single
ledger_index** (§3). It applies `pet_rules.step()` once per inner op (folding state op→op→op), then
writes the final pet state with **ONE `NFTokenModify`** — or up to one per op if it prefers a write
per step; either is fine for the verifier (§5), but **one collapsed `NFTokenModify` is recommended**
(one Batch in → one state write out → cleanest audit trail).

### Why atomicity is nice here
- **One deterministic `now`.** All inner ops are applied at the *same* ledger_index — the Batch
  commits at one ledger, so `now` is identical for feed, play, and clean. Without Batch, the three
  Payments land at (slightly) different ledgers → three different `now` values, slightly different
  decay applied before each op. Atomicity gives the care round **one canonical `now`** = a single,
  cleaner deterministic fold (§3).
- **All-or-nothing.** Either the whole care round applies or none of it. No "fed but the play tx got
  dropped" half-state. (On fallback the per-op Payments are independent and idempotent — §6 — so a
  dropped op just means that one op didn't happen, which is recoverable and honest, just not atomic.)
- **One signature, one fee.** The mobile-UX win (§1).

The atomicity is a **convenience and consistency** win. It is explicitly **NOT** a fairness lever —
that's the whole point of §3–§4.

---

## 3. THE FAIRNESS POINT — how `step()` applies to a bundled set at a single `now`

**This is the load-bearing section. Read it before changing any bundling code.**

Bundling changes *how the transactions are packaged*, not *what the rules do*. The rules engine
treats a Batch as **a fold of the existing per-op `step()` over the inner ops, all sharing one
`now`.** Concretely:

```
applyMultiCare(state, ops[], now, sender):     # ops in inner-txn order, e.g. [FEED, PLAY, CLEAN]
    s = state
    for op in ops:                             # SAME engine, once per inner op
        s = PetRules.step(s, op, now, sender)  # build/pet_rules.js — UNCHANGED
    return s
```

That is the **entire** semantic. There is no special "multi-care rule." It is literally `step()`
called N times with the **same `now`** (the Batch's ledger_index) and the **same `sender`** (the
owner who signed the outer Batch).

### Walking through what each guard does in the fold — nothing is bypassed

Every protection in `pet_rules.step()` still fires on **every** inner op, because it's the same
function:

1. **Owner gate.** `step()` first line: `if (sender !== s.owner) return s;` The Batch is owner-signed,
   so `sender` = owner for every inner op. A non-owner can't bundle care for someone else's pet —
   same guarantee as single-care (STATE_MACHINE `prove_authz`).

2. **Decay is applied once, then ops fold on top.** The first `step()` in the fold computes
   `drop = floor(max(0, now - s.last_ix) * DECAY / DAY)` and applies it. It then sets `s.last_ix = now`.
   So the **second and third** `step()` calls in the same Batch see `now - s.last_ix == 0` →
   `drop == 0` → **no double decay.** Decay for the care round is charged exactly once, at the one
   shared `now`. This is *more* correct than three separate Payments at three ledgers (which would
   each charge a sliver of decay). One ledger = one decay = one `now`. ✓

3. **Cooldowns are NOT bypassed.** This is the crucial one. In `pet_rules.step()`:
   ```
   if (op === FEED && (s.last_feed === 0 || now - s.last_feed >= COOLDOWN)) { award(...); s.hunger += RESTORE; s.last_feed = now; }
   else if (op === PLAY && (s.last_play === 0 || now - s.last_play >= COOLDOWN)) { ... s.last_play = now; }
   ```
   - If **play** is on cooldown (`now - s.last_play < COOLDOWN`), the PLAY inner op falls through
     **all** branches and `step()` returns the state with happiness **unchanged** and `care`
     **unchanged** — a **deterministic no-op**, exactly as it would be as a standalone Payment. The
     Batch can still succeed for FEED and CLEAN; PLAY simply did nothing. **Bundling a cooldowned op
     does not refresh or skip its cooldown** — the cooldown predicate reads `s.last_play` which is
     untouched by feed/clean.
   - You **cannot feed twice in one Batch to double-restore hunger.** Two FEED inner ops: the first
     sets `s.last_feed = now`; the second sees `now - s.last_feed == 0 < COOLDOWN` → no-op. The cap
     is enforced *within* the fold because each `step()` mutates `s.last_feed` that the next `step()`
     reads. **Self-farming inside a single Batch is impossible by the same predicate that blocks
     cross-tx farming.** (STATE_MACHINE `prove_period_budget` / "consecutive same-op interactions
     are ≥ COOLDOWN ledgers apart" — and two ops in one Batch are 0 ledgers apart, so the second is
     always a no-op.)

4. **Stat caps hold.** Every stat write goes through `clamp(v, 0, 100)`. Folding feed→clean can't
   push hunger/health past 100; the caps are per-`step()` and therefore per-inner-op. No bundle can
   over-fill a stat (STATE_MACHINE `prove_overflow`).

5. **Care accounting is honest.** `award()` bumps `care_max += 10` and `care += (low?10:5)` **only**
   on a cooldown-cleared feed/play. A bundle of [FEED, PLAY, CLEAN] where all are eligible awards
   care for feed and play exactly as three separate eligible Payments would — **no more.** A bundle
   where play is cooldowned awards care for feed only. So **multi-care cannot inflate `care_score`
   toward a LEGENDARY evolution** any faster than honest spaced-out care: the `care ≤ care_max`
   ceiling and the per-cooldown-window `care_max` climb are untouched (STATE_MACHINE
   `evolve()` no-rug theorem). Bundling buys convenience, never rarity.

6. **Death / age / stage / form** are evaluated by the same `step()` at the shared `now`. If the
   pet dies on the first inner op (e.g. health hit 0 from decay), `step()` returns the dead state and
   the remaining inner ops are no-ops (`if (s.alive === 0) return s;`). Evolution still fires
   set-once at the ADULT crossing. All monotonic/set-once guarantees hold (STATE_MACHINE
   `prove_monotonic`, `prove_set_once`).

### The one-line fairness theorem
> For any bundle `ops[]` applied at `now`, `applyMultiCare(state, ops, now, owner)` equals the
> result of submitting those same ops as **separate** owner Payments **that all happened to land at
> the same ledger `now`**. Bundling never reaches a state unreachable by honest separate care; it
> only fixes `now` to one value and removes inter-op decay drift. Cooldowns, caps, owner-gating, and
> care accounting are the SAME `step()` predicates, evaluated the SAME number of times.

This is why multi-care needs **no new invariant** and **no change to `pet_rules.js`**. It is a
packaging layer over the existing, replay-verified rules. (Hook variant: the same is true — the Hook
runs once per inner Invoke at one ledger; the existing `prove_*` drivers already cover each op, so a
bundle is just N proven steps at one `now`.)

---

## 4. Cooldowned inner ops — exact semantics (no-op, not failure)

To be unambiguous about "the Batch can still succeed for the others":

- A cooldowned op is a **no-op `step()`**, **not** a transaction failure. The inner Payment still
  *applies on-ledger* (owner sent 1 drop to issuer with an `op` memo); the issuer's rules engine
  reads it and `step()` simply returns unchanged stats for that op. So under `tfAllOrNothing` the
  **whole Batch still succeeds** — nothing failed, one op just had no effect. ✓
- This means **option (A)** in §1 (include cooldowned ops anyway) is safe: it never aborts the
  Batch, it just spends a drop + a memo on a no-op. **Option (B)** (auto-trim) avoids even that. Both
  produce identical pet state (the trimmed op was a no-op regardless).
- **There is no path where bundling makes a cooldowned op "count."** The cooldown predicate is
  `now - s.last_feed >= COOLDOWN` reading on-chain `last_feed`/`last_play`; bundling changes neither
  `now`'s relationship to those fields nor the fields themselves. A cooldowned op is cooldowned
  whether standalone or bundled.

> Edge note: if you genuinely wanted *whole-Batch* failure when any op is a no-op, that would require
> a different mode/guard — **do not do this.** It would let a cooldown turn into a griefing/abort and
> breaks the "best-effort care round" UX. The chosen semantics: **best-effort, all eligible ops
> apply, no-ops are silently no-ops, the Batch succeeds.** Atomicity here is about *one ledger / one
> `now`*, not about gating on cooldown outcomes.

---

## 5. How the replay verifier handles a Batch

The replay verifier (STATE_MACHINE §"Replay verifier") **already** re-derives state from the
on-ledger interaction history by re-executing `pet_rules.step()`. A Batch requires **no new verifier
logic** — only that it reads inner Payments correctly. Reuse the existing per-interaction code.

### What the verifier sees
A Batch lands as **one outer tx hash** at **one ledger_index**, containing **inner Payments each with
their `op` memo**. When the verifier walks history:

```
verify(pet):
  state = genesis(birth, owner)
  for tx in onLedgerHistory(pet):              # ordered by ledger_index, then inner order
      if tx is a single care Payment:
          state = PetRules.step(state, op(tx), tx.ledger_index, tx.sender)
      elif tx is a Batch:
          now = tx.ledger_index                # ONE ledger_index for all inner ops
          for inner in tx.innerTxns:           # in inner order
              if inner is a care Payment to issuer:
                  state = PetRules.step(state, op(inner), now, inner.sender_or_outer_signer)
      assert state == onLedgerStateAt(tx)      # NFTokenModify(s) written for this tx
```

Key points:
- **Same `step()`, same `now` for every inner op** — this is exactly the §3 fold. The verifier and
  the issuer run identical code (`build/pet_rules.js`), so they agree by construction.
- **`sender` for inner ops** = the owner (the outer Batch signer). The verifier asserts the outer
  Batch was owner-signed (so all inner care ops are owner-authored) — same owner-gate check as
  single-care.
- **One `NFTokenModify` per Batch (recommended):** the verifier folds all inner ops then compares to
  the single post-Batch dNFT state. **If the issuer instead wrote one `NFTokenModify` per inner op**,
  the verifier compares after each `step()` in the fold — both reconcile, since the fold's
  intermediate states are well-defined. The verifier should accept either write granularity.
- **Auto-trim (§1 option B) is invisible to the verifier:** a trimmed (cooldowned) op was a `step()`
  no-op, so whether it appears as an inner Payment or is omitted, the derived state is identical. The
  verifier never needs to know which UI choice was made.

### The honest stance is unchanged
A mismatch = the operator deviated from the published rules → **detected by anyone**, pinned to the
anchored ruleset (STATE_MACHINE: detectable on dNFT, **preventable** on the Xahau-Hook variant). Batch
doesn't widen or narrow this — it's still "re-derive with the open engine, assert equality." Multi-care
adds **zero** trust assumptions over single-care.

---

## 6. Fallback — sequenced multi-care if Batch isn't live (works TODAY)

Per §0, until `BatchV1_1` is enabled the production path is **sequenced**. This is **already how care
works today** — multi-care just fires the ops back-to-back from one button instead of one at a time.

```
fullCareViaSequence(pet, ops[]):               # ops = eligible ops only (auto-trimmed, §1)
    for op in ops:                             # owner signs each Payment
        submit Payment(owner → issuer, 1 drop, Memo{op}, Memo{pet_id})
    # issuer applies pet_rules.step() per Payment as each lands, writes NFTokenModify per op
```

- **Same engine, same guards.** Each Payment is an ordinary single-care interaction — the rules,
  cooldowns, caps, and verifier already handle it. Nothing new.
- **Difference vs Batch:** each Payment may land at a slightly different `ledger_index`, so `now`
  differs per op (tiny extra decay drift between ops — bounded by a few ledgers, cosmetically
  negligible). And it's **not** all-or-nothing: if op 2 is dropped, ops 1 and 3 still applied. That's
  honest and recoverable (the user re-taps the missing op; idempotency isn't even needed since each
  care op is naturally cooldown-guarded), just not atomic.
- **Signatures:** the fallback is **N sign prompts** (Xaman may allow a queued multi-sign UX, but
  worst case it's one per op). The single-signature win is the Batch-path upgrade. The fallback still
  delivers the **one-button** UX; Batch adds the **one-signature** + **one-`now`** + **atomic**
  upgrades on top.
- **Verifier:** §5's single-care branch already covers this — no Batch parsing needed.

This mirrors BREEDING_BATCH.md §7's stance: the differentiator (provable-fair care) **works today**
on the sequenced path; Batch is a robustness/UX upgrade adopted when `BatchV1_1` is live + re-audited.

---

## 7. Cutover plan (Batch ⇄ fallback behind one interface)

Same pattern as BREEDING_BATCH.md §8 — one interface, flip a flag:

```
atomicCare(pet, ops, sender):
    eligible = ops.filter(op => !onCooldown(pet, op, now))      # §1 auto-trim (pure UX, optional)
    if network.amendmentEnabled("BatchV1_1") and reaudited:     # default OFF until live + re-audited
        return careViaBatch(pet, eligible, sender)              # §2–§5 (one signature, one now, atomic)
    else:
        return careViaSequence(pet, eligible, sender)           # §6 (works today)
```

- Ship `careViaSequence` now — it's the production path and it's just today's care loop behind one
  button.
- Gate `careViaBatch` behind the **live-amendment check AND an internal re-audit of `BatchV1_1`**
  (Feb-2026 history → verify the fixed inner-auth semantics on testnet, especially since multi-care
  inner txns are owner-signed). Flipping the flag is the whole migration — **no schema change, no
  verifier change** (§5 already handles both branches), no change to `pet_rules.js`.

---

## 8. Brand guards (restated — multi-care must not erode them)

Non-negotiable, inherited from STATE_MACHINE / BREEDING_BATCH §5:

1. **Multi-care is packaging ONLY — never a fairness lever.** The bundle is N× the *same*
   `pet_rules.step()` at one `now`. It must reach **no** state unreachable by honest separate care
   (§3 theorem). *Test obligation:* property test that `applyMultiCare(state, ops, now, owner)` ===
   folding `step()` over the same ops at the same `now`, for all op orderings and cooldown states —
   and that no bundle exceeds the per-op cooldown/cap/care-accounting of separate eligible
   interactions.

2. **No cooldown bypass, no self-farming.** Two same-op inner txns in one Batch → the second is a
   provable no-op (0 ledgers apart < COOLDOWN). The cooldown predicate reads on-chain
   `last_feed`/`last_play` mutated within the fold (§3.3). *Test obligation:* `[FEED, FEED]` in one
   bundle restores hunger once, awards care once.

3. **`care_score` can't be inflated by bundling.** Care accounting is per eligible op, identical to
   spaced-out care — bundling never accelerates evolution rarity (§3.5). The `care ≤ care_max`
   no-rug ceiling is untouched.

4. **Owner-only authorship stays checkable.** The outer Batch is owner-signed; every inner care op
   is therefore owner-authored — same `prove_authz` guarantee as single-care. The verifier asserts
   the outer signer == pet owner.

5. **Verifier trust model unchanged.** Multi-care adds **zero** new trust assumptions; the verifier
   reuses single-care `step()` re-derivation (§5). Detectable on dNFT, preventable on the Hook variant.

> If any future change makes a bundled op behave differently from the same op submitted standalone at
> the same `now` — different cooldown, different cap, different care award, different owner-gate —
> **the provably-fair brand is broken. Do not ship it.** Multi-care is a fold, nothing more.

---

## 9. Open items before build
1. **Write granularity:** confirm issuer writes **one collapsed `NFTokenModify` per Batch** (cleanest
   trail) vs. one per inner op; make the verifier accept both (§5). Recommend one-per-Batch.
2. **Auto-trim vs. include-cooldowned (§1 A/B):** default to auto-trim; expose a "force full bundle"
   toggle. Confirm fee/UX copy for the trimmed case.
3. **`BatchV1_1` inner-auth for OWNER-signed inner txns:** the breeding spec uses issuer-authored
   inner txns to sidestep the multi-account inner-signing surface; multi-care's inner txns are
   owner-signed. **Re-verify on testnet** that owner-authored inner Payments under `BatchV1_1` carry
   the owner-gate correctly (the verifier's owner check is the backstop, but confirm the on-ledger
   semantics). Track against BREEDING_BATCH.md §0 status.
4. **Heal-op inclusion rule:** decide whether "Full Care + Heal" always includes HEAL or only when
   health < threshold (HEAL has no cooldown in `pet_rules.js`, so it's always effective up to the
   cap — include it only when it does meaningful work to avoid wasted ops).
5. **Xaman fallback UX:** confirm whether the wallet can queue N care Payments behind one user
   gesture pre-Batch (reduces perceived friction before the single-signature Batch path lands).

*Batch status + fallback semantics: see BREEDING_BATCH.md §0 and §7 (authoritative). Rules engine:
`build/pet_rules.js`. Substrate + replay verifier + invariant map: STATE_MACHINE.md.*
