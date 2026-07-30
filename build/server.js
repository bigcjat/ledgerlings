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
// Ledgers between the challenge landing and the ledger whose hash seeds it. ~4s each, so 20 is
// roughly 80 seconds: long enough that the seed cannot be known at commitment, short enough that a
// player is not left waiting. Counted from the CHALLENGE's ledger, not from when the payload was built.
const BATTLE_LEDGER_MARGIN = Number(process.env.BATTLE_LEDGER_MARGIN || 20);
const BATTLE_MEMO = 'ledgerlings/battle';
// House ladder: PUBLISHED NPC opponents (open stat blocks, versioned). Because the opponent's stats are public
// + fixed, a ladder battle is as provably-fair as PvP — the seed is still the pinned ledger hash and
// verify-battle re-derives the winner from (player history @N, the published NPC block, seed). Free (no wager).
const LADDER = [
  { id: 'runt',     name: 'Scrappy Runt',      stats: { stage: 1, form: 1, care: 20,  care_max: 40,  health: 70, alive: 1 } },
  { id: 'sparring', name: 'Sparring Partner',  stats: { stage: 2, form: 2, care: 60,  care_max: 80,  health: 85, alive: 1 } },
  { id: 'veteran',  name: 'Grizzled Veteran',  stats: { stage: 3, form: 3, care: 150, care_max: 180, health: 92, alive: 1 } },
  { id: 'champion', name: 'Ladder Champion',   stats: { stage: 4, form: 4, care: 230, care_max: 240, health: 98, alive: 1 } },
];
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

// xrpl.Wallet.fromSeed() defaults to ed25519 and, given a secp256k1 family seed, SILENTLY derives a
// different account rather than erroring. Xaman "secret numbers" accounts are secp256k1, so a seed
// exported from Xaman would produce the wrong keypair here and every signature would fail auth with
// nothing in the logs pointing at why. Encoded ed25519 seeds start with "sEd"; everything else is
// secp256k1, so the prefix decides it.
const walletFromSeed = seed =>
  xrpl.Wallet.fromSeed(seed, { algorithm: seed.startsWith('sEd') ? 'ed25519' : 'ecdsa-secp256k1' });

async function withClient(fn) {
  const c = new xrpl.Client(ENDPOINT); await c.connect();
  try {
    const w = walletFromSeed(ISSUER_SEED);
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
// Railway terminates TLS at its edge and forwards the real scheme in x-forwarded-proto. Without
// this, req.protocol reports 'http', so the share page emitted og:image and twitter:image as
// http:// URLs — and X/Twitter, Discord and Slack all refuse to fetch card images over plain http.
// The viral loop (/p/:nid share pages) rendered link previews with no image because of it.
app.set('trust proxy', true);
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
  // Bound the scan to the pet's own lifetime: its genesis mint is at ledger `birth` and every interaction is
  // after it, so ledger_index_min = birth guarantees we never miss genesis AND never truncate history — the
  // arbitrary count cap is gone (it silently caused false NO_GENESIS/DIVERGED as issuer volume grew). This also
  // avoids re-scanning the issuer's entire history for every verify/reconcile. (Optimization for extreme scale:
  // maintain a per-nid tx index; for hackathon volume the birth-bounded window is fine.)
  const minLedger = current && Number.isInteger(current.birth) ? current.birth : null;
  let genesis = null; const interactions = [];
  let marker;
  do {
    const req = { command: 'account_tx', account: issuer, limit: 200, forward: true, marker };
    if (minLedger != null) req.ledger_index_min = minLedger;
    const r = await c.request(req);
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
    marker = r.result.marker;
  } while (marker);
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
    derived, current,     // both states, so the UI can show the field-level match + a live "rig it" demo
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
  let marker;   // full pagination (no count cap) — battles are low-frequency; correctness over a bounded scan
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
          else if (kind === 'ladder' && hash === battleId) out.challenge = { aNid: f[1], rung: Number(f[2]), N: Number(f[3]), ownerA: tx.Account, npc: true, lseq };
          else if (kind === 'accept' && f[1] === battleId) out.accept = { bNid: f[2], ownerB: tx.Account, delivered: (t.meta && t.meta.delivered_amount) || tx.Amount, lseq };
          else if (kind === 'result' && f[1] === battleId) out.result = { winnerNid: f[2], scoreA: Number(f[3]), scoreB: Number(f[4]), rv: f[5], dest: tx.Destination, lseq };
        } catch { /* skip malformed memo */ }
      }
    }
    marker = r.result.marker;
  } while (marker);
  return out;
}
// resolve (admin, idempotent): re-derive the winner from the pinned ledger hash + open rules, pay the winner, mint a card.
// ladder (vs a published house NPC): no accept, no wager. Free, provably fair, solo-climbable.
async function resolveLadder(c, w, battleId, b) {
  const issuer = w.classicAddress;
  const { aNid, rung, ownerA, lseq } = b.challenge;
  const npc = LADDER[rung];
  if (!npc) return { error: 'invalid ladder rung', rung };

  // SEED LEDGER IS DERIVED, NOT TAKEN FROM THE MEMO.
  //
  // /sign pins N = current + margin when the PAYLOAD IS BUILT, but the player signs whenever they
  // get round to it. On 2026-07-30 a real challenge was built pinning 105955044 and landed in
  // 105955051, so the "unknowable future ledger" had already closed seven ledgers before the
  // challenge was even recorded. Its hash was public at the moment of commitment, and the whole
  // unriggability claim evaporates: a player who waits can read the seed before deciding to sign.
  //
  // Deriving the seed ledger from the ledger the challenge LANDED in fixes that by construction. It
  // is strictly in the future relative to the commitment no matter how long the player takes, and it
  // is still fully public and re-derivable by anyone reading the challenge transaction.
  //
  // The memo's N is kept only to detect the stale case and say so.
  const claimedN = b.challenge.N;
  if (!lseq) return { error: 'challenge ledger unknown', battleId };
  const N = lseq + BATTLE_LEDGER_MARGIN;
  const staleCommitment = Number.isInteger(claimedN) && claimedN <= lseq;

  const lh = await ledgerHashOf(c, N);
  if (!lh) return { error: 'pinned ledger not validated yet', N };
  const npcId = 'NPC:' + npc.id;
  const seed = seedFor(lh, battleId, aNid, npcId);
  const h = await loadHistory(c, issuer, aNid);
  if (!h.genesis) return { error: 'pet not found' };
  const sA = stateAtLedger(h.genesis, h.interactions, N);
  const d = BR.resolveBattle(seed, sA, npc.stats, aNid, npcId);
  const winnerNid = d.winner === null ? 'DRAW' : d.winner, playerWon = d.winner === aNid;
  const resultMemo = [{ Memo: { MemoType: hex(BATTLE_MEMO), MemoData: hex(['result', battleId, winnerNid, d.scoreA, d.scoreB, RULESET_VERSION].join('|')) } }];
  await submit(c, w, { TransactionType: 'Payment', Account: issuer, Destination: ownerA, Amount: '1', Memos: resultMemo });   // 1-drop carries the result
  let card;
  if (playerWon) { try {
    const cp = await c.autofill(tag({ TransactionType: 'NFTokenMint', Account: issuer, NFTokenTaxon: BATTLE_TAXON, Flags: 0,
      URI: hex(JSON.stringify({ t: 'btl', i: battleId.slice(0, 32), w: aNid.slice(0, 24), N, npc: npc.id })) }));
    const cr = (await c.submitAndWait(w.sign(cp).tx_blob)).result; card = { nid: cr.meta.nftoken_id, result: cr.meta.TransactionResult };
  } catch (e) { card = { error: e.message }; } }
  return { battleId, ladder: true, opponent: npc.name, rung, winner: playerWon ? 'player' : (d.winner === null ? 'DRAW' : 'NPC'),
    scoreA: d.scoreA, scoreB: d.scoreB, rollA: d.rollA, rollB: d.rollB, powerA: d.powerA, powerB: d.powerB,
    seed, seedLedger: N, challengeLedger: lseq, claimedN,
    staleCommitment: staleCommitment || undefined,   // the memo pinned a ledger that had already closed
    card };
}

async function resolveBattleTx(c, w, battleId) {
  const issuer = w.classicAddress;
  const b = await loadBattle(c, issuer, battleId);
  if (!b.challenge) return { error: 'battle not found', battleId };
  if (b.result) return { status: 'ALREADY_RESOLVED', result: b.result };     // idempotent — never double-pay
  if (b.challenge.npc) return resolveLadder(c, w, battleId, b);               // ladder path (no accept/wager)
  if (!b.accept) return { status: 'OPEN', error: 'not accepted yet' };
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
  if (b.challenge.npc) {   // ladder: opponent stats come from the PUBLISHED NPC table (that is why it stays provably fair)
    if (!b.result) return { ok: false, verdict: 'UNRESOLVED', reason: 'not resolved yet' };
    const { aNid, rung, lseq } = b.challenge, npc = LADDER[rung];
    if (!npc) return { ok: false, verdict: 'BAD_RUNG', reason: 'invalid ladder rung' };
    // Same derivation as resolveLadder: seed ledger counted from the ledger the challenge LANDED in,
    // so it is always after the commitment. Verifying against the memo's N instead would confirm the
    // arithmetic while missing whether the seed was knowable when the player signed — which is the
    // only property that makes this fair. A verifier that cannot fail on that is not a verifier.
    const claimedN = b.challenge.N;
    const N = (lseq || 0) + BATTLE_LEDGER_MARGIN;
    const staleCommitment = Number.isInteger(claimedN) && lseq && claimedN <= lseq;
    const lh = await ledgerHashOf(c, N); if (!lh) return { ok: false, verdict: 'ERROR', reason: 'pinned ledger not available' };
    const npcId = 'NPC:' + npc.id, seed = seedFor(lh, battleId, aNid, npcId);
    const h = await loadHistory(c, issuer, aNid), sA = stateAtLedger(h.genesis, h.interactions, N);
    const d = BR.resolveBattle(seed, sA, npc.stats, aNid, npcId), derivedWinner = d.winner === null ? 'DRAW' : d.winner;
    const ok = derivedWinner === b.result.winnerNid && d.scoreA === b.result.scoreA && d.scoreB === b.result.scoreB;
    return { ok, verdict: ok ? 'PASS' : 'FAIL', battleId, ladder: true, opponent: npc.name,
      seedLedger: N, challengeLedger: lseq, claimedN,
      ...(staleCommitment ? { warning: 'STALE_COMMITMENT', warningDetail:
        `the challenge memo pinned ledger ${claimedN}, which had already closed when the challenge landed in ${lseq}. `
        + 'That seed was public at signing time. Resolution used the derived ledger instead.' } : {}),
      derived: { winner: derivedWinner, scoreA: d.scoreA, scoreB: d.scoreB }, recorded: b.result,
      reason: ok ? 'ladder result re-derives from the pinned ledger hash + the published NPC stats + open rules' : 'recorded ladder result does not match a faithful replay' };
  }
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

// ladder: the PUBLISHED house-NPC roster (opponents are public + fixed → provably fair). Auditable.
// ── server-side sign requests ────────────────────────────────────────────────────────────────────
// The browser SDK's authorize() hangs on both desktop and mobile: no popup, no error, no rejection.
// The app registration is fine (opening the OAuth URL by hand renders a real Xaman sign request), so
// rather than keep fighting the client flow, payloads are created here with the server credentials.
// This is the ordinary Xaman server integration and it needs no sign-in at all: the player supplies
// an address, we build the transaction, Xaman shows it to them, they approve.
//
// DELIBERATELY NOT A GENERIC SIGNING PROXY. It only ever builds the two transactions this game
// defines, from validated inputs. An endpoint that signed arbitrary txjson would let anyone create
// payloads under this app's identity and show users transactions we did not author.
app.post('/sign', async (req, res) => {
  if (!sdk) return res.status(503).json({ error: 'signing not configured (set XAMAN_API_KEY and XAMAN_API_SECRET)' });
  const { kind, owner, nid, op, rung } = req.body || {};
  if (!xrpl.isValidClassicAddress(owner || '')) return res.status(400).json({ error: 'valid owner address required' });

  try {
    let txjson, instruction;

    if (kind === 'interact') {
      if (!R.OP[op]) return res.status(400).json({ error: 'unknown op' });
      if (!nid) return res.status(400).json({ error: 'nid required' });
      txjson = { TransactionType: 'Payment', Account: owner, Destination: ISSUER_ADDRESS || undefined,
        Amount: '10', Memos: [{ Memo: { MemoType: hex('ledgerlings/op'), MemoData: hex(`${op}|${nid}`) } }] };
      instruction = `Ledgerlings: ${op} your pet`;

    } else if (kind === 'ladder') {
      if (!LADDER[rung]) return res.status(400).json({ error: 'invalid rung (see GET /ladder)' });
      if (!nid) return res.status(400).json({ error: 'nid required' });
      const built = await withClient(async (c, w) => {
        const ps = await readState(c, w.classicAddress, nid);
        if (!ps) return { error: 'pet not found' };
        if (ps.owner !== owner) return { error: 'you do not own this pet' };
        if (ps.alive === 0) return { error: 'a passed pet cannot battle' };
        const cur = (await c.request({ command: 'ledger', ledger_index: 'validated' })).result.ledger_index;
        const N = cur + BATTLE_LEDGER_MARGIN;
        return { N, tx: { TransactionType: 'Payment', Account: owner, Destination: w.classicAddress, Amount: '1',
          Memos: [{ Memo: { MemoType: hex(BATTLE_MEMO), MemoData: hex(['ladder', nid, String(rung), String(N)].join('|')) } }] } };
      });
      if (built.error) return res.status(400).json(built);
      txjson = built.tx;
      instruction = `Ledgerlings: challenge ${LADDER[rung].name}`;
      res.locals = { pinnedLedger: built.N };

    } else {
      return res.status(400).json({ error: "kind must be 'interact' or 'ladder'" });
    }

    const payload = await sdk.payload.create({ txjson: tag(txjson), custom_meta: { instruction } });
    if (!payload) return res.status(502).json({ error: 'Xaman did not return a payload' });
    res.json({
      uuid: payload.uuid,
      next: payload.next && payload.next.always,     // open this: Xaman deep link on mobile, QR on desktop
      qr: payload.refs && payload.refs.qr_png,
      pinnedLedger: (res.locals && res.locals.pinnedLedger) || undefined,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Poll a sign request. Returns signed:true plus the txid once the user approves in Xaman.
app.get('/sign/:uuid', async (req, res) => {
  if (!sdk) return res.status(503).json({ error: 'signing not configured' });
  try {
    const pl = await sdk.payload.get(req.params.uuid);
    if (!pl) return res.status(404).json({ error: 'not found' });
    res.json({ signed: !!(pl.meta && pl.meta.signed), cancelled: !!(pl.meta && pl.meta.cancelled),
      expired: !!(pl.meta && pl.meta.expired), txid: pl.response && pl.response.txid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/ladder', (req, res) => {
  res.json({ rulesetVersion: RULESET_VERSION, rungs: LADDER.map((n, i) => ({ rung: i, id: n.id, name: n.name, stats: n.stats, power: BR.power(n.stats) })) });
});
// ladder challenge → unsigned 0-stake Payment (owner signs via Xaman). Then POST /battle/resolve after ledger N.
app.post('/battle/ladder', async (req, res) => {
  const { owner, aNid, rung } = req.body || {};
  if (!owner || aNid === undefined || rung === undefined) return res.status(400).json({ error: 'owner + aNid + rung required' });
  if (!xrpl.isValidClassicAddress(owner)) return res.status(400).json({ error: 'invalid owner address' });
  if (!LADDER[rung]) return res.status(400).json({ error: 'invalid rung (see GET /ladder)' });
  try {
    const out = await withClient(async (c, w) => {
      const issuer = w.classicAddress, ps = await readState(c, issuer, aNid);
      if (!ps) return { error: 'pet not found' };
      if (ps.owner !== owner) return { error: 'you do not own this pet' };
      if (ps.alive === 0) return { error: 'a passed pet cannot battle' };
      const cur = (await c.request({ command: 'ledger', ledger_index: 'validated' })).result.ledger_index;
      const N = cur + BATTLE_LEDGER_MARGIN;
      return { unsignedTx: tag({ TransactionType: 'Payment', Account: owner, Destination: issuer, Amount: '1',
          Memos: [{ Memo: { MemoType: hex(BATTLE_MEMO), MemoData: hex(['ladder', aNid, String(rung), String(N)].join('|')) } }] }),
        signWith: 'owner (Xaman)', opponent: LADDER[rung].name, pinnedLedger: N,
        note: 'battleId = this tx hash; after ledger N POST /battle/resolve to fight the house NPC (free, provably fair)' };
    });
    if (out.error) return res.status(400).json(out);
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// a pet's ladder progression — wins, current win-streak, highest rung beaten (all re-derivable from ledger).
app.get('/ladder-rank/:nid', async (req, res) => {
  try {
    const out = await withClient(async (c, w) => {
      const issuer = w.classicAddress, nid = req.params.nid;
      const cur = await readState(c, issuer, nid), minL = cur && Number.isInteger(cur.birth) ? cur.birth : null;
      const battles = []; let marker;
      do {
        const rq = { command: 'account_tx', account: issuer, limit: 200, forward: true, marker };
        if (minL != null) rq.ledger_index_min = minL;
        const r = await c.request(rq);
        for (const t of r.result.transactions) {
          const tx = t.tx || t.tx_json || {}; if (tx.TransactionType !== 'Payment') continue;
          const hash = tx.hash || t.hash, lseq = tx.ledger_index || t.ledger_index;
          for (const m of (tx.Memos || [])) {
            const md = m.Memo || {};
            try { if (unhex(md.MemoType || '') !== BATTLE_MEMO) continue; const f = unhex(md.MemoData || '').split('|');
              if (f[0] === 'ladder' && f[1] === nid && hash) battles.push({ battleId: hash, rung: Number(f[2]), lseq, win: null });
              else if (f[0] === 'result') { const bb = battles.find(x => x.battleId === f[1]); if (bb) bb.win = f[2] === nid; }
            } catch { /* skip */ }
          }
        }
        marker = r.result.marker;
      } while (marker);
      battles.sort((a, b) => a.lseq - b.lseq);
      let wins = 0, streak = 0, best = -1;
      for (const b of battles) { if (b.win) { wins++; streak++; best = Math.max(best, b.rung); } else if (b.win === false) streak = 0; }
      return { nid, resolved: battles.filter(b => b.win !== null).length, wins, currentStreak: streak, highestRungBeaten: best, highestRungName: best >= 0 ? LADDER[best].name : null };
    });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
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
// ── ladder auto-resolution ───────────────────────────────────────────────────────────────────────
// A ladder challenge is a player-signed Payment carrying "ladder|aNid|rung|N". The fight can only be
// settled once ledger N is validated, because N's hash is the unriggable seed. Nothing resolved them
// before: /battle/resolve is requireAdmin, and the poller ignored battle memos, so a player could
// start a fight that no one could finish. resolveBattleTx is idempotent (it returns ALREADY_RESOLVED
// when a result memo exists), so calling it from the poller cannot double-settle or double-pay.
const pendingLadder = new Map();                       // battleId (tx hash) -> pinned ledger N

function noteLadderChallenge(tx, hash) {
  if (!hash) return;
  for (const mm of (tx.Memos || [])) {
    const md = mm.Memo || {};
    try {
      if (unhex(md.MemoType || '') !== BATTLE_MEMO) continue;
      const f = unhex(md.MemoData || '').split('|');
      if (f[0] !== 'ladder') continue;
      const N = Number(f[3]);
      if (Number.isInteger(N)) pendingLadder.set(hash, N);
    } catch { /* skip malformed memo */ }
  }
}

async function resolvePendingLadders(c, w) {
  if (!pendingLadder.size) return 0;
  const cur = (await c.request({ command: 'ledger', ledger_index: 'validated' })).result.ledger_index;
  let done = 0;
  for (const [battleId, N] of [...pendingLadder]) {
    if (cur < N) continue;                             // seed ledger not validated yet
    try {
      const r = await resolveBattleTx(c, w, battleId);
      // Keep retrying only the genuinely transient case; drop everything else so a permanently
      // broken challenge cannot be retried every six seconds forever.
      if (r && r.error === 'pinned ledger not validated yet') continue;
      pendingLadder.delete(battleId);
      done++;
      console.log(`[poller] ladder ${battleId.slice(0, 8)} -> ${r && (r.status || r.winnerNid || 'resolved')}`);
    } catch (e) { console.warn('[poller] ladder', battleId.slice(0, 8), e.message); }
  }
  return done;
}

// Pick up challenges signed while this process was not running, so a restart does not strand a fight.
async function scanOpenLadders(c, issuer, backLedgers = 8000) {
  const cur = (await c.request({ command: 'ledger', ledger_index: 'validated' })).result.ledger_index;
  let marker, seen = 0;
  do {
    const r = await c.request({ command: 'account_tx', account: issuer,
      ledger_index_min: Math.max(0, cur - backLedgers), ledger_index_max: -1, forward: true, limit: 200, marker });
    for (const t of r.result.transactions) {
      const tx = t.tx || t.tx_json || {};
      if (tx.TransactionType !== 'Payment' || tx.Destination !== issuer) continue;
      noteLadderChallenge(tx, t.hash || tx.hash);
    }
    seen += r.result.transactions.length;
    marker = r.result.marker;
  } while (marker);
  return pendingLadder.size;
}

async function pollerTick(c, w) {
  const issuer = w.classicAddress; const affected = new Set(); let marker;
  do {
    const r = await c.request({ command: 'account_tx', account: issuer, ledger_index_min: pollerLastLedger + 1, ledger_index_max: -1, forward: true, limit: 200, marker });
    for (const t of r.result.transactions) {
      const tx = t.tx || t.tx_json || {}; const lseq = tx.ledger_index || t.ledger_index;
      if (lseq && lseq > pollerLastLedger) pollerLastLedger = lseq;
      if (tx.TransactionType === 'Payment' && tx.Destination === issuer) {
        noteLadderChallenge(tx, t.hash || tx.hash);
        for (const mm of (tx.Memos || [])) { const md = mm.Memo || {}; try { if (unhex(md.MemoType || '') === 'ledgerlings/op') { const p = unhex(md.MemoData || '').split('|'); if (p[1]) affected.add(p[1]); } } catch { /* skip */ } }
      }
    }
    marker = r.result.marker;
  } while (marker);
  for (const nid of affected) { try { await reconcilePet(c, w, nid); } catch (e) { console.warn('[poller] reconcile', nid.slice(0, 8), e.message); } }
  try { await resolvePendingLadders(c, w); } catch (e) { console.warn('[poller] ladders', e.message); }
  return affected.size;
}
async function startPoller() {
  if (!ISSUER_SEED) { console.warn('[poller] disabled — no LEDGERLINGS_ISSUER_SEED'); return; }
  const c = new xrpl.Client(ENDPOINT); await c.connect();
  const w = walletFromSeed(ISSUER_SEED); if (ISSUER_ADDRESS) w.classicAddress = ISSUER_ADDRESS;
  // catch up every existing pet once, then only react to new interactions.
  const pets = (await allIssuerNfts(c, w.classicAddress)).filter(n => n.NFTokenTaxon === TAXON);
  for (const n of pets) { try { await reconcilePet(c, w, n.NFTokenID); } catch (e) { console.warn('[poller] init', e.message); } }
  pollerLastLedger = (await c.request({ command: 'ledger', ledger_index: 'validated' })).result.ledger_index;
  let openLadders = 0;
  try { openLadders = await scanOpenLadders(c, w.classicAddress); } catch (e) { console.warn('[poller] ladder scan', e.message); }
  console.log(`[poller] watching ${w.classicAddress}; caught up ${pets.length} pet(s); ${openLadders} open ladder challenge(s); tracking from ledger ${pollerLastLedger}`);
  try { await resolvePendingLadders(c, w); } catch (e) { console.warn('[poller] ladders', e.message); }
  const loop = async () => {
    try { if (!c.isConnected()) await c.connect(); await pollerTick(c, w); }
    catch (e) { console.warn('[poller] tick', e.message); }
    setTimeout(loop, 6000);
  };
  setTimeout(loop, 6000);
}

// ---- Shareable pet card + public gallery (the viral loop) ----
const APP_URL = process.env.APP_URL || 'https://hugegreencandle.github.io/ledgerlings/';
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const shortNid = nid => `${String(nid).slice(0, 6)}…${String(nid).slice(-4)}`;
function careRatio(s) { return s.care_max > 0 ? Math.max(0, Math.min(1, s.care / s.care_max)) : 0; }
// dep-free SVG card (600x315, X-card ratio) — a little bear-ish Ledgerling colored by health, aura by rarity/form.
function genCardSvg(s, nid) {
  const stage = R.STAGE[s.stage] || 'egg', form = R.FORM[s.form] || '-';
  const dead = s.alive === 0;
  const body = dead ? '#5b6b72' : `hsl(${Math.round((s.health || 0) * 1.2)},62%,58%)`;
  const aura = s.form === 4 ? '#ffd24a' : s.form === 3 ? '#c98cff' : s.form === 2 ? '#6ff0ff' : '#3fae86';
  const scale = 0.55 + Math.min(4, s.stage) * 0.11;
  const cx = 165, cy = 150;
  const pct = Math.round(careRatio(s) * 100);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="315" viewBox="0 0 600 315">
  <defs><radialGradient id="bg" cx="30%" cy="35%" r="90%"><stop offset="0%" stop-color="#0e3a4a"/><stop offset="100%" stop-color="#05141a"/></radialGradient></defs>
  <rect width="600" height="315" fill="url(#bg)"/>
  <circle cx="${cx}" cy="${cy}" r="${92 * scale}" fill="none" stroke="${aura}" stroke-width="3" opacity="0.6"/>
  <g transform="translate(${cx},${cy}) scale(${scale})">
    <circle cx="-42" cy="-52" r="22" fill="${body}"/><circle cx="42" cy="-52" r="22" fill="${body}"/>
    <circle cx="0" cy="0" r="70" fill="${body}"/>
    <circle cx="-26" cy="-8" r="9" fill="#0b1e26"/><circle cx="26" cy="-8" r="9" fill="#0b1e26"/>
    <ellipse cx="0" cy="20" rx="14" ry="10" fill="#0b1e26"/>
    ${dead ? '<text x="0" y="-2" font-size="34" text-anchor="middle" fill="#0b1e26">✕</text>' : ''}
  </g>
  <text x="315" y="70" font-family="system-ui,sans-serif" font-size="30" font-weight="700" fill="#6ff0ff">Ledgerling</text>
  <text x="315" y="100" font-family="monospace" font-size="15" fill="#8fb3bd">${esc(shortNid(nid))}</text>
  <text x="315" y="146" font-family="system-ui,sans-serif" font-size="20" fill="#eaf6f9">${esc(stage)}${dead ? ' · passed' : ''}</text>
  <text x="315" y="174" font-family="system-ui,sans-serif" font-size="17" fill="${aura}">form: ${esc(form)}</text>
  <text x="315" y="206" font-family="system-ui,sans-serif" font-size="15" fill="#8fb3bd">care ${s.care} · quality ${pct}%</text>
  <text x="315" y="250" font-family="system-ui,sans-serif" font-size="15" fill="#7CFFB2">✅ provably fair — verify on XRPL</text>
  <text x="315" y="286" font-family="system-ui,sans-serif" font-size="13" fill="#5f7d86">Ledgerlings · a pet you can audit</text>
</svg>`;
}
app.get('/card/:nid.svg', async (req, res) => {
  try {
    const s = await withClient((c, w) => readState(c, w.classicAddress, req.params.nid));
    if (!s) return res.status(404).type('text/plain').send('pet not found');
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=60').send(genCardSvg(s, req.params.nid));
  } catch (e) { res.status(500).type('text/plain').send(e.message); }
});
// public gallery — all living pets ranked by care (best-cared first). No login.
app.get('/gallery', async (req, res) => {
  try {
    const out = await withClient(async (c, w) => (await allIssuerNfts(c, w.classicAddress))
      .filter(n => n.NFTokenTaxon === TAXON && n.URI)
      .map(n => { let s; try { s = dec(n.URI); } catch { return null; } return s && { nid: n.NFTokenID, owner: s.owner, stage: R.STAGE[s.stage] || s.stage, form: R.FORM[s.form] || '-', formId: s.form, care: s.care, quality: Math.round(careRatio(s) * 100), health: s.health, alive: s.alive }; })
      .filter(Boolean));
    out.sort((a, b) => (b.alive - a.alive) || (b.care - a.care) || (b.formId - a.formId));
    res.set('Cache-Control', 'public, max-age=30').json({ count: out.length, pets: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// public gallery page — best-cared leaderboard grid, each linking to its shareable pet page. No login.
app.get('/gallery.html', (req, res) => {
  res.type('text/html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Ledgerlings — Gallery</title>
<meta name="description" content="Every Ledgerling, ranked by care. Provably fair on the XRPL.">
<style>body{margin:0;background:#05141a;color:#eaf6f9;font-family:system-ui,sans-serif}
.wrap{max-width:1000px;margin:0 auto;padding:24px}h1{color:#6ff0ff;margin:0}
.sub{color:#8fb3bd;margin:6px 0 18px}a.cta{display:inline-block;margin:0 0 18px;padding:11px 18px;border-radius:10px;
border:1px solid #6ff0ff;background:#0e3a4a;color:#6ff0ff;text-decoration:none}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.card{border:1px solid #14414f;border-radius:14px;overflow:hidden;text-decoration:none;color:inherit;background:#08222b;transition:transform .1s}
.card:hover{transform:translateY(-2px);border-color:#6ff0ff}.card img{width:100%;display:block}
.meta{padding:10px 12px;font-size:13px;color:#8fb3bd}.meta b{color:#6ff0ff}.rank{color:#ffd24a;font-weight:700}</style></head>
<body><div class="wrap"><h1>🏆 Ledgerlings Gallery</h1>
<div class="sub">Every pet, ranked by care. Each one's whole life re-derives from the XRPL — click through and verify.</div>
<a class="cta" href="${esc(APP_URL)}">🐾 Adopt your own Ledgerling</a>
<div id="grid" class="grid"></div>
<script>fetch('/gallery').then(r=>r.json()).then(d=>{
  const g=document.getElementById('grid');
  if(!d.pets||!d.pets.length){g.innerHTML='<div style="color:#8fb3bd">No pets yet — be the first to adopt.</div>';return;}
  g.innerHTML=d.pets.slice(0,60).map((p,i)=>'<a class=card href="/p/'+p.nid+'"><img loading=lazy src="/card/'+p.nid+'.svg" alt="Ledgerling"><div class=meta><span class=rank>#'+(i+1)+'</span> · <b>'+p.stage+'</b>'+(p.form!=='-'?' · '+p.form:'')+'<br>care <b>'+p.care+'</b> · quality <b>'+p.quality+'%</b>'+(p.alive?'':' · passed')+'</div></a>').join('');
}).catch(e=>{document.getElementById('grid').textContent='Could not load the gallery.';});</script>
</div></body></html>`);
});

// public shareable pet page — OG preview (the card), live stats, Verify, and an Adopt CTA. No login.
app.get('/p/:nid', async (req, res) => {
  try {
    const nid = req.params.nid;
    const s = await withClient((c, w) => readState(c, w.classicAddress, nid));
    if (!s) return res.status(404).type('text/html').send('<h1>Ledgerling not found</h1>');
    const stage = R.STAGE[s.stage] || 'egg', form = R.FORM[s.form] || '-';
    const base = `${req.protocol}://${req.get('host')}`;
    const card = `${base}/card/${esc(nid)}.svg`;
    const title = `Ledgerling ${shortNid(nid)} — ${esc(stage)}${s.form ? ' · ' + esc(form) : ''}`;
    const desc = `A provably-fair on-chain pet. care ${s.care} (${Math.round(careRatio(s) * 100)}%). Its whole life re-derives from the XRPL — verify it yourself.`;
    res.type('text/html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="${card}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${card}">
<style>body{margin:0;background:#05141a;color:#eaf6f9;font-family:system-ui,sans-serif;text-align:center}
.wrap{max-width:640px;margin:0 auto;padding:24px}img{max-width:100%;border-radius:14px;border:1px solid #14414f}
.stats{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin:16px 0;color:#8fb3bd;font-size:14px}
.stats b{color:#6ff0ff}a.cta,button{display:inline-block;margin:8px 6px;padding:11px 18px;border-radius:10px;border:1px solid #6ff0ff;
background:#0e3a4a;color:#6ff0ff;text-decoration:none;cursor:pointer;font-size:15px}#vout{margin-top:14px;min-height:22px}
.ok{color:#7CFFB2}.bad{color:#ff6b6b}</style></head><body><div class="wrap">
<h1 style="color:#6ff0ff;margin-bottom:4px">Ledgerling</h1>
<div style="color:#5f7d86;font-family:monospace;font-size:13px;margin-bottom:14px">${esc(shortNid(nid))}</div>
<img src="${card}" alt="Ledgerling card">
<div class="stats"><span>stage <b>${esc(stage)}</b></span><span>form <b>${esc(form)}</b></span>
<span>care <b>${s.care}</b></span><span>quality <b>${Math.round(careRatio(s) * 100)}%</b></span>
<span>${s.alive ? 'health <b>' + s.health + '</b>' : '<b class="bad">passed</b>'}</span></div>
<button id="v">🔎 Verify this pet on-ledger</button>
<a class="cta" href="${esc(APP_URL)}">🐾 Adopt your own</a>
<a class="cta" href="/gallery.html">🏆 Gallery</a>
<div id="vout"></div>
<div style="color:#5f7d86;font-size:12px;margin-top:20px">Every feed, evolution and battle re-derives from XRPL ledger data under open rules. You don't trust the operator — you check.</div>
<script>document.getElementById('v').onclick=async()=>{const o=document.getElementById('vout');o.textContent='re-deriving from ledger history…';
try{const v=await(await fetch('/verify/${esc(nid)}')).json();o.innerHTML=v.verdict==='PASS'?'<span class=ok>✅ VERIFIED — '+v.interactions+' interactions reproduce from the open rules.</span>':v.verdict==='DIVERGED'?'<span class=bad>🚨 DIVERGED — does not match the open rules.</span>':'could not verify ('+(v.reason||'')+')';}catch(e){o.textContent='verify failed';}};</script>
</div></body></html>`);
  } catch (e) { res.status(500).type('text/html').send('error'); }
});

// export the issuer primitives so a harness can drive the logic without starting a server.
module.exports = { app, withClient, readState, submit, verifyPet, replay, enc, dec, hex, unhex, R, TAXON, TF_MUTABLE_TRANSFERABLE, ROYALTY_BPS, ENDPOINT,
  A, loadHistory, encAch, decAch, listAchievements, claimAchievements, verifyAchievement, ACHIEVEMENT_TAXON, RULESET_VERSION,
  BR, seedFor, stateAtLedger, loadBattle, resolveBattleTx, verifyBattle, ledgerHashOf, BATTLE_TAXON, BATTLE_FEE_BPS, BATTLE_LEDGER_MARGIN, BATTLE_MEMO,
  reconcilePet, pollerTick, startPoller, allIssuerNfts, genCardSvg, careRatio, LADDER, resolveLadder };

if (require.main === module) {
  const PORT = process.env.PORT || 8788;
  app.listen(PORT, () => console.log(`Ledgerlings issuer on :${PORT} (endpoint ${ENDPOINT})`));
  if (process.env.POLLER !== '0') startPoller().catch(e => console.warn('[poller] failed to start', e.message));
}
