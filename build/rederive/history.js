'use strict';
const crypto = require('crypto');

/**
 * Read an account's transaction history inside a pinned window, from several nodes, and prove the
 * reads agree.
 *
 * Two things the previous one-off verifiers did not do:
 *   1. bound the scan with ledger_index_max, so a re-run reads the same window rather than "to now";
 *   2. compare what different nodes returned, rather than trusting whichever answered first.
 *
 * Completeness is asserted rather than assumed: pagination must terminate on its own (marker
 * exhausted, not a cap), and every transaction must fall inside the window.
 */

function digestOf(txs) {
  // Order-independent digest, so nodes returning a different page order still compare equal.
  const ids = txs.map(t => t.hash).sort();
  return { count: ids.length, digest: crypto.createHash('sha256').update(ids.join('\n')).digest('hex') };
}

async function fetchFrom(node, { account, minLedger, maxLedger, limit = 200, maxPages = 500 }) {
  const out = [];
  let marker, pages = 0;
  do {
    const req = { command: 'account_tx', account, forward: true, limit,
                  ledger_index_min: minLedger, ledger_index_max: maxLedger };
    if (marker) req.marker = marker;
    const r = await node.req(req);
    for (const t of (r.transactions || [])) {
      const tx = t.tx || t.tx_json || {};
      const li = tx.ledger_index ?? t.ledger_index;
      if (li == null || li < minLedger || li > maxLedger) {
        throw new Error(`transaction outside the pinned window (ledger ${li}) from ${node.url}`);
      }
      if (t.validated !== true) throw new Error(`unvalidated transaction returned by ${node.url}`);
      out.push({ hash: t.hash || tx.hash, ledger_index: li, tx, meta: t.meta ?? t.metaData });
    }
    marker = r.marker;
    if (++pages > maxPages) throw new Error(`pagination exceeded ${maxPages} pages — refusing to truncate silently`);
  } while (marker);
  return out;
}

/**
 * @returns {{ transactions, agreement }} transactions from the quorum, plus what each node returned.
 */
async function historyQuorum(nodes, opts) {
  const { minAgree = 2 } = opts;
  const results = [];
  for (const n of nodes) {
    try {
      const txs = await fetchFrom(n, opts);
      results.push({ url: n.url, txs, ...digestOf(txs) });
    } catch (e) {
      results.push({ url: n.url, error: String(e.message || e) });
    }
  }
  const good = results.filter(r => r.txs);
  if (good.length < minAgree) {
    const err = new Error(`only ${good.length} endpoint(s) returned history, need ${minAgree}`);
    err.detail = results.map(({ url, error, count, digest }) => ({ url, error, count, digest }));
    throw err;
  }

  const byDigest = new Map();
  for (const g of good) byDigest.set(g.digest, [...(byDigest.get(g.digest) || []), g.url]);

  if (byDigest.size !== 1) {
    const err = new Error('ENDPOINTS DISAGREE on transaction history within the pinned window');
    err.detail = [...byDigest.entries()].map(([digest, urls]) => ({
      digest, urls, count: good.find(g => g.digest === digest).count }));
    err.fatal = true;
    throw err;
  }

  const [digest] = [...byDigest.keys()];
  const chosen = good[0];
  return {
    transactions: chosen.txs.sort((a, b) => a.ledger_index - b.ledger_index || a.hash.localeCompare(b.hash)),
    agreement: {
      digest, count: chosen.count,
      agreed_by: good.map(g => g.url),
      failed: results.filter(r => r.error).map(({ url, error }) => ({ url, error })),
    },
  };
}

module.exports = { historyQuorum, fetchFrom, digestOf };
