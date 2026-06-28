# Make Waves — submission entry (XRPL-native, paste-ready)

*Filled XRPL-first so it qualifies without the Xahau eligibility question. The Xahau-Hook variant (stronger) is noted at the end — use it only if organizers confirm Xahau counts.*

---

**Project name:** Ledgerlings — *the provably-fair on-chain pet*

**Tagline (one line):**
A virtual pet that lives on the XRP Ledger — you raise it, it ages, it can die if you neglect it, and its fairness isn't a promise, it's something you can check on-chain.

**Category:** Gaming & on-chain rewards

**The problem:**
Every web2 pet game can quietly change the rules, nerf your pet, rug a reward, or shut down the server. Even "on-chain" games usually ask you to trust an off-chain backend. Players have no way to verify the game treated them fairly.

**What it is / what it does:**
Ledgerlings is a virtual pet creature that lives on the XRP Ledger. You adopt one (it's an XRPL NFToken), and you raise it with simple on-ledger interactions — feed, play, clean, heal. It ages through lifecycle stages over ledger-time (egg → baby → teen → adult → elder), and neglect can kill it. How well you care for it deterministically decides which rarer adult/elder form it evolves into — no hidden RNG, no server.

The twist: **"Verify my pet."** A button that, on-chain, lets anyone confirm the game is fair — the rules are open and deterministic, every state transition is reproducible from the public ledger, and the fairness record is **anchored on the XRP Ledger** so it can't be backdated or quietly edited (not even by us). Fairness you re-derive yourself, not a badge you trust.

**How it runs on XRPL (the integration — honest + specific):**
- **Each pet is a Dynamic NFToken (XLS-46).** Minted mutable from the game-issuer account; the pet's full state (stage, hunger/happiness/health, age, care-score, evolved form, alive) lives in the NFToken's URI and is updated on-ledger via **`NFTokenModify`** as the pet ages and evolves — one tx per state change, a complete public audit trail. The pet is a genuinely *dynamic* on-chain creature.
- **Interactions are XRPL Payments + memos** (op = feed/play/clean/heal), owner-signed → owner-only by construction. **Escrow (FinishAfter)** for deterministic time-gates (hatching/cooldowns); **NFTokenCreateOffer/Accept** for adopting/gifting/trading pets.
- **Fairness = a public replay verifier.** The rules engine is open-source, versioned, and its version hash is **anchored to the XRP Ledger**. Anyone runs `verify(pet)`: re-execute the open deterministic rules over the pet's on-ledger interaction history and assert the result matches the on-ledger dNFT state at every step. Players can't cheat (issuer-only modify); the operator can't cheat *undetectably* — any deviation from the anchored rules is flagged. Fairness you re-derive yourself, not our word.

**How it gets users (the "gets users" lever):**
- Pets are inherently viral — adopt, name, share a link to your living pet; a public gallery + a "best-cared-for / rarest" leaderboard.
- A launch on X to my existing XRPL/Xahau audience (and the goodwill from the community shoutouts this week).
- The hook nobody else has: *"adopt the first provably-fair pet on XRPL — and tap to check the fairness yourself."*

**Why it's novel / why it wins:**
Most entries are a token, a dashboard, or a game you must trust. This is a game people actually play **and** the only one whose fairness is a checkable, on-ledger fact bound to the live rules. Fun + real users + couldn't-be-faked — the exact combination Make Waves rewards. It also showcases a verification primitive (anchored, re-derivable proof) that the broader XRPL ecosystem is actively elevating (RippleX now gates mainnet amendments on formal verification).

**Tech stack:**
- XRPL testnet/mainnet: **Dynamic NFTs (XLS-46, `NFTokenModify`)** for the evolving pet state, Payments+memos for interactions, Escrow for time-gates, NFToken offers for trading · xrpl.js / xrpl-py.
- Open-source, versioned deterministic rules engine + a client-side **replay verifier** + a hash-chained, **XRPL-anchored** proof-transparency log (already built — `registry/anchor.py` in xahc-prover).
- Single-page web frontend (adopt / feed / play / **verify**), hostable static or on Evernode.

**Team:**
Dane Brown — solo builder (kairovault.com). Background: XRPL/Xahau data + formal-verification tooling for on-chain Hooks (xahc-prover, xahau-mcp, x402-xahau). Bringing the "verifiable fairness" angle nobody else in the field has.

**Status / demo plan:**
Verification + proof-anchoring primitives already built and tested. 90-day plan: pet rules + NFToken integration → testnet pet living/aging/dying on real ledger hashes → the "Verify my pet" panel → public adopt/share launch + traction metrics.

**Links:** kairovault.com · (repo + live testnet demo to be added) · contact: @Cryptocrazy589 / daner3@gmail.com

---

## STRONGER VARIANT — only if XRPL Commons confirms Xahau qualifies
If Xahau (XRPL's sister chain) is eligible, swap the rules engine for a **Xahau Hook**: the fairness stops being merely *verifiable* and becomes *enforced by the ledger* — the Hook IS the game, no server at all, and xahc-prover proves the rules (age-monotonic, owner-only, set-once evolution, no-farming, bounded stats) for ALL inputs, bound to the deployed HookHash (flips PROOF_VOID if the pet's code is ever swapped). Same submission, one notch stronger. Lead with the Xahau version if it's allowed; default to the XRPL-native version above if not.
