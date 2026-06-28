# BUILD SPEC — Partition + Broker creator economics (XRPL mainnet)

**Goal:** artist keeps 100% of the pet resale royalty; platform earns via brokerage + cosmetics/treats; recruit via holder-gated drops; all re-verifiable. XRPL-native, no Hooks/Batch/token. Source: CREATOR_ECONOMICS.md panel.

**Success criteria (done = all true):**
1. A pet mints with `Issuer = artistAddress` (artist keeps TransferFee) via authorized minting — proven on-ledger (NFTokenID issuer field = artist).
2. A primary sale settles atomically via BrokerMode: buyer→artist (price) + buyer→platform (broker fee) in one tx; future resale royalty → artist.
3. Cosmetics mint platform-issued; treats = non-transferable MPT.
4. A holder-gated exclusive adopt: only a verified partner-collection holder can take the offer.
5. Mint/broker endpoints are AUTHed; CORS locked; inputs validated. (Panel must-fixes closed.)
6. Public read-only transparency view reconstructs royalty + disbursement flows.

---

## P0 — Security + honest model (gates any public launch; do FIRST)
Panel CRITICALs to close before sharing the canvas link or recruiting:
- **Auth all mint/broker routes.** Add a shared admin token (or signed-request check) to `/adopt /mint-accessory /register-character` + new routes. Reject anon writes.
- **Lock CORS** to the GitHub Pages origin (drop `*`).
- **Rate-limit + validate** (per-IP/wallet quotas; validate r-addresses, sizes, taxon).
- **Flip pet/character mint to `Issuer = artist`** (see P1) + **correct canvas/CHARACTER_TEMPLATE wording** to the true model (artist keeps royalty; platform earns brokerage/cosmetics/player-side).
- **Deliver NFTs** to the recipient (don't retain at issuer); **validate genesis** in verifyPet (`dec(mintURI) === enc(R.genesis(...))`); make **verify client-side** (query a public node, replay in-page) so "don't trust us, check" is true.

## P1 — Authorized minting (artist = issuer)
- **Artist setup (one-time, artist-signed via Xaman):** `AccountSet` with `NFTokenMinter = <platform address>`.
- **Platform mint (platform-signed):** `NFTokenMint { Issuer: artistAddress, NFTokenTaxon: <collabTaxon>, Flags: tfTransferable, TransferFee: <artistRoyaltyBps>, URI }`. Deliver to recipient (mint-then-offer or mint to artist for sale).
- Endpoint: `POST /mint-pet { artist, recipient, royaltyBps, uri }` (auth: admin/artist-authorized). Requires artist has set NFTokenMinter first → add a `GET /minter-status?artist=` check.
- Cosmetics: keep platform-issued (`Issuer = platform`, TransferFee → platform). Treats: P3.

## P2 — Brokered primary sale (platform's atomic cut)
- Artist: `NFTokenCreateOffer` (sell, Owner=artist, Amount=listPrice).
- Buyer (Xaman-signed): `NFTokenCreateOffer` (buy, Destination=platform-broker-locked, Amount=listPrice+brokerFee... model net of artist TransferFee).
- Platform: `NFTokenAcceptOffer { NFTokenSellOffer, NFTokenBuyOffer, NFTokenBrokerFee }` → keeps the spread, atomic, no custody.
- Endpoints: `/list-pet` (artist offer), `/buy-pet` (build buyer offer payload for Xaman), `/broker-sale` (platform matches + brokerFee).
- Math: brokerFee + artist proceeds must reconcile with the pet's own TransferFee on later resales — document the exact split.

## P3 — Treats (MPT) + cosmetics revenue
- `MPTokenIssuanceCreate` from platform with `tfMPTCanTransfer` OFF (closed-loop, non-transferable = gift card, not a security). **Verify MPTokensV1 active on target network first.**
- `/buy-treats { buyer, qty }` → player pays platform (XRP/RLUSD) → platform issues MPT to buyer. Treats spent in-game (burn/debit).

## P4 — Holder-gated cross-community recruit
- `GET /verify-holder { wallet, partnerIssuer|partnerTaxon }` → read `account_nfts`, confirm holding (point-in-time → short-lived).
- `CredentialCreate` (XLS-70, short `Expiration`) for verified holders.
- `NFTokenCreateOffer { Destination: wallet, Expiration }` = exclusive/discounted adopt only that wallet can take.
- Pitch: "your partner NFT unlocks an exclusive Ledgerling."

## P5 — Transparency dashboard (brand)
- Read-only: reconstruct TransferFee receipts + vault disbursements from `account_tx` / `nfts_by_issuer`. Static page or endpoint. "Fair pay you can re-verify."

## P6 — Marquee multisig vault (later, per-collab)
- Fresh per-collab issuer: `AccountSet asfDisableMaster` + `SignerListSet` 2-of-3 (artist/platform/recovery) + `SetRegularKey` (platform runs mint pipeline). Royalties pool where neither drains alone; co-signed disbursement. Pitch: "we literally cannot drain your royalties without your signature."

---

## Decisions needed from Dane (before build)
1. **Mainnet vs testnet** for the Make Waves submission (authorized-mint + broker + real buyers need real wallets). Likely: build/test on testnet, demo path to mainnet.
2. **Xaman API keys** (artist + buyer signing via Xaman xApp) — needed for P1 artist setup + P2 buyer offers.
3. **Default artist royalty %** + **broker fee %** + treats pricing.
4. Confirm **MPTokensV1** + **NFTokenMintOffer** activation on the target network (else separate Mint + CreateOffer).
5. Auth scheme: admin token (simple) vs per-artist signed requests.

## Sequence to ship for Make Waves
P0 (security + honest model + messaging) → P1 (artist-issuer mint) → P2 (brokered primary) → P4 (holder-gated recruit) → P5 (transparency) → P3 treats / P6 vault as time allows.
