#!/usr/bin/env node
'use strict';
// Ladder smoke: solo battle vs a PUBLISHED house NPC. challenge(rung) -> wait N -> resolve -> verify PASS
// (re-derives from the published NPC stat block + pinned ledger hash) -> tamper -> verify FAIL. Also /ladder + /ladder-rank.
// Run: node build/ladder_smoke.js
const xrpl = require('xrpl');
const ENDPOINT = 'wss://s.altnet.rippletest.net:51233';
const hex = s => Buffer.from(s, 'utf8').toString('hex').toUpperCase();

(async () => {
  const c = new xrpl.Client(ENDPOINT); await c.connect();
  const { wallet: w } = await c.fundWallet();
  const { wallet: p } = await c.fundWallet();
  process.env.LEDGERLINGS_ISSUER_SEED = w.seed; process.env.POLLER = '0';
  const S = require('./server.js'); const K = S.BATTLE_LEDGER_MARGIN;
  const I = w.classicAddress, O = p.classicAddress;
  const sign = async (wal, tx) => (await c.submitAndWait(wal.sign(await c.autofill(tx)).tx_blob)).result;
  const bmemo = d => [{ Memo: { MemoType: hex('ledgerlings/battle'), MemoData: hex(d) } }];
  const srv = S.app.listen(8801); const base = 'http://127.0.0.1:8801';

  const lad = await (await fetch(base + '/ladder')).json();
  console.log('published ladder:', lad.rungs.map(r => `${r.name}(pow ${r.power})`).join(' · '));

  const now = (await c.request({ command: 'ledger', ledger_index: 'validated' })).result.ledger_index;
  const mint = await sign(w, { TransactionType: 'NFTokenMint', Account: I, NFTokenTaxon: S.TAXON, Flags: S.TF_MUTABLE_TRANSFERABLE, TransferFee: S.ROYALTY_BPS, URI: S.enc(S.R.genesis(now, O)) });
  const nid = mint.meta.nftoken_id;

  const cur = (await c.request({ command: 'ledger', ledger_index: 'validated' })).result.ledger_index; const N = cur + K;
  console.log(`challenge rung 0 (${lad.rungs[0].name}); pin N=${N}…`);
  const chal = await sign(p, { TransactionType: 'Payment', Account: O, Destination: I, Amount: '1', Memos: bmemo(['ladder', nid, '0', String(N)].join('|')) });
  const battleId = chal.hash;

  process.stdout.write(`waiting for ledger ${N}`); let val = 0;
  while (val < N) { await new Promise(r => setTimeout(r, 2500)); val = (await c.request({ command: 'ledger', ledger_index: 'validated' })).result.ledger_index; process.stdout.write('.'); }
  console.log(' ok');

  const res = await S.resolveBattleTx(c, w, battleId);
  console.log('  result: winner', res.winner, '· scores', res.scoreA, 'vs', res.scoreB, '· card', res.card ? (res.card.nid ? 'minted' : 'none') : '(loss, no card)');
  const vp = await S.verifyBattle(c, I, battleId);
  console.log('  verify →', vp.verdict, '-', vp.reason);
  const rank = await (await fetch(base + '/ladder-rank/' + nid)).json();
  console.log('  ladder-rank:', JSON.stringify(rank));

  console.log('tamper: flip the recorded winner…');
  const npcId = 'NPC:' + lad.rungs[0].id;
  const flip = res.winner === 'player' ? npcId : nid;
  await sign(w, { TransactionType: 'Payment', Account: I, Destination: O, Amount: '1', Memos: bmemo(['result', battleId, flip, res.scoreA, res.scoreB, S.RULESET_VERSION].join('|')) });
  const vf = await S.verifyBattle(c, I, battleId);
  console.log('  verify after tamper →', vf.verdict);

  srv.close(); await c.disconnect();
  const pass = lad.rungs.length >= 4 && vp.verdict === 'PASS' && vf.verdict === 'FAIL' && rank && typeof rank.wins === 'number';
  console.log(pass
    ? `\n✅ LADDER LIVE: solo battle vs a published house NPC re-derives (PASS), a rigged record is caught (FAIL), rank tracked — provably-fair PvE, no second player needed.`
    : `\n❌ ladder smoke failed — see output above.`);
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
