# Ledgerlings — wiring the real Xaman + XRPL integration

The pieces (built):
- `app.html` — the xApp frontend. Real Xaman wiring via `xaman_bridge.js` + the unified Xumm SDK
  (`https://xaman.app/assets/cdn/xumm.min.js`). With no API key it runs the **standalone local demo**.
- `xaman_bridge.js` — frontend: resolves the user (xApp OTT), turns each interaction into a real
  `Payment + op-memo` sign request (`xumm.payload.create` → `xumm.xapp.openSignRequest`).
- `server.js` — the **issuer backend** (only it can `NFTokenModify`): verifies the signed Payment via the
  Xaman SDK, applies `pet_rules.js`, writes the new state to the pet's dNFT. Uses the Payment's
  `ledger_index` as `now` (so the replay verifier reproduces decay/age).
- `pet_rules.js` — the shared rules (browser + Node), faithful to `pet_rules.py`.

## Steps
1. **Create an xApp** at https://apps.xaman.dev → get **API key + secret**. Register the xApp's hosted URL.
2. **Issuer wallet:** create/fund an XRPL account (testnet first); export its seed. This account mints +
   modifies pets. KEEP THE SEED SECRET (env only, never in the frontend).
3. **Backend:** `npm install`, then set env + run:
   ```
   XAMAN_API_KEY=...  XAMAN_API_SECRET=...  LEDGERLINGS_ISSUER_SEED=s...  \
   XRPL_ENDPOINT=wss://s.altnet.rippletest.net:51233  node server.js
   ```
4. **Frontend:** set in `app.html` (the inline config line):
   `window.XAMAN_API_KEY` (key only — never the secret), `window.LEDGERLINGS_ISSUER` (issuer r-address),
   `window.LEDGERLINGS_BACKEND` (the server.js base URL). Host `app.html` at the URL registered in step 1.
5. **Test in Xaman:** open the xApp; it resolves your account, mints your pet, and each tap becomes a real
   on-ledger Payment → the issuer applies the rules → `NFTokenModify`. Hit "Verify my pet" to replay.

## Notes
- `app.html` stays a working OFFLINE demo when the key is blank — good for the hackathon screen-share.
- Mic for the live music-dance: check the webview's `getUserMedia` support (docs: xumm.readme.io); the
  tap-to-beat dance needs no mic and already works.
- Cosmetic `loadout` (v2 marketplace) is reserved and isolated from the fair state.
