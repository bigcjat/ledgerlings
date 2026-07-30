/* Ledgerlings <-> Xaman bridge — REAL Xumm SDK wiring with a local-demo fallback.
 * SDK: https://xaman.app/assets/cdn/xumm.min.js   ·   Docs: https://docs.xaman.dev
 *
 * In a Xaman xApp the SDK auto-resolves the user (OTT context); interactions become real
 * Payment+memo sign requests. With no SDK/key (e.g. opened as a plain web page), interact()
 * returns {local:true} and the app falls back to the offline demo rules — so app.html still runs anywhere.
 *
 * Set before this script loads:
 *   window.XAMAN_API_KEY        = '...'      // from https://apps.xaman.dev (xApp)
 *   window.LEDGERLINGS_ISSUER    = 'r...'     // the game issuer account (mints + modifies pets)
 *   window.LEDGERLINGS_BACKEND   = 'https://...' // the issuer service base URL (server.js)
 */
const XamanBridge = (() => {
  let xumm = null, account = null, ready = false, sourceTag = null;
  const KEY = window.XAMAN_API_KEY || '';
  const ISSUER = window.LEDGERLINGS_ISSUER || '';
  const BACKEND = window.LEDGERLINGS_BACKEND || '';
  const hex = s => Array.from(new TextEncoder().encode(s)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

  // pull the Make Waves SourceTag from the backend so the PLAYER's own interaction Payment is credited
  // to Ledgerlings on the leaderboard (not just issuer-built txns). Public, non-secret.
  async function loadConfig() {
    if (!BACKEND) return;
    try { const cfg = await (await fetch(`${BACKEND}/config`)).json(); if (Number.isInteger(cfg && cfg.sourceTag)) sourceTag = cfg.sourceTag; }
    catch { /* no config → no tag */ }
  }

  /* Two contexts, and they are NOT interchangeable:
   *
   *   xApp    – opened inside Xaman. The OTT resolves the user automatically, and xumm.xapp exists.
   *   browser – an ordinary web page. xumm.xapp is UNDEFINED here (verified against the live SDK),
   *             and the user must be resolved with authorize(), which opens a popup and therefore
   *             has to be triggered by a click. It cannot run at page load.
   *
   * xumm.runtime = { cli, browser, xapp } is the discriminator the SDK itself provides.
   * init() therefore never authorizes on its own: in a browser it reports the not-signed-in state and
   * leaves the page to offer a sign-in button, falling back to keyless adopt if the user declines. */
  let isXapp = false, sdkReady = false;

  async function init() {
    await loadConfig();
    if (!window.Xumm || !KEY) { console.info('[xaman] no SDK/API key → local demo mode'); return false; }
    try {
      xumm = new Xumm(KEY);
      isXapp = !!(xumm.runtime && xumm.runtime.xapp);
      sdkReady = true;
      if (!isXapp) { console.info('[xaman] browser context → sign-in is available on demand'); return false; }

      // xApp: the OTT resolves the user with no interaction.
      await new Promise((res) => {
        xumm.on('success', res); xumm.on('ready', res); setTimeout(res, 4000);  // resolve on first signal
      });
      account = await xumm.user.account;
      ready = !!account;
      console.info('[xaman] xApp ready as', account, '· sourceTag', sourceTag);
      return ready;
    } catch (e) { console.warn('[xaman] init failed → local mode:', e); return false; }
  }

  /* Browser sign-in. MUST be called from a click: authorize() opens a popup and browsers block
   * popups that are not user-initiated. Resolves to the account, or null if declined/failed. */
  async function signIn(onFallbackUrl) {
    if (!sdkReady || !xumm || isXapp) return null;

    // The SDK does async work before it calls window.open, so by the time the popup is requested the
    // browser no longer considers it user-initiated and blocks it. authorize() then waits forever for
    // a callback that cannot arrive: no popup, no error, no rejection. Observed on a desktop browser,
    // and reproduced headlessly — the button simply sat on "opening Xaman…".
    //
    // So: capture the URL the SDK wants to open, and if the popup was blocked, hand it back to the
    // page. A link the user clicks IS user-initiated, so it always opens.
    let popupUrl = null, blocked = false;
    const realOpen = window.open;
    window.open = function (...args) {
      popupUrl = args[0];
      const w = realOpen.apply(window, args);
      if (!w || w.closed || typeof w.closed === 'undefined') blocked = true;
      return w;
    };

    // WATCH for the popup rather than guessing when it happens. A fixed short wait missed it: the SDK
    // does its async setup first and calls window.open well after the click.
    let notified = false;
    const watch = setInterval(() => {
      if (!notified && blocked && popupUrl && typeof onFallbackUrl === 'function') {
        notified = true; onFallbackUrl(popupUrl);
      }
    }, 300);

    // Cap the wait. authorize() never rejects when the popup is blocked, so without this the caller
    // is left awaiting a promise that cannot settle and the button stays disabled forever.
    const timeout = new Promise(r => setTimeout(() => r('TIMEOUT'), 180000));

    try {
      const outcome = await Promise.race([xumm.authorize().then(() => 'OK').catch(e => e), timeout]);
      if (outcome === 'TIMEOUT') { console.warn('[xaman] sign-in timed out'); return null; }
      account = await xumm.user.account;
      ready = !!account;
      console.info('[xaman] signed in as', account);
      return account;
    } catch (e) { console.warn('[xaman] sign-in failed:', e); return null; }
    finally { clearInterval(watch); window.open = realOpen; }
  }

  async function signOut() {
    try { xumm && (await xumm.logout()); } catch { /* best effort */ }
    account = null; ready = false;
  }

  /* xumm.payload is a lazy Promise that resolves to the payload API. Awaiting it is correct whether
   * it arrives as a promise or as a plain object, so both contexts use this. */
  const payloadApi = async () => await xumm.payload;

  /* Is a Xaman sign-in possible at all right now? The page uses this to decide whether to show a
   * "Sign in with Xaman" button next to keyless adopt. */
  function canSignIn() { return sdkReady && !isXapp && !ready; }

  /* Create + open a Payment(+op memo) sign request; resolve {signed, uuid, txid} or {local:true}. */
  async function interact(op, nid) {
    if (!ready || !xumm) return { local: true };
    // memo = "<op>|<nid>" so the on-ledger verifier can attribute this interaction to THIS pet.
    const memoData = nid ? `${op}|${nid}` : op;
    const P = await payloadApi();
    const request = {
      txjson: {
        TransactionType: 'Payment',
        Destination: ISSUER,
        Amount: '10',                                // a tiny nudge tx; the memo carries the intent
        Memos: [{ Memo: { MemoType: hex('ledgerlings/op'), MemoData: hex(memoData) } }],
        ...(sourceTag != null ? { SourceTag: sourceTag } : {}),   // credit THIS player's account on the Make Waves leaderboard
      },
      custom_meta: { identifier: 'ledgerlings-' + op, instruction: `Ledgerlings: ${op} your pet` },
    };

    // BROWSER: create + subscribe, and hand the user the deep link. There is no xumm.xapp here, so
    // openSignRequest does not exist; calling it would throw. The subscription resolves when the
    // payload is signed, declined or expires.
    if (!isXapp) {
      const sub = await P.createAndSubscribe(request, (ev) => {
        if (Object.keys(ev.data).indexOf('signed') > -1) return ev.data;   // resolves the subscription
      });
      const url = sub && sub.created && sub.created.next && sub.created.next.always;
      if (url) window.open(url, '_blank', 'noopener');                     // Xaman deep link / QR page
      const res = await sub.resolved;
      const signed = !!(res && res.signed);
      let txid = null;
      if (signed) { try { const full = await P.get(sub.created.uuid); txid = full && full.response && full.response.txid; } catch { /* best effort */ } }
      return { signed, uuid: sub.created && sub.created.uuid, txid };
    }

    const payload = await P.create(request);
    xumm.xapp.openSignRequest(payload);              // open the sign UI inside Xaman
    return await new Promise((res) => {
      // openSignRequest resolves via the xApp 'payload' event (NOT xumm.on). Per docs the event is
      // { reason: 'SIGNED' | 'DECLINED', uuid } — there is no data.payload object and no txid; fetch
      // txid via payload.get(uuid). One-shot + cleanup.
      const onResult = async (data) => {
        if (!data || !data.uuid) return;
        if (payload.uuid && data.uuid !== payload.uuid) return;          // ignore unrelated payloads
        xumm.xapp.off && xumm.xapp.off('payload', onResult);
        const signed = data.reason === 'SIGNED';
        let txid = null;
        if (signed) { try { const full = await (await payloadApi()).get(data.uuid); txid = full && full.response && full.response.txid; } catch (e) { /* txid best-effort */ } }
        res({ signed, uuid: data.uuid, txid });
      };
      xumm.xapp.on('payload', onResult);
    });
  }

  /* Sign a server-built transaction as-is. Used for the ladder challenge, where the backend returns
   * an unsignedTx whose memo pins the future ledger that seeds the fight. The txjson is passed
   * through untouched: altering it here would change the battle the player thinks they are entering. */
  async function signLadder(txjson, label) {
    if (!ready || !xumm || !txjson) return { local: true };
    const P = await payloadApi();
    const request = { txjson, custom_meta: { identifier: 'ledgerlings-ladder', instruction: `Ledgerlings: challenge ${label || 'the ladder'}` } };
    if (!isXapp) {
      const sub = await P.createAndSubscribe(request, (ev) => {
        if (Object.keys(ev.data).indexOf('signed') > -1) return ev.data;
      });
      const url = sub && sub.created && sub.created.next && sub.created.next.always;
      if (url) window.open(url, '_blank', 'noopener');
      const res = await sub.resolved;
      const signed = !!(res && res.signed);
      let txid = null;
      if (signed) { try { const full = await P.get(sub.created.uuid); txid = full && full.response && full.response.txid; } catch { /* best effort */ } }
      return { signed, txid };                      // txid IS the battleId
    }
    const payload = await P.create(request);
    xumm.xapp.openSignRequest(payload);
    return await new Promise((res) => {
      const onResult = async (data) => {
        if (!data || !data.uuid) return;
        if (payload.uuid && data.uuid !== payload.uuid) return;
        xumm.xapp.off && xumm.xapp.off('payload', onResult);
        const signed = data.reason === 'SIGNED';
        let txid = null;
        if (signed) { try { const full = await (await payloadApi()).get(data.uuid); txid = full && full.response && full.response.txid; } catch { /* best effort */ } }
        res({ signed, txid });
      };
      xumm.xapp.on('payload', onResult);
    });
  }

  /* Authoritative pet state from the issuer backend (after a signed interaction it has run the rules
   * + NFTokenModify). Falls back to null so the caller keeps its optimistic local state. */
  async function fetchPet(nid) {
    if (!BACKEND) return null;
    try { return await (await fetch(`${BACKEND}/pet/${nid}`)).json(); } catch { return null; }
  }
  /* Verify my pet: the issuer (or anyone) re-derives the pet from its on-ledger history and
   * compares to the on-chain state. Returns {ok, verdict:'PASS'|'DIVERGED'|..., interactions, reason}. */
  async function verify(nid) {
    if (!BACKEND) return { ok: null, verdict: 'NO_BACKEND', reason: 'no issuer backend configured (local demo)' };
    try { return await (await fetch(`${BACKEND}/verify/${nid}`)).json(); }
    catch (e) { return { ok: null, verdict: 'ERROR', reason: String(e.message || e) }; }
  }
  async function adopt() {
    if (!BACKEND || !account) return null;
    try { return await (await fetch(`${BACKEND}/adopt`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner: account }) })).json(); } catch { return null; }
  }
  /* current validated ledger (for LIVE-pet cooldown math). null if no backend. */
  async function now() {
    if (!BACKEND) return null;
    try { const j = await (await fetch(`${BACKEND}/now`)).json(); return Number.isInteger(j && j.ledger) ? j.ledger : null; } catch { return null; }
  }

  return { init, signIn, signOut, canSignIn, interact, signLadder, fetchPet, adopt, verify, now,
    get account() { return account; }, get ready() { return ready; }, get isXapp() { return isXapp; },
    get sourceTag() { return sourceTag; } };
})();
