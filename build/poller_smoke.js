#!/usr/bin/env node
'use strict';
// Live-loop smoke: proves the issuer poller AUTO-APPLIES a signed interaction (no operator, no /interact call).
//   mint pet -> owner signs a feed Payment(op memo) -> reconcilePet() applies step()+NFTokenModify ->
//   pet URI now reflects the feed AND /verify PASSES. Then a 2nd reconcile is a no-op (idempotent).
//
// Run:  node build/poller_smoke.js
const xrpl = require('xrpl');
const S = require('./server.js');
const ENDPOINT = 'wss://s.altnet.rippletest.net:51233';
const hex = s => Buffer.from(s, 'utf8').toString('hex').toUpperCase();

(async () => {
  const c = new xrpl.Client(ENDPOINT); await c.connect();
  console.log('funding issuer + owner…');
  const { wallet: w } = await c.fundWallet();
  const { wallet: p } = await c.fundWallet();
  const ISSUER = w.classicAddress, OWNER = p.classicAddress;
  const signAs = async (wallet, tx) => (await c.submitAndWait(wallet.sign(await c.autofill(tx)).tx_blob)).result;

  console.log('minting pet (genesis)…');
  const now0 = (await c.request({ command: 'ledger', ledger_index: 'validated' })).result.ledger_index;
  const gen = S.R.genesis(now0, OWNER);
  const mintR = await signAs(w, { TransactionType: 'NFTokenMint', Account: ISSUER, NFTokenTaxon: S.TAXON,
    Flags: S.TF_MUTABLE_TRANSFERABLE, TransferFee: S.ROYALTY_BPS, URI: S.enc(gen) });
  const nid = mintR.meta.nftoken_id;
  const before = await S.readState(c, ISSUER, nid);

  console.log('owner signs a FEED Payment — but NO manual modify (the poller must do it)…');
  await signAs(p, { TransactionType: 'Payment', Account: OWNER, Destination: ISSUER, Amount: '10',
    Memos: [{ Memo: { MemoType: hex('ledgerlings/op'), MemoData: hex(`feed|${nid}`) } }] });
  const stale = await S.readState(c, ISSUER, nid);
  console.log('  before poller: hunger', stale.hunger, 'care_max', stale.care_max, '(unchanged =', JSON.stringify(stale) === JSON.stringify(before), ')');

  console.log('reconcilePet() = one poller pass…');
  const rec = await S.reconcilePet(c, w, nid);
  const after = await S.readState(c, ISSUER, nid);
  console.log('  updated:', rec.updated, '· after: hunger', after.hunger, 'care_max', after.care_max, 'last_feed', after.last_feed);

  console.log('verify the pet → expect PASS (on-ledger state matches the replay the poller wrote)…');
  const v = await S.verifyPet(c, ISSUER, nid);
  console.log('  ', v.verdict, '-', v.reason);

  console.log('second reconcile → idempotent no-op…');
  const rec2 = await S.reconcilePet(c, w, nid);
  console.log('  updated:', rec2.updated);

  await c.disconnect();
  const applied = rec.updated && after.last_feed > 0 && after.care_max > before.care_max;
  const pass = JSON.stringify(stale) === JSON.stringify(before) && applied && v.verdict === 'PASS' && rec2.updated === false;
  console.log(pass
    ? `\n✅ LIVE LOOP: a signed interaction is auto-applied by the poller (no operator, no /interact), pet updates + verifies, and re-runs are idempotent.`
    : `\n❌ poller smoke failed — see output above.`);
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
