# Ledgerlings

**A provably fair on-chain pet, live on XRPL mainnet.**

You adopt one, you raise it, and it can die if you neglect it. What makes it different from every
other pet game is that you do not have to take the operator's word for any of it. Every trait, every
hunger tick, every evolution and every battle re-derives from public ledger history under open rules,
so you can catch the operator cheating instead of trusting it not to.

**Play on mainnet:** https://hugegreencandle.github.io/ledgerlings/
**Free testnet sandbox:** https://hugegreencandle.github.io/ledgerlings/testnet.html

---

## Live on mainnet

Since 2026-07-30. First mainnet mint:

```
1616A61F1B3DBE39EE45E38C207F6EB0D12023F5D91FD4FAF3149F5444ED11AF
```
https://livenet.xrpl.org/transactions/1616A61F1B3DBE39EE45E38C207F6EB0D12023F5D91FD4FAF3149F5444ED11AF

| | |
|---|---|
| Issuer | `rDe4tWiu8hVNQEySmfzms47M6qt4JSWf6L` |
| SourceTag on every app transaction | `2606250001` |
| Pet NFT taxon | `7777` |

Adopting is free and needs no wallet connection: paste an XRPL address and the issuer mints the pet
to you. Care actions and ladder fights are real transactions you approve in Xaman.

## The point: you can catch it cheating

Every pet page has a **Verify** button. It walks the pet from its mint transaction through every
interaction, re-runs the open rules, and compares the result field by field against what is actually
on the ledger.

- Honest history returns **PASS**.
- A single tampered field returns **DIVERGED**.

There is a **"simulate a cheating operator"** button next to it that flips one field of the record so
you can watch the verifier catch the lie, without touching the ledger.

Two independent implementations of the check exist, deliberately, and both verify a real pet:

```bash
curl https://ledgerlings-backend-production.up.railway.app/verify/<nftoken_id>   # Node
python3 build/replay_verify.py <nftoken_id>                                      # Python
```

The Python one talks to a public XRPL node and never to a Ledgerlings server, so it is the one that
does not require trusting the operator. Point it wherever you like:

```bash
python3 build/replay_verify.py <nftoken_id> --node https://your-own-node:51234
```

It exits non-zero on DIVERGED, and with no arguments it self-tests the checker against synthetic
histories instead of hitting the network. It needs `pip install xrpl-py`.

## The rules bite

This is not decorative. Pets age over ledger time and starve if nobody feeds them. The first mainnet
pet died exactly that way, on-ledger, and its death re-derives from the same rules as everything
else — nobody decided it, and nobody can undo it.

Feeding and playing are cooldown-gated so care cannot be farmed. Cleaning and healing are not.

## How it works

```
docs/  (GitHub Pages frontend)              build/server.js  (issuer backend, the ONLY NFTokenModifier)
  ├─ pet_rules.js   the ONE rules engine      ├─ /adopt        mint a mutable pet NFT
  ├─ xaman_bridge.js                          ├─ /pet/:nid     read state from the NFT URI
  └─ tap → sign a Payment carrying            ├─ /interact     verify signed Payment → step() → NFTokenModify
     "<op>|<nftoken_id>" as a memo            └─ /verify/:nid  replay from genesis → PASS or DIVERGED
```

**One rules engine.** `pet_rules.js` is the single source of truth for every state transition.
`pet_rules.py` is a byte-identical Python twin, and a parity harness gates any change to either:

```bash
npm test           # JS step ≡ Python step, 123k states. Run before any rules edit.
npm run test:rules # heavy parity gate, 610k states
```

**State lives on the ledger, not in a database.** Each pet is a mutable XRPL NFT whose URI holds the
full state as roughly 160 bytes of short-key JSON. The issuer service is the only party that can
modify it.

**Interactions are ordinary Payments.** A player action is a Payment from owner to issuer carrying an
`op|nftoken_id` memo, source-tagged. The backend verifies the signed payload, takes that Payment's
`ledger_index` as `now` so decay and aging are deterministic, applies the rules, and writes the new
state back with `NFTokenModify`.

**Provably fair battles.** The NPC ladder seeds its dice from the hash of a ledger that has not
closed when the challenge is made, so neither the player nor the operator can know the roll in
advance.

**Royalties are native, not a marketplace promise.** Pets carry a 5% XRPL `TransferFee`, which the
ledger pays to the issuer on every secondary sale. For collaborator artwork the backend supports
authorized minting, where the creator authorises this issuer as their `NFTokenMinter` and the mint
names them as `Issuer`, so their royalty flows to them rather than to the platform.

## Running it yourself

```bash
cd build
npm install
npm test                 # rules parity gate
npm run smoke            # live on testnet: adopt → read → interact → re-read
npm run smoke:verify     # verify on testnet: PASS on honest history, DIVERGED on tampered
python3 replay_verify.py # independent Python verifier self-test
```

Configuration lives in `build/.env` (copy `build/.env.example`). The issuer seed is the crown jewel
and never belongs in this repository.

## Built for Make Waves

XRPL-native throughout: XLS-20 NFTs, mutable NFTs via `NFTokenModify`, `TransferFee` royalties
through authorized minting, brokered sales, and memo-carried interactions reconciled from ledger
history. No token, no unaudited dependencies.

Built by [Dane Brown](https://github.com/Hugegreencandle), Kairo Vault Technologies G.K.
