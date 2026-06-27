# Ledgerlings — Fun & Interactivity (delight layer)

## The architecture principle (this is what makes rich fun SAFE for the brand)
Two layers, kept separate:
- **On-chain (verifiable, minimal):** the care/evolution state — feed/play/clean/heal, aging, death,
  evolution. Deterministic + provably fair. Don't bloat it.
- **Client-side (the xApp webview — rich, real-time, cosmetic):** toys, mini-games, audio-reactive dance,
  sensors, AR. None of it touches the fair state, so it can be as playful and alive as you want.
- **The bridge:** a mini-game/toy can grant a BOUNDED on-chain happiness/care bump (capped per cooldown, so
  it stays farm-proof + fair). Skill earns a *little* care; it can't be exploited. Fun feeds fairness, safely.

## ⭐ The music-dance (your idea — yes, and it's a viral standout)
The xApp runs in a webview → **Web Audio API**. Flow:
- `getUserMedia(mic)` → `AnalyserNode` → real-time FFT / onset(beat) detection → estimate tempo + energy.
- Drive the pet: bounce on each beat, cycle dance frames at the BPM, brighten the proof-core with the bass.
- The pet literally dances *with* your music. A pet dancing to your song = an instantly shareable clip =
  organic marketing (the "gets users" engine). Core glows to the beat = the brand on display.

Feasibility + honest caveats:
- Depends on the Xaman webview granting **mic permission** (`getUserMedia`). VERIFY in the xApp SDK first.
- If mic is restricted, fallbacks that need no permission: (a) an in-xApp music player (you control the
  audio → analyze it directly, no mic); (b) **tap-to-the-beat** (the player taps, the pet dances + a rhythm
  mini-game grants bounded happiness); (c) **device motion** (shake/tilt → the pet wiggles).
- Pure cosmetic + client-side → zero fairness risk, no chain cost.

## Toys to play with (client-side, cosmetic; some grant bounded happiness)
- **Ball** — drag-fling, the pet chases/fetches it (simple physics).
- **Laser pointer / bubble** — pet chases your finger; pop bubbles.
- **Tickle** — tap the pet → giggle + a happy reaction.
- **Instruments / drum pad** — tap out a beat, the pet dances to it (a gentler music-dance with no mic).
- **Feeding variety** — different foods = different reaction animations (cosmetic flavor).
- Toys can be **cosmetic dNFTs** (ties to the marketplace: a rare ball, a glowing dance floor, instruments).

## Mini-games (skill → BOUNDED on-chain reward)
- **Rhythm/dance game** (the music-dance as a scored game) — hit the beats → happiness (capped/cooldown).
- **Catch** — the pet tosses, you catch; **memory** — Simon-says with the core colors; **hide & seek.**
- All: score → a small, cooldown-bounded happiness/care bump. Farm-proof (the cap is the fairness guard).

## Reactions & life (emotional bonding — cheap, huge charm)
- Reacts to **taps** (tickle), **follows your finger**, **sleeps at night / when you're away**, **lights up
  when you open the app** ("missed you!"), idle micro-animations (blink, yawn, look around).
- **Sensors:** shake → wobble; tilt → slide; step-counter → "walk your pet"; time-of-day → day/night moods.

## Social / multiplayer (post-MVP, big virality)
- **Visit** a friend's pet; pets **play together**; a **dance party** where multiple pets sync to the same
  beat; **gift** a toy/accessory (a real on-chain NFT transfer). Leaderboards for best-cared / rarest.

## AR (later, max shareability)
- Camera → the pet appears on your desk / in your room and **dances there.** The most shareable possible clip.

## Scoping
- **MVP (90 days):** the core loop + fairness + a thin xApp. Add ONE delight hook for the demo — the
  **music-dance (or tap-to-beat)** is the highest wow-per-effort and the most shareable; it could be the
  thing that wins the room.
- **Post-MVP:** the toy box, mini-games, social, AR — a steady stream of updates that keep users returning.
- **Brand guard:** everything fun stays cosmetic OR grants only bounded/cooldowned on-chain happiness.
  Nothing fun is allowed to break "provably fair." That rule is non-negotiable and it's also your edge:
  *the only pet that's this alive AND this honest.*
