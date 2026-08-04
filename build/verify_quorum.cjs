'use strict';
/* Quorum re-derivation of a pet, for /verify/:nid.
 *
 * The previous verifier read history from a single node and scanned to "now". That meant the verdict
 * depended on whichever server answered, and two people verifying the same pet minutes apart read
 * different windows, so neither could reproduce the other's result. For a game whose whole claim is
 * "you don't have to trust me, re-derive it", the residual trust was "you do have to trust my node".
 *
 * This pins a validated ledger that several independent nodes agree on, reads the history from all of
 * them, and refuses to answer if they disagree. The bundle hash lets anyone re-run and compare.
 */
const { rederive } = require('./rederive');
const R = require('./pet_rules.js');

const ENDPOINTS = (process.env.XRPL_QUORUM_ENDPOINTS ||
  'wss://xrplcluster.com,wss://s1.ripple.com,wss://s2.ripple.com,wss://xrpl.ws').split(',');
const MIN_AGREE = Number(process.env.XRPL_QUORUM_MIN || 2);

const unhex = h => Buffer.from(h || '', 'hex').toString('utf8');
const K = { v:'v', owner:'o', birth:'b', last_ix:'x', hunger:'h', happiness:'j', health:'l',
  stage:'s', form:'f', alive:'a', age:'g', care:'c', care_max:'m', death_cause:'d',
  last_feed:'F', last_play:'P' };
const KINV = Object.fromEntries(Object.entries(K).map(([f, s]) => [s, f]));
const decodeUri = uri => {
  const o = JSON.parse(unhex(uri));
  const s = { loadout: [] };
  for (const sk in o) s[KINV[sk] || sk] = o[sk];
  return s;
};

async function verifyPetQuorum(issuer, nid, { fromLedger } = {}) {
  return rederive({
    account: issuer,
    fromLedger,
    endpoints: ENDPOINTS,
    minAgree: MIN_AGREE,
    subject: { kind: 'ledgerlings.pet', nftoken_id: nid, issuer },
    reducerName: 'ledgerlings/pet_rules@v1',

    reduce(txs) {
      let genesis = null; const ops = [];
      for (const { tx, meta } of txs) {
        if (tx.TransactionType === 'NFTokenMint' && tx.URI && meta && meta.nftoken_id === nid) {
          try { genesis = decodeUri(tx.URI); } catch { /* not a pet URI */ }
        } else if (tx.TransactionType === 'Payment' && tx.Destination === issuer) {
          for (const m of (tx.Memos || [])) {
            const md = m.Memo || {};
            try {
              if (unhex(md.MemoType || '') !== 'ledgerlings/op') continue;
              const [opName, mNid] = unhex(md.MemoData || '').split('|');
              if (mNid === nid) ops.push([R.OP[opName] || 0, tx.ledger_index ?? 0, tx.Account]);
            } catch { /* malformed memo, ignore */ }
          }
        }
      }
      if (!genesis) throw new Error('no genesis mint for this token inside the pinned window');
      ops.sort((a, b) => a[1] - b[1]);
      let s = genesis;
      for (const [op, at, by] of ops) s = R.step(s, op, at, by);
      const { loadout, ...state } = s;
      return { state, meta: { interactions: ops.length } };
    },

    // What the ledger says the NFT is, read AT the pinned ledger so claim and history line up.
    async claim(ctx) {
      let marker;
      do {
        const r = await ctx.nodes[0].req({ command: 'account_nfts', account: issuer,
          ledger_index: ctx.pin.ledger_index, limit: 400, ...(marker ? { marker } : {}) });
        const hit = (r.account_nfts || []).find(n => n.NFTokenID === nid);
        if (hit) { const { loadout, ...state } = decodeUri(hit.URI); return state; }
        marker = r.marker;
      } while (marker);
      return null;   // burned or never minted -> DERIVED_ONLY rather than a false match
    },
  });
}

module.exports = { verifyPetQuorum };
