"""Ledgerlings — testnet scaffold: mint a MUTABLE pet dNFT + one NFTokenModify round-trip.

Proves the core on-ledger loop the whole game rests on:
  1. mint a Dynamic NFToken with tfMutable set, pet state encoded in its URI;
  2. apply an interaction (feed) -> new state -> NFTokenModify updates the URI on-ledger;
  3. read it back and confirm the state changed.

If this round-trips on testnet, the dNFT-native design is GO. Run:  python mint_pet.py
Requires: pip install "xrpl-py>=3.0"  (NFTokenModify + DynamicNFT support). Network: XRPL testnet.
"""
import json
import time

from xrpl.clients import JsonRpcClient
from xrpl.wallet import generate_faucet_wallet
from xrpl.models.transactions import NFTokenMint, NFTokenModify
from xrpl.models.requests import AccountNFTs
from xrpl.transaction import submit_and_wait
from xrpl.utils import str_to_hex, hex_to_str

TESTNET = "https://s.altnet.rippletest.net:51234"

# NFTokenMint flags (raw ints — robust across xrpl-py versions)
TF_TRANSFERABLE = 8      # pets can be gifted/traded
TF_MUTABLE = 16          # REQUIRED — lets the issuer NFTokenModify the URI (Dynamic NFT)


def pet_state(**overrides):
    """The pet record (scaffold = compact JSON in the URI; production = the 64-byte packed record
    from STATE_MACHINE.md). Fits well under the 256-byte URI cap."""
    s = {"v": 1, "stage": 0, "hunger": 80, "happiness": 80, "health": 100,
         "age": 0, "care": 0, "form": 0, "alive": 1}
    s.update(overrides)
    return s


def uri_hex(state):
    return str_to_hex(json.dumps(state, separators=(",", ":")))


def read_pet(client, addr, nid):
    nfts = client.request(AccountNFTs(account=addr)).result["account_nfts"]
    for n in nfts:
        if n["NFTokenID"] == nid:
            return json.loads(hex_to_str(n["URI"]))
    return None


def main():
    client = JsonRpcClient(TESTNET)
    print("1. funding issuer wallet from testnet faucet (a few seconds)…")
    issuer = None
    for attempt in range(6):
        try:
            issuer = generate_faucet_wallet(client, debug=False)
            break
        except Exception as e:
            wait = 8 * (attempt + 1)
            print(f"   faucet busy ({type(e).__name__}); retry in {wait}s… ({attempt+1}/6)")
            time.sleep(wait)
    if issuer is None:
        print("   ✗ faucet unavailable after retries — rerun later."); return 1
    print("   issuer:", issuer.classic_address)

    # ── MINT a mutable pet ──
    init = pet_state()
    mint = NFTokenMint(
        account=issuer.classic_address,
        nftoken_taxon=7777,                       # the Ledgerlings collection taxon
        flags=TF_TRANSFERABLE | TF_MUTABLE,
        uri=uri_hex(init),
    )
    r = submit_and_wait(mint, client, issuer)
    res = r.result["meta"]["TransactionResult"]
    print(f"2. mint pet dNFT: {res}")
    if res != "tesSUCCESS":
        print("   ✗ mint failed — abort."); return 1

    nfts = client.request(AccountNFTs(account=issuer.classic_address)).result["account_nfts"]
    nid = nfts[-1]["NFTokenID"]
    print("   pet NFTokenID:", nid)
    print("   initial state:", read_pet(client, issuer.classic_address, nid))

    # ── INTERACTION: feed -> NFTokenModify ──
    fed = pet_state(hunger=100, care=10, last="fed")
    mod = NFTokenModify(
        account=issuer.classic_address,
        nftoken_id=nid,
        uri=uri_hex(fed),
    )
    r2 = submit_and_wait(mod, client, issuer)
    res2 = r2.result["meta"]["TransactionResult"]
    print(f"3. feed -> NFTokenModify: {res2}")
    if res2 != "tesSUCCESS":
        print("   ✗ modify failed (is DynamicNFT enabled? was tfMutable set?) — abort."); return 1

    print("   new state:    ", read_pet(client, issuer.classic_address, nid))
    print("\n✅ LOOP PROVEN on testnet: mutable pet dNFT minted, NFTokenModify updated its state on-ledger.")
    print("   Next (queue): the deterministic rules engine drives state; Payment+memo triggers each modify.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
