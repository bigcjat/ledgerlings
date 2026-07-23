#!/usr/bin/env node
'use strict';
// Provably-fair battle smoke (Make Waves #10) on XRPL testnet:
//   challenge (A stakes) -> accept (B stakes) -> wait for the pinned ledger N -> resolve (winner paid, card minted)
//   -> verify-battle PASS -> a TAMPERED result record (winner flipped) -> verify-battle FAIL.
// Proves the seed (pinned future ledger hash) + open rules re-derive the winner, and the verifier catches a rigged record.
//
// Run:  node build/battle_smoke.js

const xrpl = require('xrpl');
const S = require('./server.js');
const ENDPOINT = 'wss://s.altnet.rippletest.net:51233';
const hex = s => Buffer.from(s, 'utf8').toString('hex').toUpperCase();
const K = S.BATTLE_LEDGER_MARGIN;

(async () => {
  const c = new xrpl.Client(ENDPOINT); await c.connect();
  console.log('funding issuer + two owners…');
  const { wallet: w } = await c.fundWallet();
  const { wallet: p } = await c.fundWallet();
  const { wallet: q } = await c.fundWallet();
  const ISSUER = w.classicAddress;
  const signAs = async (wallet, tx) => (await c.submitAndWait(wallet.sign(await c.autofill(tx)).tx_blob)).result;
  const mint = async owner => {
    const now = (await c.request({ command: 'ledger', ledger_index: 'validated' })).result.ledger_index;
    const r = await signAs(w, { TransactionType: 'NFTokenMint', Account: ISSUER, NFTokenTaxon: S.TAXON,
      Flags: S.TF_MUTABLE_TRANSFERABLE, TransferFee: S.ROYALTY_BPS, URI: S.enc(S.R.genesis(now, owner)) });
    return r.meta.nftoken_id;
  };
  const battleMemo = data => [{ Memo: { MemoType: hex(S.BATTLE_MEMO), MemoData: hex(data) } }];

  console.log('minting a pet for each owner…');
  const aNid = await mint(p.classicAddress), bNid = await mint(q.classicAddress);

  const cur = (await c.request({ command: 'ledger', ledger_index: 'validated' })).result.ledger_index;
  const N = cur + K, STAKE = '5000000';   // 5 XRP each
  console.log(`challenge: A stakes 5 XRP, pins ledger N=${N} (current ${cur}, margin ${K})…`);
  const chal = await signAs(p, { TransactionType: 'Payment', Account: p.classicAddress, Destination: ISSUER, Amount: STAKE,
    Memos: battleMemo(['challenge', aNid, STAKE, String(N)].join('|')) });
  const battleId = chal.hash;
  console.log('  battleId', battleId.slice(0, 16), '…');

  console.log('accept: B stakes 5 XRP…');
  await signAs(q, { TransactionType: 'Payment', Account: q.classicAddress, Destination: ISSUER, Amount: STAKE,
    Memos: battleMemo(['accept', battleId, bNid].join('|')) });

  process.stdout.write(`waiting for pinned ledger ${N} to validate`);
  let val = 0;
  while (val < N) { await new Promise(r => setTimeout(r, 2500)); val = (await c.request({ command: 'ledger', ledger_index: 'validated' })).result.ledger_index; process.stdout.write('.'); }
  console.log(` reached ${val}`);

  console.log('resolve…');
  const resolved = await S.resolveBattleTx(c, w, battleId);
  console.log('  winner', (resolved.winner || '').slice(0, 16), 'scores', resolved.scoreA, 'vs', resolved.scoreB,
    'paid', resolved.payout && resolved.payout.paidDrops, 'drops · card', resolved.card && resolved.card.result);

  console.log('verify-battle → expect PASS…');
  const vp = await S.verifyBattle(c, ISSUER, battleId);
  console.log('  ', vp.verdict, '-', vp.reason);

  console.log('operator TAMPERS: emits a fraudulent result record with the winner flipped…');
  const loser = resolved.winner === aNid ? bNid : aNid;
  await signAs(w, { TransactionType: 'Payment', Account: ISSUER, Destination: p.classicAddress, Amount: '1',
    Memos: battleMemo(['result', battleId, loser, resolved.scoreA, resolved.scoreB, S.RULESET_VERSION].join('|')) });
  const vf = await S.verifyBattle(c, ISSUER, battleId);
  console.log('  verify after tamper →', vf.verdict, '-', vf.reason);

  await c.disconnect();
  const pass = vp.verdict === 'PASS' && vf.verdict === 'FAIL' && resolved.winner && resolved.winner !== 'DRAW';
  console.log(pass
    ? `\n✅ BATTLES LIVE: winner re-derives from the pinned ledger hash + open rules (PASS); a rigged record is caught (FAIL).`
    : `\n❌ battle smoke failed — see output above.`);
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
