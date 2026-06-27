#!/usr/bin/env node
'use strict';
// Differential step harness — proves the JS rules engine (pet_rules.js, used by the app + server)
// produces BYTE-IDENTICAL state to the Python engine (pet_rules.py, used by the replay verifier).
// The whole "Verify my pet" fairness claim rests on these two never diverging. If they do, the
// verifier either falsely DIVERGES (honest pets fail) or falsely PASSES (cheating slips through).
//
// Run:  node diff_rules.js [numScenarios] [stepsPerScenario]
// Generates random scenarios in JS, runs them through JS step, then through Python step
// (diff_rules_runner.py), and asserts every intermediate state matches.

const R = require('./pet_rules.js');
const { execFileSync } = require('child_process');

// Seeded PRNG (mulberry32) so any failure is reproducible.
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const OWNER = 'rOwner';
const STRANGER = 'rStranger';
const OPS = [R.FEED, R.PLAY, R.CLEAN, R.HEAL, 9 /* invalid op — must be a no-op action */];

function makeScenario(rand, nSteps) {
  const birth = Math.floor(rand() * 100); // small non-zero births too
  const steps = [];
  let now = birth;
  for (let i = 0; i < nSteps; i++) {
    // advance the clock by 0 .. ~2.5 days, occasionally a big jump (death / lifespan / heavy decay)
    const jump = rand() < 0.12 ? Math.floor(rand() * 45 * R.DAY) : Math.floor(rand() * 2.5 * R.DAY);
    now += jump; // monotonic, like ledger sequence
    const op = OPS[Math.floor(rand() * OPS.length)];
    const sender = rand() < 0.15 ? STRANGER : OWNER; // exercise owner-only
    steps.push({ op, now, sender });
  }
  return { owner: OWNER, birth, steps };
}

// JS replay -> per-step state list (mirrors diff_rules_runner.run)
function runJs(scn) {
  let s = R.genesis(scn.birth, scn.owner);
  const out = [Object.assign({}, s)];
  for (const it of scn.steps) { s = R.step(s, it.op, it.now, it.sender); out.push(Object.assign({}, s)); }
  return out;
}

// canonical compare (sorted keys) so field-order never causes a false mismatch
function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}

function main() {
  const N = Number(process.argv[2] || 3000);
  const STEPS = Number(process.argv[3] || 40);
  const rand = rng(0xC0FFEE);
  const scenarios = Array.from({ length: N }, () => makeScenario(rand, STEPS));

  const jsResults = scenarios.map(runJs);
  const pyResults = JSON.parse(execFileSync('python3', ['diff_rules_runner.py'],
    { input: JSON.stringify(scenarios), maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' }));

  let mismatches = 0, firstFail = null;
  for (let i = 0; i < scenarios.length; i++) {
    for (let j = 0; j < jsResults[i].length; j++) {
      if (canon(jsResults[i][j]) !== canon(pyResults[i][j])) {
        mismatches++;
        if (!firstFail) firstFail = { scenario: i, step: j, input: scenarios[i].steps[j - 1] || 'genesis',
          js: jsResults[i][j], py: pyResults[i][j] };
        break;
      }
    }
  }

  const totalStates = N * (STEPS + 1);
  if (mismatches === 0) {
    console.log(`✅ JS ≡ Python over ${N} scenarios × ${STEPS} steps (${totalStates} states) — engines agree byte-for-byte.`);
    process.exit(0);
  } else {
    console.log(`❌ ${mismatches}/${N} scenarios DIVERGED. The verifier cannot be trusted until these are equal.`);
    console.log('First divergence:', JSON.stringify(firstFail, null, 2));
    process.exit(1);
  }
}
main();
