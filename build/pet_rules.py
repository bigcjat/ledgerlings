"""Ledgerlings deterministic rules engine — the single source of truth for pet state transitions.

Pure + deterministic (integer-only): the SAME function the dNFT issuer applies on each interaction, the
replay verifier re-runs to prove fairness, and the Xahau Hook enforces in the stronger variant. No RNG,
no clock — time comes from the ledger sequence. Faithful to STATE_MACHINE.md.

step(state, op, now, sender) -> new state. genesis() -> a fresh egg. evolve()/stage_for_age() are public
so the verifier checks the exact same functions.
"""

# ── constants (STATE_MACHINE.md; tune DAY down for a fast testnet demo) ──
DAY = 21600                       # ledgers/day at ~4s
DECAY_NUM, DECAY_DEN = 60, DAY    # ~60 stat points lost per day of neglect (12h ≈ 30)
RESTORE = 50                      # feed/play top-up; must exceed inter-visit decay or a pet can't be saved
FEED_COOLDOWN = DAY // 6          # ~4h
PLAY_COOLDOWN = DAY // 6
STAGE_AGE = [0, 1 * DAY, 3 * DAY, 7 * DAY, 21 * DAY]   # EGG/BABY/TEEN/ADULT/ELDER thresholds
LIFESPAN = 40 * DAY
CARE_GOOD, CARE_CEIL = 10, 10

EGG, BABY, TEEN, ADULT, ELDER, PASSED = range(6)
RUNT, STANDARD, RARE, LEGENDARY = 1, 2, 3, 4
FEED, PLAY, CLEAN, HEAL = 1, 2, 3, 4
STAGE_NAME = {EGG: "egg", BABY: "baby", TEEN: "teen", ADULT: "adult", ELDER: "elder", PASSED: "passed"}
FORM_NAME = {0: "-", RUNT: "runt", STANDARD: "standard", RARE: "rare", LEGENDARY: "legendary"}


def _clamp(v, lo=0, hi=100):
    return lo if v < lo else hi if v > hi else v


def stage_for_age(age):
    """Monotone step function — age only grows, so stage never reverts (the no-revert invariant)."""
    if age < STAGE_AGE[1]: return EGG
    if age < STAGE_AGE[2]: return BABY
    if age < STAGE_AGE[3]: return TEEN
    if age < STAGE_AGE[4]: return ADULT
    if age < LIFESPAN: return ELDER
    return PASSED


def evolve(care_score, care_max):
    """Deterministic care->form (no hidden RNG). care_score<=care_max always, and care_max only climbs
    once per cooldown window, so a rare/legendary form can't be spam-farmed — it reflects sustained care."""
    if care_max <= 0:
        return RUNT
    ratio = care_score * 100 // care_max          # 0..100
    if ratio < 40: return RUNT
    if ratio < 75: return STANDARD
    if ratio < 92: return RARE
    return LEGENDARY


def genesis(birth_ledger, owner):
    return {"v": 1, "owner": owner, "birth": birth_ledger, "last_ix": birth_ledger,
            "hunger": 80, "happiness": 80, "health": 100, "stage": EGG, "form": 0, "alive": 1,
            "age": 0, "care": 0, "care_max": 0, "death_cause": 0, "last_feed": 0, "last_play": 0,
            # RESERVED (v2 marketplace): cosmetic-only list of equipped accessory/background NFTokenIDs.
            # MUST stay COSMETIC — step() never reads it, so wearables can never affect stats/evolution
            # (pay-to-win would break the provably-fair brand). A separate v2 `equip` op manages it.
            "loadout": []}


def _award_care(s, was_low):
    s["care_max"] += CARE_CEIL                     # the cooldown-bounded ceiling
    s["care"] += CARE_GOOD if was_low else CARE_GOOD // 2   # full credit only when the pet actually needed it


def step(state, op, now, sender):
    """Apply one interaction. Pure: returns a NEW state, never mutates the input."""
    s = dict(state)
    if sender != s["owner"]:                        # OWNER-ONLY (the Hook/issuer rejects others)
        return s
    if s["alive"] == 0:                             # dead is FINAL + frozen (no-resurrection)
        return s
    age = now - s["birth"]
    new_stage = stage_for_age(age)

    # decay since last interaction (deterministic, only lowers)
    elapsed = max(0, now - s["last_ix"])
    drop = min(100, elapsed * DECAY_NUM // DECAY_DEN)
    s["hunger"] = _clamp(s["hunger"] - drop)
    s["happiness"] = _clamp(s["happiness"] - drop)
    # health drains ONLY from neglect — a stat left low/empty hurts; a tended pet keeps its health.
    drain = 0
    for stat in (s["hunger"], s["happiness"]):
        if stat == 0:   drain += drop
        elif stat < 20: drain += drop // 2
    s["health"] = _clamp(s["health"] - drain)

    if age >= LIFESPAN:                             # death is one-way + final
        s["alive"], s["death_cause"], s["stage"] = 0, 2, PASSED        # old age
        s["age"], s["last_ix"] = age, now
        return s
    if s["health"] == 0:
        s["alive"], s["death_cause"] = 0, 1                            # neglect; stage frozen where it died
        s["age"], s["last_ix"] = age, now
        return s

    # action (cooldown-gated; no infinite farming)
    if op == FEED and (s["last_feed"] == 0 or now - s["last_feed"] >= FEED_COOLDOWN):
        _award_care(s, s["hunger"] < 50); s["hunger"] = _clamp(s["hunger"] + RESTORE); s["last_feed"] = now
    elif op == PLAY and (s["last_play"] == 0 or now - s["last_play"] >= PLAY_COOLDOWN):
        _award_care(s, s["happiness"] < 50); s["happiness"] = _clamp(s["happiness"] + RESTORE); s["last_play"] = now
    elif op == CLEAN:
        s["health"] = _clamp(s["health"] + 20)
    elif op == HEAL:
        s["health"] = _clamp(s["health"] + 30)

    s["stage"] = new_stage
    if new_stage >= ADULT and s["form"] == 0:       # evolution: once, frozen (set-once)
        s["form"] = evolve(s["care"], s["care_max"])
    s["age"], s["last_ix"] = age, now
    return s


if __name__ == "__main__":
    OWNER = "rPetOwner"
    # 1) LOVED pet — fed/played whenever a stat is low, across 22 days -> reaches adult, evolves
    s = genesis(0, OWNER)
    t = 0
    for day in range(22):
        for slot in range(2):                       # 2 care visits/day, each tends BOTH stats
            t += DAY // 2
            s = step(s, FEED, t, OWNER)
            s = step(s, PLAY, t, OWNER)
    print(f"LOVED     -> stage={STAGE_NAME[s['stage']]:6} form={FORM_NAME[s['form']]:9} "
          f"care={s['care']}/{s['care_max']} alive={s['alive']} hp={s['health']}")

    # 2) NEGLECTED pet — adopted, then ignored; one check-in after 3 days
    n = genesis(0, OWNER)
    n = step(n, HEAL, 3 * DAY, OWNER)               # owner returns to a starving pet
    print(f"NEGLECTED -> stage={STAGE_NAME[n['stage']]:6} alive={n['alive']} "
          f"death_cause={n['death_cause']} (1=neglect 2=old-age) hp={n['health']} hunger={n['hunger']}")

    # 3) OWNER-ONLY — a stranger can't touch the pet
    before = dict(s)
    s2 = step(s, FEED, t + DAY, "rStranger")
    print(f"STRANGER  -> state unchanged: {s2 == before}")
