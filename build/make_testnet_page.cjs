#!/usr/bin/env node
/**
 * Generate docs/testnet.html from build/app.html.
 *
 *   node build/make_testnet_page.cjs
 *
 * The testnet page is the SAME app pointed at the testnet service, so judges and testers can play
 * the whole game for free. Make Waves judging asks for an entry that is testable live; mainnet
 * adoption is free but feeding and fighting need a funded account, which is a wall a judge should
 * not hit.
 *
 * It exists as a generated file rather than a hand-maintained copy because a hand-maintained copy
 * goes stale the moment app.html changes, which is the exact failure this repo already had with
 * market_mood.js. check_docs_sync.cjs verifies the output still matches; this script produces it.
 * Run both after touching app.html.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'build', 'app.html');
const OUT = path.join(ROOT, 'docs', 'testnet.html');

// Keep in lockstep with the SUBS table in check_docs_sync.cjs.
const SUBS = [
  ["window.LEDGERLINGS_ISSUER='rDe4tWiu8hVNQEySmfzms47M6qt4JSWf6L'",
   "window.LEDGERLINGS_ISSUER='rE6WuQHWWJbgwoLYnSvbywaxH84K1tjjQm'"],
  ["window.LEDGERLINGS_BACKEND='https://ledgerlings-backend-production.up.railway.app'",
   "window.LEDGERLINGS_BACKEND='https://ledgerlings-testnet-production.up.railway.app'"],
  ['<title>Ledgerlings</title>', '<title>Ledgerlings (testnet)</title>'],
];

const BANNER = `<div style="background:#7a4a00;color:#ffe9c2;padding:8px 12px;font-size:12px;text-align:center;line-height:1.45">
  <b>XRPL TESTNET</b> — a free sandbox for judges and testers. Nothing here uses real XRP.
  Everything works exactly as it does on mainnet, on the same code and the same open rules.<br>
  The real one lives at <a href="./" style="color:#ffd27a">hugegreencandle.github.io/ledgerlings</a>.
  Need test XRP to play? <a href="https://xrpl.org/xrp-testnet-faucet.html" target="_blank" rel="noopener" style="color:#ffd27a">XRPL testnet faucet</a>.
</div>
`;

let html = fs.readFileSync(SRC, 'utf8');
for (const [from, to] of SUBS) {
  if (!html.includes(from)) {
    console.error(`build/app.html no longer contains:\n  ${from}\nUpdate SUBS here and in check_docs_sync.cjs.`);
    process.exit(1);
  }
  html = html.replace(from, to);
}
if (!html.includes('<div id="app">')) { console.error('anchor <div id="app"> not found'); process.exit(1); }
html = html.replace('<div id="app">', BANNER + '<div id="app">');

fs.writeFileSync(OUT, html);
console.log(`wrote ${path.relative(ROOT, OUT)} from ${path.relative(ROOT, SRC)}`);
console.log('  issuer  -> rE6WuQHWWJbgwoLYnSvbywaxH84K1tjjQm (testnet)');
console.log('  backend -> ledgerlings-testnet-production.up.railway.app');
