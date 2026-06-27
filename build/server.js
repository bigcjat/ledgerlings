/* Ledgerlings issuer backend — the only party that can NFTokenModify a pet.
 * Verifies the player's signed Payment(+op memo) via the Xaman SDK, applies the open rules, and writes the
 * new state to the pet's dNFT URI. Uses the PAYMENT's ledger_index as `now` (so the replay verifier can
 * reproduce decay/age — the verifiability fix).
 *
 * Setup (see XAMAN_SETUP.md):  npm install  ·  set env  ·  node server.js
 *   XAMAN_API_KEY, XAMAN_API_SECRET   (https://apps.xaman.dev)
 *   LEDGERLINGS_ISSUER_SEED            (the issuer wallet seed — mints + modifies; KEEP SECRET)
 *   XRPL_ENDPOINT                     (default testnet)
 */
const express = require('express');
const xrpl = require('xrpl');
const { XummSdk } = require('xumm-sdk');
const R = require('./pet_rules.js');

// sdk only needed for /interact (verifying signed payloads); lazy so /adopt + /pet + tests run without it.
const sdk = process.env.XAMAN_API_KEY ? new XummSdk(process.env.XAMAN_API_KEY, process.env.XAMAN_API_SECRET) : null;
const ENDPOINT = process.env.XRPL_ENDPOINT || 'wss://s.altnet.rippletest.net:51233';
const ISSUER_SEED = process.env.LEDGERLINGS_ISSUER_SEED;
const TAXON = 7777, TF_MUTABLE_TRANSFERABLE = 8 | 16;

const hex = s => Buffer.from(s, 'utf8').toString('hex').toUpperCase();
const unhex = h => Buffer.from(h, 'hex').toString('utf8');
const enc = o => hex(JSON.stringify(o));
const dec = h => JSON.parse(unhex(h));

async function withClient(fn) {
  const c = new xrpl.Client(ENDPOINT); await c.connect();
  try { return await fn(c, xrpl.Wallet.fromSeed(ISSUER_SEED)); } finally { await c.disconnect(); }
}
async function readState(c, issuer, nid) {
  const r = await c.request({ command: 'account_nfts', account: issuer });
  const n = r.result.account_nfts.find(x => x.NFTokenID === nid);
  return n ? dec(n.URI) : null;
}
async function submit(c, w, tx) {
  const prepared = await c.autofill(tx);
  const res = await c.submitAndWait(w.sign(prepared).tx_blob);
  return res.result.meta.TransactionResult;
}

const app = express();
app.use(express.json());

// adopt: mint a mutable pet dNFT owned (in-state) by the user
app.post('/adopt', async (req, res) => {
  const owner = req.body.owner;
  if (!owner) return res.status(400).json({ error: 'owner required' });
  const out = await withClient(async (c, w) => {
    const now = (await c.request({ command: 'ledger', ledger_index: 'validated' })).result.ledger_index;
    const r = await submit(c, w, { TransactionType: 'NFTokenMint', Account: w.classicAddress,
      NFTokenTaxon: TAXON, Flags: TF_MUTABLE_TRANSFERABLE, URI: enc(R.genesis(now, owner)) });
    const nfts = (await c.request({ command: 'account_nfts', account: w.classicAddress })).result.account_nfts;
    return { result: r, nid: nfts[nfts.length - 1].NFTokenID };
  });
  res.json(out);
});

// read pet state
app.get('/pet/:nid', async (req, res) => {
  const s = await withClient((c, w) => readState(c, w.classicAddress, req.params.nid));
  s ? res.json(s) : res.status(404).json({ error: 'pet not found' });
});

// interact: verify the signed Payment, apply rules, NFTokenModify
app.post('/interact', async (req, res) => {
  const { uuid, nid } = req.body;
  if (!uuid || !nid) return res.status(400).json({ error: 'uuid + nid required' });
  if (!sdk) return res.status(503).json({ error: 'signing not configured (set XAMAN_API_KEY/SECRET)' });
  // 1) verify the sign request was actually signed
  const pl = await sdk.payload.get(uuid);
  if (!pl || !pl.meta.signed) return res.status(400).json({ error: 'not signed' });
  const txid = pl.response.txid;

  const out = await withClient(async (c, w) => {
    // 2) read the on-ledger Payment: op memo + sender + the ledger_index (= the deterministic `now`)
    const tx = (await c.request({ command: 'tx', transaction: txid })).result;
    const memo = (tx.Memos || []).map(m => m.Memo).find(m => unhex(m.MemoType || '') === 'ledgerlings/op');
    if (!memo) throw new Error('no op memo');
    const op = R.OP[unhex(memo.MemoData)] || 0;
    const sender = tx.Account, now = tx.ledger_index;
    // 3) apply the open rules, write the new state on-ledger
    const state = await readState(c, w.classicAddress, nid);
    if (!state) throw new Error('pet not found');
    const next = R.step(state, op, now, sender);            // sender !== owner ⇒ no-op (owner-only)
    const result = await submit(c, w, { TransactionType: 'NFTokenModify',
      Account: w.classicAddress, NFTokenID: nid, URI: enc(next) });
    return { result, state: next, applied: JSON.stringify(next) !== JSON.stringify(state) };
  });
  res.json(out);
});

// export the issuer primitives so a harness can drive the logic without starting a server.
module.exports = { app, withClient, readState, submit, enc, dec, hex, unhex, R, TAXON, TF_MUTABLE_TRANSFERABLE, ENDPOINT };

if (require.main === module) {
  const PORT = process.env.PORT || 8788;
  app.listen(PORT, () => console.log(`Ledgerlings issuer on :${PORT} (endpoint ${ENDPOINT})`));
}
