# Ledgerlings mainnet launch — RUNBOOK (committed plan, 2026-07-22)

Decisions (locked): RegularKey-only security at launch · gate first on the unsigned-tx flow (Xaman
later) · fund 30 XRP. Gate cleared: NFTokenModify live on XRPL mainnet since 2025-06-11.
Reserves (xrpl.org, 2026): base 1 XRP + 0.2 XRP/item (0.2 per NFTokenPage of ≤32 NFTs; 0.2 per open offer).

## Who does what
- **Claude (me), safe / no funds or keys:** reserve math (done), SourceTag wiring in `server.js`
  (env-gated, non-breaking), mainnet env config, this runbook, a post-launch smoke check. I NEVER
  generate, hold, or submit anything with your production seeds or funds.
- **Dane (you), money + keys — irreversible, do carefully):** generate the two wallets, fund, and sign
  the SetRegularKey / DisableMaster txns per the SAFE ORDER below.

## Step 1 — generate two mainnet wallets (you)
- **ISSUER (master)** — will go COLD after Step 3. Generate offline; back up the seed in ≥2 secure places.
- **REGULARKEY (signer)** — the backend's hot key. Generate separately; its seed is the only one that
  ever touches Railway env.
- Never paste either seed into a chat/tool. (Use a trusted local signer — xrpl.org tools / xrpl.js / xaman.)

## Step 2 — fund the ISSUER account with 30 XRP (you)
Send 30 XRP to the issuer classic address from an exchange/wallet. (1 XRP base reserve activates it; the
rest funds NFT pages + offers + fees.)

## Step 3 — RegularKey, THEN disable master — SAFE ORDER (you; DisableMaster is irreversible)
1. `SetRegularKey` on the issuer: RegularKey = the REGULARKEY address. (Signed by the issuer master.)
2. **TEST**: submit one trivial tx (e.g. an `AccountSet` no-op) signed by the RegularKey — confirm it
   SUCCEEDS on mainnet. Do NOT skip this. If the RegularKey can't sign, STOP.
3. Only after the RegularKey is proven working: `asfDisableMaster` (AccountSet SetFlag 4), signed by the
   master. Master now cold/offline; keep its seed backed up anyway (RegularKey can be rotated by it if
   you ever re-enable, but treat master as archival). ⚠️ If the RegularKey seed is lost BEFORE re-enabling
   master, the account is bricked — that's why Step 3.2 is mandatory.

## Step 4 — point the backend at mainnet (you set env; I prep the code)
Railway env for `ledgerlings-backend`:
- `XRPL_ENDPOINT = wss://xrplcluster.com`
- `LEDGERLINGS_ISSUER_SEED = <the REGULARKEY seed>`   ← RegularKey, NOT the master
- `MAKEWAVES_SOURCE_TAG = <your Make Waves source tag>`  ← see NOTE below
- keep `ADMIN_TOKEN` and `ALLOWED_ORIGIN` as-is (locked).
NOTE: I need your **Make Waves source tag** (a number) to wire attribution — check your entry / the
platform, or ask organizers on Discord. Without it the leaderboard can't credit Ledgerlings' on-chain
activity (Most Users / Most Volume / 300-users prizes all key off it). The code will read it from env,
so nothing hardcoded — you just set the number.

## Step 5 — PASS THE GATE (you trigger, I verify)
- Do one real adopt/mint on mainnet (source-tagged). Confirm on livenet.xrpl.org: NFT `Issuer` = artist,
  `TransferFee` = 5000 (5%), source tag present.
- That live tx = "Passed Mainnet Gate." Update the Make Waves entry (Ledgerlings) with the link.

## After the gate (follow-on)
- 2-of-3 multisig royalty vault before onboarding a partner collection (the "can't drain your royalties" story).
- Xaman signing for smooth user adoption (the 300-active-users prize).

## Blocking input I need from you before I wire code
1. Your Make Waves **source tag** (number).
2. Go-ahead to edit `build/server.js` (add the env-gated SourceTag to mint/offer/accept txns — non-breaking:
   if the env is unset it behaves exactly as today).
