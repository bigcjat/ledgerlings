# Ledgerlings — "Market Mood" mechanic (XRPL Price Oracle)

*A pet whose mood reacts, in real time, to the live XRP price — read from an ON-LEDGER Price Oracle, so
even the vibe is data you can verify. Novel, on-brand, and buildable on a primitive that's live today.*

## The one-liner
Your pet feels the market. XRP pumping → it's euphoric, core glowing bright; dumping → it's anxious, core
dimmed. The price comes from the XRPL Price Oracle (XLS-47), so the reaction is driven by **verifiable
on-chain data, not our word** — tap to check the exact oracle + price + ledger it read.

## ⚠️ The brand rule (non-negotiable — this is what keeps it honest)
Market mood is **COSMETIC + EPHEMERAL ONLY.** It is a client-side render overlay. It MUST NOT touch the
fair care-state (hunger/happiness/health/care/evolution/alive) — for two reasons:
1. **Fairness:** a live, external, second-by-second value can't be in the deterministic state, or the pet
   becomes pay-to-win-by-market and the rules stop being re-derivable.
2. **Verifiability:** the replay verifier reconstructs the pet from the ledger history; it can't depend on
   "what was the price at verify time." So mood lives entirely OUTSIDE `pet_rules.step()` (which never reads it).
Mood is to the pet what weather is to a person: it changes how they look/feel in the moment, not who they are.

## Data source — XRPL Price Oracle (XLS-47, LIVE)
- Read XRP/USD via the **`get_aggregate_price`** RPC across one or more published XRP/USD oracles
  (`{account, oracle_document_id}` each) → returns median/trimmed-mean + each oracle's `LastUpdateTime`.
  `price = AssetPrice / 10^Scale`. Aggregating multiple oracles = robust to a single bad feed.
- Poll every ~30–60s (oracles update periodically; respect `LastUpdateTime` — show "stale" if old).
- **TODO before build:** identify live XRP/USD oracle(s) on mainnet (provider account + document id). If none
  reliable yet, use a public price API as a clearly-labeled **off-chain fallback** — but the on-ledger oracle
  is the brand point ("verifiable"), so prefer it and surface which source is in use.

## Mood mapping (trend = current vs a short rolling baseline, e.g. ~1h)
| Δ (short-term) | Mood | Visual |
|---|---|---|
| > +5% | 🚀 euphoric | big bounce, core blazing cyan-white, sparkle burst, upward aura |
| +1%..+5% | 😄 happy | brighter core, content idle, soft green-cyan aura |
| −1%..+1% | 😌 calm | normal idle, neutral core |
| −5%..−1% | 😟 worried | subdued, core dimmed, slight droop, blue aura |
| < −5% | 😰 scared | trembling idle, core deep/dim, "rain" backdrop, pet hunches |
| high volatility (|Δ| swinging) | 😵 dizzy | wobble/spin, flickering core |
- The **aura color** = direction (green up / blue-grey down); **core brightness/hue** = magnitude;
  **idle animation variant** = mood. Reuses the existing procedural pet's bounce/squash/core-glow params.

## "Verify the mood" — the honesty hook (cheap, very on-brand)
A tap on the mood badge shows:
`Mood from XRPL Price Oracle <account>#<doc> · XRP/USD = $X.XXXX · as of ledger N (updated <t>). Check it.`
Even the *cosmetic* layer is transparent about its on-chain source. Nobody else's pet game can say that.

## Architecture (drops into the existing app cleanly)
- New client module **`market_mood.js`**: polls the oracle (xrpl.js / public node), keeps a small rolling
  price history, exposes `getMood() -> {mood, dPct, price, oracle, ledger, stale}`.
- `app.html` render loop passes `mood` into `drawPet()` to drive **aura + core hue + idle variant** — a few
  extra params, no new state. `pet_rules.js`/`pet_rules.py` are **untouched** (proven isolation, like `loadout`).
- A small mood badge in the HUD (emoji + Δ%) + the "verify the mood" popup.

## Marketplace tie-in (compounds v2)
The down-market "rain" / up-market "sunshine" backdrops are exactly the **artist-background dNFTs** from
MARKETPLACE_ROADMAP.md — market weather becomes a collectible cosmetic layer. Optional "market-reactive"
premium backgrounds.

## Scoping
- **Small, high-novelty add** — buildable today (oracle is live). Good candidate for the hackathon "one
  delight hook" alongside (or instead of) the dance, because it's *unique to XRPL* (a pet that provably
  reacts to on-chain market data) — judges remember that.
- v1 = mood overlay + the verify-the-mood popup. v2 = market-weather backgrounds (marketplace).
- Keep it strictly cosmetic; never let it bleed into the fair state. That guard is the whole point.
