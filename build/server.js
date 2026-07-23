/* Ledgerlings issuer backend — the only party that can NFTokenModify a pet.
 * Verifies the player's signed Payment(+op memo) via the Xaman SDK, applies the open rules, and writes the
 * new state to the pet's dNFT URI. Uses the PAYMENT's ledger_index as `now` (so the replay verifier can
 * reproduce decay/age — the verifiability fix).
 *
 * Setup (see XAMAN_SETUP.md):  npm install  ·  set env  ·  node server.js
 *   XAMAN_API_KEY, XAMAN_API_SECRET   (https://apps.xaman.dev)
 *   LEDGERLINGS_ISSUER_SEED            (the SIGNING seed — mints + modifies; KEEP SECRET. In the
 *                                      RegularKey setup this is the REGULARKEY seed, NOT the master.)
 *   ISSUER_ADDRESS                    (optional; the issuer account we act AS = the Account on every
 *                                      tx. Set this to the ISSUER (master) address when the seed above
 *                                      is a RegularKey. Unset => act as the seed's own account.)
 *   XRPL_ENDPOINT                     (default testnet)
 */
const express = require('express');
const xrpl = require('xrpl');
const { XummSdk } = require('xumm-sdk');
const crypto = require('crypto');
const R = require('./pet_rules.js');
const A = require('./achievements.js');
const BR = require('./battle_rules.js');

// sdk only needed for /interact (verifying signed payloads); lazy so /adopt + /pet + tests run without it.
const sdk = process.env.XAMAN_API_KEY ? new XummSdk(process.env.XAMAN_API_KEY, process.env.XAMAN_API_SECRET) : null;
const ENDPOINT = process.env.XRPL_ENDPOINT || 'wss://s.altnet.rippletest.net:51233';
const ISSUER_SEED = process.env.LEDGERLINGS_ISSUER_SEED;
// RegularKey setup: sign with LEDGERLINGS_ISSUER_SEED (the RegularKey) but act AS the issuer account.
// When ISSUER_ADDRESS is set we override the wallet's classicAddress so every tx Account + every
// account_nfts/account_tx lookup targets the ISSUER, while signing still uses the RegularKey keypair
// (the ledger accepts it because the issuer authorized that key via SetRegularKey). Unset => the wallet
// acts as its own account (the plain master-key mode; testnet unaffected).
const ISSUER_ADDRESS = process.env.ISSUER_ADDRESS || undefined;
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
// Achievements (Make Waves #11): soulbound badges — non-transferable (Flags 0), no royalty, own taxon.
// A badge is a PURE PROJECTION of the pet's on-ledger history (achievements.js), so it re-derives + can't be faked.
const ACHIEVEMENT_TAXON = 7780;
// Ruleset version stamped into each badge so it can't be validated against a swapped ruleset.
// Production = the anchored open-rules hash; MVP default 'v1'.
const RULESET_VERSION = String(process.env.RULESET_VERSION || 'v2').slice(0, 12);   // v2: egg hatches in-session
// Auto-mint newly-earned badges inside /interact (more live on-chain txns for the demo). Default ON; AUTO_AWARD=0 disables.
const AUTO_AWARD = process.env.AUTO_AWARD !== '0';
// Battles (Make Waves #10): provably-fair pet duels. Soulbound "battle card" record NFT; own taxon.
const BATTLE_TAXON = 7781;
const BATTLE_FEE_BPS = Number(process.env.BATTLE_FEE_BPS || 500);        // platform cut of the pot (5%)
// Challenger pins a FUTURE ledger N >= now + margin so its hash is unknowable at commit (unbiasable seed).
const BATTLE_LEDGER_MARGIN = Number(process.env.BATTLE_LEDGER_MARGIN || 20);
const BATTLE_MEMO = 'ledgerlings/battle';
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
  try {
    const w = xrpl.Wallet.fromSeed(ISSUER_SEED);
    // RegularKey: sign with w's keypair but ACT AS the issuer — override the address so tx.Account and
    // every account lookup target the issuer; the signature stays the RegularKey's (valid per SetRegularKey).
    if (ISSUER_ADDRESS) w.classicAddress = ISSUER_ADDRESS;
    return await fn(c, w);
  } finally { await c.disconnect(); }
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

// adopt: mint a mutable pet dNFT owned (in-state) by the user. PUBLIC so a real player can start with one tap,
// but hardened: server builds the genesis URI (no state injection) and caps ONE living pet per owner (returns the
// existing one instead of minting again). Only /adopt is public; every other mint stays requireAdmin.
app.post('/adopt', async (req, res) => {
  const owner = req.body.owner;
  if (!owner || !xrpl.isValidClassicAddress(owner)) return res.status(400).json({ error: 'valid owner address required' });
  try {
    const out = await withClient(async (c, w) => {
      // one-living-pet-per-owner cap: return the caller's existing pet rather than minting a second
      for (const n of await allIssuerNfts(c, w.classicAddress)) {
        if (n.NFTokenTaxon !== TAXON || !n.URI) continue;
        let s; try { s = dec(n.URI); } catch { continue; }
        if (s.owner === owner && s.alive !== 0) return { existing: true, nid: n.NFTokenID, state: s };
      }
      const now = (await c.request({ command: 'ledger', ledger_index: 'validated' })).result.ledger_index;
      const prepared = await c.autofill(tag({ TransactionType: 'NFTokenMint', Account: w.classicAddress,
        NFTokenTaxon: TAXON, Flags: TF_MUTABLE_TRANSFERABLE, TransferFee: ROYALTY_BPS, URI: enc(R.genesis(now, owner)) }));
      const rr = (await c.submitAndWait(w.sign(prepared).tx_blob)).result;
      return { result: rr.meta.TransactionResult, nid: rr.meta.nftoken_id, state: R.genesis(now, owner) };
    });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// public config — lets the frontend stamp the Make Waves SourceTag on the PLAYER's own interaction Payment
// (so distinct player accounts show on the leaderboard, not just issuer-built txns).
app.get('/config', (req, res) => {
  res.json({ sourceTag: SOURCE_TAG !== undefined ? SOURCE_TAG : null, taxon: TAXON, rulesetVersion: RULESET_VERSION });
});

// current validated ledger — the frontend uses this as `now` for LIVE pets (real ledger indices) so it can
// gray-out feed/play while on cooldown (no wasted signature on a step() no-op).
app.get('/now', async (req, res) => {
  try { const l = (await withClient((c) => c.request({ command: 'ledger', ledger_index: 'validated' }))).result.ledger_index; res.json({ ledger: l }); }
  catch (e) { res.status(500).json({ error: e.message }); }
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
// Pull a pet's full on-ledger history: genesis mint URI + all interaction Payments (memo'd "<op>|<nid>"
// for THIS nid), each with its Payment ledger_index (= the deterministic `now`). Shared by the pet
// verifier AND the achievements projection so both replay the exact same inputs.
async function loadHistory(c, issuer, nid) {
  const current = await readState(c, issuer, nid);
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
  interactions.sort((a, b) => a[1] - b[1]);
  return { current, genesis, interactions };
}

// verify a pet: re-derive it from its on-ledger history and compare to the on-chain state.
async function verifyPet(c, issuer, nid) {
  const { current, genesis, interactions } = await loadHistory(c, issuer, nid);
  if (!current) return { ok: false, verdict: 'NOT_FOUND', reason: 'pet not found at issuer' };
  if (!genesis) return { ok: false, verdict: 'NO_GENESIS', reason: 'no mint URI found for this nid' };
  const derived = replay(genesis, interactions);
  const ok = enc(derived) === enc(current);   // reproduce the exact stored bytes
  return { ok, verdict: ok ? 'PASS' : 'DIVERGED', nid, interactions: interactions.length,
    reason: ok ? 'on-ledger state matches a faithful replay of the open rules'
               : 'on-ledger state does NOT match the open rules — the operator deviated' };
}

// ---- Achievements (Make Waves #11): badges = a pure projection of the same replay ----
// Compact soulbound-badge codec (hex(JSON) <= 256 bytes, same cap as pets). Full pet nid kept so the
// badge is independently replayable; owner is looked up from the pet, not duplicated.
function encAch(nid, achId, earnedLedger, meta) {
  const o = { t: 'ach', p: nid, i: achId, L: earnedLedger, rv: RULESET_VERSION };
  if (meta && meta.form) o.fm = meta.form;
  let h = hex(JSON.stringify(o));
  if (h.length > 256) { delete o.rv; h = hex(JSON.stringify(o)); }   // shed rv first if oversized (keep pet+id+ledger)
  return h;
}
function decAch(uri) { try { const o = JSON.parse(unhex(uri)); return o && o.t === 'ach' ? o : null; } catch { return null; } }

// all NFTs held by an account (paginated) — badges can accumulate past one page.
async function allIssuerNfts(c, issuer) {
  const out = []; let marker;
  do {
    const r = await c.request({ command: 'account_nfts', account: issuer, limit: 400, marker });
    out.push(...r.result.account_nfts); marker = r.result.marker;
  } while (marker);
  return out;
}
// minted badges (optionally filtered to one pet nid)
async function listAchievements(c, issuer, nid) {
  return (await allIssuerNfts(c, issuer))
    .filter(n => n.NFTokenTaxon === ACHIEVEMENT_TAXON && n.URI)
    .map(n => { const o = decAch(n.URI); return o ? { achNid: n.NFTokenID, ...o } : null; })
    .filter(Boolean)
    .filter(b => !nid || b.p === nid);
}
// mint any newly-earned, not-yet-minted badges for a pet. Idempotent (skips (pet, achId) already on-ledger).
async function claimAchievements(c, w, nid, only) {
  const issuer = w.classicAddress;
  const { genesis, interactions } = await loadHistory(c, issuer, nid);
  if (!genesis) return { minted: [], skipped: [], reason: 'no genesis for nid' };
  const earned = A.achievementsFor(genesis, interactions).filter(e => !only || e.id === only);
  const haveIds = new Set((await listAchievements(c, issuer, nid)).map(b => b.i));
  const minted = [], skipped = [];
  for (const e of earned) {
    if (haveIds.has(e.id)) { skipped.push(e.id); continue; }
    const prepared = await c.autofill(tag({ TransactionType: 'NFTokenMint', Account: issuer,
      NFTokenTaxon: ACHIEVEMENT_TAXON, Flags: 0 /* soulbound: non-transferable, no royalty */,
      URI: encAch(nid, e.id, e.earnedLedger, e.meta) }));
    const r = (await c.submitAndWait(w.sign(prepared).tx_blob)).result;
    minted.push({ id: e.id, earnedLedger: e.earnedLedger, result: r.meta.TransactionResult, achNid: r.meta.nftoken_id });
  }
  return { minted, skipped, earnedCount: earned.length };
}
// verify a badge: re-derive its pet from on-ledger history and assert the badge was earned at the claimed ledger.
async function verifyAchievement(c, issuer, achNid) {
  const badge = (await allIssuerNfts(c, issuer)).find(n => n.NFTokenID === achNid);
  if (!badge) return { ok: false, verdict: 'NOT_FOUND', reason: 'badge not held by issuer' };
  const o = badge.URI && decAch(badge.URI);
  if (!o) return { ok: false, verdict: 'NOT_ACHIEVEMENT', reason: 'not a Ledgerlings badge' };
  const { genesis, interactions } = await loadHistory(c, issuer, o.p);
  if (!genesis) return { ok: false, verdict: 'NO_GENESIS', reason: 'pet for this badge not found' };
  const match = A.achievementsFor(genesis, interactions).find(e => e.id === o.i);
  const ok = Boolean(match) && match.earnedLedger === o.L;
  return { ok, verdict: ok ? 'PASS' : 'FAIL', achNid, pet: o.p, achId: o.i, claimedLedger: o.L,
    derivedLedger: match ? match.earnedLedger : null,
    reason: ok ? 'badge re-derives from the open rules at the claimed ledger'
      : match ? 'earnedLedger mismatch — badge does not match a faithful replay'
              : 'this pet never earned this badge under the open rules' };
}

app.get('/verify/:nid', async (req, res) => {
  try { res.json(await withClient((c, w) => verifyPet(c, w.classicAddress, req.params.nid))); }
  catch (e) { res.status(500).json({ ok: false, verdict: 'ERROR', reason: e.message }); }
});

// claim: mint any newly-earned badges for a pet (admin, idempotent). Optional body.achId limits to one.
app.post('/claim-achievement', requireAdmin, async (req, res) => {
  const { nid, achId } = req.body || {};
  if (!nid) return res.status(400).json({ error: 'nid required' });
  try { res.json(await withClient((c, w) => claimAchievements(c, w, nid, achId))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// list a pet's minted badges + the full catalog (public).
app.get('/achievements/:nid', async (req, res) => {
  try {
    const badges = await withClient((c, w) => listAchievements(c, w.classicAddress, req.params.nid));
    res.json({ nid: req.params.nid, badges,
      catalog: A.CATALOG.map(a => ({ id: a.id, label: a.label, desc: a.desc })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// verify a badge: re-derive it from the pet's on-ledger history (public — the fairness proof).
app.get('/verify-achievement/:achNid', async (req, res) => {
  try { res.json(await withClient((c, w) => verifyAchievement(c, w.classicAddress, req.params.achNid))); }
  catch (e) { res.status(500).json({ ok: false, verdict: 'ERROR', reason: e.message }); }
});

// ---- Provably-fair battles (Make Waves #10) ----
// Seed = SHA-256(ledgerHash(N) | battleId | aNid | bNid). N is pinned in the future at challenge time, so its
// hash is unknowable to anyone until it closes => unbiasable, yet re-derivable by anyone. (Same idea as `now`.)
function seedFor(ledgerHash, battleId, aNid, bNid) {
  return crypto.createHash('sha256').update([ledgerHash, battleId, aNid, bNid].join('|')).digest('hex');
}
// pet state AS OF ledger N = replay only the interactions up to N (so the result is fixed + re-derivable).
function stateAtLedger(genesis, interactions, N) {
  return replay(genesis, interactions.filter(([, lseq]) => lseq <= N));
}
async function ledgerHashOf(c, N) {
  const r = await c.request({ command: 'ledger', ledger_index: Number(N) });
  return (r.result.ledger && r.result.ledger.ledger_hash) || r.result.ledger_hash || null;
}
// a battle lives entirely in three memo'd Payments on the issuer: challenge (tx hash = battleId), accept, result.
async function loadBattle(c, issuer, battleId) {
  const out = { battleId, challenge: null, accept: null, result: null };
  let marker, scanned = 0;
  do {
    const r = await c.request({ command: 'account_tx', account: issuer, limit: 200, forward: true, marker });
    for (const t of r.result.transactions) {
      const tx = t.tx || t.tx_json || {}; if (tx.TransactionType !== 'Payment') continue;
      const hash = tx.hash || t.hash || ''; const lseq = tx.ledger_index || t.ledger_index;
      for (const m of (tx.Memos || [])) {
        const md = m.Memo || {};
        try {
          if (unhex(md.MemoType || '') !== BATTLE_MEMO) continue;
          const f = unhex(md.MemoData || '').split('|'), kind = f[0];
          if (kind === 'challenge' && hash === battleId) out.challenge = { aNid: f[1], stakeDrops: f[2], N: Number(f[3]), ownerA: tx.Account, delivered: (t.meta && t.meta.delivered_amount) || tx.Amount, lseq };
          else if (kind === 'accept' && f[1] === battleId) out.accept = { bNid: f[2], ownerB: tx.Account, delivered: (t.meta && t.meta.delivered_amount) || tx.Amount, lseq };
          else if (kind === 'result' && f[1] === battleId) out.result = { winnerNid: f[2], scoreA: Number(f[3]), scoreB: Number(f[4]), rv: f[5], dest: tx.Destination, lseq };
        } catch { /* skip malformed memo */ }
      }
    }
    marker = r.result.marker; scanned += r.result.transactions.length;
  } while (marker && scanned < 8000);
  return out;
}
// resolve (admin, idempotent): re-derive the winner from the pinned ledger hash + open rules, pay the winner, mint a card.
async function resolveBattleTx(c, w, battleId) {
  const issuer = w.classicAddress;
  const b = await loadBattle(c, issuer, battleId);
  if (!b.challenge) return { error: 'battle not found', battleId };
  if (!b.accept) return { status: 'OPEN', error: 'not accepted yet' };
  if (b.result) return { status: 'ALREADY_RESOLVED', result: b.result };     // idempotent — never double-pay
  const { aNid, N } = b.challenge, { bNid } = b.accept;
  const lh = await ledgerHashOf(c, N);
  if (!lh) return { error: 'pinned ledger not validated yet', N };
  const seed = seedFor(lh, battleId, aNid, bNid);
  const hA = await loadHistory(c, issuer, aNid), hB = await loadHistory(c, issuer, bNid);
  if (!hA.genesis || !hB.genesis) return { error: 'a pet in this battle was not found' };
  const sA = stateAtLedger(hA.genesis, hA.interactions, N), sB = stateAtLedger(hB.genesis, hB.interactions, N);
  const d = BR.resolveBattle(seed, sA, sB, aNid, bNid);
  // Custody guard (mainnet-safe): pot = what ACTUALLY arrived (meta.delivered_amount), not the memo. If either
  // side delivered less than the agreed stake, VOID the battle and refund the actual amounts — no one can win the
  // counterpart's real XRP by under-delivering their own stake.
  const stake = Number(b.challenge.stakeDrops || 0);
  const deliveredA = Number(b.challenge.delivered || 0), deliveredB = Number(b.accept.delivered || 0);
  if (deliveredA < stake || deliveredB < stake) {
    const voidMemo = [{ Memo: { MemoType: hex(BATTLE_MEMO), MemoData: hex(['result', battleId, 'VOID', 0, 0, RULESET_VERSION].join('|')) } }];
    if (deliveredA > 0) await submit(c, w, { TransactionType: 'Payment', Account: issuer, Destination: b.challenge.ownerA, Amount: String(Math.max(1, deliveredA)), Memos: voidMemo });
    if (deliveredB > 0) await submit(c, w, { TransactionType: 'Payment', Account: issuer, Destination: b.accept.ownerB, Amount: String(Math.max(1, deliveredB)) });
    return { battleId, status: 'VOID', reason: 'stake underpaid — refunded actual amounts', stake, deliveredA, deliveredB };
  }
  const winnerNid = d.winner === null ? 'DRAW' : d.winner;
  const pot = deliveredA + deliveredB;
  const fee = Math.floor(pot * BATTLE_FEE_BPS / 10000);
  const resultMemo = [{ Memo: { MemoType: hex(BATTLE_MEMO), MemoData: hex(['result', battleId, winnerNid, d.scoreA, d.scoreB, RULESET_VERSION].join('|')) } }];
  let payout;
  if (d.winner === null) {                                                    // draw → refund both, carry result memo
    await submit(c, w, { TransactionType: 'Payment', Account: issuer, Destination: b.challenge.ownerA, Amount: '1', Memos: resultMemo });
    if (deliveredA > 1) await submit(c, w, { TransactionType: 'Payment', Account: issuer, Destination: b.challenge.ownerA, Amount: String(deliveredA) });
    if (deliveredB > 1) await submit(c, w, { TransactionType: 'Payment', Account: issuer, Destination: b.accept.ownerB, Amount: String(deliveredB) });
    payout = { winner: 'DRAW', refunded: true };
  } else {
    const winnerOwner = d.winner === aNid ? sA.owner : sB.owner;
    const amount = String(Math.max(1, pot - fee));
    const rr = await submit(c, w, { TransactionType: 'Payment', Account: issuer, Destination: winnerOwner, Amount: amount, Memos: resultMemo });
    payout = { winner: winnerNid, winnerOwner, paidDrops: amount, feeDrops: fee, result: rr };
  }
  let card;                                                                   // cosmetic soulbound "battle card" keepsake
  try {
    const cp = await c.autofill(tag({ TransactionType: 'NFTokenMint', Account: issuer, NFTokenTaxon: BATTLE_TAXON, Flags: 0,
      URI: hex(JSON.stringify({ t: 'btl', i: battleId.slice(0, 32), w: (d.winner || 'DRAW').slice(0, 24), N })) }));
    const cr = (await c.submitAndWait(w.sign(cp).tx_blob)).result;
    card = { nid: cr.meta.nftoken_id, result: cr.meta.TransactionResult };
  } catch (e) { card = { error: e.message }; }
  return { battleId, winner: winnerNid, scoreA: d.scoreA, scoreB: d.scoreB, rollA: d.rollA, rollB: d.rollB, powerA: d.powerA, powerB: d.powerB, seed, pot, fee, payout, card };
}
// verify (public): re-derive winner + scores from the pinned ledger + open rules; confirm the payout went to the winner.
async function verifyBattle(c, issuer, battleId) {
  const b = await loadBattle(c, issuer, battleId);
  if (!b.challenge) return { ok: false, verdict: 'NOT_FOUND', reason: 'no challenge with this id' };
  if (!b.accept) return { ok: false, verdict: 'OPEN', reason: 'not accepted yet' };
  if (!b.result) return { ok: false, verdict: 'UNRESOLVED', reason: 'not resolved yet' };
  if (b.result.winnerNid === 'VOID') {   // battle was voided for underpayment; refunds are on-ledger + checkable
    const stake = Number(b.challenge.stakeDrops || 0), dA = Number(b.challenge.delivered || 0), dB = Number(b.accept.delivered || 0);
    const legit = dA < stake || dB < stake;
    return { ok: legit, verdict: legit ? 'VOID' : 'FAIL', battleId, reason: legit ? 'voided: a party delivered less than the agreed stake; refunded' : 'VOID recorded but both stakes were fully delivered' };
  }
  const { aNid, N } = b.challenge, { bNid } = b.accept;
  const lh = await ledgerHashOf(c, N);
  if (!lh) return { ok: false, verdict: 'ERROR', reason: 'pinned ledger not available' };
  const seed = seedFor(lh, battleId, aNid, bNid);
  const hA = await loadHistory(c, issuer, aNid), hB = await loadHistory(c, issuer, bNid);
  const sA = stateAtLedger(hA.genesis, hA.interactions, N), sB = stateAtLedger(hB.genesis, hB.interactions, N);
  const d = BR.resolveBattle(seed, sA, sB, aNid, bNid);
  const derivedWinner = d.winner === null ? 'DRAW' : d.winner;
  const winnerMatch = derivedWinner === b.result.winnerNid;
  const scoresMatch = d.scoreA === b.result.scoreA && d.scoreB === b.result.scoreB;
  const winnerOwner = d.winner === aNid ? sA.owner : d.winner === bNid ? sB.owner : null;
  const paidRight = d.winner === null || b.result.dest === winnerOwner;
  const ok = winnerMatch && scoresMatch && paidRight;
  return { ok, verdict: ok ? 'PASS' : 'FAIL', battleId, N, seed,
    derived: { winner: derivedWinner, scoreA: d.scoreA, scoreB: d.scoreB, winnerOwner }, recorded: b.result,
    reason: ok ? 'winner + scores re-derive from the pinned ledger hash and the open rules; payout went to the winner'
      : !winnerMatch ? 'recorded winner does not match a faithful replay'
      : !scoresMatch ? 'recorded scores do not match the replay' : 'payout did not go to the derived winner' };
}

// challenge → returns an UNSIGNED stake Payment (owner signs via Xaman). Pins a future ledger N for the seed.
app.post('/battle/challenge', async (req, res) => {
  const { owner, aNid, stakeXrp, N } = req.body || {};
  if (!owner || !aNid) return res.status(400).json({ error: 'owner + aNid required' });
  if (!xrpl.isValidClassicAddress(owner)) return res.status(400).json({ error: 'invalid owner address' });
  try {
    const out = await withClient(async (c, w) => {
      const issuer = w.classicAddress;
      const ps = await readState(c, issuer, aNid);
      if (!ps) return { error: 'pet not found' };
      if (ps.owner !== owner) return { error: 'you do not own this pet' };
      if (ps.alive === 0) return { error: 'a passed pet cannot battle' };
      const cur = (await c.request({ command: 'ledger', ledger_index: 'validated' })).result.ledger_index;
      const targetN = Number.isInteger(Number(N)) && Number(N) >= cur + BATTLE_LEDGER_MARGIN ? Number(N) : cur + BATTLE_LEDGER_MARGIN;
      const drops = stakeXrp ? xrpl.xrpToDrops(stakeXrp) : '1';   // 0-stake friendly = 1 drop to carry the memo
      return { unsignedTx: tag({ TransactionType: 'Payment', Account: owner, Destination: issuer, Amount: String(drops),
          Memos: [{ Memo: { MemoType: hex(BATTLE_MEMO), MemoData: hex(['challenge', aNid, String(drops), String(targetN)].join('|')) } }] }),
        signWith: 'owner (Xaman)', pinnedLedger: targetN, currentLedger: cur,
        note: 'battleId = this Payment tx hash after it validates; share it so an opponent can POST /battle/accept' };
    });
    if (out.error) return res.status(400).json(out);
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// accept → returns an UNSIGNED matching-stake Payment (opponent signs via Xaman).
app.post('/battle/accept', async (req, res) => {
  const { owner, battleId, bNid } = req.body || {};
  if (!owner || !battleId || !bNid) return res.status(400).json({ error: 'owner + battleId + bNid required' });
  if (!xrpl.isValidClassicAddress(owner)) return res.status(400).json({ error: 'invalid owner address' });
  try {
    const out = await withClient(async (c, w) => {
      const issuer = w.classicAddress;
      const b = await loadBattle(c, issuer, battleId);
      if (!b.challenge) return { error: 'unknown battleId' };
      if (b.accept) return { error: 'already accepted' };
      if (bNid === b.challenge.aNid) return { error: 'a pet cannot battle itself' };
      // must accept BEFORE the pinned ledger closes — otherwise ledgerHash(N) is known and the accepter
      // could join only when the seed already favors them. Closes the accepter-foreknowledge bias.
      const curL = (await c.request({ command: 'ledger', ledger_index: 'validated' })).result.ledger_index;
      if (curL >= b.challenge.N) return { error: `challenge expired: pinned ledger ${b.challenge.N} already reached (current ${curL})` };
      const ps = await readState(c, issuer, bNid);
      if (!ps) return { error: 'pet not found' };
      if (ps.owner !== owner) return { error: 'you do not own this pet' };
      if (ps.alive === 0) return { error: 'a passed pet cannot battle' };
      const drops = b.challenge.amount || '1';   // must match the challenger's stake
      return { unsignedTx: tag({ TransactionType: 'Payment', Account: owner, Destination: issuer, Amount: String(drops),
          Memos: [{ Memo: { MemoType: hex(BATTLE_MEMO), MemoData: hex(['accept', battleId, bNid].join('|')) } }] }),
        signWith: 'owner (Xaman)', matchStakeDrops: String(drops) };
    });
    if (out.error) return res.status(400).json(out);
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// resolve (admin) · status (public) · verify (public — the fairness proof)
app.post('/battle/resolve', requireAdmin, async (req, res) => {
  const { battleId } = req.body || {};
  if (!battleId) return res.status(400).json({ error: 'battleId required' });
  try { res.json(await withClient((c, w) => resolveBattleTx(c, w, battleId))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/battle/:battleId', async (req, res) => {
  try {
    const b = await withClient((c, w) => loadBattle(c, w.classicAddress, req.params.battleId));
    res.json({ status: !b.challenge ? 'NOT_FOUND' : b.result ? 'RESOLVED' : b.accept ? 'LIVE' : 'OPEN', ...b });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/verify-battle/:battleId', async (req, res) => {
  try { res.json(await withClient((c, w) => verifyBattle(c, w.classicAddress, req.params.battleId))); }
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
    // auto-award: mint any milestone badge this interaction just crossed (more live on-chain txns). Non-fatal.
    let achievements;
    if (AUTO_AWARD) { try { achievements = await claimAchievements(c, w, nid); } catch (e) { achievements = { error: e.message }; } }
    return { result, state: next, applied: JSON.stringify(next) !== JSON.stringify(state), achievements };
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

// ---- Issuer poller: auto-applies signed interactions (no operator in the loop) ----
// A pet's correct state = replay(its on-ledger history). The poller reconciles each pet to that replay:
// if the on-ledger URI differs, it NFTokenModifies to the derived state + auto-awards badges. Idempotent
// (no-op once matched) and self-healing (actively enforces the same property /verify checks).
async function reconcilePet(c, w, nid) {
  const { current, genesis, interactions } = await loadHistory(c, w.classicAddress, nid);
  if (!genesis || !current) return { nid, updated: false };
  const derived = replay(genesis, interactions);
  if (enc(derived) === enc(current)) return { nid, updated: false };
  await submit(c, w, { TransactionType: 'NFTokenModify', Account: w.classicAddress, NFTokenID: nid, URI: enc(derived) });
  if (AUTO_AWARD) { try { await claimAchievements(c, w, nid); } catch { /* badge mint best-effort */ } }
  return { nid, updated: true, state: derived };
}
let pollerLastLedger = 0;
async function pollerTick(c, w) {
  const issuer = w.classicAddress; const affected = new Set(); let marker;
  do {
    const r = await c.request({ command: 'account_tx', account: issuer, ledger_index_min: pollerLastLedger + 1, ledger_index_max: -1, forward: true, limit: 200, marker });
    for (const t of r.result.transactions) {
      const tx = t.tx || t.tx_json || {}; const lseq = tx.ledger_index || t.ledger_index;
      if (lseq && lseq > pollerLastLedger) pollerLastLedger = lseq;
      if (tx.TransactionType === 'Payment' && tx.Destination === issuer) {
        for (const mm of (tx.Memos || [])) { const md = mm.Memo || {}; try { if (unhex(md.MemoType || '') === 'ledgerlings/op') { const p = unhex(md.MemoData || '').split('|'); if (p[1]) affected.add(p[1]); } } catch { /* skip */ } }
      }
    }
    marker = r.result.marker;
  } while (marker);
  for (const nid of affected) { try { await reconcilePet(c, w, nid); } catch (e) { console.warn('[poller] reconcile', nid.slice(0, 8), e.message); } }
  return affected.size;
}
async function startPoller() {
  if (!ISSUER_SEED) { console.warn('[poller] disabled — no LEDGERLINGS_ISSUER_SEED'); return; }
  const c = new xrpl.Client(ENDPOINT); await c.connect();
  const w = xrpl.Wallet.fromSeed(ISSUER_SEED); if (ISSUER_ADDRESS) w.classicAddress = ISSUER_ADDRESS;
  // catch up every existing pet once, then only react to new interactions.
  const pets = (await allIssuerNfts(c, w.classicAddress)).filter(n => n.NFTokenTaxon === TAXON);
  for (const n of pets) { try { await reconcilePet(c, w, n.NFTokenID); } catch (e) { console.warn('[poller] init', e.message); } }
  pollerLastLedger = (await c.request({ command: 'ledger', ledger_index: 'validated' })).result.ledger_index;
  console.log(`[poller] watching ${w.classicAddress}; caught up ${pets.length} pet(s); tracking from ledger ${pollerLastLedger}`);
  const loop = async () => {
    try { if (!c.isConnected()) await c.connect(); await pollerTick(c, w); }
    catch (e) { console.warn('[poller] tick', e.message); }
    setTimeout(loop, 6000);
  };
  setTimeout(loop, 6000);
}

// export the issuer primitives so a harness can drive the logic without starting a server.
module.exports = { app, withClient, readState, submit, verifyPet, replay, enc, dec, hex, unhex, R, TAXON, TF_MUTABLE_TRANSFERABLE, ROYALTY_BPS, ENDPOINT,
  A, loadHistory, encAch, decAch, listAchievements, claimAchievements, verifyAchievement, ACHIEVEMENT_TAXON, RULESET_VERSION,
  BR, seedFor, stateAtLedger, loadBattle, resolveBattleTx, verifyBattle, ledgerHashOf, BATTLE_TAXON, BATTLE_FEE_BPS, BATTLE_LEDGER_MARGIN, BATTLE_MEMO,
  reconcilePet, pollerTick, startPoller, allIssuerNfts };

if (require.main === module) {
  const PORT = process.env.PORT || 8788;
  app.listen(PORT, () => console.log(`Ledgerlings issuer on :${PORT} (endpoint ${ENDPOINT})`));
  if (process.env.POLLER !== '0') startPoller().catch(e => console.warn('[poller] failed to start', e.message));
}
