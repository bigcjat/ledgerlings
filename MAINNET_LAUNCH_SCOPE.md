# Ledgerlings — testnet → XRPL MAINNET launch scope (2026-07-22)

Goal: pass the Make Waves "Mainnet Gate" (a live mainnet tx from the project) and be able to onboard
real users. Recon: `build/server.js` is network-agnostic — endpoint + issuer are env vars
(`XRPL_ENDPOINT` defaults testnet `wss://s.altnet.rippletest.net:51233`; `LEDGERLINGS_ISSUER_SEED`).
So the delta is **config + funding + key security**, not a rewrite. Everything below is XRPL-native
(no Hooks, no Batch/XLS-56, no Permission Delegation — all confirmed NOT on mainnet in the repo docs).

## ✅ GATING QUESTION — RESOLVED (2026-07-22)
**Dynamic NFT (NFTokenModify / XLS-46) is ENABLED on XRPL mainnet since 2025-06-11** (xrpl.org known-
amendments, livenet tx CB5D2736…). The pet lifecycle (issuer NFTokenModify to mutate the dNFT) runs on
mainnet. Hard gate CLEARED — the launch is viable; it's config + funding + key security, not a rewrite.

## Phase 0 — pre-flight (no money spent)
- [ ] Confirm NFTokenModify enabled on mainnet (above). If NO → STOP, reassess (adult-only static pets?).
- [ ] Confirm the base NFT ops we use are live: NFTokenMint (w/ Issuer + TransferFee), NFTokenCreateOffer,
      NFTokenAcceptOffer w/ NFTokenBrokerFee. (XLS-20 — long-standing, but confirm.)
- [ ] Reserve math: issuer holds many pets → owner reserve per NFTokenPage (~32 NFTs/page). Compute XRP
      needed for the first ~N pets + base reserve + a fee buffer. Decide funding amount.

## Phase 1 — mainnet issuer account + KEY SECURITY (the #1 risk)
The testnet seed sits hot in Railway env — fine for a throwaway. On mainnet that key mints real NFTs and
receives real royalty; a leaked env = drained. Minimum-viable safe setup (repo CREATOR_ECONOMICS already
specs it):
- [ ] Create a FRESH mainnet issuer account, fund from Phase-0 math.
- [ ] `SetRegularKey` = a separate signing key the backend uses; then `asfDisableMaster` so the master
      seed goes COLD (offline). Railway env holds ONLY the RegularKey seed, not the master.
- [ ] (Stretch, the marquee) 2-of-3 SignerList vault for royalty custody — "we can't drain your royalties
      without your signature." Can follow after the gate; RegularKey is the launch-blocking minimum.
- DECISION NEEDED: RegularKey-only (fast, safe-enough) vs full multisig vault at launch.

## Phase 2 — point the backend at mainnet
- [ ] Railway env: `XRPL_ENDPOINT = wss://xrplcluster.com` (or s1.ripple.com), `LEDGERLINGS_ISSUER_SEED`
      = the RegularKey seed, keep `ADMIN_TOKEN` / `ALLOWED_ORIGIN` locked.
- [ ] Add the Make Waves **SourceTag** to every project tx (mint/offer/accept) so the weekly leaderboard
      attributes on-chain activity + active accounts to Ledgerlings. (Prizes: Most Users, Most Volume,
      300-active-users → all keyed off the source tag. Load-bearing for scoring — don't skip.)
- [ ] Smoke: one adopt/mint against mainnet from a funded test buyer; verify NFT Issuer + TransferFee on
      a mainnet explorer.

## Phase 3 — PASS THE GATE
- [ ] Do ONE real mainnet mint/adopt (source-tagged). That live tx = the "Passed Mainnet Gate" evidence.
- [ ] Update the Make Waves entry (Ledgerlings) with the mainnet link.

## Phase 4 — real users (follow-on, for the leaderboard prizes)
- [ ] Xaman signing for buyers/adopters (`XAMAN_API_KEY/SECRET` — currently optional; unsigned-tx flow
      /list-pet /buy-pet already returns Xaman-ready offers, so this is UX polish, not a blocker).
- [ ] First partner collection (a partner collection) onboarded on mainnet = community + volume.

## Decisions Dane must make before executing
1. NFTokenModify confirmed on mainnet? (Phase-0 hard gate.)
2. Key security at launch: RegularKey-only (recommended for speed) or full multisig vault.
3. How much XRP to fund the issuer (from Phase-0 reserve math).
4. Xaman keys now, or ship the gate on the unsigned-tx flow first.

## Effort estimate
Phases 0–3 (pass the gate) ≈ half a day of focused work + funding, ASSUMING NFTokenModify is live on
mainnet. Phase 1 key security is the part to not rush. Phase 4 (users) is ongoing through the 90 days.
