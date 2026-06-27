"""Ledgerlings replay verifier — "Verify my pet". The differentiator, made real.

Fairness here is not a promise; it is re-derivable. Anyone re-executes the OPEN deterministic rules
(pet_rules.step) from genesis over the pet's on-ledger interaction history and asserts the result equals
the on-ledger dNFT state. If the operator ever deviated from the published rules — inflated care to mint a
rare form, skipped a death, edited a stat — the replay no longer reproduces the on-ledger state and it is
flagged, with the exact diverging fields. Players can't cheat (issuer-only modify); the operator can't
cheat undetectably.

SOUNDNESS NOTE: the replay only reproduces if `now` is DETERMINISTIC from on-ledger data. The issuer MUST
apply each interaction with `now = the triggering Payment's ledger_index` (not its own processing time).
The on-ledger reader below uses the Payment ledger_index; interaction.py must match (queued fix).
"""
import json

import pet_rules as R


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

    # walk issuer history (multi-pet sound): genesis = the mint whose meta.nftoken_id == nid;
    # interactions = Payments memo'd "<op>|<nid>" for THIS nid (so other pets are not mixed in).
    genesis_state, interactions = None, []
    txs = client.request(AccountTx(account=issuer_addr, limit=200, forward=True)).result["transactions"]
    for t in txs:
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
    if genesis_state is None:
        return False, "no genesis (mint URI) found"
    interactions.sort(key=lambda x: x[1])
    return verify(genesis_state, interactions, current)


if __name__ == "__main__":
    # self-test: prove the verifier ACCEPTS an honest history and CATCHES operator cheating.
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
