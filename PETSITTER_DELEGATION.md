# Ledgerlings — Pet-Sitter via XRPL Permission Delegation (design doc)

*Feature: let an owner who is away delegate **care-only** actions (feed / play / clean) to a trusted
friend (the "sitter"), scoped so the sitter can **never** sell, transfer, breed, or change the loadout —
and keep the whole thing **provably fair**: a delegated sitter's actions are still bounded by the same
deterministic `pet_rules.step()` and still re-derivable by the replay verifier, while a non-delegated
stranger remains a no-op.*

> **STATUS HEADLINE (read first).** The XRPL-native path for this feature depends on the
> **Permission Delegation amendment (XLS family — `DelegateSet` / account-level permission delegation)**,
> which at time of writing is **in the amendment voting process, NOT yet enabled on XRPL mainnet.** Treat
> everything in §1–§3 marked **[DEPENDS-ON-DELEGATION]** as gated on that amendment activating. §5 gives a
> **fallback that works today** with an honest, weaker trust model. Before building, verify current amendment
> status on-chain (see §1.4) — do not assume it is live.

---

## 0. What is already true today (no amendment needed)

From `build/pet_rules.js` (the shared, open, deterministic rules engine):

```js
function step(state, op, now, sender) {
  const s = Object.assign({}, state);
  if (sender !== s.owner) return s;     // <-- OWNER-ONLY: any non-owner sender is a pure no-op
  if (s.alive === 0) return s;
  ...
}
```

and from `build/replay_verify.py`, the verifier re-executes `step()` over the on-ledger interaction
sequence `(op_code, ledger_seq, sender)` and asserts the re-derived state equals the on-ledger dNFT state.

So **today the authorized-actor set is exactly `{owner}`**. Anyone else's interaction Payment is recorded
on-ledger but produces no state change — which is exactly why a stranger can't grief your pet. Pet-sitting
is the first feature that must **widen** that set, and it must do so without weakening the fairness guarantee.

---

## 1. XRPL Permission Delegation — mechanics (be accurate) **[DEPENDS-ON-DELEGATION]**

### 1.1 What it is
Permission Delegation lets one account (the **delegator** / owner) authorize a second account (the
**delegate** / sitter) to send **specific, named transaction types** *on the delegator's behalf*. The
delegate signs with **its own keys** but the transaction executes **as if** sent by the delegator for the
delegated permission only. This is account-scoped authorization, distinct from:

- **Multisign / SignerList** — co-signing a *single* account's own transactions (no second account acts "as" you).
- **Regular key / master key** — full control of the account, not scoped.
- **`NFTokenCreateOffer` / brokered transfer** — moves the asset, the opposite of what a sitter may do.

Permission Delegation is **granular**: you grant *transaction-type-level* (and, in the richer form,
*delegated-field-level*) permissions, not "control of the account."

### 1.2 How a grant is created — `DelegateSet`
The owner submits a delegation transaction (commonly `DelegateSet`) naming:
- the **delegate account** (the sitter's `r...` address),
- the **set of permissions** granted — e.g. the right to submit `Payment` (or, in Ledgerlings's design,
  the specific care-interaction transaction type; see §3.2),
- a **replace-in-full semantics**: re-submitting `DelegateSet` for the same delegate overwrites the prior
  permission set (this is how you both grant and narrow).

The grant lives **on-ledger** as a delegation object owned by the delegator. That on-ledger presence is the
whole reason this stays verifiable: the replay verifier can read *exactly* what was delegated, to whom, and
when (§3).

### 1.3 Scoping (this is the safety-critical part)
The owner grants **only** the permission(s) needed for care, and nothing else. Concretely, the sitter must
**not** receive permission for any of:

| Capability | Underlying tx the grant must EXCLUDE | Why |
|---|---|---|
| Sell / list the pet | `NFTokenCreateOffer` (sell), `NFTokenAcceptOffer` | sitter must never monetize your pet |
| Transfer / gift | `NFTokenCreateOffer` (transfer), brokered accept | sitter must never move ownership |
| Breed (v2) | the future breed/`equip`-adjacent op | breeding mints/derives — owner-only economic act |
| Change loadout | the v2 `equip` op (cosmetic loadout mgmt) | loadout is owner's cosmetic inventory |
| Burn / destroy | `NFTokenBurn` | obvious |
| Re-delegate | `DelegateSet` | sitter must not be able to sub-delegate to a stranger |

The sitter receives **only** the care interaction permission (feed / play / clean — and we deliberately
**exclude `heal`** if heal is treated as a scarce/owner resource; default care set = `{feed, play, clean}`).

> **Time-window scoping caveat (verify):** depending on the final amendment, delegation may or may not carry
> a native *expiry*. Do **not** assume a built-in TTL. Ledgerlings therefore enforces the time window in
> **two re-derivable ways** regardless: (a) the owner submits the revoking `DelegateSet` at window end, and
> (b) Ledgerlings treats the **on-ledger grant ledger and the revoke ledger as the authority window** and the
> replay verifier honors only sitter actions that fall inside `[grant_ledger, revoke_ledger)` (§3.3). If the
> amendment ships a native expiry field, we additionally honor it. This makes "time-bounded" true even if the
> primitive itself has no TTL.

### 1.4 Revocation — and what to verify before building
- **Revoke** = the owner submits a `DelegateSet` that removes the care permission for that delegate (or
  removes the delegate entirely). It takes effect immediately and is itself an on-ledger, timestamped event.
- **Owner always retains full control.** Delegation never reduces the owner's own authority; the owner can
  feed/play/clean directly at any time and can revoke at any time.
- **Before building, verify on-chain:**
  1. Is the Permission Delegation amendment **enabled** on the target network? (`feature` / `server_info`
     → check the amendment's status is `enabled`, not just `supported`/voting.)
  2. The **exact transaction name and field layout** (`DelegateSet` vs. final spec name) — read the live
     amendment spec, do not trust this doc's names verbatim.
  3. Whether **granular per-transaction-type** (and ideally per-field) delegation is in the activated version,
     vs. only a coarser grant. Our scoping safety (§1.3) needs transaction-type granularity at minimum.
  4. Whether delegation carries a **native expiry**; if not, rely on the §3.3 window logic.

---

## 2. Pet-sitter design (product flow)

### 2.1 The story
You're going on vacation. Decay never pauses (`pet_rules.step()` applies decay on every interaction based on
elapsed ledgers since `last_ix`). Miss enough days and `health` hits 0 → `alive` flips 1→0, permanently
(no resurrection). **Pet-sitting = "don't let your pet die while you're away"** without handing anyone your
keys or your asset.

### 2.2 Flow **[DEPENDS-ON-DELEGATION]**
1. **Owner picks a sitter + a window.** In the Xaman xApp: choose a trusted `r...` address, set a window
   (e.g. "next 10 days").
2. **Owner grants scoped care.** App builds a `DelegateSet` granting the sitter **only** the care interaction
   permission (§3.2), excludes everything in §1.3, and (if supported) sets an expiry; owner signs in Xaman.
3. **Sitter cares for the pet.** During the window the sitter opens Ledgerlings, sees "you're sitting
   *Mochi* for `rOwner...`", and taps feed / play / clean. Each tap is a care interaction the sitter signs
   **with their own keys**, executing as a delegated action on the owner's behalf.
4. **Same rules apply.** The issuer's rules engine processes the sitter's interaction through the **exact same
   `step()`** — same decay, same cooldowns, same care accounting, same death logic. A sitter cannot over-feed
   (cooldown), can't farm a LEGENDARY, can't touch `form`/`loadout`.
5. **Owner revokes anytime.** On return (or early), owner submits the revoking `DelegateSet`. From that
   ledger on, the sitter is a stranger again → no-op.
6. **Everything stays auditable.** Grant, every sitter interaction, and revoke are all on-ledger.

### 2.3 What the sitter sees vs. can do
- **Sees:** the pet's public state + that they hold an active care delegation and its window.
- **Can do:** feed / play / clean (bounded by cooldowns, same as the owner).
- **Cannot do:** sell, transfer, breed, equip/change loadout, burn, heal (if heal is owner-scoped),
  re-delegate, or modify the dNFT directly (only the issuer writes state, exactly as today).

---

## 3. THE KEY FAIRNESS CHANGE — extending the authorized-actor set (handle precisely)

This is the heart of the doc. Today: **authorized actor = `owner`**. Pet-sitting requires:
**authorized actor = `owner` OR an actively-delegated sitter (within the on-ledger authority window).**
The fairness guarantee must survive the change: the new authority is itself **on-ledger, time-bounded,
revocable, and therefore re-derivable**, so the verifier can reproduce the exact same accept/reject decision
the issuer made — without trusting the issuer.

### 3.1 New concept: a re-derivable "authority oracle"
Introduce a pure function the **issuer and the verifier both compute identically** from on-ledger data:

```
is_authorized(sender, owner, now, delegations) -> bool
  # delegations: the on-ledger care-delegation events for THIS pet's owner, in ledger order:
  #   each = { delegate, grant_ledger, revoke_ledger (or +inf if still active),
  #            expiry_ledger (or +inf), perms (must include CARE) }
  if sender == owner: return True
  for d in delegations:
    if d.delegate == sender
       and CARE in d.perms
       and grant_ledger <= now < min(revoke_ledger, expiry_ledger):
         return True
  return False
```

`now` is the triggering interaction's **ledger_index** (the same deterministic clock the verifier already
relies on — see the SOUNDNESS NOTE in `replay_verify.py`). `delegations` is read from the owner's on-ledger
`DelegateSet` history. Because grants/revokes are timestamped ledger events, `is_authorized` is a **pure,
deterministic function of public ledger data** — exactly the property that keeps the game fair.

### 3.2 The care-delegation must be *scoped to care only*, and that scope must be re-derivable
Two implementation options; **prefer (A)**:

- **(A) Dedicated care-interaction permission (preferred).** The interaction is its own transaction type (or
  a `Payment`-with-`op`-memo whose delegated permission is specifically the Ledgerlings care op). The owner
  delegates **only** that. Selling/transfer/breed/equip are different transaction types and are **never**
  granted → the sitter literally cannot submit them as the owner. The verifier confirms `CARE in d.perms`
  straight from the `DelegateSet` object. **The ledger itself enforces scope; the verifier merely reads it.**

- **(B) Coarse `Payment` delegation + app-level memo discipline (fallback if granularity is limited).** If
  the activated amendment only delegates `Payment`, the sitter could in principle send other memos. We
  **mitigate, not eliminate:** the issuer's rules engine only ever interprets `op ∈ {feed, play, clean}` from
  a delegated sender and ignores everything else; and crucially **the rules engine never performs sell /
  transfer / breed / equip at all** — those are separate owner-signed transactions outside `step()`. So even
  under (B) a sitter cannot sell your pet, because *nothing in the care path can*. The residual risk under (B)
  is only that a coarse `Payment` delegation might let the sitter move *other* funds of the owner — which is
  why (A) is strongly preferred and (B) should pair with a near-zero-balance/holding constraint or be
  declined. **Verify which granularity the amendment ships and choose accordingly.**

### 3.3 Exactly how `pet_rules.step()` changes

**Today:**
```js
function step(state, op, now, sender) {
  const s = Object.assign({}, state);
  if (sender !== s.owner) return s;   // owner-only
  ...
}
```

**With pet-sitting** — thread the re-derivable authority in, keep the rest byte-for-byte identical:

```js
// authority is computed by the SAME pure function the verifier uses (§3.1),
// from on-ledger delegation events. step() takes the precomputed boolean so it stays pure & substrate-free.
function step(state, op, now, sender, authorized /* = is_authorized(sender, owner, now, delegations) */) {
  const s = Object.assign({}, state);
  if (!authorized) return s;          // <-- was: sender !== s.owner. owner OR active delegate ⇒ proceed; else no-op
  if (s.alive === 0) return s;
  // ... decay, death, action, cooldowns, care accounting, evolve() — ALL UNCHANGED ...
  // CARE accounting, cooldowns, [0,100] clamps, set-once form: identical for owner and sitter.
  return s;
}
```

Key properties preserved:
- **A non-delegated stranger is still a no-op.** `is_authorized` returns false → `return s` unchanged, exactly
  like today. The "stranger can't grief your pet" guarantee is intact.
- **A sitter is bounded by the same rules.** Cooldowns (`last_feed`/`last_play`), `[0,100]` clamps, monotone
  `care`/`care_max`, set-once `form` — none of these branch on *who* acted. A sitter cannot over-feed, cannot
  farm a rare form, cannot revive a dead pet.
- **`form` / `loadout` / sale untouched.** `step()` never reads `loadout` (cosmetic-only hard rule, unchanged),
  and sale/transfer/breed live entirely outside `step()` — so widening `step()`'s actor set cannot expose them.

> Implementation note: keep `step()` **pure** by passing `authorized` in (don't have `step()` do ledger I/O).
> The issuer computes it live; the verifier computes it during replay. Same function, same inputs → same result.

### 3.4 Exactly how the replay verifier changes (`replay_verify.py`)

Today the verifier feeds `(op, now, sender)` per interaction and `step()` self-checks `sender == owner`.
Two changes, both keeping it a pure re-derivation:

**(1) Read the delegation history too.** In `verify_pet(...)`, alongside the genesis mint URI and the care
Payments, also scan the **owner's** `DelegateSet` events for this pet and build the `delegations` list
(`delegate`, `grant_ledger`, `revoke_ledger`, `expiry_ledger`, `perms`). These are public ledger objects.

**(2) Re-derive authority per interaction and assert it matches.** In `replay(...)`:

```python
def replay(genesis_state, interactions, delegations):
    s = dict(genesis_state)
    owner = genesis_state["owner"]
    for op, now, sender in interactions:                 # ascending ledger order
        authorized = is_authorized(sender, owner, now, delegations)   # pure, from on-ledger data
        s = R.step(s, op, now, sender, authorized)
    return s
```

What this buys us — the fairness argument, stated precisely:
- The verifier reproduces **exactly the same accept/no-op decision** the issuer made for **every** interaction,
  because `is_authorized` is a pure function of public, timestamped ledger data (grant/revoke/expiry ledgers).
  The issuer cannot secretly honor an un-delegated sender (the replay would no-op it and **diverge** → flagged),
  and cannot secretly **ignore** a validly-delegated sitter (the replay would apply it and diverge if the
  issuer didn't).
- A sitter action **outside** its window (before grant, after revoke/expiry) is a no-op in replay → if the
  on-ledger state moved, `verify()` reports `DIVERGED` with the exact field, just like the existing cheat
  tests. So **time-bounding and revocation are enforced by re-derivation**, not by trusting the operator.
- A **non-delegated stranger** action is a no-op in replay → matches the unchanged "stranger = no-op" reality.

The existing self-tests (honest history ✅, inflated-care 🚨, hidden-death 🚨) all still pass; we add:
- **delegated-sitter honest history ✅** — owner grants, sitter feeds inside window → replay reproduces.
- **expired/revoked sitter action 🚨** — issuer applies a sitter feed after revoke → `DIVERGED` on the
  affected stat (e.g. `hunger`/`last_feed`).
- **un-delegated stranger "care" 🚨 if applied** — issuer applies a stranger's op → `DIVERGED`; if correctly
  no-op'd → `VERIFIED`.

### 3.5 Hook-mode equivalent (if Ledgerlings runs as a Xahau Hook)
In Hook mode the same widening is a one-line change to the authz check: the existing `prove_authz` invariant
("only `owner` interacts") becomes "**only `owner` OR an active on-ledger delegate** interacts," with the
delegation read from ledger state. The scope (care-only) and bounds (cooldown/monotone/overflow/set-once) are
**unchanged** and remain covered by `prove_period_budget` / `prove_monotonic` / `prove_overflow` /
`prove_set_once`. This upgrades the guarantee from *detectable* (dNFT replay) to *prevented* (ledger-enforced),
but the delegation primitive availability is the same gating concern.

---

## 4. Social angle — pet-sitting as a feature

- **Core hook:** *"Going away? Don't let your pet die. Hand a friend the keys to the litter box, not the
  house."* Scoped delegation is the perfect demo of "provable trust": the friend can care, provably can't
  steal.
- **Trust / reputation (optional, cosmetic):** track per-sitter **completed sits** and **pets kept alive
  through the window**, all derivable from public ledger history (grant → interactions → still-alive at
  revoke). Surface a sitter's "kept N pets alive" stat. Because it's re-derivable, the reputation is itself
  honest — no operator-controlled score.
- **Sitter reward — bounded, cosmetic, NOT pay-to-win (hard rule):** a successful sit can award the **sitter**
  a purely cosmetic badge/accessory NFTokenID that lives in the **loadout** (which `step()` never reads → can
  never touch stats or `evolve()`). Critically, **a sitter's care must not earn the sitter's own `care_score`
  on someone else's pet in a way that buys forms** — care accrues to **the pet** as always; the sitter's
  reward is a separate cosmetic mint. This keeps the provably-fair brand intact: rewards are visible flair,
  never a stat or evolution advantage. Cap rewards (e.g. one badge per completed sit) to avoid grind.
- **Anti-abuse:** the owner-revoke is one tap; a bad sitter is cut off immediately and the gap shows in the
  pet's decay (publicly visible). Cooldowns mean a sitter can't "spend" your pet's interactions wastefully
  faster than the rules allow anyway.

---

## 5. Fallback if Permission Delegation is NOT live (works today) — "Vacation Mode"

Until the amendment activates, ship pet-sitting with an **honest, weaker trust model.** Two options:

### 5.1 Issuer-mediated vacation mode (recommended fallback)
- The owner submits an on-ledger **"sit-grant" memo** to the issuer: *"authorize `rSitter...` to care for
  pet `<id>` until ledger `L` (or until I revoke)."* Owner-signed → its authenticity is on-ledger.
- The **issuer** (which already is the only writer of dNFT state) honors care interactions from `rSitter`
  **only while a valid, unexpired, un-revoked sit-grant exists** — applying the **same `step()` rules**.
- Revoke = an on-ledger "sit-revoke" memo from the owner.
- **This reuses §3 almost verbatim:** the `delegations` list is built from owner-signed **sit-grant/revoke
  memos** instead of `DelegateSet` objects; `is_authorized` and the verifier changes are **identical**. So
  the fairness/auditability story is the same: grant, sitter actions, and revoke are all on-ledger and
  re-derivable.
- **Honest trust trade-off:** the scope ("care-only") is **enforced by the issuer + checkable by the replay
  verifier**, but it is **not enforced by the ledger's own authorization layer** — there's no native
  `DelegateSet` object the ledger checks at signing time. A malicious *issuer* could ignore a sit-grant;
  but the **replay verifier catches that** (it would diverge), so this remains *detectable*, consistent with
  the dNFT mode's existing "detectable, not preventable" honesty. The sitter still **cannot** sell/transfer/
  breed/equip because — exactly as in §3.2(B) — those actions are owner-signed transactions the sitter simply
  cannot produce; the issuer never sells on a sitter's word.
- **Net:** this gives the *full feature today* with the *same verifiable-fairness guarantee* the project
  already ships (detectable cheating), and **no extra custody.** The only thing missing vs. real delegation is
  *ledger-level* (preventative) scope enforcement of who-may-care.

### 5.2 Co-sign / shared-control variants (note the trade-off, generally avoid)
- **Multisign hand-off:** owner adds the sitter to a SignerList — **rejected**: that grants control of the
  owner's *whole account*, the opposite of scoped. Don't do this.
- **Custodial vacation mode:** owner hands a session key / temporary signer to a Ledgerlings-run agent that
  feeds on a schedule — **possible but custodial**: now a third party holds signing power. Honest trade-off:
  convenient (auto-feed while away) but it breaks the "no keys to anyone" promise; offer only as an explicit,
  clearly-labeled opt-in, never the default.

**Recommendation:** ship **§5.1 issuer-mediated vacation mode now** (full feature, same fairness model),
and **upgrade the authority source from sit-grant memos to native `DelegateSet`** the moment Permission
Delegation activates — the `is_authorized` function and verifier don't change, only where `delegations` is
read from.

---

## 6. Honest status summary — what depends on what

| Piece | Depends on Permission Delegation amendment? | Works today? |
|---|---|---|
| Owner-only care (current behavior) | No | **Yes** (shipped: `sender !== owner` no-op) |
| `step()` taking a re-derivable `authorized` flag | No (pure-function refactor) | **Yes** — can land now |
| Verifier reading authority from on-ledger events + re-deriving | No | **Yes** — works against sit-grant memos now |
| **Issuer-mediated "vacation mode" (§5.1)** | No | **Yes** — full feature, detectable-fairness |
| Native scoped delegate (sitter signs as owner for care only) | **Yes** [DEPENDS-ON-DELEGATION] | **No** — until amendment enabled |
| Ledger-level (preventative) scope enforcement | **Yes** | **No** — until amendment enabled |
| Hook-mode authz widening to owner-OR-delegate | Same gating + Xahau Hook mode | Only in Hook mode |
| Sitter reputation (re-derivable) + cosmetic reward | No | **Yes** |

**Bottom line.** Pet-sitting can ship **today** via issuer-mediated vacation mode (§5.1) with the project's
existing verifiable-fairness guarantee — cheating remains *detectable* by anyone via the replay verifier, and
a sitter provably cannot sell/transfer/breed/equip because nothing in the care path can. When the Permission
Delegation amendment activates (**verify on-chain first — it is currently in voting, not enabled**), swap the
authority source to native `DelegateSet` for **ledger-enforced, preventative** care-only scope, with **zero
change** to `is_authorized` or the verifier. The single fairness-critical edit is widening
`step()`'s actor gate from `sender == owner` to a **pure, on-ledger-re-derivable** `owner OR active delegate`
— and that edit preserves every existing invariant: strangers stay no-ops, sitters stay bounded by the same
care rules, and the verifier still reproduces the on-ledger pet exactly or flags the exact diverging field.
