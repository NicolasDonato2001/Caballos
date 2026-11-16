"""Simulación económica por perfiles de jugador (días hasta hitos)."""
import json, sys

def table_avg(t):  # reward table list per position -> average if positions uniform
    return sum(t) / len(t)

def run(cfg, profile, days=180):
    r500 = cfg["r8_500"]; r1500 = cfg["r8_1500"]
    avg_race = (table_avg(r500) + table_avg(r1500)) / 2
    gold = cfg["start_gold"]; gems = 0
    races, trains_per_day, play_days = profile["races"], profile["trains"], profile["days_week"]
    full = cfg["daily_full"]
    lvl = {"establo": 1, "centro": 1, "recup": 1}
    slots = 5; horses = 1; saddles = 0; breeds = 0
    upg = cfg["upgrade_costs"]
    slot_prices = cfg["slot_prices"]
    log = {}
    plan = profile.get("plan", "std")
    queue = []
    def milestone(name, d):
        if name not in log: log[name] = d
    for d in range(1, days + 1):
        if (d - 1) % 7 < play_days:
            n_full = min(races, full); n_red = max(0, races - full)
            gold += n_full * avg_race + n_red * avg_race * cfg["reduced"]
        if d % 7 == 0:
            gold += cfg["weekly_gold"] * profile["weekly_done"]
            gems += cfg["weekly_gems"] * profile["weekly_done"]
            gold += cfg["champ_net"] * profile["champ"]
        gold += cfg["gem_conv_gold"] * profile.get("paid_conv", 0)
        # compras en orden de prioridad
        changed = True
        while changed:
            changed = False
            # 1) segundo caballo (sexo opuesto) para criar
            if horses < 2 and gold >= cfg["horse_basic"]:
                gold -= cfg["horse_basic"]; horses += 1; changed = True; milestone("2_caballos", d); continue
            # 2) mejoras de edificios, intercaladas con espacios
            cheapest = min(lvl, key=lambda k: lvl[k])
            if lvl[cheapest] < 5:
                c = upg[lvl[cheapest] - 1]
                need_slot = horses >= slots and slots < cap(lvl["establo"])
                if need_slot and gold >= slot_prices[slots - 5]:
                    gold -= slot_prices[slots - 5]; slots += 1; changed = True; continue
                if gold >= c:
                    gold -= c; lvl[cheapest] += 1; changed = True
                    if all(v >= 2 for v in lvl.values()): milestone("edificios_n2", d)
                    if all(v >= 3 for v in lvl.values()): milestone("edificios_n3", d)
                    if all(v >= 5 for v in lvl.values()): milestone("edificios_n5", d)
                    continue
            # 3) criar si hay espacio (1 cruza activa: max 1 por día con 8h + 24h -> ~0.75/día)
            if horses < slots and gold >= cfg["breed_cost"] and breeds < d * 0.6:
                gold -= cfg["breed_cost"]; horses += 1; breeds += 1; changed = True
                if horses >= 8: milestone("8_caballos", d)
                continue
            # 4) monturas (hasta 3)
            if saddles < 3 and lvl["centro"] >= 3 and gold >= cfg["saddle"]:
                gold -= cfg["saddle"]; saddles += 1; changed = True
                if saddles == 3: milestone("3_monturas", d)
                continue
            # 5) espacios hasta 20
            if slots < cap(lvl["establo"]) and slots < 20 and gold >= slot_prices[slots - 5]:
                gold -= slot_prices[slots - 5]; slots += 1; changed = True
                if slots == 20: milestone("20_espacios", d)
                continue
    log["oro_final"] = round(gold)
    return log

def cap(level):
    return {1: 5, 2: 8, 3: 11, 4: 15, 5: 20}[level]

V01 = dict(r8_500=[140, 100, 70, 35, 35, 35, 35, 35], r8_1500=[180, 130, 90, 45, 45, 45, 45, 45],
           start_gold=2500, daily_full=15, reduced=0.25, weekly_gold=1500, weekly_gems=5,
           champ_net=0, gem_conv_gold=2500, horse_basic=2500, breed_cost=500, saddle=3000,
           upgrade_costs=[1500, 3500, 8000, 18000],
           slot_prices=[500, 600, 720, 864, 1037, 1244, 1493, 1792, 2150, 2580, 3096, 3715, 4458, 5350, 6420])
V02 = dict(V01, upgrade_costs=[1000, 2400, 4800, 9600], gem_conv_gold=1000, champ_net=430,
           r8_500=[160, 115, 80, 40, 40, 40, 40, 40], r8_1500=[210, 150, 105, 50, 50, 50, 50, 50],
           slot_prices=[400, 480, 575, 690, 830, 1000, 1200, 1440, 1730, 2075, 2490, 2990, 3590, 4300, 5160])
PROFILES = {
    "casual": dict(races=5, trains=2, days_week=5, weekly_done=0.5, champ=0.5),
    "regular": dict(races=15, trains=6, days_week=6, weekly_done=1, champ=1),
    "dedicado": dict(races=25, trains=10, days_week=7, weekly_done=1, champ=1),
    "pagador_conv": dict(races=15, trains=6, days_week=6, weekly_done=1, champ=1, paid_conv=1),
}
if __name__ == "__main__":
    for name, base in (("v0.1", V01), ("v0.2", V02)):
        cfg = dict(base)
        if len(sys.argv) > 1: cfg.update(json.loads(sys.argv[1]))
        print("==", name)
        for k, pr in PROFILES.items():
            print(f"{k:13s}", run(cfg, pr, days=365))
