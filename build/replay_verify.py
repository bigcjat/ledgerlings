"""Ledgerlings replay verifier — "Verify my pet". The differentiator, made real.

Fairness here is not a promise; it is re-derivable. Anyone re-executes the OPEN deterministic rules
(pet_rules.step) from genesis over the pet's on-ledger interaction history and asserts the result equals
the on-ledger dNFT state. If the operator ever deviated from the published rules — inflated care to mint a
rare form, skipped a death, edited a stat — the replay no longer reproduces the on-ledger state and it is
flagged, with the exact diverging fields. Players can't cheat (issuer-only modify); the operator can't
cheat undetectably.

Run it against a real pet, on any node you like:

    python3 replay_verify.py <nftoken_id>
    python3 replay_verify.py <nftoken_id> --node https://your-own-node:51234

With no arguments it runs the self-test below instead, which proves the checker accepts an honest
history and catches a cheating operator, using synthetic states and no network.

SOUNDNESS NOTE: the replay only reproduces if `now` is DETERMINISTIC from on-ledger data. Each
interaction MUST be applied with `now = the triggering Payment's ledger_index`, never the issuer's
processing time. Verified 2026-08-05: the live writer (server.js `/interact`) and the reconciling
poller both use `tx.ledger_index`, so the deployed path is sound, and so is the reader below. The
standalone `interaction.py` demo still uses the current validated ledger at processing time and is
NOT part of the live path; do not point it at a live issuer.
"""
import argparse
import json
import sys

import pet_rules as R

MAINNET_RPC = "https://s1.ripple.com:51234"
MAINNET_ISSUER = "rDe4tWiu8hVNQEySmfzms47M6qt4JSWf6L"


def replay(genesis_state, interactions):
    """interactions: list of (op_code, ledger_seq, sender) in ascending ledger order. Pure."""
    s = dict(genesis_state)
    for op, now, sender in interactions:
        s = R.step(s, op, now, sender)
    return s


def _diff(derived, claimed):
    keys = set(derived) | set(claimed)
    return {k: (derived.get(k), claimed.get(k)) for k in keys if derived.get(k) != claimed.get(k)}


def verify(genesis_state, interactions, claimed_final):
    """(ok, detail). Re-derive from the open rules; compare to the on-ledger state."""
    derived = replay(genesis_state, interactions)
    if derived == claimed_final:
        return True, ("VERIFIED — the on-ledger pet reproduces exactly from the open rules over its "
                      f"{len(interactions)} interactions. The game played fair.")
    d = _diff(derived, claimed_final)
    return False, ("DIVERGED — the on-ledger state does NOT match a faithful replay; the operator deviated "
                   f"from the published rules. Diverging fields (derived vs on-ledger): "
                   + ", ".join(f"{k}: {a}->{b}" for k, (a, b) in d.items()))


# ── on-ledger reader (used by the Xaman xApp's "Verify my pet" button) ──
def verify_pet(client, issuer_addr, nid):
    """Pull genesis (from the mint URI) + interaction Payments (owner->issuer, op memos) + current state;
    replay and compare. Requires xrpl-py; `now` per interaction = the Payment's ledger_index."""
    from xrpl.models.requests import AccountNFTs, AccountTx
    from xrpl.utils import hex_to_str
    MEMO_TYPE = "ledgerlings/op"
    OP = {"feed": R.FEED, "play": R.PLAY, "clean": R.CLEAN, "heal": R.HEAL}

    # compact on-ledger codec — MIRRORS server.js: short keys + loadout omitted. (Keep in sync.)
    _KINV = {"v": "v", "o": "owner", "b": "birth", "x": "last_ix", "h": "hunger", "j": "happiness",
             "l": "health", "s": "stage", "f": "form", "a": "alive", "g": "age", "c": "care",
             "m": "care_max", "d": "death_cause", "F": "last_feed", "P": "last_play"}
    def decode_uri(uri_hex):
        o = json.loads(hex_to_str(uri_hex))
        s = {"loadout": []}                       # loadout not stored on-ledger; restore default
        for sk, val in o.items():
            s[_KINV.get(sk, sk)] = val
        return s

    # current on-ledger state
    current = None
    for n in client.request(AccountNFTs(account=issuer_addr)).result["account_nfts"]:
        if n["NFTokenID"] == nid:
            current = decode_uri(n["URI"])
    if current is None:
        return False, "pet not found at issuer"

    # Walk issuer history (multi-pet sound): genesis = the mint whose meta.nftoken_id == nid;
    # interactions = Payments memo'd "<op>|<nid>" for THIS nid, so other pets are never mixed in.
    #
    # PAGINATION IS NOT OPTIONAL. account_tx returns one page and a marker. Reading only the first
    # page silently drops later interactions, the replay comes up short, and an HONEST pet is
    # reported as DIVERGED — the worst possible failure for a tool whose whole job is telling the
    # truth about honest pets. Follow the marker to exhaustion.
    #
    # Scanning from the pet's birth (rather than the issuer's whole history) is both cheaper and
    # sound: the genesis mint and every interaction for this pet are at or after its birth ledger.
    genesis_state, interactions = None, []
    marker, pages = None, 0
    while True:
        req = AccountTx(account=issuer_addr, limit=200, forward=True,
                        ledger_index_min=current.get("birth", -1))
        if marker:
            req.marker = marker
        res = client.request(req).result
        pages += 1
        for t in res.get("transactions", []):
            tx = t.get("tx") or t.get("tx_json") or {}
            meta = t.get("meta") or t.get("metaData") or {}
            lseq = tx.get("ledger_index") or t.get("ledger_index")
            if tx.get("TransactionType") == "NFTokenMint" and tx.get("URI") and meta.get("nftoken_id") == nid:
                try:
                    genesis_state = decode_uri(tx["URI"])
                except Exception:
                    pass
            elif tx.get("TransactionType") == "Payment" and tx.get("Destination") == issuer_addr:
                for m in tx.get("Memos", []):
                    md = m.get("Memo", {})
                    try:
                        if hex_to_str(md.get("MemoType", "")) == MEMO_TYPE:
                            parts = hex_to_str(md.get("MemoData", "")).split("|")
                            op_name = parts[0]
                            m_nid = parts[1] if len(parts) > 1 else None
                            if m_nid == nid:
                                interactions.append((OP.get(op_name, 0), lseq, tx.get("Account")))
                    except Exception:
                        pass
        marker = res.get("marker")
        if not marker:
            break

    if genesis_state is None:
        return False, "no genesis (mint URI) found"
    interactions.sort(key=lambda x: x[1])
    return verify(genesis_state, interactions, current)


def _cli(argv):
    """Verify one real pet against a public node. Nothing here talks to a Ledgerlings server."""
    ap = argparse.ArgumentParser(
        prog="replay_verify.py",
        description="Re-derive a Ledgerling from XRPL history and compare it to what the issuer stored. "
                    "Run with no arguments to self-test the checker instead.")
    ap.add_argument("nid", help="the pet's NFTokenID")
    ap.add_argument("--node", default=MAINNET_RPC, help=f"any XRPL JSON-RPC node (default {MAINNET_RPC})")
    ap.add_argument("--issuer", default=MAINNET_ISSUER, help="issuer account (default: Ledgerlings mainnet)")
    a = ap.parse_args(argv)

    try:
        from xrpl.clients import JsonRpcClient
    except ImportError:
        print("this needs xrpl-py:  pip install xrpl-py", file=sys.stderr)
        return 2

    # Echo what was actually used, so the output is self-describing evidence rather than a bare verdict.
    print(f"node   : {a.node}")
    print(f"issuer : {a.issuer}")
    print(f"pet    : {a.nid}\n")

    ok, detail = verify_pet(JsonRpcClient(a.node), a.issuer, a.nid)
    print(("✅ " if ok else "🚨 ") + detail)
    return 0 if ok else 1


if __name__ == "__main__":
    # With an nftoken_id, verify that real pet against a node. This is the mode the README points at.
    if len(sys.argv) > 1:
        sys.exit(_cli(sys.argv[1:]))

    # With no arguments: self-test. Proves the CHECKER accepts an honest history and catches a
    # cheating operator, using synthetic states and no network. It deliberately says nothing about
    # any real pet, which is exactly why the README used to be wrong to offer it as a way to verify one.
    g = R.genesis(1000, "rOwner")
    ix, t = [], 1000
    for op in (R.FEED, R.PLAY, R.FEED, R.PLAY, R.FEED, R.PLAY):
        t += R.DAY // 2
        ix.append((op, t, "rOwner"))
    honest = replay(g, ix)

    ok, msg = verify(g, ix, honest)
    print("HONEST history :", "✅" if ok else "🚨", msg)

    # operator cheats: inflates care + mints a legendary the history didn't earn
    cheat = dict(honest); cheat["care"] = 99999; cheat["form"] = R.LEGENDARY
    ok2, msg2 = verify(g, ix, cheat)
    print("CHEATING op    :", "✅" if ok2 else "🚨", msg2)

    # operator hides a death (claims alive when neglect should have killed it)
    g2 = R.genesis(1000, "rOwner")
    neglected = replay(g2, [(R.HEAL, 1000 + 3 * R.DAY, "rOwner")])     # one late visit -> should be dead
    revived = dict(neglected); revived["alive"] = 1; revived["health"] = 100
    ok3, msg3 = verify(g2, [(R.HEAL, 1000 + 3 * R.DAY, "rOwner")], revived)
    print("HIDDEN death   :", "✅" if ok3 else "🚨", msg3)
