'use strict';

/**
 * Pin a validated ledger that a quorum of independent nodes agree on.
 *
 * Why this exists: every verifier in this codebase previously took the first endpoint that
 * answered. That makes the verdict depend on one server. Here we ask every reachable node for its
 * latest validated ledger, choose a height they can all speak to, then fetch that ledger's hash from
 * each and require the hashes to be identical. A verdict built on this pin rests on "N independent
 * nodes agreed", not "one node said so".
 *
 * Disagreement is reported, never smoothed over.
 */
async function pinLedger(nodes, { at = null, minAgree = 2 } = {}) {
  const tips = [];
  for (const n of nodes) {
    try {
      const r = await n.req({ command: 'ledger', ledger_index: 'validated' });
      const idx = Number(r.ledger_index ?? (r.ledger && r.ledger.ledger_index));
      if (r.validated !== true) throw new Error('node did not confirm the ledger is validated');
      tips.push({ url: n.url, index: idx });
    } catch (e) {
      tips.push({ url: n.url, error: String(e.message || e) });
    }
  }
  const ok = tips.filter(t => t.index);
  if (ok.length < minAgree) {
    const err = new Error(`only ${ok.length} endpoint(s) returned a validated tip, need ${minAgree}`);
    err.tips = tips; throw err;
  }

  // Pick a height every responding node can serve: the lowest tip, unless caller pinned one.
  const target = at != null ? Number(at) : Math.min(...ok.map(t => t.index));

  const seen = [];
  for (const n of nodes) {
    try {
      const r = await n.req({ command: 'ledger', ledger_index: target });
      const L = r.ledger || {};
      const hash = r.ledger_hash || L.ledger_hash;
      const closed = r.validated === true || L.closed === true;
      if (!hash) throw new Error('no ledger_hash in response');
      if (!closed) throw new Error('ledger not closed/validated at this node');
      seen.push({ url: n.url, hash, close_time: L.close_time ?? null });
    } catch (e) {
      seen.push({ url: n.url, error: String(e.message || e) });
    }
  }

  const answers = seen.filter(s => s.hash);
  if (answers.length < minAgree) {
    const err = new Error(`only ${answers.length} endpoint(s) served ledger ${target}, need ${minAgree}`);
    err.detail = seen; throw err;
  }
  const hashes = [...new Set(answers.map(a => a.hash))];
  if (hashes.length !== 1) {
    // Two nodes disagreeing on a validated ledger hash is a serious condition. Never continue.
    const err = new Error(`ENDPOINTS DISAGREE on ledger ${target}: ${hashes.join(' vs ')}`);
    err.detail = seen; err.fatal = true; throw err;
  }

  return {
    ledger_index: target,
    ledger_hash: hashes[0],
    close_time: answers[0].close_time,
    agreed_by: answers.map(a => a.url),
    unreachable: seen.filter(s => s.error),
    tips,
  };
}

module.exports = { pinLedger };
