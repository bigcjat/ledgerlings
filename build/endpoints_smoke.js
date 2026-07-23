#!/usr/bin/env node
'use strict';
// Public surface smoke: /adopt (public) -> /gallery, /card/:nid.svg, /p/:nid, /gallery.html all serve. No login.
// Run: node build/endpoints_smoke.js
const xrpl = require('xrpl');
const ENDPOINT = 'wss://s.altnet.rippletest.net:51233';

(async () => {
  const c = new xrpl.Client(ENDPOINT); await c.connect();
  const { wallet: w } = await c.fundWallet();
  const { wallet: p } = await c.fundWallet();
  const { wallet: q } = await c.fundWallet();
  // configure the issuer server from THIS throwaway wallet, before requiring it
  process.env.LEDGERLINGS_ISSUER_SEED = w.seed;
  process.env.POLLER = '0';
  process.env.MAKEWAVES_SOURCE_TAG = '2606250001';
  const S = require('./server.js');
  const srv = S.app.listen(8799);
  const base = 'http://127.0.0.1:8799';
  const j = (path, opts) => fetch(base + path, opts).then(r => r.json());
  const t = (path) => fetch(base + path).then(r => Promise.all([r.status, r.text(), r.headers.get('content-type')]));

  console.log('adopt two pets (public /adopt)…');
  const a1 = await j('/adopt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner: p.classicAddress }) });
  const a2 = await j('/adopt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner: q.classicAddress }) });
  console.log('  pets:', (a1.nid || '').slice(0, 10), (a2.nid || '').slice(0, 10));

  console.log('one-per-owner cap: re-adopt same owner returns existing…');
  const a1b = await j('/adopt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner: p.classicAddress }) });
  const capOk = a1b.existing === true && a1b.nid === a1.nid;

  console.log('GET /gallery…'); const g = await j('/gallery');
  console.log('  count', g.count);
  console.log('GET /card/:nid.svg…'); const [cs, cbody, cct] = await t('/card/' + a1.nid + '.svg');
  console.log('  status', cs, 'ctype', cct, 'isSvg', cbody.startsWith('<svg'));
  console.log('GET /p/:nid…'); const [ps, pbody] = await t('/p/' + a1.nid);
  const ogOk = pbody.includes('og:image') && pbody.includes('/card/' + a1.nid + '.svg') && pbody.includes('Adopt your own');
  console.log('  status', ps, 'has OG card + adopt CTA', ogOk);
  console.log('GET /gallery.html…'); const [gs, gbody] = await t('/gallery.html');
  const galOk = gs === 200 && gbody.includes('Ledgerlings Gallery') && gbody.includes("fetch('/gallery')");

  srv.close(); await c.disconnect();
  const pass = a1.nid && a2.nid && capOk && g.count >= 2 && cs === 200 && cbody.startsWith('<svg') && (cct || '').includes('svg')
    && ps === 200 && ogOk && galOk;
  console.log(pass
    ? '\n✅ PUBLIC SURFACE LIVE: adopt (public, 1/owner), gallery, SVG card, shareable pet page (OG preview), gallery page all serve.'
    : '\n❌ endpoints smoke failed — see output above.');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
