#!/usr/bin/env node
'use strict';
// Issuer-backend smoke harness — proves the mint → read → modify → read loop works LIVE on XRPL testnet,
// using the same primitives server.js exposes (so it tests the real code path, not a copy).
// Funds a throwaway testnet issuer, exercises it, prints a verdict. No long-running server (per the
// no-local-servers rule — this is a one-shot harness, like mint_pet.py).
//
// Run:  node backend_smoke.js

const xrpl = require('xrpl');
const ENDPOINT = 'wss://s.altnet.rippletest.net:51233';

(async () => {
  console.log('1) funding a throwaway testnet issuer wallet (faucet)…');
  const c0 = new xrpl.Client(ENDPOINT); await c0.connect();
  const { wallet } = await c0.fundWallet();
  await c0.disconnect();
  console.log('   issuer:', wallet.classicAddress);

  // server.js reads the seed/endpoint from env at require time -> set BEFORE requiring it.
  process.env.LEDGERLINGS_ISSUER_SEED = wallet.seed;
  process.env.XRPL_ENDPOINT = ENDPOINT;
  const S = require('./server.js');
  const OWNER = wallet.classicAddress; // owner == issuer here so the owner-only FEED applies

  let nid;
  const mint = await S.withClient(async (c, w) => {
    const now = (await c.request({ command: 'ledger', ledger_index: 'validated' })).result.ledger_index;
    const r = await S.submit(c, w, { TransactionType: 'NFTokenMint', Account: w.classicAddress,
      NFTokenTaxon: S.TAXON, Flags: S.TF_MUTABLE_TRANSFERABLE, URI: S.enc(S.R.genesis(now, OWNER)) });
    const nfts = (await c.request({ command: 'account_nfts', account: w.classicAddress })).result.account_nfts;
    return { r, nid: nfts[nfts.length - 1].NFTokenID };
  });
  nid = mint.nid;
  console.log(`2) ADOPT (NFTokenMint mutable dNFT): ${mint.r}  nid=${nid.slice(0, 16)}…`);
  if (mint.r !== 'tesSUCCESS') { console.log('❌ mint failed — likely DynamicNFT/NFTokenModify not enabled on this network.'); process.exit(1); }

  const s0 = await S.withClient((c, w) => S.readState(c, w.classicAddress, nid));
  console.log(`3) READ state from URI: stage=${S.R.STAGE[s0.stage]} hunger=${s0.hunger} happiness=${s0.happiness} alive=${s0.alive}`);

  const modify = await S.withClient(async (c, w) => {
    const state = await S.readState(c, w.classicAddress, nid);
    const now = (await c.request({ command: 'ledger', ledger_index: 'validated' })).result.ledger_index;
    const next = S.R.step(state, S.R.FEED, now, OWNER);  // the SAME engine the verifier uses
    const r = await S.submit(c, w, { TransactionType: 'NFTokenModify', Account: w.classicAddress, NFTokenID: nid, URI: S.enc(next) });
    return { r, next };
  });
  console.log(`4) INTERACT (step FEED + NFTokenModify): ${modify.r}`);
  if (modify.r !== 'tesSUCCESS') { console.log('❌ NFTokenModify failed — DynamicNFT amendment likely required.'); process.exit(1); }

  const s1 = await S.withClient((c, w) => S.readState(c, w.classicAddress, nid));
  console.log(`5) RE-READ state: hunger=${s1.hunger} (was ${s0.hunger}) happiness=${s1.happiness} last_feed=${s1.last_feed}`);

  const changed = JSON.stringify(s0) !== JSON.stringify(s1);
  console.log(changed
    ? `\n✅ ISSUER BACKEND LIVE: adopt → read → interact → re-read round-tripped on testnet, on-ledger state changed.`
    : `\n❌ state did not change after FEED — investigate.`);
  process.exit(changed ? 0 : 1);
})().catch(e => { console.error('❌ smoke error:', e.message); process.exit(1); });
