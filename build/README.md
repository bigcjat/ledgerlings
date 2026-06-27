# Ledgerlings — build/

The provably-fair on-chain pet, as a Xaman xApp + XRPL issuer backend. **Phase-1 is code-complete and
proven on XRPL testnet.** Remaining work is deploy-side (Xaman dev app, hosting, live device test).

## Architecture (two halves)
```
app.html (xApp frontend, in Xaman)          server.js (issuer backend, the ONLY NFTokenModifier)
  ├─ pet_rules.js  (the ONE rules engine)     ├─ /adopt        mint a mutable pet dNFT (meta.nftoken_id)
  ├─ xaman_bridge.js (Xumm SDK wrapper)       ├─ /pet/:nid     read state from the NFT URI
  └─ tap → interact(op,nid)                   ├─ /interact     verify signed Payment → step() → NFTokenModify
        signs Payment("<op>|<nid>") in Xaman  └─ /verify/:nid  replay from genesis → PASS / DIVERGED
              │                                          ▲
              └─ Payment (owner→issuer, memo) ───────────┘  (now = the Payment's ledger_index, deterministic)
```
- **One rules engine.** `pet_rules.js` is the single source of truth — used by the app, the issuer, and the
  verifier. `pet_rules.py` is a byte-identical Python twin (proven by `diff_rules.js`). Never fork it.
- **Provably fair.** State lives on-chain in a Dynamic NFT (`NFTokenModify`). Anyone replays the open rules over
  the pet's ledger history and checks it matches — `/verify/:nid` (Node) or `replay_verify.py` (Python).
- **Compact codec.** The 256-byte URI stores a short-key JSON (`server.js` `enc`/`dec`; ~160 B live, was 254).
  `loadout` is cosmetic and not stored on-ledger. `pet_rules` state stays full-key in memory.
- **Multi-pet sound.** One issuer holds every pet; genesis is matched by `meta.nftoken_id`, interactions are
  filtered by the `nid` in the memo — pets never mix.

## Commands
```bash
npm install              # deps (express, xrpl, xumm-sdk)
npm test                 # rules-parity gate: JS step ≡ Python step (123k states). RUN BEFORE ANY RULES EDIT.
npm run test:rules       # heavy parity gate (610k states)
npm run smoke            # backend live on testnet: adopt → read → interact → re-read
npm run smoke:verify     # verify live on testnet: 2 pets/1 issuer → PASS/PASS(isolated), tamper → DIVERGED
python3 replay_verify.py # the independent Python verifier self-test (honest VERIFIED, cheat DIVERGED)
npm start                # run the issuer service (needs .env)
```

## Config (`.env` — copy from `.env.example`, never commit real values)
| var | needed for | notes |
|-----|-----------|-------|
| `XAMAN_API_KEY` | xApp + `/interact` | public client id (frontend) |
| `XAMAN_API_SECRET` | `/interact` only | backend-only secret |
| `LEDGERLINGS_ISSUER_SEED` | everything | issuer wallet — **crown jewel**; cold/multisig/RegularKey for mainnet |
| `XRPL_ENDPOINT` | everything | default testnet; mainnet `wss://xrplcluster.com` |
| `PORT` | the service | default 8788 |

Frontend config (set on `window` before `xaman_bridge.js` loads): `XAMAN_API_KEY`, `LEDGERLINGS_ISSUER`
(issuer r-address), `LEDGERLINGS_BACKEND` (this service's base URL). With none set, `app.html` runs the
standalone local demo.

## Go-live checklist (the remaining Phase-1 work — needs your creds/device)
1. **Xaman developer app** at apps.xaman.dev → API key + secret; register the xApp (its hosted URL).
2. **Issuer wallet:** mainnet → secure the seed (cold/multisig/RegularKey). Testnet → `npm run smoke` prints a way
   to fund one.
3. **Deploy:** host `server.js` (set `.env`) + host the static frontend (`app.html` + `pet_rules.js` +
   `xaman_bridge.js` + sprites); point the xApp URL at the frontend, set `LEDGERLINGS_BACKEND` to the service.
4. **Verify the SDK `payload` event shape** on the first real sign (flagged in `xaman_bridge.js`).
5. **Live end-to-end test inside Xaman:** adopt → care actions sign + apply → "Verify my pet" → PASS.

## Files
`app.html` xApp UI · `pet_rules.js`/`pet_rules.py` rules engine (twins) · `diff_rules.js`/`diff_rules_runner.py`
parity harness · `xaman_bridge.js` Xumm wrapper · `server.js` issuer service · `replay_verify.py` Python verifier ·
`backend_smoke.js`/`verify_smoke.js` testnet smokes · `render_*.py` sprite tooling · `ledgerlings_*.png` sprites.
