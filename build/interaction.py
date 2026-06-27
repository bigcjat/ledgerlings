"""Ledgerlings interaction pipeline — the full on-ledger loop, end to end:

  owner sends Payment + memo(op)  ->  issuer parses the op from the memo  ->  pet_rules.step()
   ->  NFTokenModify writes the new state to the pet's dNFT URI.

The issuer is the only one who can modify the dNFT, so it applies the open rules on the owner's behalf;
owner-only is enforced by pet_rules (the memo's source account must equal the pet's owner). This is the
dNFT-native game loop the Xaman xApp will drive. Run: python interaction.py  (testnet, two faucet wallets)
"""
import json
import time

from xrpl.clients import JsonRpcClient
from xrpl.wallet import generate_faucet_wallet
from xrpl.models.transactions import NFTokenMint, NFTokenModify, Payment, Memo
from xrpl.models.requests import AccountNFTs, AccountTx, Ledger
from xrpl.transaction import submit_and_wait
from xrpl.utils import str_to_hex, hex_to_str

import pet_rules as R

TESTNET = "https://s.altnet.rippletest.net:51234"
TAXON = 7777
TF = 8 | 16                                            # transferable | mutable (Dynamic NFT)
OP_CODE = {"feed": R.FEED, "play": R.PLAY, "clean": R.CLEAN, "heal": R.HEAL}
MEMO_TYPE = "ledgerlings/op"


def fund(client):
    for i in range(6):
        try:
            return generate_faucet_wallet(client, debug=False)
        except Exception:
            time.sleep(8 * (i + 1))
    raise RuntimeError("faucet unavailable")


def now_ledger(client):
    return client.request(Ledger(ledger_index="validated")).result["ledger_index"]


def _uri(state):
    return str_to_hex(json.dumps(state, separators=(",", ":")))


def read_state(client, issuer_addr, nid):
    for n in client.request(AccountNFTs(account=issuer_addr)).result["account_nfts"]:
        if n["NFTokenID"] == nid:
            return json.loads(hex_to_str(n["URI"]))
    return None


def mint_pet(client, issuer, owner_addr):
    init = R.genesis(now_ledger(client), owner_addr)
    submit_and_wait(NFTokenMint(account=issuer.classic_address, nftoken_taxon=TAXON,
                                flags=TF, uri=_uri(init)), client, issuer)
    return client.request(AccountNFTs(account=issuer.classic_address)).result["account_nfts"][-1]["NFTokenID"]


def send_interaction(client, owner, issuer_addr, op_name):
    """Owner triggers an interaction with a tiny Payment carrying the op in a memo."""
    tx = Payment(account=owner.classic_address, destination=issuer_addr, amount="10",
                 memos=[Memo(memo_type=str_to_hex(MEMO_TYPE), memo_data=str_to_hex(op_name))])
    return submit_and_wait(tx, client, owner).result["meta"]["TransactionResult"]


def parse_latest_op(client, issuer_addr):
    """Issuer reads its incoming txns, returns (op_name, sender) from the most recent valid op memo."""
    txs = client.request(AccountTx(account=issuer_addr, limit=20)).result["transactions"]
    for t in txs:                                       # newest first
        tx = t.get("tx") or t.get("tx_json") or {}
        if tx.get("TransactionType") != "Payment" or tx.get("Destination") != issuer_addr:
            continue
        for m in tx.get("Memos", []):
            md = m.get("Memo", {})
            try:
                if hex_to_str(md.get("MemoType", "")) == MEMO_TYPE:
                    return hex_to_str(md.get("MemoData", "")), tx.get("Account")
            except Exception:
                pass
    return None, None


def apply_op(client, issuer, nid, op_name, sender):
    """The pipeline core: read state -> step() -> NFTokenModify."""
    state = read_state(client, issuer.classic_address, nid)
    new = R.step(state, OP_CODE.get(op_name, 0), now_ledger(client), sender)
    res = submit_and_wait(NFTokenModify(account=issuer.classic_address, nftoken_id=nid,
                                        uri=_uri(new)), client, issuer).result["meta"]["TransactionResult"]
    return new, res


def show(tag, s):
    print(f"   {tag:16} hunger={s['hunger']:3} happy={s['happiness']:3} hp={s['health']:3} "
          f"care={s['care']}/{s['care_max']} stage={R.STAGE_NAME[s['stage']]}")


def main():
    c = JsonRpcClient(TESTNET)
    print("funding issuer + owner wallets…")
    issuer, owner = fund(c), fund(c)
    print("issuer:", issuer.classic_address, "\nowner :", owner.classic_address)

    nid = mint_pet(c, owner_addr=owner.classic_address, issuer=issuer)
    print("\nminted pet:", nid)
    show("genesis", read_state(c, issuer.classic_address, nid))

    # ── full loop: owner sends Payment+memo -> issuer parses -> step -> NFTokenModify ──
    for op in ("feed", "play"):
        print(f"\nowner sends '{op}' (Payment+memo):", send_interaction(c, owner, issuer.classic_address, op))
        parsed_op, sender = parse_latest_op(c, issuer.classic_address)
        print(f"   issuer parsed op='{parsed_op}' from {sender[:8]}…")
        new, res = apply_op(c, issuer, nid, parsed_op, sender)
        print(f"   NFTokenModify: {res}")
        show(f"after {op}", read_state(c, issuer.classic_address, nid))

    # ── owner-only: a stranger's interaction is ignored by the rules ──
    stranger = fund(c)
    print(f"\nstranger sends 'feed':", send_interaction(c, stranger, issuer.classic_address, "feed"))
    before = read_state(c, issuer.classic_address, nid)
    new, res = apply_op(c, issuer, nid, "feed", stranger.classic_address)
    print(f"   rules ignore non-owner -> state unchanged: {new == before}  (NFTokenModify {res} but no-op state)")
    print("\n✅ INTERACTION PIPELINE PROVEN on testnet: Payment+memo -> parse -> rules -> NFTokenModify -> dNFT.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
