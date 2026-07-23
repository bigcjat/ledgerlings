/* Ledgerlings — On-Chain Achievements (Make Waves #11).
 * Achievements are a PURE PROJECTION of the same replay the verifier uses: each badge is a monotonic
 * predicate over the pet's state trace, "earned" at the ledger_index of the step where it first turns
 * true. No off-ledger input => a badge is as re-derivable (and un-fakeable) as pet state itself.
 * FAITHFUL to pet_rules.js; this module never mutates state or touches the ledger. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pet_rules.js'));
  else root.PetAchievements = factory(root.PetRules);
}(typeof self !== 'undefined' ? self : this, function (R) {
  const NURTURER_AWARDS = 20;            // care_max += 10 per cooldown-valid feed/play → 200
  const NURTURER_CARE_MAX = NURTURER_AWARDS * 10;

  // Catalog: each badge is a monotonic state predicate `sat(state)`. `first_bond` is event-based
  // (first owner interaction that actually changed state) and handled specially below.
  const CATALOG = [
    { id: 'first_bond', label: 'First Bond',     desc: 'your first real interaction', event: 'first_change' },
    { id: 'hatch',      label: 'Hatched',        desc: 'left the egg',        sat: s => s.stage >= R.BABY },
    { id: 'teen',       label: 'Growing Up',     desc: 'reached teen',        sat: s => s.stage >= R.TEEN },
    { id: 'adult',      label: 'All Grown Up',   desc: 'reached adult',       sat: s => s.stage >= R.ADULT, meta: s => ({ form: s.form, formName: R.FORM[s.form] || '-' }) },
    { id: 'elder',      label: 'Elder',          desc: 'reached elder',       sat: s => s.stage >= R.ELDER },
    { id: 'full_life',  label: 'A Full Life',    desc: 'passed of old age, not neglect', sat: s => s.death_cause === 2 },
    { id: 'devoted',    label: 'Devoted Keeper', desc: 'evolved to the top form',        sat: s => s.form === 4 },
    { id: 'nurturer',   label: 'Nurturer',       desc: `${NURTURER_AWARDS}+ acts of care`, sat: s => s.care_max >= NURTURER_CARE_MAX },
  ];
  const BY_ID = Object.fromEntries(CATALOG.map(a => [a.id, a]));

  // Replay the OPEN rules and record, per badge, the first ledger its predicate turns true.
  // interactions = [[op, now, sender], ...] sorted by ledger (same shape the verifier builds).
  function achievementsFor(genesis, interactions) {
    let s = genesis;
    const earned = {};
    const latched = {};                                   // monotonic: once true, stays true
    for (const a of CATALOG) latched[a.id] = a.sat ? a.sat(s) : false;   // genesis baseline (all false)
    let bonded = false;
    for (const [op, now, sender] of interactions) {
      const next = R.step(s, op, now, sender);
      // first_bond: first owner interaction that actually moved state (a no-op from a non-owner leaves it identical)
      if (!bonded && JSON.stringify(next) !== JSON.stringify(s)) {
        earned.first_bond = { id: 'first_bond', earnedLedger: now };
        bonded = true;
      }
      for (const a of CATALOG) {
        if (!a.sat) continue;
        const now_true = a.sat(next);
        if (now_true && !latched[a.id]) {
          earned[a.id] = { id: a.id, earnedLedger: now, ...(a.meta ? { meta: a.meta(next) } : {}) };
        }
        latched[a.id] = now_true || latched[a.id];
      }
      s = next;
    }
    // stable order = catalog order
    return CATALOG.map(a => earned[a.id]).filter(Boolean);
  }

  return { CATALOG, BY_ID, achievementsFor, NURTURER_AWARDS, NURTURER_CARE_MAX };
}));
