#!/usr/bin/env node
/**
 * Fail if the published site (docs/, served by GitHub Pages) has drifted from source (build/).
 *
 *   node build/check_docs_sync.cjs
 *
 * WHY. On 2026-07-30 the live site had been 404ing on market_mood.js for an unknown period. The
 * file existed in build/ and was referenced by the page, but had never been copied to docs/, so
 * MarketMood was undefined and the mood badge was broken for every visitor. Nothing caught it,
 * because docs/ is a separate deploy target and nothing enforced that the two agree.
 *
 * That was the sixth failure that day of the same shape: something looked fine while doing nothing.
 * The others were a Railway build stale since June, a missing MAKEWAVES_SOURCE_TAG that would have
 * scored zero on the leaderboard, an http:// og:image that killed link previews, a wallet derived
 * on the wrong curve, and a frontend that simulated instead of touching the ledger. This check
 * exists so the deploy-drift member of that family cannot come back quietly.
 *
 * Three checks:
 *   1. every file docs/ mirrors is byte-identical to its build/ source (docs/index.html <- build/app.html)
 *   2. every local src/href in a docs/ page resolves inside docs/            <- the market_mood.js bug
 *   3. anything build/app.html loads locally is present in docs/ too         <- catches it one step earlier
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const DOCS = path.join(ROOT, 'docs');

// docs/index.html is a copy of build/app.html; everything else keeps its name.
const RENAMES = { 'index.html': 'app.html' };

const problems = [];
const note = m => console.log('  ' + m);

function localRefs(html) {
  // Strip inline script BODIES first, keeping the opening tag so <script src="..."> still counts.
  // Without this the scan reads JS string literals as markup: app.html builds a share link with
  // href="${BK()}/p/${petNid}" inside a template literal, which is not a file and never was.
  const markup = html.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>');
  const out = new Set();
  for (const m of markup.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const v = m[1];
    if (/^(https?:)?\/\//.test(v) || v.startsWith('#') || v.startsWith('data:') || v.startsWith('mailto:')) continue;
    if (v.includes('${') || v.includes("'+") || v.includes('"+')) continue;   // built at runtime, not a file
    out.add(v.split('?')[0].split('#')[0]);
  }
  return [...out];
}

if (!fs.existsSync(DOCS)) { console.error('docs/ not found'); process.exit(2); }

// ---- 1. mirrored files must be byte-identical ----------------------------------------------
console.log('\n1. docs/ files match their build/ source');
for (const name of fs.readdirSync(DOCS)) {
  const docPath = path.join(DOCS, name);
  if (fs.statSync(docPath).isDirectory()) continue;
  const srcName = RENAMES[name] || name;
  const srcPath = path.join(BUILD, srcName);
  if (!fs.existsSync(srcPath)) { note(`?  docs/${name} has no build/${srcName} counterpart (ignored)`); continue; }
  if (fs.readFileSync(srcPath).equals(fs.readFileSync(docPath))) note(`ok docs/${name} == build/${srcName}`);
  else { note(`XX docs/${name} DIFFERS from build/${srcName}`); problems.push(`docs/${name} is stale; copy build/${srcName} over it`); }
}

// ---- 2. every local reference in a docs/ page resolves inside docs/ -------------------------
console.log('\n2. docs/ pages resolve every local file they reference');
for (const name of fs.readdirSync(DOCS).filter(n => n.endsWith('.html'))) {
  for (const ref of localRefs(fs.readFileSync(path.join(DOCS, name), 'utf8'))) {
    if (fs.existsSync(path.join(DOCS, ref))) note(`ok docs/${name} -> ${ref}`);
    else { note(`XX docs/${name} -> ${ref}  MISSING`); problems.push(`docs/${name} references ${ref}, which is not in docs/ and will 404 on the live site`); }
  }
}

// ---- 3. anything build/app.html loads locally must exist in docs/ ---------------------------
console.log('\n3. files build/app.html loads are present in docs/');
const appPath = path.join(BUILD, 'app.html');
if (fs.existsSync(appPath)) {
  for (const ref of localRefs(fs.readFileSync(appPath, 'utf8'))) {
    if (fs.existsSync(path.join(DOCS, ref))) note(`ok ${ref}`);
    else { note(`XX ${ref} exists for build/ but is NOT in docs/`); problems.push(`build/app.html loads ${ref}; copy it to docs/ or the deployed page will 404`); }
  }
}

// ---- 4. docs/testnet.html must be build/app.html with ONLY the known substitutions ---------
// It is a derived copy, so it silently goes stale whenever app.html changes. That is precisely the
// drift this script exists to catch, and creating it without a check would have reintroduced the
// problem in a new place.
console.log('\n4. docs/testnet.html is in step with build/app.html');
const tnPath = path.join(DOCS, 'testnet.html');
if (fs.existsSync(tnPath) && fs.existsSync(appPath)) {
  const SUBS = [
    ["window.LEDGERLINGS_ISSUER='rDe4tWiu8hVNQEySmfzms47M6qt4JSWf6L'", "window.LEDGERLINGS_ISSUER='rE6WuQHWWJbgwoLYnSvbywaxH84K1tjjQm'"],
    ["window.LEDGERLINGS_BACKEND='https://ledgerlings-backend-production.up.railway.app'", "window.LEDGERLINGS_BACKEND='https://ledgerlings-testnet-production.up.railway.app'"],
    ['<title>Ledgerlings</title>', '<title>Ledgerlings (testnet)</title>'],
  ];
  let expected = fs.readFileSync(appPath, 'utf8');
  for (const [from, to] of SUBS) {
    if (!expected.includes(from)) { note(`XX build/app.html no longer contains: ${from.slice(0, 60)}`); problems.push(`the testnet substitution "${from.slice(0, 50)}..." no longer matches build/app.html; update check_docs_sync.cjs and regenerate docs/testnet.html`); }
    expected = expected.replace(from, to);
  }
  const actual = fs.readFileSync(tnPath, 'utf8');
  // the banner is the one intentional addition, so compare with it stripped out
  const stripBanner = t => t.replace(/<div style="background:#7a4a00[\s\S]*?<\/div>\n(?=<div id="app">)/, '');
  if (stripBanner(actual) === expected) note('ok docs/testnet.html == build/app.html + known substitutions');
  else { note('XX docs/testnet.html has drifted from build/app.html'); problems.push('docs/testnet.html is stale; regenerate it from build/app.html with the testnet substitutions'); }
} else note('?  no docs/testnet.html (skipped)');

console.log('');
if (problems.length) {
  console.error(`FAIL: ${problems.length} problem(s) — the deployed site does not match source\n`);
  problems.forEach(p => console.error('  - ' + p));
  console.error('\nFix: copy the changed files into docs/ (docs/index.html is build/app.html) and commit.');
  process.exit(1);
}
console.log('PASS: docs/ matches build/ and resolves everything it references.');
