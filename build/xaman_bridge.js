/* Ledgerlings <-> Xaman bridge — REAL Xumm SDK wiring with a local-demo fallback.
 * SDK: https://xumm.app/assets/cdn/xumm.min.js   ·   Docs: https://docs.xaman.dev
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
  let xumm = null, account = null, ready = false;
  const KEY = window.XAMAN_API_KEY || '';
  const ISSUER = window.LEDGERLINGS_ISSUER || '';
  const BACKEND = window.LEDGERLINGS_BACKEND || '';
  const hex = s => Array.from(new TextEncoder().encode(s)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

  async function init() {
    if (!window.Xumm || !KEY) { console.info('[xaman] no SDK/API key → local demo mode'); return false; }
    try {
      xumm = new Xumm(KEY);                          // xApp context auto-resolves the user via the OTT
      await new Promise((res) => {
        xumm.on('success', res); xumm.on('ready', res); setTimeout(res, 4000);  // resolve on first signal
      });
      account = await xumm.user.account;
      ready = !!account;
      console.info('[xaman] ready as', account);
      return ready;
    } catch (e) { console.warn('[xaman] init failed → local mode:', e); return false; }
  }

  /* Create + open a Payment(+op memo) sign request; resolve {signed, uuid, txid} or {local:true}. */
  async function interact(op) {
    if (!ready || !xumm) return { local: true };
    const payload = await xumm.payload.create({
      txjson: {
        TransactionType: 'Payment',
        Destination: ISSUER,
        Amount: '10',                                // a tiny nudge tx; the memo carries the intent
        Memos: [{ Memo: { MemoType: hex('ledgerlings/op'), MemoData: hex(op) } }],
      },
      custom_meta: { identifier: 'ledgerlings-' + op, instruction: `Ledgerlings: ${op} your pet` },
    });
    xumm.xapp.openSignRequest(payload);              // open the sign UI inside Xaman
    return await new Promise((res) => {
      const onResult = async (data) => {
        if (!data || data.uuid !== payload.uuid) return;
        const full = await xumm.payload.get(data.uuid);
        res({ signed: !!full?.meta?.signed, uuid: data.uuid, txid: full?.response?.txid });
      };
      xumm.on('payload', onResult);
    });
  }

  /* Authoritative pet state from the issuer backend (after a signed interaction it has run the rules
   * + NFTokenModify). Falls back to null so the caller keeps its optimistic local state. */
  async function fetchPet(nid) {
    if (!BACKEND) return null;
    try { return await (await fetch(`${BACKEND}/pet/${nid}`)).json(); } catch { return null; }
  }
  async function adopt() {
    if (!BACKEND || !account) return null;
    try { return await (await fetch(`${BACKEND}/adopt`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner: account }) })).json(); } catch { return null; }
  }

  return { init, interact, fetchPet, adopt, get account() { return account; }, get ready() { return ready; } };
})();
