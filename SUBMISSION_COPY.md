# Ledgerlings — submission copy + hero GIF (Make Waves)

## Tagline (lead with the differentiator, not "a pet game")
**Primary:** "The one where you can catch the game cheating — on-chain."
**Alt:** "A virtual pet whose fairness is a checkable on-ledger fact. Not 'trust us.' Re-derive it."
**One-liner (submission header):** Ledgerlings is a provably-fair on-chain pet on the XRPL — every feed, evolution, achievement, and PvP battle re-derives from public ledger data under open rules, so the operator can't cheat without anyone detecting it.

## The hero GIF (6 seconds — the single moment that wins)
Goal: make a judge FEEL "couldn't be faked" in one loop. Storyboard:
1. (0-2s) A resolved battle card on screen — big green **✅ VERIFIED** ("winner re-derives from the pinned ledger hash + open rules").
2. (2-4s) Tap the **"Rig it"** toggle — one field of the on-ledger record visibly flips (winner swapped).
3. (4-6s) The badge snaps to red **❌ FAIL — "recorded winner does not match a faithful replay."**
Caption burned in: "Change one byte, everyone sees it. That's provably fair."
(The `verify-battle` / `verify-achievement` endpoints already return exactly this PASS/FAIL — the "Rig it" panel is the last UI piece; see panel rank #6.)

## Where to show traction
- Point judges at the live mainnet issuer account filtered by **SourceTag 2606250001** — every player's own tagged interaction Payment + every battle/achievement mint is on-ledger and countable.
- "Verify my pet" / "Verify this battle" buttons in the app = judges test criterion 3 (live-testable) themselves.

## 60-90s demo script
1. (0-10s) "Most on-chain games ask you to trust the server. This one you can audit." Adopt a pet in one tap (Xaman).
2. (10-30s) Feed it — show the Payment sign + the pet updating live (poller auto-applies, no operator).
3. (30-50s) Battle a second pet with an XRP wager — resolve — winner paid on-ledger.
4. (50-75s) The KILLER MOMENT: hit "Verify" → green PASS + the re-derived history → toggle "Rig it" → red FAIL.
5. (75-90s) "Every badge, every battle, every care action — re-derivable, on XRPL mainnet, tagged to the leaderboard. You can't fake it, and you don't have to trust me." 

## Positioning note (solo build)
Lead on the **Grand Prize / novelty axis** (the verifiable-fairness primitive no other entry has), not the raw
Most-Users / Most-Volume race. The couldn't-be-faked story + a clean live demo is the solo-winnable path.
