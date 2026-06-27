/* ──────────────────────────────────────────────────────────────────────────
   market_mood.js — Ledgerlings "Market Mood" mechanic
   ───────────────────────────────────────────────────────────────────────────
   The pet's APPEARANCE reacts to the live XRP/USD price.

   HARD RULE (from MARKET_MOOD.md): this is COSMETIC + EPHEMERAL ONLY.
   It is a client-side render overlay. It NEVER touches pet_rules / the fair
   care-state / the replay verifier. Nothing here is persisted or signed.
   It only feeds drawPet() three extra inputs: aura color, core hue/brightness,
   idle-animation variant.

   Public API:
     MarketMood.start()                       // begin polling (idempotent)
     MarketMood.stop()
     MarketMood.get() -> {
        mood,     // 'euphoric'|'happy'|'calm'|'worried'|'scared'|'dizzy'
        dPct,     // short-term % change vs rolling baseline (number)
        price,    // latest XRP/USD price (number|null)
        source,   // human label of the live source (string)
        onLedger, // boolean — true only if reading the XRPL Price Oracle
        oracle,   // {account, docId, ledger} when on-ledger, else null
        updated,  // ms epoch of the latest successful read (number|null)
        stale     // true if no fresh read within STALE_MS
     }
   ────────────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  // ── tunables ────────────────────────────────────────────────────────────
  const POLL_MS    = 30000;   // poll every ~30s (spec: 30–60s)
  const STALE_MS   = 120000;  // a read older than this is "stale"
  const HIST_MAX   = 40;      // rolling history length (~20 min at 30s)
  const BASELINE_N = 12;      // baseline = avg of the oldest ~N samples in window
  // mood thresholds (% change) per the spec's mapping table
  const T_EUPHORIC = 5;       // > +5%
  const T_HAPPY    = 1;       // +1%..+5%
  // |Δ| swinging this much across recent samples => dizzy (high volatility)
  const T_DIZZY_VOL = 4;

  // ── state ─────────────────────────────────────────────────────────────────
  let hist = [];              // [{t, price}]
  let timer = null;
  let last = {
    mood: 'calm', dPct: 0, price: null,
    source: 'starting…', onLedger: false, oracle: null,
    updated: null, stale: true
  };
  let inFlight = false;

  // ── ON-LEDGER ORACLE (XLS-47) — STUB, ready for a 1-function swap ──────────
  // The brand point of MARKET_MOOD.md is "verifiable on-chain data". The real
  // path is the XRPL Price Oracle: an rippled `get_aggregate_price` RPC over
  // one or more PUBLISHED XRP/USD oracles, each addressed by
  // {account, oracle_document_id}. price = AssetPrice / 10^Scale.
  //
  // It is left STUBBED because no reliable mainnet XRP/USD oracle
  // (account + document id) is confirmed at build time. The moment one is
  // identified, fill ORACLES below and flip the early `return null` — every
  // consumer already reads `onLedger`/`oracle` and the UI will switch its
  // "Verify the mood" copy automatically. No other code changes needed.
  //
  // Reference RPC (XLS-47):
  //   {"method":"get_aggregate_price","params":[{
  //       "base_asset":"XRP","quote_asset":"USD",
  //       "trim":20,
  //       "oracles":[{"account":"r…","oracle_document_id":N}, ...]
  //   }]}
  // -> result.entire_set.mean / .median (already AssetPrice/10^Scale aware
  //    depending on node), plus each oracle's LastUpdateTime (=> stale check)
  //    and the validated `ledger_index` to show in the honesty popup.
  const ORACLES = [
    // { account: 'rXRPUSDoracleAccount...', oracle_document_id: 1 },  // <- fill when identified
  ];
  const XRPL_RPC = 'https://xahau.network';  // or an XRPL mainnet JSON-RPC node

  async function readOnLedgerOracle() {
    // Not wired until a real XRP/USD oracle is identified — fail closed so we
    // transparently fall back to the clearly-labeled off-chain source.
    if (!ORACLES.length) return null;
    try {
      const res = await fetch(XRPL_RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          method: 'get_aggregate_price',
          params: [{ base_asset: 'XRP', quote_asset: 'USD', trim: 20, oracles: ORACLES }]
        })
      });
      const j = await res.json();
      const r = j && j.result;
      if (!r || r.status !== 'success' || !r.entire_set) return null;
      const price = Number(r.entire_set.mean || r.median);
      if (!isFinite(price) || price <= 0) return null;
      return {
        price,
        source: 'XRPL Price Oracle (XLS-47, on-ledger)',
        onLedger: true,
        oracle: {
          account: ORACLES[0].account,
          docId: ORACLES[0].oracle_document_id,
          ledger: r.ledger_index || r.ledger_current_index || null
        }
      };
    } catch (_) {
      return null;
    }
  }

  // ── OFF-LEDGER FALLBACK (works in a browser today, CORS-friendly) ─────────
  // Honest about being off-chain. Two independent endpoints; first that
  // succeeds wins, so a single outage doesn't blank the mood.
  async function readOffLedger() {
    // 1) Coinbase spot — CORS-open, no key
    try {
      const res = await fetch('https://api.coinbase.com/v2/prices/XRP-USD/spot', { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        const price = Number(j && j.data && j.data.amount);
        if (isFinite(price) && price > 0) {
          return { price, source: 'Coinbase spot (off-chain)', onLedger: false, oracle: null };
        }
      }
    } catch (_) { /* try next */ }

    // 2) CoinGecko simple price — CORS-open, no key
    try {
      const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=ripple&vs_currencies=usd',
        { cache: 'no-store' }
      );
      if (res.ok) {
        const j = await res.json();
        const price = Number(j && j.ripple && j.ripple.usd);
        if (isFinite(price) && price > 0) {
          return { price, source: 'CoinGecko (off-chain)', onLedger: false, oracle: null };
        }
      }
    } catch (_) { /* fall through */ }

    return null;
  }

  // ── mood computation from the rolling history ─────────────────────────────
  function computeBaseline() {
    if (hist.length < 2) return null;
    // baseline = mean of the oldest BASELINE_N samples in the window
    const old = hist.slice(0, Math.min(BASELINE_N, hist.length - 1));
    const sum = old.reduce((a, p) => a + p.price, 0);
    return sum / old.length;
  }

  function shortTermVolatility() {
    // peak-to-peak %, over the recent half of the window — used to detect "dizzy"
    if (hist.length < 4) return 0;
    const recent = hist.slice(-Math.max(4, Math.floor(hist.length / 2)));
    let lo = Infinity, hi = -Infinity;
    for (const p of recent) { if (p.price < lo) lo = p.price; if (p.price > hi) hi = p.price; }
    if (lo <= 0) return 0;
    return ((hi - lo) / lo) * 100;
  }

  function moodFor(dPct, vol) {
    // High volatility (swinging) overrides direction => dizzy.
    if (vol >= T_DIZZY_VOL && Math.abs(dPct) < T_EUPHORIC) return 'dizzy';
    if (dPct >  T_EUPHORIC) return 'euphoric';
    if (dPct >  T_HAPPY)    return 'happy';
    if (dPct >= -T_HAPPY)   return 'calm';
    if (dPct >= -T_EUPHORIC)return 'worried';
    return 'scared';
  }

  function recompute() {
    const price = hist.length ? hist[hist.length - 1].price : null;
    const base = computeBaseline();
    const dPct = (base && price) ? ((price - base) / base) * 100 : 0;
    const vol = shortTermVolatility();
    const updated = hist.length ? hist[hist.length - 1].t : last.updated;
    const stale = !updated || (Date.now() - updated > STALE_MS);
    last = {
      ...last,
      price,
      dPct: stale ? 0 : dPct,                 // don't show movement off a stale feed
      mood: stale ? 'calm' : moodFor(dPct, vol),
      updated,
      stale
    };
  }

  async function poll() {
    if (inFlight) return;
    inFlight = true;
    try {
      // Prefer the on-ledger oracle (brand point); fall back to off-chain.
      let read = await readOnLedgerOracle();
      if (!read) read = await readOffLedger();
      if (read) {
        const t = Date.now();
        hist.push({ t, price: read.price });
        if (hist.length > HIST_MAX) hist = hist.slice(-HIST_MAX);
        last.source = read.source;
        last.onLedger = read.onLedger;
        last.oracle = read.oracle;
      }
      // if read failed, leave hist as-is; recompute() will mark stale below
      if (!read && !hist.length) last.source = 'no live price (offline/blocked)';
      recompute();
    } catch (_) {
      recompute();
    } finally {
      inFlight = false;
    }
  }

  function start() {
    if (timer) return;
    poll();                                   // immediate first read
    timer = setInterval(poll, POLL_MS);
    // keep "stale" honest even between polls
    setInterval(recompute, 5000);
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  function get() {
    // recompute staleness on read so callers always see fresh truth
    recompute();
    return { ...last, oracle: last.oracle ? { ...last.oracle } : null };
  }

  // emoji helper for the HUD badge (kept here so UI stays declarative)
  const EMOJI = { euphoric: '🚀', happy: '😄', calm: '😌', worried: '😟', scared: '😰', dizzy: '😵' };
  function emoji(m) { return EMOJI[m] || '😌'; }

  global.MarketMood = { start, stop, get, emoji, readOnLedgerOracle, _hist: () => hist.slice() };
})(typeof window !== 'undefined' ? window : this);
