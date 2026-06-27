"""Differential-harness Python side. Reads scenarios JSON from stdin, replays each through
pet_rules.step, emits the per-step state list as JSON. Pairs with diff_rules.js (the JS side)."""
import sys, json
import pet_rules as R

def run(scn):
    owner = scn["owner"]
    s = R.genesis(scn["birth"], owner)
    out = [dict(s)]
    for it in scn["steps"]:
        s = R.step(s, it["op"], it["now"], it["sender"])
        out.append(dict(s))
    return out

def main():
    scenarios = json.load(sys.stdin)
    json.dump([run(scn) for scn in scenarios], sys.stdout)

if __name__ == "__main__":
    main()
