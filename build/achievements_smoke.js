#!/usr/bin/env node
'use strict';
// Achievements smoke (Make Waves #11) — proves the badge mint + verify path on XRPL testnet:
//   - claimAchievements mints an EARNED badge (first_bond, earnable on the first interaction) -> verify PASS
//   - a FABRICATED badge the pet never earned (adult, on an egg) -> verify FAIL  (the fairness discriminator)
//   - claim is IDEMPOTENT (second claim mints nothing, skips first_bond)
// Stage/care badges (hatch..full_life, devoted, nurturer) need an aged pet (age in ledgers ~ 1 day to hatch);
// their correctness is proven deterministically in achievements.test.js. This smoke proves the on-chain plumbing.
//
// Run:  node build/achievements_smoke.js

const xrpl = require('xrpl');
const S = require('./server.js');
const ENDPOINT = 'wss://s.altnet.rippletest.net:51233';
const hex = s => Buffer.from(s, 'utf8').toString('hex').toUpperCase();

(async () => {
  const c = new xrpl.Client(ENDPOINT); await c.connect();
  console.log('funding throwaway testnet issuer + player…');
  const { wallet: w } = await c.fundWallet();
  const { wallet: p } = await c.fundWallet();
  const ISSUER = w.classicAddress, OWNER = p.classicAddress;
  const signAs = async (wallet, tx) => (await c.submitAndWait(wallet.sign(await c.autofill(tx)).tx_blob)).result;

  console.log('minting a pet…');
  const now0 = (await c.request({ command: 'ledger', ledger_index: 'validated' })).result.ledger_index;
  const mintR = await signAs(w, { TransactionType: 'NFTokenMint', Account: ISSUER, NFTokenTaxon: S.TAXON,
    Flags: S.TF_MUTABLE_TRANSFERABLE, TransferFee: S.ROYALTY_BPS, URI: S.enc(S.R.genesis(now0, OWNER)) });
  const nid = mintR.meta.nftoken_id;
  console.log('  pet nid', nid.slice(0, 16), '…');

  console.log('player sends one interaction (feed) → issuer applies step + NFTokenModify…');
  const pay = await signAs(p, { TransactionType: 'Payment', Account: OWNER, Destination: ISSUER, Amount: '10',
    Memos: [{ Memo: { MemoType: hex('ledgerlings/op'), MemoData: hex(`feed|${nid}`) } }] });
  const st = S.R.step(await S.readState(c, ISSUER, nid), S.R.FEED, pay.ledger_index, OWNER);
  await signAs(w, { TransactionType: 'NFTokenModify', Account: ISSUER, NFTokenID: nid, URI: S.enc(st) });
  console.log('  interaction ledger', pay.ledger_index);

  console.log('claimAchievements → should mint first_bond…');
  const claim = await S.claimAchievements(c, w, nid);
  console.log('  minted:', JSON.stringify(claim.minted), ' skipped:', JSON.stringify(claim.skipped));
  const badge = (claim.minted || []).find(m => m.id === 'first_bond');

  console.log('verify the EARNED badge → expect PASS…');
  const vPass = badge ? await S.verifyAchievement(c, ISSUER, badge.achNid) : { verdict: 'NO_BADGE' };
  console.log('  ', JSON.stringify(vPass));

  console.log('fabricate an unearned badge (adult, on an egg) + verify → expect FAIL…');
  const fakeR = await signAs(w, { TransactionType: 'NFTokenMint', Account: ISSUER, NFTokenTaxon: S.ACHIEVEMENT_TAXON,
    Flags: 0, URI: S.encAch(nid, 'adult', pay.ledger_index, { form: 4 }) });
  const fakeNid = fakeR.meta.nftoken_id;
  const vFail = await S.verifyAchievement(c, ISSUER, fakeNid);
  console.log('  ', JSON.stringify(vFail));

  console.log('claim again → idempotent (mints nothing, skips first_bond)…');
  const claim2 = await S.claimAchievements(c, w, nid);
  console.log('  minted:', JSON.stringify(claim2.minted), ' skipped:', JSON.stringify(claim2.skipped));

  await c.disconnect();
  const pass = badge && vPass.verdict === 'PASS' && vFail.verdict === 'FAIL'
    && (claim2.minted || []).length === 0 && (claim2.skipped || []).includes('first_bond');
  console.log(pass
    ? `\n✅ ACHIEVEMENTS LIVE: earned badge PASSES, fabricated badge FAILS (${vFail.reason}), claim is idempotent.`
    : `\n❌ achievements smoke failed — see output above.`);
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
