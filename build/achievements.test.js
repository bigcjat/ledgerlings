/* Pure unit tests for achievements.js — no ledger, no deps. Run: node build/achievements.test.js
 * Strategy: an INDEPENDENT oracle (predicates re-implemented here) replays each trace; we assert
 * achievementsFor() agrees with it. Agreement across many varied traces = the projection is faithful. */
const A = require('./achievements.js');
const R = require('./pet_rules.js');

let fails = 0;
const ok = (c, m) => { if (c) console.log('  ok  ', m); else { console.error('  FAIL', m); fails++; } };

// Independent oracle: replay with R.step, record first ledger each predicate turns true.
function oracle(genesis, interactions) {
  const P = {
    hatch: s => s.stage >= R.BABY, teen: s => s.stage >= R.TEEN, adult: s => s.stage >= R.ADULT,
    elder: s => s.stage >= R.ELDER, full_life: s => s.death_cause === 2,
    devoted: s => s.form === 4, nurturer: s => s.care_max >= 200,
  };
  let s = genesis; const earned = {}; const latched = {}; let bonded = false;
  for (const k in P) latched[k] = P[k](s);
  for (const [op, now, sender] of interactions) {
    const n = R.step(s, op, now, sender);
    if (!bonded && JSON.stringify(n) !== JSON.stringify(s)) { earned.first_bond = now; bonded = true; }
    for (const k in P) { if (P[k](n) && !latched[k]) earned[k] = now; latched[k] = P[k](n) || latched[k]; }
    s = n;
  }
  return earned;                        // { id: earnedLedger }
}

const asMap = list => Object.fromEntries(list.map(e => [e.id, e.earnedLedger]));
// order-independent map equality (achievementsFor returns catalog order; the oracle returns fire order)
const mapsEqual = (a, b) => { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every(k => b[k] === a[k]); };

// A "devoted keeper" schedule: act the moment a stat dips below 45 (so feed/play awards are "low" =>
// care == care_max => top form 4), heal to hold health. Runs past ADULT so `form` + `devoted` fire.
function devotedTrace(owner) {
  const g = R.genesis(0, owner); let s = g; const ix = []; const END = 9 * R.DAY;
  for (let now = 600; now <= END; now += 600) {
    // preview the decay step() would apply at `now`, so decisions see time passing (decay lives in step)
    const drop = Math.min(100, Math.floor(Math.max(0, now - s.last_ix) * R.DECAY / R.DAY));
    const h = R.clamp(s.hunger - drop), j = R.clamp(s.happiness - drop);
    let drain = 0; for (const st of [h, j]) { if (st === 0) drain += drop; else if (st < 20) drain += Math.floor(drop / 2); }
    const hl = R.clamp(s.health - drain);
    let op = null;
    if (hl < 50) op = R.HEAL;
    else if (h < 45 && (s.last_feed === 0 || now - s.last_feed >= R.COOLDOWN)) op = R.FEED;
    else if (j < 45 && (s.last_play === 0 || now - s.last_play >= R.COOLDOWN)) op = R.PLAY;
    if (op === null) continue;
    ix.push([op, now, owner]); s = R.step(s, op, now, owner);
    if (s.alive === 0) break;
  }
  return { genesis: g, interactions: ix };
}

// A caretaker policy that keeps the pet alive: every `spacing` ledgers, act on the neediest stat.
// Returns the interaction list [[op, now, owner], ...]. `ticks` decides how long the pet lives.
function caretakerTrace(owner, ticks, spacing) {
  const g = R.genesis(0, owner); let s = g; const ix = [];
  for (let i = 1; i <= ticks; i++) {
    const now = i * spacing;
    // choose op from the sim's current view (feed/play/heal the lowest stat)
    let op = R.FEED;
    if (s.health <= 40) op = R.HEAL;
    else if (s.happiness <= s.hunger) op = R.PLAY;
    ix.push([op, now, owner]);
    s = R.step(s, op, now, owner);
    if (s.alive === 0) break;           // stop once dead (later interactions are no-ops anyway)
  }
  return { genesis: g, interactions: ix };
}

console.log('T1 — exact: single feed at age=DAY earns first_bond + hatch at that ledger');
{
  const O = 'rOWNER1', g = R.genesis(0, O);
  const ix = [[R.FEED, R.DAY, O]];
  const got = asMap(A.achievementsFor(g, ix));
  ok(JSON.stringify(got) === JSON.stringify({ first_bond: R.DAY, hatch: R.DAY }), 'earned = {first_bond, hatch} @DAY, got ' + JSON.stringify(got));
}

console.log('T2 — non-owner interaction earns nothing (owner-only by construction)');
{
  const O = 'rOWNER2', g = R.genesis(0, O);
  const ix = [[R.FEED, R.DAY, 'rIMPOSTOR']];
  ok(A.achievementsFor(g, ix).length === 0, 'impostor feed → no badges');
}

console.log('T3 — projection matches the independent oracle across varied traces');
const covered = new Set();
let sawMonotonic = false;
const traces = [
  ...[[6, R.COOLDOWN], [40, R.COOLDOWN], [120, R.COOLDOWN], [300, R.COOLDOWN], [50, Math.floor(R.DAY / 2)]]
    .map(([t, sp]) => ['caretaker(' + t + ',' + sp + ')', caretakerTrace('rCARE' + t + '_' + sp, t, sp)]),
  ['devoted', devotedTrace('rDEVOTED')],
];
for (const [name, { genesis, interactions }] of traces) {
  const got = asMap(A.achievementsFor(genesis, interactions));
  const exp = oracle(genesis, interactions);
  ok(mapsEqual(got, exp), `${name} matches oracle — ids ${Object.keys(got).join(',') || '(none)'}`);
  Object.keys(got).forEach(id => covered.add(id));
  const order = ['hatch', 'teen', 'adult', 'elder', 'full_life'].filter(k => k in got).map(k => got[k]);
  ok(order.every((v, i) => i === 0 || v >= order[i - 1]), `  lifecycle ledgers monotonic: ${order.join(' <= ') || '(n/a)'}`);
  if (order.length >= 3) sawMonotonic = true;
}

console.log('T4 — coverage: every catalog badge is reachable by some trace');
for (const a of A.CATALOG) ok(covered.has(a.id), `badge "${a.id}" earned by at least one trace`);
ok(sawMonotonic, 'at least one trace exercised a 3+ lifecycle chain');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
