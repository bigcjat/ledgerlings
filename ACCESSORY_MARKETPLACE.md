# Ledgerlings — Accessory Marketplace Architecture

**Status:** draft for Dane + Chris · 2026-06-27 · **Design credit:** a collaborator
**Chain assumption:** XRPL XLS-20 NFTs (same NFToken model Ledgerlings already uses for the pet dNFT).
*If accessories ever mint on Xahau (URITokens), the royalty + taxon mechanics differ — revisit.*

Accessories (backgrounds, clothes, items) for Ledgerlings, created by artists, sold to owners. The model is
**issuer-mint + native royalty**, NOT a per-trade brokerage — less ops, passive perpetual revenue, and provenance
falls out for free.

## 1. The core decision — mint from OUR issuer, not broker each trade
- Ledgerlings (one **issuer account**) mints every accessory via `NFTokenMint`. The **artist receives the minted
  NFT to sell** and keeps the **primary sale**. The artist gets **no resale royalty**.
- Because we are the issuer, we set **`TransferFee`** (0–50%, paid to the issuer on every on-ledger secondary
  sale, **protocol-enforced** — no marketplace can strip it, unlike Ethereum). → we earn a **perpetual cut on all
  resales, any marketplace**, automatically.
- Why this beats brokering: a broker only earns on trades it matches; the issuer earns on *every* secondary,
  passively, with no presence in the transaction.

**Royalty split:** artist = primary sale; issuer (us) = secondary `TransferFee`. (On-ledger you *can't* split
TransferFee to a third party anyway — it only pays the issuer — so this is the native-shaped deal.)

## 2. The unifying primitive — `artist_id` is ONE uint32 doing four jobs
Assign each artist a single `uint32` id. The same integer is:

| Role | XRPL field | Use |
|------|-----------|-----|
| Artist identity | (off-ledger) | the artist profile key |
| Collection | `NFTokenTaxon` | groups all of that artist's accessories (issuer + taxon = "collection") |
| Catalog filter | encoded in `NFTokenID` | recoverable from the token id itself (see §4) |
| Payment routing | Destination Tag | artist pays the issuer to "boost" → destTag = artist_id identifies them |

All four are the same `uint32`, so there's no mapping table — the number *is* the join key across identity,
collection, catalog, and payments. **Reserve `0`** (taxon 0 = uncategorized, destTag 0 = none); start artist_ids at **1**.

## 3. Mint flow
1. **Canvas tool** — artist designs a background/accessory in our web tool.
2. **Mint-time gate** — we review/approve before minting (content policy + IP check). This is *pre-publication*
   control — better than post-hoc takedowns, and necessary because **our issuer account is the on-chain issuer of
   record** for everything it mints.
3. **`NFTokenMint`** from the issuer: `NFTokenTaxon = artist_id`, `TransferFee = <royalty bps>`,
   flags include `tfTransferable`, `URI` → the asset metadata (image + creator attribution + edition).
4. **Deliver to artist** — the minted NFT goes to the artist to list/sell (they keep the primary sale).
5. **Resale** — any on-ledger secondary sale pays our `TransferFee` to the issuer. Forever.

## 4. Querying / catalog — no native by-taxon RPC; use the indexers
- The **`NFTokenID`** (256 bits) is deterministic: `Flags(16) | TransferFee(16) | Issuer(160) | Taxon(32) |
  TokenSeq(32)`. The taxon (= artist_id) is recoverable from the id itself — **but it's scrambled** (XOR'd with a
  value derived from the token sequence). Unscramble with `xrpl.js parseNFTokenID()` (or replicate
  `(384160001 * seq + 2459) mod 2^32` XOR). **Do not read the raw bits — you'll get garbage.**
- Base `rippled` only offers `account_nfts` (per-owner). To list a collection by taxon, use an indexer — **all of
  these support an issuer+taxon query, so no custom indexing is needed to ship**:
  - **Clio** — `nfts_by_issuer(issuer = <us>, nft_taxon = artist_id)` → that artist's whole collection.
  - **Bithomp API** and **XRPL Data API (xrpldata)** — same issuer+taxon query.
- A local cache (artist_id → minted NFTs) is a **later optimization** for app speed + to avoid third-party rate
  limits — not a dependency.

## 5. Provenance — the "is this a real app accessory?" problem, solved
Every legit accessory has `Issuer = our account`. The app filters NFTs by **our issuer + the artist's taxon**;
anything not from our issuer is not an app accessory and isn't shown. Random NFTs can't impersonate the catalog.
No heuristics, no guessing — the issuer is the authority.

## 6. Boost payments (optional, later)
Artists can pay the issuer to promote/feature their collection. The payment carries **Destination Tag =
artist_id**, so we attribute it with zero lookup. **Set `asfRequireDest` on the receiving wallet** so a payment
*without* a tag is rejected (no stranded, unattributable funds). Validate the tag maps to a real artist.

## 7. Verification tie-in (Kairo Vault edge)
`artist_id` is also the join key into the verification layer. A **verification record** can attest: "minted by
the Ledgerlings issuer, taxon = artist_id = N, creator = <artist>, edition X of Y" — provenance + authenticity +
scarcity, keyed on the same integer. A *verified* accessory marketplace (genuine artist, genuine edition) is a
differentiator a generic NFT marketplace can't match. Artist authenticity can be strengthened with an artist
signature in the metadata.

## 8. Security & ops
- **Issuer key = crown jewels.** One account mints the entire catalog *and* receives boost payments. Put it in
  **cold storage / multisig / behind a RegularKey** (rotate-able). A leak = fake-authentic accessories + the
  royalty stream at risk.
- **Mint cost** — the issuer fronts the per-NFT reserve/fee. Recoup via a small mint fee or a primary-sale cut.
- **Moderation** lives at the mint gate (§3.2) + a content/IP policy. We are the issuer of record — we just lived
  the trademark lesson (Tamagotchi → Ledgerlings); the same rights risk applies to artist-uploaded content.

## 9. Open questions / pressure-test
1. **Artist incentive (the real one).** Artists get primary-sale only, no resale royalty (we keep it). On most
   NFT platforms creators expect resale royalties — this is a draw we're *not* offering. For volume cosmetics it's
   usually fine, and "boost" is artists paying *us* for reach — but confirm the primary economics + audience are
   attractive enough that artists actually show up. **This is the make-or-break, and it's not technical.**
2. **Royalty enforcement edge.** `TransferFee` is enforced on native on-ledger sales (strong on XRPL); an exotic
   off-ledger transfer path can sidestep it. Acceptable, far better than ETH — note it.
3. **Sequencing (distribution before build).** A marketplace needs Ledgerlings players who want cosmetics. Ship
   the pet + get adoption (Make Waves) FIRST. Upside: the canvas tool can **seed artist supply pre-launch**, so
   content + an artist community are ready at launch — partly defusing the chicken-and-egg.

## 10. Build order (when Ledgerlings has users)
1. issuer account + key security + `asfRequireDest` + artist_id registry (start at 1).
2. canvas tool + mint-time gate → `NFTokenMint(taxon=artist_id, TransferFee, URI)`.
3. catalog read path (Clio/Bithomp/XRPLData by issuer+taxon; parseNFTokenID) + app filter-by-issuer.
4. artist profiles (artist_id → name/links) + verification records (creator/edition).
5. boost payments (destTag = artist_id) — last, optional.
6. **trait-derived pixel pets (§11)** — phase 2, after the core marketplace + the partner/CC0 pipeline exists.

## 11. Trait-derived pixel pets (cross-collection growth hook, phase 2)
**Idea:** read a collection's **traits** and generate a **pixel-pet rendition** of a user's NFT — not a wearable,
the *whole pet skin* reflects their NFT (their "robot + crown + laser eyes" Ape → a pixel Ledgerling with those
features). Stronger hook than a stamped accessory: the entire pet *is* their NFT. Every collection's holders want a
pixel Ledgerling of theirs → real cross-community acquisition. Ownership check is trivial (`account_nfts`).

**⚠️ The landmine — IP rights (same as the accessory lesson, with one nuance).** Minting + selling a "pixel pet
version" of someone's NFT is a **derivative work** → if **we** mint it, **we** are the on-chain issuer of a
commercial derivative of third-party IP, and our derivative carries *our* `TransferFee`, not the creator's. The
nuance in our favor: generating **new pixel art from trait *data*** ("laser eyes", "gold chain") is more
**transformative** than copying the actual artwork, and trait *attributes* aren't protected like the image is — so
this sits on somewhat safer ground than image-copying. **But do NOT lean on "transformative"** (it's murky), and a
"pixel BAYC pet" still carries **brand/trademark** association risk for famous collections. Net: the nuance reduces
exposure, it does not remove the gate.

**The safe design — split the action, gate the risky half:**
1. **Equip / display (open-ish).** Render the pixel skin on *your own* pet, in-app, **no new mint**. Personal
   display of a thing you own — much lower risk. The broad, fun, low-friction version.
2. **Mint a sellable pixel-pet skin (gated).** Only from:
   - **CC0 / open-license collections** (no rights issue — CC0 **pixel-art** collections are the ideal first
     targets: pixel→pixel maps cleanly, zero rights issue), and
   - **Partner projects that opt in** — they grant "your holders may mint a pixel Ledgerling of our NFTs." That
     permission **is** the deal: cross-promo for them, acquisition for us → the IP gate is a **BD pipeline**.
3. **The per-collection trait mapping is the real new cost — and it enforces the gate for free.** Each supported
   collection needs a curated **trait → pixel-feature mapping** (their attribute set → our pet's parts). That's
   deliberate art/config work per collection, so we *only* support collections we've cleared + partnered with —
   the build cost and the IP gate naturally align (you can't accidentally support a collection you shouldn't).
   Traits live in NFT metadata (URI → JSON `attributes`); for cross-chain NFTs, read that chain's metadata.
4. **Architecture fit — it's a generative SKIN, the core pet stays.** The provably-fair Ledgerling is unchanged;
   the NFT-derived look is a skin/variant NFT. Same issuer-royalty model (we mint, `TransferFee`, user keeps
   primary; dedicated "pixel-pets" taxon range or per-partner id).
5. **Provenance + verification** — the skin's metadata references the **source NFT** + the mapping version; a
   verification record attests "pixel pet derived from NFT X (collection C, traits T), generated by Ledgerlings,
   mapping vM, edition N" → a provable derivation chain + the audit trail if a derivation is ever challenged.

**Net:** keep the cross-community magic via *equip/display for anything you own*; restrict *mint-to-sell* to
CC0 + opt-in partner collections. The per-collection trait-mapping cost enforces that gate automatically, and
trait-generation gives a bit more legal breathing room than image-copying. Core pet + royalty/provenance model
unchanged. (Design credit: Chris.)
