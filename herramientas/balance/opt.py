"""Búsqueda automática de coeficientes (hill-climbing con números aleatorios comunes)."""
import json, sys, time, copy
import numpy as np
from sim_v02 import P
from bench import sensitivity

TARGET = {500:  dict(Vel=.40, Pot=.33, Res=.24, Tem=.22, Int=.24),
          1500: dict(Vel=.30, Pot=.22, Res=.40, Tem=.32, Int=.32)}
KEYS = ["d0", "d1", "pen_max", "tem_k", "check_k", "judge_bias", "judge_sd", "draft_k",
        "waste_k", "vmax_k", "vs_vel", "vs_res", "res_coef_b", "kick_k", "amax_k", "pace500_mid", "acc_k"]
BOUNDS = dict(tem_k=(0.3, 0.92), judge_bias=(0, 0.9), judge_sd=(0, 0.9), pace500_mid=(0.85, 0.98),
              res_coef_b=(0.002, 0.011), pen_max=(0.1, 0.6))

def to_p(x):
    p = copy.deepcopy(P)
    for k, v in x.items():
        if k == "pace500_mid":
            p["pace500"] = [(0.10, 0.90), (0.70, v), (0.88, min(v + 0.02, 1.0)), (1.01, 1.0)]
        else:
            p[k] = v
    return p

from multiprocessing import Pool
def _one(args):
    x, d, N, seed = args
    return d, sensitivity(d, N=N, seed=seed, p=to_p(x))
POOL = None
def score(x, N=300, seed=11):
    global POOL
    if POOL is None: POOL = Pool(2)
    tot = 0; res = {}
    for d, r in POOL.map(_one, [(x, 500, N, seed), (x, 1500, N, seed)]):
        res[d] = {k: round(r[k]["win"], 3) for k in TARGET[d]}
        tot += sum((r[k]["win"] - TARGET[d][k]) ** 2 for k in TARGET[d])
    return tot, res

if __name__ == "__main__":
    state_f = "opt_state.json"
    try:
        st = json.load(open(state_f))
    except FileNotFoundError:
        x = json.loads(sys.argv[1]); s, r = score(x)
        st = dict(x=x, s=s, r=r, it=0)
    rng = np.random.default_rng(int(time.time()))
    budget = float(sys.argv[2]) if len(sys.argv) > 2 else 500
    t0 = time.time()
    while time.time() - t0 < budget:
        x = dict(st["x"])
        for k in rng.choice(KEYS, size=3, replace=False):
            v = x[k] * float(np.exp(rng.normal(0, 0.2)))
            lo, hi = BOUNDS.get(k, (1e-4, 50))
            x[k] = float(np.clip(v, lo, hi))
        s, r = score(x)
        st["it"] += 1
        if s < st["s"]:
            st.update(x=x, s=s, r=r)
            print(f"it{st['it']} score {s:.4f} {r}", flush=True)
        json.dump(st, open(state_f, "w"))
    print("BEST", round(st["s"], 4), st["r"])
