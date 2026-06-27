# Ledgerlings — Care-Bond / Staking via XRPL TokenEscrow (design)

*A provable commitment device: lock tokens that release ONLY if your pet stays alive (and/or
reaches a stage / hits a care threshold). "Skin in the game to keep it alive."*

> **Status (one line):** TokenEscrow (escrow of issued tokens/IOUs, not just XRP) is **LIVE on XRPL
> mainnet**. The honest hard part is **not** the escrow — it's wiring the escrow's release to a
> *provable fact about the pet's fair state*. XRPL escrow gives you a **time-gate** (`FinishAfter`)
> and an optional **crypto-condition** (a PREIMAGE-SHA-256 hashlock). It does **not** give you a
> native "release iff this dNFT field == ALIVE" predicate. So the bond is gated by a verifier that
> *publishes a release secret* (or signs an attestation) **only when the replay verifier proves the
> condition** — and the whole thing is auditable because the replay verifier is open + deterministic.

This feature is a **side-commitment**. It reads the pet's state; it **never writes it**. `step()` in
`build/pet_rules.js` is untouched and the replay verifier (`build/replay_verify.py`) is unchanged. The
pet's "provably fair" guarantee is the *input* to the bond, not modified by it.

---

## 0. TL;DR of the trust model (read this first)

| Release mechanism | Who can release | Trust assumption | Honest verdict |
|---|---|---|---|
| **Crypto-condition (PREIMAGE-SHA-256) + verifier-published preimage** | Anyone holding the preimage | You trust the **verifier/oracle** to publish the preimage **only when** the replay verifier says the condition holds — *but everyone can independently re-run the replay verifier and catch a wrong release* | **Recommended.** Honest "trust-minimized, not trustless": the *condition itself* is publicly recomputable, so a dishonest release is **detectable by anyone**, matching the dNFT mode's existing "detectable, not preventable" honesty. |
| **Issuer-attestation (no condition; issuer finishes)** | The game-issuer account only | You trust the issuer to call `EscrowFinish` honestly | Simplest. Same detectability (replay verifier catches a bad finish) but the issuer is a single point of liveness *and* the only finisher. |
| **Pure `FinishAfter` only (no condition)** | Anyone, after the time | **No condition at all** — releases on time regardless of pet state | **Not a care-bond.** This is just a timelock. Useful only as the *cancel/refund fallback*, never as the success path. |
| **On-ledger Hook predicate (Xahau mode)** | The ledger itself | None beyond "the Hook is the proven code" (PROOF_VOID if swapped) | **Strongest, future.** Only on Xahau-Hook mode; XRPL mainnet escrow can't read the dNFT in-protocol. |

There is **no** way on XRPL today to make an escrow's release a *native function of the dNFT's `alive`
byte*. Anyone who claims "the ledger enforces the bond" is overclaiming. What we ship is: **the
release is gated on a fact that the whole world can recompute and that the operator cannot fake
undetectably.** That is the same honesty bar as the rest of Ledgerlings.

---

## 1. TokenEscrow mechanics (the primitives we build on)

XRPL `EscrowCreate` / `EscrowFinish` / `EscrowCancel`, extended by the **TokenEscrow** amendment to lock
**issued tokens (IOUs / trustline balances)** as well as XRP. Relevant fields and rules:

### `EscrowCreate`
- **`Amount`** — what's locked. With TokenEscrow this can be an **issued-currency amount**
  `{ "currency": "...", "issuer": "r...", "value": "X" }`, not only drops. The funds leave the
  creator's spendable balance and sit in the escrow object until finished or cancelled.
- **`Destination`** — who receives the funds on a successful `EscrowFinish`. (For a self-bond this is
  the owner's own account; for a challenge pool it's the pool account.)
- **`FinishAfter`** — a ledger close-time (Ripple-epoch seconds). `EscrowFinish` is **rejected before**
  this time. This is the **"survive for N days" clock.**
- **`CancelAfter`** — optional close-time after which `EscrowCancel` is allowed (funds return to the
  **creator**). This is the **failure/expiry path.** Must be **after** `FinishAfter` if both are set.
- **`Condition`** — optional **crypto-condition** (PREIMAGE-SHA-256 fulfilment hash, the hash of a
  secret preimage). If present, `EscrowFinish` must supply a matching **`Fulfillment`** (the preimage)
  or it fails. This is the only place XRPL lets an *arbitrary external fact* gate a release: whoever
  controls the preimage controls the finish.

### `EscrowFinish`
- Allowed **only at/after `FinishAfter`** (if set) **and** only with a valid **`Fulfillment`** (if a
  `Condition` was set). Pays `Amount` to `Destination`.
- **Anyone can submit `EscrowFinish`** (it's not restricted to the creator/destination) — they just
  need to satisfy time + condition and pay the fee + the per-fulfillment-byte fee surcharge. This
  matters: with a condition, the *first party to learn the preimage* can finish; without one, anyone
  can finish once the time passes.

### `EscrowCancel`
- Allowed **only at/after `CancelAfter`** (if set). Returns `Amount` to the **creator**. Anyone may
  submit it. If `CancelAfter` is unset, the escrow can **never** be cancelled (funds only ever leave
  via finish) — relevant for "forfeit on death" designs.

### TokenEscrow gotchas (verify before mainnet)
- **Token must be transferable/trustline-compatible** to the destination; **frozen** trustlines or a
  destination lacking the trustline can block finish — confirm both parties hold the trustline.
- **Transfer fees / rippling:** issued-token escrows interact with the issuer's `TransferRate`. The
  amount delivered can differ from the amount locked if a transfer fee applies. **Verify the exact
  delivered amount semantics for your token** (ideally use a no-transfer-fee bond token, see §6).
- **`FinishAfter` granularity is ledger close-time (seconds), not ledger index.** Our pet clock is in
  **ledger sequence** (`birth_ledger`, `LEDGERS_PER_DAY`). These two clocks must be reconciled — see
  §3.3. Do **not** assume "N days of ledgers" == "`FinishAfter` = now + N·86400"; close-time drifts.
- **One escrow object per (account, sequence).** Track the `OfferSequence`/owner+sequence to build the
  `EscrowFinish`/`Cancel`.
- **Reserve:** each escrow object increments the creator's owner reserve until resolved.

---

## 2. The care-bond design

### 2.1 The commitment
The owner locks **X** of a bond token in an escrow at pet genesis (or at any stage boundary). The
escrow encodes:

- **Term:** `FinishAfter = T_release` — the ledger-time corresponding to "**N days from now**" (or
  "when the pet should have reached stage S").
- **Success predicate P** (the thing we actually care about), **evaluated by the replay verifier** at
  the target ledger `N_target`:
  - `alive == 1` (the baseline "kept it alive"), and/or
  - `stage >= S` (e.g. reached ADULT), and/or
  - `care_score / care_max >= K` (e.g. ratio ≥ 75 → at least RARE-tier care quality), and/or
  - `form >= F` (reached at least a target evolved form).
  P is a pure boolean over the **same on-ledger-derived state** the replay verifier already produces.

### 2.2 The payouts
- **Success (P true at `N_target`):** the escrow finishes to **`Destination`**. For a self-bond,
  `Destination = owner` → the owner **gets the bond back** (optionally **+ a bonus** drawn from a
  separate reward pool, paid as a second transaction — escrow itself only returns the locked amount).
- **Failure (pet dead / P false):** the bond is **forfeit**. Three honest options for "forfeit":
  1. **To a pool account** (`Destination = pool`) — survivors split it (see §4 challenge bonds);
  2. **Burned** — `Destination` = a black-hole / issuer account that retires the token (cleanest
     "the stake is gone");
  3. **To charity** — `Destination` = a published charity account.
  The forfeit path is realized by **letting the success-condition expire**: if P is false the verifier
  **never publishes the preimage**, the success finish is impossible, and a **`CancelAfter`-gated
  second escrow** (or a pre-committed forfeit-finish, see §3.4) routes the funds to the forfeit
  destination. The exact wiring is the crux — §3.

### 2.3 Why this is a real commitment device
The owner cannot get the bond back *unless* the pet's **fair, publicly-recomputable** state satisfies
P. They can't fake `alive`/`care_score` (issuer-only `NFTokenModify`, and any operator deviation is
caught by the replay verifier). They can't withdraw early (`FinishAfter`). So the only way to recover
the stake is to **actually keep the pet alive / thriving** under the unmodified rules. That's the
"skin in the game."

---

## 3. THE KEY — making the release VERIFIABLE + DETERMINISTIC

### 3.1 The fact we're gating on already exists
`build/replay_verify.py` already does exactly this computation: pull the pet's full on-ledger history
(every interaction Payment + every `NFTokenModify`), re-execute the open deterministic rules
(`build/pet_rules.js`, byte-faithful to `pet_rules.py`) from genesis, and produce the **canonical pet
state at any ledger N**. "Is the pet ALIVE at ledger N?", "what is `stage`/`care_score` at ledger N?"
are **already deterministic outputs** of the verifier, derivable by anyone, with no operator input.

So the care-bond does **not** introduce a new trusted computation. The success predicate P is just a
boolean read of the verifier's existing output. **This is the whole pitch:** the hard part of any
"prove a real-world condition to an escrow" oracle problem — *is the condition objectively
computable?* — is already solved here, because the pet's state is a deterministic function of public
ledger data under an anchored ruleset.

### 3.2 Composition guarantee (does NOT alter the pet)
- The bond reads `replay_verify` output. It **never** calls `NFTokenModify`, never injects an
  interaction, never touches `step()`. The escrow lives in a **separate** account-owned object on the
  ledger and is invisible to the rules engine.
- Formally: for any interaction history H, `step*(H)` (the folded pet state) is **identical** whether
  or not a bond escrow exists. The bond is a **pure observer** of `step*(H)` at `N_target`. We assert
  this the same way `loadout` is asserted cosmetic-only: the rules engine has **no read path** to any
  escrow object, so a bond cannot influence stats, decay, death, or evolution. (Add this to the
  replay-verifier's invariant set: "no escrow object id appears in any `step()` input.")
- Consequence: **bonds can't pay-to-win.** A whale staking 10,000 tokens does not make their pet
  decay slower or evolve higher. The bond changes the *owner's* incentives, not the *pet's* physics.

### 3.3 Reconciling the two clocks (ledger-seq vs close-time)
The pet ages in **ledger sequence**; escrow `FinishAfter` is **close-time seconds**. Honest handling:
- Pick the **success target as a ledger sequence** `N_target` (e.g. `birth_ledger + N·LEDGERS_PER_DAY`)
  — this is what the replay verifier evaluates P at, and it's the canonical, deterministic anchor.
- Set the escrow `FinishAfter` to the **close-time of (a few ledgers after) `N_target`** with a safety
  margin, because close-time/sequence drift. The escrow's time-gate should open **no earlier** than
  `N_target` is finalized so the preimage can't be published before the fact is real.
- `N_target` (sequence) is the **source of truth for P**; `FinishAfter` (time) is only a
  *can't-finish-before* guard. Document this asymmetry; never gate correctness on close-time math.

### 3.4 The release wiring — three honest mechanisms

#### A. Crypto-condition + verifier-published preimage (RECOMMENDED)
1. **Create.** The owner creates the success escrow with:
   - `Amount = X bond-token`, `Destination = owner` (self-bond) or `pool`,
   - `FinishAfter = closeTime(N_target)+margin`,
   - `Condition = SHA-256-hash(secret)` where **`secret` is held/derived by the verifier-oracle** and
     bound to "P(pet, N_target) == true". (The secret can be a per-bond random value the oracle
     committed to at create time, *or* deterministically `HMAC(oracle_key, bond_id)`.)
   - A **forfeit escrow** (or a `CancelAfter` on this same escrow) routes funds to the forfeit
     destination if the success path never fires (see "Failure," below).
2. **At `N_target`.** Anyone (including the owner) runs `replay_verify` on the pet up to `N_target`.
   The **oracle** also runs it. **Iff** P is true, the oracle **publishes the preimage** (e.g. posts it
   in a memo / on a public endpoint / via a `Payment` memo to the owner).
3. **Finish.** The owner (or anyone) submits `EscrowFinish` with the `Fulfillment = secret`. Funds go
   to `Destination`. **Done — bond returned.**
4. **Failure.** If P is false, the oracle **refuses to publish** the preimage → the success escrow can
   never finish → at `CancelAfter` the funds route to the **forfeit destination** (either via
   `EscrowCancel` returning to creator *then* an auto-forfeit, or — cleaner — by making the *success*
   escrow's `Destination` the **pool/charity/burn** and the **owner the creator who only gets it back
   if they could cancel**, with `CancelAfter` set such that cancel is *only* reachable on the success
   timeline; the precise routing is chosen per variant in §4).
   - **Trust note:** anyone can re-run `replay_verify`. If the oracle publishes the preimage when P is
     *false* (wrongful release), the world sees a finished bond whose pet was provably dead → the
     oracle is **caught**. If the oracle withholds the preimage when P is *true* (wrongful forfeit),
     the world sees a forfeited bond whose pet provably thrived → the oracle is **caught**. The oracle
     has **no undetectable cheat**, exactly mirroring the issuer's position in dNFT mode. This is the
     honest ceiling on XRPL mainnet.
   - **Reducing oracle power further:** use **m-of-n oracles** with a published preimage split (k-of-n
     secret sharing) so no single operator can mis-release; or let the **owner themselves** be one
     oracle for the *success* direction (they can always prove their own success) while a neutral
     party guards the *forfeit* direction. Threshold-publishing turns "trust one operator" into
     "trust that a quorum colludes," and collusion is still publicly detectable.

#### B. Issuer-attestation (issuer is the finisher)
No `Condition`. The escrow `FinishAfter`s, and the **game-issuer account** is the party that submits
`EscrowFinish` to `Destination = owner` **iff** its own `replay_verify` says P holds; otherwise it
lets `CancelAfter` route to forfeit. Simpler (no crypto-condition plumbing) but the issuer is the sole
finisher and a liveness dependency. Same detectability. Good for v1 / small bonds.

#### C. Hook predicate (Xahau-Hook mode only, future)
In Xahau-Hook mode the pet state is **HookState**, and a small **bond Hook** can read it in-protocol
and emit/permit the finish **iff** `alive`/`stage`/`care_score` satisfy P at the trigger ledger —
gated by an `xahc-prover` driver. This is **enforced, not merely detectable**, and binds to the
deployed `HookHash` (PROOF_VOID if swapped). Not available on XRPL mainnet; documented as the upgrade
path, consistent with `STATE_MACHINE.md`'s two-mode honesty.

### 3.5 What's deterministic vs trusted (be precise)
- **Deterministic & trustless:** the pet's state at `N_target` (anyone recomputes it from ledger data
  + anchored rules). The predicate P over that state. The time-gate. The fact of a finish/cancel
  (it's on-ledger).
- **Trusted (mechanism A/B):** that the party controlling the preimage/finish **acts honestly**. This
  trust is **bounded by detectability** — they cannot cheat without leaving a publicly provable
  contradiction. Threshold oracles shrink it further. **Only mechanism C removes it.**
- We **never** claim the escrow itself "knows" the pet is alive. It doesn't. It knows a time and a
  hash. The *binding* of that hash to a true fact is the verifier's job, and that job is **publicly
  auditable**. State this plainly in the xApp UI.

---

## 4. Variants

### 4.1 Solo self-bond (discipline device)
- One owner, one pet, one bond. `Destination(success) = owner`; `forfeit → burn or charity`.
- Pure commitment device: "I'm betting myself X that I keep this pet alive 14 days." No counterparty.
- Cleanest forfeit = **burn** (stake is genuinely gone) or **charity** (published account), so there's
  no incentive for anyone to want the pet to die.
- UI framing: a personal accountability streak. Optional small **bonus** on success from a sponsor
  pool to make it +EV for good caretakers.

### 4.2 Social / challenge bonds (survivor-split pool)
- N owners each escrow X into (or toward) a **shared pool account** for a fixed cohort term.
- At `N_target`, the verifier computes P for **every** pet in the cohort. **Survivors** (P true) split
  the **forfeited** bonds of the **non-survivors**, pro-rata or evenly, **plus** their own stake back.
- Mechanics: each entrant's success escrow returns their own stake; each entrant's **forfeit** routes
  to the pool; a **distribution step** (a Batch of Payments, or a settlement Hook in Xahau mode) pays
  survivors from the pool. The distribution amounts are a **deterministic function of the verifier's
  cohort result**, so the split is itself auditable ("you can recompute who survived and what each is
  owed").
- This is the most viral variant: leaderboard + real stakes + provable fairness ("the payout table is
  recomputable from chain"). Caution: keep it a **skill/care** challenge, not a wager on randomness —
  the deterministic care path (no hidden RNG) is what makes it defensible.

### 4.3 Sponsor bonds
- A **sponsor** (brand, community, the game itself) funds the **bonus pool** or the **whole bond** on
  behalf of caretakers. "Keep your adopted pet alive 30 days, sponsored by X → claim the reward."
- `Destination(success) = owner`, funded by sponsor; forfeit returns to sponsor or rolls into next
  cohort. Sponsor gets a provable, anti-sybil-ish engagement metric (you can't fake a 30-day fair-care
  record). Good growth/partnership hook.
- Anti-sybil note: bonds make sybil farming **costly** (real stake per pet) and **provable** (fair
  care record required), but don't fully prevent it — pair with per-account/per-pet limits.

---

## 5. Architecture (create / finish flow + proof surface)

### 5.1 Components
- **`build/pet_rules.js`** — unchanged. The shared deterministic rules.
- **`build/replay_verify.py`** — unchanged. Add a thin wrapper/CLI flag `--predicate` /
  `--at-ledger N_target` that returns the **boolean P** (and the full state) at `N_target`. This is
  the only new code that touches the verifier, and it's read-only.
- **Bond service / oracle** (new, off-ledger) — for mechanism A/B: runs `replay_verify`, and either
  **publishes the preimage** (A) or **submits `EscrowFinish`** (B) when P holds; otherwise stands down
  so the forfeit path fires. Should be **stateless w.r.t. truth** (it derives P fresh from chain).
  Should publish, per bond, the `(pet_id, N_target, P-definition, condition-hash, escrow ids)` so
  anyone can audit.
- **xApp UI** — "Place a care-bond" (pick term, predicate, amount, forfeit destination), "Bond
  status" (shows P live as computed client-side by the same replay logic), and **"Verify this bond"**
  (re-runs `replay_verify` in-browser, shows P, and shows whether the on-ledger finish/cancel matches
  what P dictates → flags any oracle deviation).

### 5.2 Create flow (mechanism A, self-bond)
1. UI computes `N_target = birth_ledger + N·LEDGERS_PER_DAY` and the predicate P.
2. Oracle commits a per-bond `condition = SHA256(secret)`; UI shows the commitment + P + ids.
3. Owner signs **`EscrowCreate`**: `Amount=X`, `Destination=owner` (success) , `FinishAfter=closeTime(N_target)+margin`,
   `Condition=condition`, `CancelAfter` set for the forfeit timeline (per variant routing in §3.4).
4. Escrow object now on-ledger; UI tracks it. Owner cares for the pet normally (ordinary interactions;
   the bond is invisible to `step()`).

### 5.3 Finish / forfeit flow
1. At/after `N_target`, **anyone** runs `replay_verify --at-ledger N_target --predicate P`.
2. **P true:** oracle publishes `secret`; owner (or anyone) submits **`EscrowFinish`** with
   `Fulfillment=secret` → stake (+ optional bonus tx) to owner.
3. **P false:** oracle withholds; at `CancelAfter` the forfeit routing executes (cancel-to-creator
   then auto-forfeit, or direct pool/burn/charity destination per the variant). Survivor distribution
   (4.2) is a deterministic settlement step.
4. **Audit:** the "Verify this bond" panel re-derives P and asserts the on-ledger outcome matches.
   Mismatch ⇒ the oracle is **publicly caught** (wrongful release or wrongful forfeit).

### 5.4 Proof surface (how the condition is "proven")
- **The condition's *computability* is proven by construction:** P is a pure function of the same
  inputs the replay verifier already consumes; the rules engine version is **anchored to the ledger**
  (proof-transparency log, per `STATE_MACHINE.md`), so the oracle can't backdate/swap the rules that
  define P.
- **The condition's *enforcement* is**: detectable (mechanism A/B) or enforced (mechanism C). We label
  each in the UI. We do **not** dress up A/B as trustless.
- Optional: register each bond's `(pet_id, N_target, P, condition-hash)` in the proof registry so the
  bond's definition is anchored too, not just the ruleset.

---

## 6. Honest status, gotchas, and what to verify

**Status.** TokenEscrow (issued-token escrow) is **live on XRPL mainnet**. Plain XRP escrow with
`Condition`/`FinishAfter`/`CancelAfter` is long-live. The replay verifier already computes the exact
fact the bond needs. So the building blocks exist **today** in dNFT mode; nothing here needs Hooks.

**The honest limitation.** XRPL mainnet escrow **cannot read the dNFT in-protocol**, so the success
predicate is enforced by an **oracle/issuer** (mechanism A/B), which is **trust-minimized and
fully auditable**, not trustless. Only Xahau-Hook mode (C) makes it ledger-enforced. We must say this
plainly and never claim "the ledger guarantees you get your bond back iff the pet lives."

**Gotchas to verify before mainnet:**
1. **Which token.** Use a **bond token with `TransferRate` = 0 (no transfer fee)** and clean rippling,
   so the delivered amount == locked amount. Verify both parties (creator, all destinations incl. pool
   /charity/burn) hold the trustline and aren't frozen. Confirm TokenEscrow's exact delivered-amount /
   transfer-fee semantics on the **current mainnet amendment**, not docs memory.
2. **`FinishAfter` granularity.** It's **close-time seconds**, while P is evaluated at a **ledger
   sequence** `N_target`. Reconcile per §3.3: `N_target` is canonical for P; `FinishAfter` is only a
   no-early-finish guard with margin. Never compute correctness from close-time arithmetic.
3. **Who triggers finish.** With a `Condition`, **whoever holds the preimage can finish** (anyone) —
   ensure the preimage is only published when P holds, and consider who is *incentivized* to submit
   the finish (owner for self-bond; pool keeper for challenge). Without a condition, **anyone can
   finish after the time regardless of state** → that's not a care-bond, only a fallback.
4. **Forfeit routing correctness.** The "P false ⇒ forfeit" path is the subtle part: an escrow's
   *cancel* returns to the **creator**, not to a pool, so "forfeit to pool/burn/charity" needs the
   success-escrow's `Destination` to *be* the forfeit target with a release secret the owner only gets
   on success — **model this carefully per variant and test on testnet** (success returns to owner;
   non-success leaves funds reachable only by the forfeit destination/time). Get an XRPL escrow review
   before mainnet.
5. **Oracle integrity.** Single-oracle = single point of (detectable) failure + liveness. Prefer
   **m-of-n threshold preimage publishing**; publish the bond definition + ruleset anchor so every
   release is independently re-checkable.
6. **Reserves & object lifetime.** Each escrow holds owner reserve until finished/cancelled; an escrow
   with no `CancelAfter` can **never** release except via finish — intentional for some burn designs,
   a footgun otherwise.
7. **Reconfirm against live amendment state** (TokenEscrow flags, transfer-fee handling, and whether
   any later amendment changed escrow semantics) using the live Xahau/XRPL reference rather than
   training memory before writing the create/finish builders.

**Composition guarantee restated.** The bond is a **pure observer**. `step()` and `replay_verify`'s
state derivation are byte-identical with or without any bond. Add a one-line invariant to the verifier
suite: *no escrow object id is ever an input to `step()`* — same discipline as "`loadout` is
cosmetic-only." Bonds change incentives, never the pet's physics. No pay-to-win.
