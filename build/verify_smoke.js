#!/usr/bin/env node
'use strict';
// "Verify my pet" smoke — proves the on-ledger verifier is MULTI-PET SOUND on XRPL testnet:
//   - honest history per pet -> PASS
//   - two pets under one issuer stay ISOLATED (A's verify uses only A's interactions)
//   - a tampered (cheated) pet -> DIVERGED
// Exercises the REAL path: a Payment(op|nid) memo, then step(now = the Payment's ledger_index) + NFTokenModify.
// Uses ONE shared client (sequential submitAndWait) so the account sequence advances cleanly.
//
// Run:  node verify_smoke.js

const xrpl = require('xrpl');
const S = require('./server.js');
const ENDPOINT = 'wss://s.altnet.rippletest.net:51233';
const hex = s => Buffer.from(s, 'utf8').toString('hex').toUpperCase();

(async () => {
  const c = new xrpl.Client(ENDPOINT); await c.connect();
  console.log('funding throwaway testnet issuer + player…');
  const { wallet: w } = await c.fundWallet();          // issuer (mints + modifies)
  const { wallet: p } = await c.fundWallet();          // player (owns + signs interactions)
  const ISSUER = w.classicAddress, OWNER = p.classicAddress;   // player != issuer (real flow; self-pay would be temREDUNDANT)

  const signAs = async (wallet, tx) => (await c.submitAndWait(wallet.sign(await c.autofill(tx)).tx_blob)).result;

  const mint = async () => {
    const now = (await c.request({ command: 'ledger', ledger_index: 'validated' })).result.ledger_index;
    const r = await signAs(w, { TransactionType: 'NFTokenMint', Account: ISSUER, NFTokenTaxon: S.TAXON,
      Flags: S.TF_MUTABLE_TRANSFERABLE, TransferFee: S.ROYALTY_BPS, URI: S.enc(S.R.genesis(now, OWNER)) });
    return r.meta.nftoken_id;
  };

  // real interaction: PLAYER signs a Payment(op|nid) -> issuer applies step(now = Payment ledger_index) + NFTokenModify
  const interact = async (nid, opName, opCode) => {
    const pay = await signAs(p, { TransactionType: 'Payment', Account: OWNER, Destination: ISSUER, Amount: '10',
      Memos: [{ Memo: { MemoType: hex('ledgerlings/op'), MemoData: hex(`${opName}|${nid}`) } }] });
    const now = pay.ledger_index;
    const state = await S.readState(c, ISSUER, nid);
    const next = S.R.step(state, opCode, now, OWNER);
    await signAs(w, { TransactionType: 'NFTokenModify', Account: ISSUER, NFTokenID: nid, URI: S.enc(next) });
  };

  console.log('minting two pets under one issuer…');
  const A = await mint(), B = await mint();
  console.log('  A', A.slice(0, 14), ' B', B.slice(0, 14), A === B ? '  ⚠ SAME NID' : '  (distinct ✓)');

  await interact(A, 'feed', S.R.FEED);
  await interact(B, 'play', S.R.PLAY);
  await interact(A, 'feed', S.R.FEED);                 // A: 2 interactions, B: 1

  const vA = await S.verifyPet(c, ISSUER, A), vB = await S.verifyPet(c, ISSUER, B);
  console.log(`verify A -> ${vA.verdict} (interactions=${vA.interactions}; expect PASS, 2)`);
  console.log(`verify B -> ${vB.verdict} (interactions=${vB.interactions}; expect PASS, 1 — NOT mixed with A)`);

  console.log('operator tampers with A (fakes a legendary form an egg never earned)…');
  const sA = await S.readState(c, ISSUER, A); sA.form = 4;   // egg-stage form must be 0 -> replay diverges; same byte size
  console.log(`  (pet state URI = ${S.enc(sA).length / 2} bytes / 256 max)`);
  await signAs(w, { TransactionType: 'NFTokenModify', Account: ISSUER, NFTokenID: A, URI: S.enc(sA) });
  const vAt = await S.verifyPet(c, ISSUER, A);
  console.log(`verify A after tamper -> ${vAt.verdict} (expect DIVERGED)`);

  await c.disconnect();
  const pass = A !== B && vA.verdict === 'PASS' && vA.interactions === 2
    && vB.verdict === 'PASS' && vB.interactions === 1 && vAt.verdict === 'DIVERGED';
  console.log(pass
    ? `\n✅ VERIFY MY PET LIVE: per-pet replay PASSES honest history, DIVERGES on tamper, multi-pet stays isolated.`
    : `\n❌ verify smoke failed — see verdicts above.`);
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
