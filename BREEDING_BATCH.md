# Ledgerlings — Atomic Breeding via XRPL Batch (v3 spec)

*Implementation-oriented design for how v3 breeding becomes one atomic, provably-fair act.
Companion to BREEDING_ROADMAP.md (the genetics/economy design) and STATE_MACHINE.md (the
dNFT substrate + replay verifier). This doc covers ONLY the atomicity + provable-fairness
plumbing of the breeding transaction.*

---

## 0. Honesty banner — what's live vs. what's pending (read first)

| Thing | Status (2026-06) | What we do about it |
|---|---|---|
| **XRPL Batch amendment (XLS-56d)** | **NOT enabled on mainnet. IN VOTING and currently in flux.** The original amendment was **disabled in rippled v3.1.1** after a Feb-2026 [vulnerability disclosure](https://xrpl.org/blog/2026/vulnerabilitydisclosurereport-bug-feb2026) (inner-txn signature-validation flaw → inner txns executable on arbitrary accounts). It is being **re-introduced as `BatchV1_1`** in a later release. | Treat Batch as **future** for the atomic path. Ship the **Fallback (§7) sequenced flow today**; flip on the Batch path (§1–§4) only once `BatchV1_1` shows as *enabled* on the target network. Code both behind one `atomicBreed()` interface so the cutover is a config flag, not a rewrite. |
| **Dynamic NFToken `NFTokenModify` (XLS-46)** | **Live.** Used today for per-interaction state writes. | Parent breed-count/cooldown bumps are `NFTokenModify`s — works in either path. |
| **`NFTokenMint` / `NFTokenCreateOffer`** | **Live.** | Offspring egg mint + fee transfer work in either path. |
| **Commit–reveal seed off a future ledger hash** | **Live** (pure XRPL primitives: memo commit + later ledger-hash reveal). | The provable-fairness core does **not** depend on Batch. Batch only makes the *bundle* atomic; it never touches how the genome is derived. |

**Bottom line:** provable-fair breeding (the differentiator) works *today* on the sequenced
fallback. Batch is a robustness upgrade (true all-or-nothing) we adopt when `BatchV1_1` is live.

---

## 1. The Batch transaction structure (when `BatchV1_1` is enabled)

Breeding is **one outer `Batch`** submitted by the **issuer account** (the only account that may
mint/modify pets), wrapping **inner transactions** that are applied **atomically**.

### Batch facts we rely on
- Up to **8 inner transactions** per Batch.
- Mode **`tfAllOrNothing`**: *every* inner txn succeeds or *none* are applied — exactly the
  property breeding needs.
- Inner txns: set **`tfInnerBatchTxn`**, **`Fee: "0"`**, **no signature**, **empty
  `SigningPubKey` (`""`)**, **no `TxnSignature`/`Signers`**. The single outer Batch carries the
  fee and the issuer's signature; the inner txns are authorized by the Batch envelope.
- All inner txns here originate from the **issuer account** (it owns mint/modify authority).
  The breeder's consent + fee come in *before* the Batch as a prerequisite (§3), not as an
  inner txn signed by the breeder — this sidesteps the multi-account inner-signing surface that
  caused the Feb-2026 bug and keeps the trust model simple (issuer-authored, publicly verifiable).

### Inner transactions (in order)

```
Batch (outer, mode = tfAllOrNothing, signed+fee by ISSUER)
 ├─ inner[1]  NFTokenModify   parentA  → breed_count++, last_breed_ledger = now, write cooldown
 ├─ inner[2]  NFTokenModify   parentB  → breed_count++, last_breed_ledger = now, write cooldown
 ├─ inner[3]  NFTokenMint     offspring EGG dNFT
 │                              URI = encode(genome, parents=[A_id,B_id], seed_commit, gen)
 │                              (tfTransferable, transfer_fee set per MARKETPLACE_ROADMAP)
 └─ inner[4]  NFTokenCreateOffer (issuer → breeder, amount 0) to deliver the egg, OR
              the egg is minted directly to the breeder if a destination mint is used.
```

Fee accounting (inner[0] conceptually): the **breeding fee** is *collected before* the Batch as a
prerequisite Payment (§3, step P2). The issuer does not need to put the fee Payment inside the
Batch — and shouldn't, because the fee Payment is **breeder-signed** and we keep inner txns
issuer-authored. If a sire-rental split is owed (BREEDING_ROADMAP economy), the split payout
*can* be an inner `Payment` from the issuer to the sire owner so the split is atomic with the
mint — that's the one place an extra inner txn earns its slot.

### The atomicity guarantee this buys us
With `tfAllOrNothing`, the broken intermediate states enumerated in BREEDING_ROADMAP are
**unreachable on-ledger**:
- ❌ "fee paid but no baby" — fee is a *precondition* gate (§3); the mint either commits with the
  parent bumps or the whole Batch fails and nothing is written. (Fee refund path: §7 compensation.)
- ❌ "baby minted but parents not bumped" — mint + both bumps are in one atomic unit; partial
  apply is impossible.
- ❌ "two simultaneous breeds racing the cap" — the eligibility re-check is an inner condition that
  reads parent state *at apply time* (§3); a losing race fails the whole Batch.

---

## 2. Deterministic `breed()` + commit–reveal seed in the atomic flow

The genome is **computed off-ledger before the Batch is built**, then **frozen into the offspring
URI** by the mint. The Batch does not *compute* anything random — it only *records* a value that
anyone can independently re-derive. This is the whole no-rigged-rare-baby property.

### `breed(genomeA, genomeB, seed)` — deterministic, analogous to `evolve()` in pet_rules.js
- **Pure function**, same engine discipline as `step()`/`evolve()`: shared JS (Node issuer +
  browser verifier), versioned, version-hash **anchored to XRPL** (same proof-transparency log as
  the pet rules engine).
- Per gene: dominant/recessive Mendelian resolution from the two parent genomes; a **bounded**
  mutation chance driven *only* by `seed`. No `ledger_nonce`, no hidden RNG, no operator input
  beyond the parents and the committed seed.
- `genome` and `parents=[A_id,B_id]` are written into the offspring egg's dNFT URI (the same
  64-byte-record discipline as STATE_MACHINE, extended with the genome block + parent IDs).

### Commit–reveal seed (the only randomness, and it's proven)
Same mechanism as the optional hatch-variant commit–reveal in STATE_MACHINE, applied to breeding:

```
T0  COMMIT   breeder submits intent: memo carries  seed_commit = sha512half(secret)
             and names parentA_id, parentB_id, target_breed_ledger N (a near-future ledger).
             The egg is NOT minted yet. The commit is on-ledger and immutable.

T1  REVEAL   at/after ledger N, seed = mix(secret, ledger_hash(N)).
             ledger_hash(N) is unknown at T0 → breeder cannot grind a rare outcome;
             issuer cannot grind it either (it's a public future ledger hash).
             secret is checked against seed_commit (sha512half) before anything mints.

T2  BREED    issuer computes genome = breed(genomeA, genomeB, seed),
             builds the Batch (§1) with that genome + seed_commit baked into the egg URI,
             submits it atomically.
```

Why the order is safe: the genome is fully determined by `(genomeA, genomeB, secret, ledger_hash(N))`
the instant ledger N closes — *before* the Batch is built. The Batch is a faithful recorder. If the
issuer tried to mint a different genome than `breed()` yields, the verifier (§4) catches it.

**Grind-resistance note:** because `seed` depends on `ledger_hash(N)`, neither party can preview the
outcome at commit time, and the issuer can't re-roll after seeing it (the egg URI is `set_once`
collectible; re-minting a "better" egg for the same commit is detectable — the commit pins parents +
N, and only one egg may reference a given commit; the verifier flags a second).

---

## 3. Eligibility checks — enforced atomically (no double-spend of a breeding slot)

A "breeding slot" = one unit of a parent's bounded lifetime breed capacity. Double-spending it
(breeding the same parent twice off one cooldown, or exceeding the lifetime cap via a race) is the
core risk. Atomicity is what closes it.

### The eligibility predicate (both parents must pass)
Per parent, read from its current on-ledger dNFT state:
```
ELIGIBLE(p) :=
     p.alive == 1
  && p.stage == ADULT            # not EGG/BABY/TEEN (immature) and NOT ELDER/PASSED (elders can't breed)
  && p.breed_count < BREED_CAP   # lifetime cap
  && (now - p.last_breed_ledger) >= breed_cooldown(p.breed_count)   # cooldown, GROWS per breed
```
`breed_cooldown()` increases with `breed_count` (bounded supply; BREEDING_ROADMAP economy).
New parent fields (reserve in the dNFT schema now, like `loadout`/`genome`):
`breed_count` (u8, monotonic ↑), `last_breed_ledger` (u64).

### How atomicity enforces it
- **Batch path (`tfAllOrNothing`):** the two `NFTokenModify` inner txns (inner[1], inner[2]) carry
  the *expected* pre-state as a guard: each bump is conditioned on the parent still being
  `ELIGIBLE` and its `breed_count`/`last_breed_ledger` being **exactly what we read** when building
  the Batch (optimistic-concurrency / compare-and-swap on those fields). If a concurrent breed
  already bumped a parent, the read no longer matches → that inner txn fails → **the whole Batch
  fails** → no mint, no half-bump. The losing race breeds nothing. This is the on-ledger CAS that
  makes a slot single-use.
- The mint (inner[3]) and both bumps are one atomic unit, so you can never consume a slot (bump)
  without producing exactly one egg, nor produce an egg without consuming both slots.

### Concurrency / nonce hygiene
- Issuer serializes breed Batches per-parent in its own queue (one in-flight Batch per parent) so
  two Batches don't even reach the ledger racing the same slot in the common case; the on-ledger
  CAS is the backstop for anything that slips through (e.g. issuer restart, multi-instance).
- Outer Batch uses a normal issuer sequence number; no special nonce needed.

---

## 4. Replay verifier extension — provably-fair breeding

The existing replay verifier (STATE_MACHINE §"Replay verifier") re-derives each pet's *care* state.
Breeding adds a second, independent check anyone can run: **re-derive the offspring genome.**

### `verifyBreeding(offspring_id)` — client-side, trustless
```
1. Pull the offspring egg dNFT  → read URI → { genome, parents=[A_id,B_id], seed_commit, gen }.
2. Pull parentA, parentB dNFTs   → read parentA.genome, parentB.genome
   (re-derive each parent's genome the same way; genomes are immutable set-once at mint).
3. Pull the commit txn (seed_commit) and the reveal txn (secret) from the offspring's on-ledger
   history; pull ledger_hash(N) for the committed target ledger N.
4. Assert sha512half(secret) == seed_commit.                 # commit binding (prove_commitment)
5. seed' = mix(secret, ledger_hash(N)).
6. genome' = breed(parentA.genome, parentB.genome, seed')    # the ANCHORED, versioned engine
7. ASSERT genome' == offspring.genome.                       # the no-rug theorem
   ASSERT offspring.parents == [A_id, B_id] and both existed/were ELIGIBLE at the breed ledger.
   ASSERT exactly one egg references this seed_commit.        # no re-roll
8. (atomicity audit) Confirm the breed Batch (or fallback sequence) shows: both parent
   breed_count bumps + the single mint, consistent with §3. A missing/extra bump = flagged.
```
A mismatch at step 7 = the operator minted a genome the rules don't produce → **a rigged baby,
detected by anyone**, pinned to the anchored `breed()` version so the operator can't backdate or
swap the rules. Same honest stance as the care verifier: **detectable on dNFT, preventable on the
Xahau-Hook variant** (where `prove_commitment` + a `breed()` Hook prove it for all inputs).

### What Batch adds to verification
Batch makes the atomicity audit (step 8) trivial and **iron-clad**: the whole breed is one txn hash
with a deterministic inner set — there's no window where the ledger shows a mint without its bumps.
On the fallback (§7), step 8 instead reconstructs the intended atomic set from the linked sequence +
idempotency key and confirms it completed (or was cleanly compensated).

---

## 5. Brand guards (HARD rules — restated, and how this spec respects them)

These are non-negotiable from BREEDING_ROADMAP / STATE_MACHINE / MARKETPLACE_ROADMAP. Restated so
nothing in the atomic-breeding work erodes them:

1. **Genetics are COSMETIC / collectible ONLY — never pay-to-win on fair care-state.**
   The offspring's `genome` lives in the *cosmetic* region of the dNFT record, exactly like
   `loadout`. The care state machine `step()`/`evolve()` **must never read `genome`** — verified
   the same way loadout is: transitions are identical for any genome. A bred legendary-looking pet
   still lives/ages/dies by the same open rules; genetics decide how it LOOKS and its rarity, not
   its stats. *Test obligation:* property test that `step(state,...)` output is invariant under any
   change to the `genome`/`parents` fields.

2. **Supply is bounded by construction.**
   - **Cooldown** that **grows** with each breed (`breed_cooldown(breed_count)`).
   - **Lifetime breed cap** (`breed_count < BREED_CAP`).
   - **Elders can't breed** (`stage == ADULT` required; ELDER/PASSED excluded).
   These are enforced atomically (§3), so scarcity can't be raced or double-spent. No operator
   knob mints extra eggs — every egg consumes two real, in-bounds slots.

3. **The only randomness is the commit–reveal mutation, and it's proven.**
   `breed()` is deterministic except for the bounded mutation driven by the **commit–reveal seed**
   off a **future ledger hash**. No `ledger_nonce`, no off-chain operator seed, no hidden RNG
   anywhere in the flow. The seed is anchored (commit) and re-derivable (reveal) → §4 proves it.

4. **Issuer-only authorship stays publicly checkable.** Only the issuer mints/modifies (unchanged
   from STATE_MACHINE). Batch doesn't add breeder-signed inner txns (§1) — it keeps the
   issuer-authored, anchored-rules, replay-verifiable trust model intact. (This also avoids the
   multi-account inner-signing surface behind the Feb-2026 Batch bug.)

> If any future change makes `genome` influence stats, or lets an egg mint without consuming two
> in-bounds slots, or introduces randomness outside the proven commit–reveal — **the provably-fair
> brand is broken. Do not ship it.**

---

## 6. dNFT schema additions (reserve now — no migration later)

Extend the pet record (STATE_MACHINE 64-byte layout) with a breeding block, mirroring how `loadout`
and `genome` were reserved cheaply:

| field | size | notes |
|---|---|---|
| `genome`            | N bytes | visible + recessive genes; **cosmetic**, set-once at mint, `step()` never reads it |
| `parents`           | 2×32 B  | `[parentA NFTokenID, parentB NFTokenID]`; set-once at mint → on-chain pedigree |
| `gen`               | 2 B     | generation number (Gen-0 = MVP founders) |
| `breed_count`       | 1 B     | lifetime breeds by THIS pet; **monotonic ↑**, `< BREED_CAP` |
| `last_breed_ledger` | 8 B     | for the growing cooldown |
| `seed_commit`       | 32 B    | the commit this pet was bred from (Gen-0: zero) |

Reserve these in the v3-ready schema immediately. MVP/Gen-0 pets get `genome` (their founder
genome), `parents=∅`, `gen=0`, `breed_count=0` — they become founder lineage with zero migration.

---

## 7. Fallback — sequenced flow if Batch isn't enabled (works TODAY)

Until `BatchV1_1` is live, run breeding as an **idempotent, compensatable saga**. It reaches the
same end state and is **still fully verifiable** (§4 step 8 reconstructs the intended atomic set).

### Idempotency key
`breed_id = sha512half(parentA_id ‖ parentB_id ‖ seed_commit ‖ target_ledger N)`.
Every step below is tagged with `breed_id` (in memos / a small issuer-side journal). Re-running any
step with the same `breed_id` is a **no-op if already done** → safe retry, no duplicate eggs.

### Sequence (with compensation)
```
P1  GATE     re-read parentA, parentB on-ledger. Assert ELIGIBLE(A) && ELIGIBLE(B) (§3) AND
             record (breed_count, last_breed_ledger) read-values for CAS. Reserve the slot in the
             issuer journal keyed by breed_id (in-process lock per parent).  [no on-ledger write]

P2  FEE      breeder-signed Payment of the breeding fee → issuer, memo = breed_id.
             (This is the consent + revenue step. If breeder never pays, nothing was minted →
             nothing to undo.)

P3  REVEAL   verify secret vs seed_commit; seed = mix(secret, ledger_hash(N)); compute
             genome = breed(A.genome, B.genome, seed).

P4  MINT     NFTokenMint offspring egg (genome, parents, seed_commit, gen), memo = breed_id.
             ← THE COMMIT POINT. Egg now exists. Idempotent: if an egg with this breed_id exists, skip.

P5  BUMP-A   NFTokenModify parentA: breed_count++, last_breed_ledger=now — BUT only if A's current
             (breed_count,last_breed_ledger) still match the P1 read (CAS). If they don't → a race
             won; go to COMPENSATE. Idempotent on breed_id.

P6  BUMP-B   NFTokenModify parentB likewise (CAS). Idempotent on breed_id.

P7  DELIVER  NFTokenCreateOffer egg → breeder (or direct mint to breeder in P4). + sire split payout
             if owed.
```

### Failure handling
- **Crash between P4 and P5/P6:** on restart, the issuer scans its journal for `breed_id`s with a
  mint (P4 done) but missing bumps, and **rolls forward** (re-runs P5/P6, which are idempotent +
  CAS-guarded). Roll-forward is preferred because the egg already exists and is the user's asset.
- **CAS fails at P5/P6 (a real race won the slot):** **COMPENSATE** — burn the just-minted egg
  (issuer can `NFTokenBurn` an egg it minted and still holds, pre-delivery) and **refund the fee**
  (Payment back to breeder, memo = `breed_id` + `refund`). End state = as if the breed never
  happened; bounded supply preserved; breeder made whole. This is why P7 (deliver) is **last** —
  before delivery the egg is reversible.
- **Fee never arrives (P2 timeout):** abort before P4; nothing minted; release the journal slot.

### Why the fallback is honest, not a hack
- **Verifiable:** §4 still re-derives the genome and confirms the egg matches the parents+seed.
  Step 8 reconstructs the intended set via `breed_id` and confirms either full completion or clean
  compensation — there's an on-ledger trail for everything.
- **Bounded supply still holds:** the CAS guard (P5/P6) is the same single-use-slot enforcement as
  the Batch path; a lost race compensates rather than over-issues.
- **The window we accept:** between P4 and P7 the egg exists undelivered for a few ledgers. That's
  the only gap Batch removes. We bound it with roll-forward/compensate and a per-`breed_id` lock,
  and it's fully auditable. Batch upgrades this from "recoverable + auditable" to "impossible to
  observe partially."

---

## 8. Cutover plan (Batch ⇄ fallback behind one interface)

```
atomicBreed(parentA, parentB, commit, secret):
    if network.amendmentEnabled("BatchV1_1"):   # poll/feature-gate; default OFF until live + re-audited
        return breedViaBatch(...)                # §1–§4
    else:
        return breedViaSaga(...)                 # §7
```
- Ship `breedViaSaga` now; it's the production path for Make-Waves-era v3.
- Gate `breedViaBatch` behind the live-amendment check **and** an internal re-audit of `BatchV1_1`
  (given the Feb-2026 history, we verify the fixed inner-auth semantics on testnet before trusting
  it with mints). Flipping the flag is the entire migration — no schema change, no verifier change
  (the verifier already handles both via §4 step 8).

---

## 9. Open items before build
1. Lock the `genome` byte layout (visible + recessive gene encoding) + the exact `breed()` mutation
   bound — must be a pure function, committable to the anchored engine alongside `step()`/`evolve()`.
2. Decide `BREED_CAP` and the `breed_cooldown(breed_count)` curve (economy tuning, BREEDING_ROADMAP).
3. Confirm `BatchV1_1` final inner-txn semantics when it ships (this doc tracks XLS-56d; re-verify
   flags/fields against the released amendment, esp. inner-auth, before enabling the Batch path).
4. Sire-rental split: confirm whether the split payout rides inside the Batch (atomic) vs. a
   post-deliver Payment; lean atomic-inside-Batch when Batch is live.

*Sources for Batch status: [XRPL Batch docs](https://xrpl.org/docs/concepts/transactions/batch-transactions),
[Batch txn reference](https://xrpl.org/docs/references/protocol/transactions/types/batch),
[XLS-0056 standard](https://github.com/XRPLF/XRPL-Standards/tree/master/XLS-0056-batch),
[Feb-2026 vuln disclosure](https://xrpl.org/blog/2026/vulnerabilitydisclosurereport-bug-feb2026),
[Known Amendments](https://xrpl.org/resources/known-amendments).*
