/* Ledgerlings — provably-fair battle rules (Make Waves #10). PURE + portable (Node + browser), no deps.
 * Outcome = a deterministic function of (pet A state@N, pet B state@N, seed). The seed is derived server-side
 * from a pinned FUTURE ledger hash (see server.js seedFor) that nobody can bias; here we only spread it.
 * SEED-DOMINANT by design: the roll (0..999) outweighs stat power (100..212), so care/form give an edge, not a
 * lock — an underdog can win. HARD RULE (like loadout): stats influence, never determine. Versioned; the version
 * hash is stamped into the battle record so the rules can't be swapped to justify a result. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BattleRules = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const BASE = 100;

  // bounded power: base + modest care/form/stage edges. range 100..212 (max ~2.1x min).
  function power(s) {
    if (!s) return 0;
    const ratio = s.care_max > 0 ? Math.max(0, Math.min(1, s.care / s.care_max)) : 0;
    const careBonus = Math.round(ratio * 40);                 // 0..40
    const formBonus = Math.max(0, Math.min(4, s.form || 0)) * 10;   // 0..40
    const stageBonus = Math.max(0, Math.min(4, s.stage || 0)) * 8;  // 0..32
    return BASE + careBonus + formBonus + stageBonus;
  }

  // sync, portable per-pet roll from the (unbiasable) seed. FNV-1a spread; seed is the entropy, this just maps it.
  function fnv1a(str) {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function rollFor(seed, nid) { return fnv1a(seed + ':' + nid) % 1000; }   // 0..999

  // resolve: higher score wins; a dead pet forfeits; both dead => draw (winner null); exact tie => lexicographic nid.
  function resolveBattle(seed, A, B, nidA, nidB) {
    const aliveA = !!A && A.alive !== 0, aliveB = !!B && B.alive !== 0;
    const powerA = power(A), powerB = power(B);
    const rollA = rollFor(seed, nidA), rollB = rollFor(seed, nidB);
    const scoreA = aliveA ? rollA + powerA : -1;
    const scoreB = aliveB ? rollB + powerB : -1;
    let winner;
    if (scoreA < 0 && scoreB < 0) winner = null;
    else if (scoreA > scoreB) winner = nidA;
    else if (scoreB > scoreA) winner = nidB;
    else winner = nidA < nidB ? nidA : nidB;
    return { winner, scoreA, scoreB, rollA, rollB, powerA, powerB, aliveA, aliveB };
  }

  return { BASE, power, fnv1a, rollFor, resolveBattle };
}));
