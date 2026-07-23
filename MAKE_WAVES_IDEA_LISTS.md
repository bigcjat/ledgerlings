# Make Waves — official idea lists (XRPL-Commons/community-ideas) + Ledgerlings mapping
Captured 2026-07-23. Source: https://github.com/XRPL-Commons/community-ideas
- `hackathon/index.md` — 35 hackathon-scope ideas (most relevant to an entry)
- `make-waves/index.md` — 74 broader market-gap opportunities

## Judging criteria (from hackathon list intro) — what a strong entry does
1. Demo a working transaction within 24 hours.
2. **Generate on-chain transactions through normal usage.**
3. Be **testable live by judges on testnet.**
→ Ledgerlings already hits all 3: every interaction = on-ledger Payment(op|nid) + NFTokenModify, live-testable. The provable-fairness core IS the differentiator — don't dilute it.

## Ledgerlings-relevant ideas (ranked by fit)
- **#11 On-Chain Achievements** [NFTs] — mint achievement NFT on milestone. ★ Best low-scope add: pet hits milestone (evolved / survived N days / bonded) → achievement NFT. On-theme, more txns, judge-visible.
- **#10 NFT Battle Cards** [NFTs+GAMING] — collectible + wager mechanics. ★ Pet-vs-pet *provably-fair* battle w/ XRP wager. Extends the ledger_index-as-clock fairness anchor into PvP. More scope, high payoff.
- **#4 Subscription Escrow** — recurring payment via time-locked escrow. = the care/petsitter economy. **Use this, NOT Payment Channels** (matches CARE_BOND_ESCROW.md; PayChan claims are off-ledger → they destroy the ledger_index fairness anchor).
- **#33 Digital Identity Credentials** [VERIFICATION+NFTs] — verifiable credentials as NFTs (Dane's verification lane).
- **#13–15 AI Agents** (marketplace / data-feed oracle / content bounty escrow) — Proven-Agent-Budget lane.
- **#28 Supply Chain Provenance** [VERIFICATION+FAIRNESS] — the fairness tag = Dane's lane (not a game).

## Payment Channels verdict
No payment-channel idea exists on either list. Recurring/streaming need = **#4 Subscription Escrow**. Confirms: don't put channels in Ledgerlings; escrow fits the care-bond and preserves provable fairness. See [[project_ledgerlings_collab_resume]].

## Full hackathon list (35)
Payments: 1 X402 Pay-Per-Article · 2 Streaming Tips · 3 Split & Settle · 4 Subscription Escrow.
DeFi: 5 RLUSD Remittance · 6 DEX Limit-Order Bot · 7 Liquidity Pool Dashboard · 8 Flash Swap Arbitrage.
Gaming: 9 Prediction Market · 10 NFT Battle Cards · 11 On-Chain Achievements · 12 Arcade Token Machine.
AI Agents: 13 AI Agent Marketplace · 14 Data Feed Oracle · 15 AI Content Bounty Board.
Ad-tech: 16 Pay-Per-Click Ads · 17 Survey Rewards.
Impact/Inclusion: 18 Tontine · 19 Micro-Insurance · 20 Remittance Unbanked · 21 Micro-Lending Circle.
Climate: 22 Carbon Credit Marketplace · 23 Community Solar Ledger · 24 Reforestation Tracker (GPS-NFT).
Humanitarian: 25 Transparent Aid · 26 Disaster Relief Fund · 27 Scholarship DAO · 28 Supply Chain Provenance.
General: 29 NFT Event Tickets · 30 Freelancer Escrow · 31 Loyalty Points · 32 DAO Treasury Manager · 33 Digital Identity Credentials · 34 Bounty Board · 35 Payroll on XRPL.

## Make Waves 74 (categories only — see index.md for full)
Wallets (12) · B2B (13) · RWA & Stables (6) · DeFi (16) · Builder Primitives (14, incl. #58 Pluggable Proof Primitives Library = Dane's VaaS thesis, #25 Dynamic NFT Framework, #50 Gaming Utility-NFT Framework) · AI Agents (12, incl. #63 AgentPay x402+XRPL, #67 On-Chain Reputation for AI Agents/KYA).
