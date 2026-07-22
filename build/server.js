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
// Royalty: native XRPL TransferFee, auto-paid to the issuer on every secondary sale.
// 0–50000 = 0.000%–50.000% (0.001% steps). 5000 = 5%. Requires tfTransferable (set above).
// FINALIZED default = 5%; Dane confirms the final business number.
const ROYALTY_BPS = 5000;
// Collaborator accessories/backgrounds: separate taxon, transferable (royalty), not mutable.
const ACCESSORY_TAXON = 7778, TF_TRANSFERABLE = 8;
// Bring-your-character registrations (NFT projects adding a playable skin): own taxon. The roster is
// just "all issuer NFTs at this taxon" — persistent on-ledger, no database needed.
const CHARACTER_TAXON = 7779;
// SECURITY: all mint/write endpoints require this admin token (fail-closed). No anon minting from the
// issuer. ALLOWED_ORIGIN locks CORS. Set both in the host env.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://hugegreencandle.github.io';
// Broker fee = platform's atomic cut on a PRIMARY sale (NFTokenBrokerFee), as bps of the list price.
// Configurable — final business number TBD (Dane). 1000 = 10%. Artist keeps the price; platform keeps this.
const BROKER_FEE_BPS = Number(process.env.BROKER_FEE_BPS || 1000);
// Make Waves leaderboard attribution: stamp every project tx (issuer-signed AND user-signed offers)
// with the hackathon SourceTag so on-chain activity + active accounts are credited to Ledgerlings.
// Env-gated + non-breaking: unset => no SourceTag field, behaves exactly as before. Set MAKEWAVES_SOURCE_TAG.
const SOURCE_TAG = Number.isInteger(Number(process.env.MAKEWAVES_SOURCE_TAG))
  ? Number(process.env.MAKEWAVES_SOURCE_TAG) : undefined;
const tag = tx => (SOURCE_TAG !== undefined && tx && tx.SourceTag === undefined ? { ...tx, SourceTag: SOURCE_TAG } : tx);

const hex = s => Buffer.from(s, 'utf8').toString('hex').toUpperCase();
const unhex = h => Buffer.from(h, 'hex').toString('utf8');

// Compact on-ledger codec — the NFT URI is capped at 256 bytes; full-key JSON was 254 (≈no headroom).
// Short keys + omit `loadout` (cosmetic, step() never reads it) shrink the wire form to ~150 bytes while
// pet_rules state shape stays UNCHANGED in memory (so the diff harness + rules are untouched). Fixed key
// order => deterministic string, so the verifier's enc(derived) === enc(current) still holds.
const K = { v: 'v', owner: 'o', birth: 'b', last_ix: 'x', hunger: 'h', happiness: 'j', health: 'l',
  stage: 's', form: 'f', alive: 'a', age: 'g', care: 'c', care_max: 'm', death_cause: 'd',
  last_feed: 'F', last_play: 'P' };
const KINV = Object.fromEntries(Object.entries(K).map(([f, s]) => [s, f]));
const enc = state => {
  const o = {};
  for (const f in K) o[K[f]] = state[f];          // fixed order from K -> deterministic
  return hex(JSON.stringify(o));
};
const dec = h => {
  const o = JSON.parse(unhex(h));
  const s = { loadout: [] };                        // loadout not stored on-ledger; restore the default
  for (const sk in o) s[KINV[sk] || sk] = o[sk];
  return s;
};

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
  const prepared = await c.autofill(tag(tx));
  const res = await c.submitAndWait(w.sign(prepared).tx_blob);
  return res.result.meta.TransactionResult;
}

const app = express();
app.use(express.json({ limit: '8mb' }));   // accessory submissions carry a small PNG hash + metadata
// CORS — locked to our own origin (not '*'). The canvas/demo are served from GitHub Pages.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Auth gate for all write/mint endpoints. Fail-closed: no token configured OR mismatch => rejected.
// No anonymous minting from the issuer wallet (closes the open-signing-oracle hole).
function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return res.status(503).json({ error: 'minting not configured (ADMIN_TOKEN unset)' });
  if (req.header('x-admin-token') !== ADMIN_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// adopt: mint a mutable pet dNFT owned (in-state) by the user
app.post('/adopt', requireAdmin, async (req, res) => {
  const owner = req.body.owner;
  if (!owner) return res.status(400).json({ error: 'owner required' });
  const out = await withClient(async (c, w) => {
    const now = (await c.request({ command: 'ledger', ledger_index: 'validated' })).result.ledger_index;
    // take the nid from the mint's meta.nftoken_id (robust — last-NFT is wrong once one issuer holds many pets)
    const prepared = await c.autofill(tag({ TransactionType: 'NFTokenMint', Account: w.classicAddress,
      NFTokenTaxon: TAXON, Flags: TF_MUTABLE_TRANSFERABLE, TransferFee: ROYALTY_BPS, URI: enc(R.genesis(now, owner)) }));
    const res = (await c.submitAndWait(w.sign(prepared).tx_blob)).result;
    return { result: res.meta.TransactionResult, nid: res.meta.nftoken_id, state: R.genesis(now, owner) };
  });
  res.json(out);
});

// read pet state
app.get('/pet/:nid', async (req, res) => {
  const s = await withClient((c, w) => readState(c, w.classicAddress, req.params.nid));
  s ? res.json(s) : res.status(404).json({ error: 'pet not found' });
});

// replay the OPEN rules from genesis over the pet's on-ledger interaction history
function replay(genesis, interactions) {
  let s = genesis;
  for (const [op, now, sender] of interactions) s = R.step(s, op, now, sender);
  return s;
}

// verify a pet: re-derive it from its on-ledger history and compare to the on-chain state.
// Multi-pet-sound: genesis = the mint whose meta.nftoken_id == nid; interactions = Payments memo'd
// "<op>|<nid>" for THIS nid (so other pets' interactions are not mixed in). `now` per interaction =
// the Payment's ledger_index (deterministic — the verifiability fix).
async function verifyPet(c, issuer, nid) {
  const current = await readState(c, issuer, nid);
  if (!current) return { ok: false, verdict: 'NOT_FOUND', reason: 'pet not found at issuer' };
  let genesis = null; const interactions = [];
  let marker, scanned = 0;
  do {
    const r = await c.request({ command: 'account_tx', account: issuer, limit: 200, forward: true, marker });
    for (const t of r.result.transactions) {
      const tx = t.tx || t.tx_json || {};
      const lseq = tx.ledger_index || t.ledger_index;
      if (tx.TransactionType === 'NFTokenMint' && tx.URI && t.meta && t.meta.nftoken_id === nid) {
        try { genesis = dec(tx.URI); } catch { /* not our genesis */ }
      } else if (tx.TransactionType === 'Payment' && tx.Destination === issuer) {
        for (const m of (tx.Memos || [])) {
          const md = m.Memo || {};
          try {
            if (unhex(md.MemoType || '') === 'ledgerlings/op') {
              const [opName, mNid] = unhex(md.MemoData || '').split('|');
              if (mNid === nid) interactions.push([R.OP[opName] || 0, lseq, tx.Account]);
            }
          } catch { /* skip malformed memo */ }
        }
      }
    }
    marker = r.result.marker; scanned += r.result.transactions.length;
  } while (marker && scanned < 5000);
  if (!genesis) return { ok: false, verdict: 'NO_GENESIS', reason: 'no mint URI found for this nid' };
  interactions.sort((a, b) => a[1] - b[1]);
  const derived = replay(genesis, interactions);
  const ok = enc(derived) === enc(current);   // reproduce the exact stored bytes
  return { ok, verdict: ok ? 'PASS' : 'DIVERGED', nid, interactions: interactions.length,
    reason: ok ? 'on-ledger state matches a faithful replay of the open rules'
               : 'on-ledger state does NOT match the open rules — the operator deviated' };
}

app.get('/verify/:nid', async (req, res) => {
  try { res.json(await withClient((c, w) => verifyPet(c, w.classicAddress, req.params.nid))); }
  catch (e) { res.status(500).json({ ok: false, verdict: 'ERROR', reason: e.message }); }
});

// interact: verify the signed Payment, apply rules, NFTokenModify
app.post('/interact', requireAdmin, async (req, res) => {
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
    const [opName] = unhex(memo.MemoData).split('|');   // memo is "<op>|<nid>" (nid present for on-ledger verify)
    const op = R.OP[opName] || 0;
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

// mint-accessory: a collaborator's drawn accessory/background → an on-ledger NFT with the 5% royalty.
// The issuer mints (taxon=ACCESSORY_TAXON, transferable); artist + image hash + name are anchored in the
// URI (compact, <=256 bytes). MVP: the URI carries provenance (name/artist/sha256); hosting the image
// itself (IPFS/Arweave) + delivering the NFT to the artist's wallet are the production follow-ups.
app.post('/mint-accessory', requireAdmin, async (req, res) => {
  const { artist, name, sha256, kind } = req.body || {};
  if (!artist || !name || !sha256) return res.status(400).json({ error: 'artist, name, sha256 required' });
  try {
    const out = await withClient(async (c, w) => {
      const meta = { t: 'acc', k: String(kind || 'accessory').slice(0, 12), n: String(name).slice(0, 40),
        a: String(artist).slice(0, 40), h: String(sha256).slice(0, 64), r: ROYALTY_BPS };
      if (Buffer.byteLength(JSON.stringify(meta)) > 256) meta.h = meta.h.slice(0, 32);  // keep URI <=256 bytes
      const prepared = await c.autofill(tag({ TransactionType: 'NFTokenMint', Account: w.classicAddress,
        NFTokenTaxon: ACCESSORY_TAXON, Flags: TF_TRANSFERABLE, TransferFee: ROYALTY_BPS, URI: hex(JSON.stringify(meta)) }));
      const r = (await c.submitAndWait(w.sign(prepared).tx_blob)).result;
      return { result: r.meta.TransactionResult, nid: r.meta.nftoken_id, meta };
    });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// register-character: an NFT project adds their character as a playable Ledgerlings skin (per
// CHARACTER_TEMPLATE.md). Mints a registration NFT (taxon=CHARACTER_TAXON) anchoring creator + name +
// collection + art hash + a hash of the anchor map; 5% royalty. The character runs the SHARED rules
// engine — registration is attribution + roster membership, not game logic.
// AUTHORIZED MINTING: if `creatorAddress` (a valid XRPL r-address) is supplied, we mint with
// Issuer = that address, so the on-ledger TransferFee (resale royalty) routes to the CREATOR, not the
// platform. Precondition: the creator must first authorize our issuer as their NFTokenMinter (one-time
// AccountSet — see GET /minter-info). Without creatorAddress we fall back to a platform-issuer mint
// (royalty supports the project). This is the partition model: characters → creator royalty.
app.post('/register-character', requireAdmin, async (req, res) => {
  const { creator, name, collection, sha256, anchorsHash, creatorAddress } = req.body || {};
  if (!creator || !name || !sha256) return res.status(400).json({ error: 'creator, name, sha256 required' });
  if (creatorAddress && !xrpl.isValidClassicAddress(creatorAddress))
    return res.status(400).json({ error: 'creatorAddress is not a valid XRPL r-address' });
  const authorized = Boolean(creatorAddress);
  try {
    const out = await withClient(async (c, w) => {
      const meta = { t: 'char', n: String(name).slice(0, 32), a: String(creator).slice(0, 32),
        col: String(collection || '').slice(0, 32), h: String(sha256).slice(0, 64),
        x: String(anchorsHash || '').slice(0, 16), r: ROYALTY_BPS };
      if (authorized) meta.iss = creatorAddress;                 // royalty recipient (the creator)
      if (Buffer.byteLength(JSON.stringify(meta)) > 256) { meta.col = meta.col.slice(0, 16); meta.h = meta.h.slice(0, 32); }
      const tx = { TransactionType: 'NFTokenMint', Account: w.classicAddress,
        NFTokenTaxon: CHARACTER_TAXON, Flags: TF_TRANSFERABLE, TransferFee: ROYALTY_BPS, URI: hex(JSON.stringify(meta)) };
      if (authorized) tx.Issuer = creatorAddress;                // authorized mint: TransferFee → creator
      const r = (await c.submitAndWait(w.sign(await c.autofill(tag(tx))).tx_blob)).result;
      return { result: r.meta.TransactionResult, nid: r.meta.nftoken_id, meta,
        royaltyTo: authorized ? 'creator' : 'project',
        royaltyRecipient: authorized ? creatorAddress : w.classicAddress };
    });
    // authorized mint fails closed if the creator hasn't authorized us as their NFTokenMinter yet
    if (authorized && out.result === 'tecNO_PERMISSION') {
      const ourIssuer = await withClient(async (c, w) => w.classicAddress);
      return res.status(409).json({ error: 'authorized-mint not permitted yet', result: out.result, ourIssuer,
        fix: `Creator ${creatorAddress} must first run an AccountSet (from their own wallet) with SetFlag 10 (asfAuthorizedNFTokenMinter) and NFTokenMinter = ${ourIssuer}, then retry. See GET /minter-info.` });
    }
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// minter-info: the one-time AccountSet a creator runs (from THEIR wallet) to authorize Ledgerlings to
// mint as them — so their character's resale royalty routes to THEM. Then register with creatorAddress.
app.get('/minter-info', async (req, res) => {
  try {
    const ourIssuer = await withClient(async (c, w) => w.classicAddress);
    res.json({ ourIssuer,
      instructions: 'From your own wallet, submit the accountSet below (one-time). Then POST /register-character with creatorAddress = your address. Your 5% resale royalty will route to you.',
      accountSet: { TransactionType: 'AccountSet', SetFlag: 10, NFTokenMinter: ourIssuer } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// roster: every registered character (= issuer NFTs at CHARACTER_TAXON). Persistent on-ledger, no DB.
app.get('/roster', async (req, res) => {
  try {
    const out = await withClient(async (c, w) => {
      const r = await c.request({ command: 'account_nfts', account: w.classicAddress, limit: 400 });
      return r.result.account_nfts
        .filter(n => n.NFTokenTaxon === CHARACTER_TAXON && n.URI)
        .map(n => { try { return { nid: n.NFTokenID, ...JSON.parse(unhex(n.URI)) }; } catch { return null; } })
        .filter(Boolean);
    });
    res.json({ characters: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- P2: brokered primary sale (platform's atomic cut, no custody) ----
// Flow: artist lists (sell offer, destination-locked to the platform broker) -> buyer offers price+brokerFee
// (buy offer) -> platform NFTokenAcceptOffer matches both with NFTokenBrokerFee = the spread. Seller (artist)
// receives buy.Amount - BrokerFee = the price; platform keeps the fee; buyer gets the NFT — atomic, no custody.
// Artist must own the pet first (delivered post-mint). Offers returned UNSIGNED for Xaman signing.
const brokerFeeDrops = priceDrops => String(Math.floor(Number(priceDrops) * BROKER_FEE_BPS / 10000));

app.get('/broker-info', async (req, res) => {
  try {
    const broker = await withClient(async (c, w) => w.classicAddress);
    res.json({ broker, brokerFeeBps: BROKER_FEE_BPS, royaltyBps: ROYALTY_BPS });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// artist lists a pet for primary sale -> UNSIGNED sell offer (artist signs via Xaman), locked to the broker.
app.post('/list-pet', async (req, res) => {
  const { artist, nftId, priceXrp } = req.body || {};
  if (!artist || !nftId || !priceXrp) return res.status(400).json({ error: 'artist, nftId, priceXrp required' });
  if (!xrpl.isValidClassicAddress(artist)) return res.status(400).json({ error: 'invalid artist address' });
  try {
    const broker = await withClient(async (c, w) => w.classicAddress);
    const tx = tag({ TransactionType: 'NFTokenCreateOffer', Account: artist, NFTokenID: nftId,
      Amount: xrpl.xrpToDrops(priceXrp), Flags: 1 /* tfSellNFToken */, Destination: broker });
    res.json({ unsignedTx: tx, signWith: 'artist (Xaman)', note: 'sell offer locked to the platform broker' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// buyer offer for a listed pet -> UNSIGNED buy offer for price + broker fee (buyer signs via Xaman).
app.post('/buy-pet', (req, res) => {
  const { buyer, artist, nftId, priceXrp } = req.body || {};
  if (!buyer || !artist || !nftId || !priceXrp) return res.status(400).json({ error: 'buyer, artist, nftId, priceXrp required' });
  if (!xrpl.isValidClassicAddress(buyer) || !xrpl.isValidClassicAddress(artist))
    return res.status(400).json({ error: 'invalid buyer/artist address' });
  const priceDrops = xrpl.xrpToDrops(priceXrp);
  const fee = brokerFeeDrops(priceDrops);
  const total = String(Number(priceDrops) + Number(fee));
  const tx = tag({ TransactionType: 'NFTokenCreateOffer', Account: buyer, Owner: artist, NFTokenID: nftId, Amount: total });
  res.json({ unsignedTx: tx, signWith: 'buyer (Xaman)', priceDrops, brokerFeeDrops: fee, totalDrops: total });
});

// platform matches a sell + buy offer, keeping NFTokenBrokerFee = the spread. Admin-signed, atomic, no custody.
app.post('/broker-sale', requireAdmin, async (req, res) => {
  const { sellOffer, buyOffer, brokerFeeDrops: fee } = req.body || {};
  if (!sellOffer || !buyOffer || !fee) return res.status(400).json({ error: 'sellOffer, buyOffer, brokerFeeDrops required' });
  try {
    const result = await withClient((c, w) => submit(c, w, { TransactionType: 'NFTokenAcceptOffer',
      Account: w.classicAddress, NFTokenSellOffer: sellOffer, NFTokenBuyOffer: buyOffer, NFTokenBrokerFee: String(fee) }));
    res.json({ result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// export the issuer primitives so a harness can drive the logic without starting a server.
module.exports = { app, withClient, readState, submit, verifyPet, replay, enc, dec, hex, unhex, R, TAXON, TF_MUTABLE_TRANSFERABLE, ROYALTY_BPS, ENDPOINT };

if (require.main === module) {
  const PORT = process.env.PORT || 8788;
  app.listen(PORT, () => console.log(`Ledgerlings issuer on :${PORT} (endpoint ${ENDPOINT})`));
}
