# Deploy the Ledgerlings issuer backend (testnet)

The backend (`server.js`) is the only party that can mint/`NFTokenModify` pets. It's fully env-driven and
host-agnostic (`npm start` = `node server.js`, reads `PORT`). `/adopt` + `/pet` need only the issuer seed;
`/interact` additionally needs Xaman keys.

## 1. Pick a host (free Node tier)
- **Render** (easiest persistent free Node service) — New → Web Service → connect this repo → Root Dir `build` → Build `npm install` → Start `npm start`.
- Or **Railway** / **Fly.io** — same start command; set root to `build/`.
- (GitHub Pages can't run this — it's static-only; it hosts the *frontend* and points at this backend URL.)

## 2. Set env vars on the host
| Var | Value |
|---|---|
| `LEDGERLINGS_ISSUER_SEED` | the testnet issuer seed (generated; KEEP SECRET — host env only, never in git) |
| `XRPL_ENDPOINT` | `wss://s.altnet.rippletest.net:51233` (testnet) |
| `XAMAN_API_KEY` / `XAMAN_API_SECRET` | optional — only for `/interact` (apps.xaman.dev) |

## 3. Deploy + smoke test
- `POST /adopt {owner}` → mints a pet (testnet), returns `{nid, state}`.
- `GET  /pet?nid=...` → reads pet state.
- Confirm a mint succeeds and the returned NFTokenID starts `0018 1388…` (flags|5% royalty).

## 4. Wire the frontend
In the GitHub Pages demo (`docs/index.html`), set before `xaman_bridge.js`:
```html
<script>window.LEDGERLINGS_BACKEND='https://<your-backend-host>';
        window.XAMAN_API_KEY='<xApp public key>';</script>
```
Empty values keep the page in client-side local-demo mode (current state).

## Mainnet later
Generate a fresh issuer, secure it (cold/multisig/RegularKey — see `ACCESSORY_MARKETPLACE.md §8`), set
`XRPL_ENDPOINT=wss://xrplcluster.com`. Royalty (`ROYALTY_BPS=5000` = 5%) is already baked into every mint.
