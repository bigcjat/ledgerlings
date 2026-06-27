# Ledgerlings — Breeding (roadmap, v2/v3)

*Breeding is the deepest engagement + economy mechanic in collectible pets (it built CryptoKitties). For
Ledgerlings it's also the single best showcase of the provably-fair thesis — because every other breeding
NFT game is a BLACK BOX (the dev can secretly mint rares), and ours is **verifiable genetics.***

## The differentiator: provably-fair breeding
Every breeding game asks you to trust that the rare offspring wasn't rigged. Ledgerlings proves it:
- The offspring's genome is a **deterministic function of the two parents' genomes** + a **commit-reveal
  mutation seed** (seeded by a future ledger hash neither party can grind), all open-source.
- The seed commit + the genome-derivation rules are **anchored on XRPL** (the proof-transparency log).
- Anyone runs the breeding verifier: re-derive the child's genome from the parents + the revealed seed,
  assert it matches the on-ledger offspring. A rigged "legendary baby" no longer reproduces → caught.
- **"The only breedable pet where you can prove the rare baby wasn't minted by the dev."** Nobody else has this.

## Genetics model (deterministic + deep)
- Each pet has a **genome** in its dNFT: visible traits (body palette, core type, pattern, form-affinity,
  size) + **recessive** hidden genes (Mendelian-style — a rare trait can skip generations, then surface).
- Offspring genome = `breed(parentA.genome, parentB.genome, seed)`: per gene, dominant/recessive resolution
  + a small, bounded **mutation chance** off the commit-reveal seed (the only randomness, and it's proven).
- Depth without rigging: recessives + mutation make outcomes exciting yet fully re-derivable. Rarity is
  *earned by genetics + luck you can audit*, never granted by an operator.

## Lineage (a provable pedigree — collectors love this)
- The offspring dNFT records both parent NFTokenIDs → an **on-chain family tree**. Anyone can trace
  ancestry and verify it. "Gen-0 / founder lineage" becomes a real, provable collectible property.

## Economy (revenue + bounded supply — the CryptoKitties lesson)
- **Breeding fee** → a cut to the issuer (Dane's revenue) + optionally a split to a "sire" owner if you
  breed with someone else's pet (rent-your-stud market — organic social + revenue).
- **Bounded supply** so value doesn't crash: per-pet **breeding cooldown** (grows with each breed),
  a **lifetime breed cap**, and elders can't breed. Scarcity by construction.
- Ties to the marketplace: rare genomes/lineages = collectible value → secondary sales → transfer-fee
  royalties (MARKETPLACE_ROADMAP.md).

## Brand guard (non-negotiable)
- Breeding affects **cosmetics + collectibility only** — never the care-game's fair state. A bred pet still
  lives/ages/dies by the same open rules; genetics decide how it LOOKS and its rarity, not pay-to-win stats.
- The mutation randomness is **commit-reveal + anchored** — provable, shown off, never hidden.

## Scoping
- **v3 (after the marketplace).** Big feature: genome schema, breed() + verifier, lineage, the breeding
  economy. Not the hackathon MVP.
- **Reserve now (cheap, like loadout):** add a `genome` + `parents` field to the pet dNFT schema so v3 needs
  no migration. The MVP pets become Gen-0 founders (scarcity + story for early adopters).

## First steps (when v3 starts)
1. Define the genome schema (visible + recessive genes) + add `genome`/`parents` to the dNFT state.
2. Implement `breed(genomeA, genomeB, seed)` (deterministic) + the commit-reveal seed flow.
3. Extend the replay verifier: re-derive an offspring's genome → prove the breeding was fair.
4. Breeding economy: fee/cooldown/cap + the sire-rental split. Mint the offspring as an egg dNFT.
