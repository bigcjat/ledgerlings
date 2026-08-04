'use strict';
const crypto = require('crypto');

/** Canonical JSON: sorted keys, no incidental whitespace, so two honest runs hash identically. */
function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

/**
 * An evidence bundle states what was read, from where, at which ledger, and what followed from it.
 * `bundle_hash` covers everything except itself, so a third party re-running the same inputs gets
 * the same hash — or a different one, which is equally informative.
 */
function makeBundle({ subject, pin, agreement, derived, claimed, divergence, verdict, reducer, meta }) {
  const body = {
    schema: 'kvt.xrpl-rederive/v1',
    subject,
    pin: { ledger_index: pin.ledger_index, ledger_hash: pin.ledger_hash,
           close_time: pin.close_time, agreed_by: [...pin.agreed_by].sort() },
    history: { digest: agreement.digest, count: agreement.count,
               agreed_by: [...agreement.agreed_by].sort() },
    reducer: reducer || null,
    derived, claimed,
    divergence: divergence.length ? divergence : null,
    verdict,
    meta: meta || null,
  };
  return { ...body, bundle_hash: sha256(canonical(body)) };
}

/** Field-by-field comparison. Only keys the reducer actually produced are compared. */
function compare(derived, claimed) {
  const out = [];
  for (const k of Object.keys(derived).sort()) {
    const a = derived[k], b = claimed ? claimed[k] : undefined;
    if (canonical(a) !== canonical(b)) out.push({ field: k, derived: a, claimed: b === undefined ? null : b });
  }
  return out;
}

module.exports = { canonical, sha256, makeBundle, compare };
