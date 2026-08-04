'use strict';
const { connectAll } = require('./node');
const { pinLedger } = require('./pin');
const { historyQuorum } = require('./history');
const { makeBundle, compare, canonical, sha256 } = require('./evidence');

const DEFAULT_ENDPOINTS = [
  'wss://xrplcluster.com',
  'wss://s1.ripple.com',
  'wss://s2.ripple.com',
  'wss://xrpl.ws',
];

/**
 * Re-derive a claimed state from ledger history and say whether it holds.
 *
 * @param {object} o
 * @param {string}   o.account     account whose history is replayed
 * @param {function} o.reduce      (transactions, ctx) -> derived state   [pure]
 * @param {function} o.claim       (ctx) -> claimed state, or a literal object
 * @param {number}  [o.fromLedger] window start (default: earliest the nodes will serve)
 * @param {number}  [o.atLedger]   pin to this ledger instead of the agreed tip
 * @param {string[]}[o.endpoints]
 * @param {number}  [o.minAgree=2] how many independent nodes must agree
 */
async function rederive(o) {
  const endpoints = o.endpoints || DEFAULT_ENDPOINTS;
  const minAgree = o.minAgree ?? 2;
  const { live, dead } = await connectAll(endpoints, { min: minAgree });
  try {
    const pin = await pinLedger(live, { at: o.atLedger, minAgree });
    const { transactions, agreement } = await historyQuorum(live, {
      account: o.account,
      minLedger: o.fromLedger ?? -1,
      maxLedger: pin.ledger_index,
      minAgree,
    });

    const ctx = { pin, nodes: live, account: o.account, transactions };

    // A reducer may return either the state itself, or { state, meta } when it wants to report
    // something that is not part of the claim — a count of interactions, say. Anything in `meta` is
    // recorded in the bundle but never compared, so incidental extras cannot manufacture a
    // divergence.
    const reduced = await o.reduce(transactions, ctx);
    const hasEnvelope = reduced && typeof reduced === 'object' && 'state' in reduced &&
                        Object.keys(reduced).every(k => k === 'state' || k === 'meta');
    const derived = hasEnvelope ? reduced.state : reduced;
    const reducerMeta = hasEnvelope ? (reduced.meta ?? null) : null;
    const claimed = typeof o.claim === 'function' ? await o.claim(ctx) : (o.claim ?? null);

    const divergence = claimed == null ? [] : compare(derived, claimed);
    const verdict = claimed == null ? 'DERIVED_ONLY' : (divergence.length ? 'DIVERGED' : 'MATCH');

    return makeBundle({
      subject: o.subject || { account: o.account },
      pin, agreement, derived, claimed, divergence, verdict,
      reducer: o.reducerName || null,
      meta: { unreachable: [...pin.unreachable.map(u => u.url), ...dead.map(d => d.url)],
              reducer: reducerMeta },
    });
  } finally {
    live.forEach(n => n.close());
  }
}

module.exports = { rederive, DEFAULT_ENDPOINTS, canonical, sha256, compare };
