# Ledgerlings — Make Waves MVP (XRPL Commons hackathon, 90 days from 2026-06-21)

*The provably-fair on-chain pet. Built on the existing PROJECT.md; this is the hackathon-winnable scope.*

## Distribution unlock — ship it as a Xaman xApp (the "gets users" lever)
Make Waves scores on **users**, and the hardest part of any on-chain game is distribution. Solve it by
shipping Ledgerlings as an **xApp that runs inside Xaman** (the dominant XRPL/Xahau wallet) — instant access
to a large, wallet-native, sign-ready user base, no install. The name pivots for free: **"Ledgerlings" now
reads as Xaman + Tamagotchi** (not Xahau), so the brand nods directly to the wallet it lives in. Dane has a
warm Wietse / XRPL Labs relationship (see memory `project_xaman_simulate_integration`) — a real path to xApp
placement. *This is the single biggest "gets users" advantage in the whole entry.*

## The wedge (why this places, not just participates)
Make Waves scores on "**runs on XRPL and gets users.**" Two levers, and this hits both with one thing
nobody else in the field can ship:
- **Gets users:** a Tamagotchi is *inherently viral* — you adopt one, name it, it ages, it can die if you
  neglect it, you share it. Pets are the most-shared genre in mobile history.
- **The unfair advantage:** it is **provably fair**. Every other on-chain game asks you to trust the
  rules. This one's rules are a Hook, and the fairness is a **theorem** — the pet can't be rugged,
  secretly nerfed, resurrected, or rigged. *"The first provably-fair pet" is a headline a judge repeats.*

## ⚠️ Eligibility — confirm before the clock burns
The pet is a **Xahau Hook** (XRPL mainnet has no Hooks). **First action: ask XRPL Commons whether Xahau
qualifies** (it's XRPL's sister chain; usually yes). If Xahau is OK → ship as designed. If XRPL-only →
fallback in the appendix (on-ledger committed state + verifiable scheme, weaker "provable", still works).

## What makes this fast: the prover is ~80% already built
The pet is a stateful Hook evolving over time — exactly the class hardened this week. The proof set maps
**1:1 onto existing committed drivers**, so the verification (the hard, differentiating part) is mostly
done; the MVP is mainly the pet Hook + a frontend.

| Provably-fair claim | Existing driver |
|---|---|
| Age only increases; an elder can't revert; dead stays dead | `prove_monotonic` |
| Only the owner can interact with their pet (no griefing/hijack) | `prove_authz` / `prove_owner_state` |
| Evolution happens once and is frozen (no re-roll for a rarer form) | `prove_set_once` |
| No infinite farming — feed/XP cooldowns can't be bypassed | `prove_period_budget` (cumulative-cap) |
| Stats stay in `[0,max]`; no overflow/underflow corrupts the pet | `prove_overflow` / bounds |

So Phase-1 proving is **mostly re-skinning + re-running** drivers you already trust.

## The killer feature (ties in this week's work) — "Verify my pet"
A button next to the pet. Tap it and:
1. it resolves the pet's deployed **HookHash** and looks it up in the **proof registry** (`registry.status_of`)
   → shows the proven invariants + the honest residual;
2. it confirms the **deployed bytecode == the proven bytecode** via the manifest binding — and if the pet's
   Hook were ever swapped, it flips **PROOF_VOID** ("this is not the pet whose fairness was proven");
3. the registry head is **anchored on Xahau** (proof-transparency), so the fairness record can't be
   backdated — not even by you.
This is `trust()` for a pet. No other hackathon entry can show "tap to mathematically verify the game is
fair, bound to the live code." It also quietly demos your whole VaaS stack to exactly the right audience.

## The provably-fair MECHANIC (the headline detail)
- **Care → evolution is DETERMINISTIC** from on-chain care history (feed/play/clean counts, neglect
  windows) — no hidden server RNG. Great care → a rarer adult/elder form; neglect → a lesser one. The
  function is in the Hook, and `prove_set_once` + the deterministic-transition proof show **the rare form
  can never be minted on a path that didn't earn it.** That is the "no rug" theorem.
- **If any randomness is wanted** (e.g. which of two baby forms hatches): a **commit-reveal** seeded by a
  future ledger hash the owner can't predict or grind, and prove the reveal can't be re-rolled
  (`set_once`) and is bound to the committed seed. Fairness of the randomness is itself proven — a feature
  you *show off*, not hide.

## MVP scope (ships in 90 days)
- **The pet Hook** (Xahau, C→WASM via xahc): HookState = hunger · happiness · health · age · stage ·
  alive · last-interaction-ledger · care-score. Interactions via Invoke+memo (feed/play/clean/heal).
  Ledger-time decay; neglect → death; age → stage progression (egg→baby→teen→adult→elder→passing).
- **The proofs:** the 5 claims above, run + a signed cert per invariant in the registry, head anchored.
- **The frontend** (single-page, hostable on Evernode or static): adopt a pet, see it + its stats +
  stage, sign feed/play txns, and the **"Verify my pet"** panel (registry status + live HookHash binding).
- **Each pet a URIToken** (identity + collectible + shareable link). Optional: a public gallery.
- **Testnet deploy** + a demo pet living/aging/dying on real ledger hashes.

## 90-day milestone plan (start 2026-06-21 → submit ~2026-09-19)
- **Weeks 1–2** — confirm Xahau eligibility; finalize the pet Hook state machine + the care→evolution
  function; build the Hook; first interactions on testnet.
- **Weeks 3–4** — prove the 5 invariants (re-skin existing drivers), register + anchor the certs, wire the
  `Verify my pet` lookup. *The differentiator is done by week 4.*
- **Weeks 5–7** — frontend: adopt/feed/play, live state read, the verify panel, URIToken-per-pet.
- **Weeks 8–10** — get users: shareable pet links, a gallery/leaderboard, "adopt a provably-fair pet"
  launch on X (you have the audience + the Will/XRPL-Commons goodwill), a 60-sec demo video.
- **Weeks 11–12** — polish, harden, traction metrics (adoptions/interactions = the "gets users" proof),
  submission writeup leading with the theorem-not-promise angle + the live verify demo.

## Why it wins (the judge's takeaway)
"Most entries are a token or a dashboard. This is a game people actually play **and** the first one whose
fairness is a mathematical proof you can check on-chain, bound to the live code. It's fun, it has users,
and it's the only entry that couldn't be faked." That's the rare combination Make Waves rewards.

## Honest scope guards (don't over-commit alongside the Scott push)
- Phase-1 MVP = pet Hook + 5 proofs + a thin frontend + testnet. **Not** breeding, marketplaces, or full
  evolution trees — those are post-hackathon depth.
- The "provable RNG" is only if a hatch needs randomness; the deterministic care→form path needs none and
  is the stronger story — lead with it.
- Reuse the committed drivers; resist building new prover capability for the pet (the moat's already there).

## Appendix — XRPL-only fallback (if Xahau is ineligible)
No Hooks on XRPL, so "the Hook is the game" doesn't hold. Fallback: pet state in a committed, hash-chained
off-ledger log whose head is anchored to XRPL (the same proof-transparency primitive), with the
state-transition rules open-source + a verifier anyone runs. Weaker than a Hook (the transition isn't
enforced on-ledger), but still "verifiable fairness, anchored on XRPL." Decide only after the eligibility answer.
