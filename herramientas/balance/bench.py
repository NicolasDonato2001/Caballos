"""Batería de balance: sensibilidad de atributos, razas, estrategias, tráfico."""
import sys, json, time
import numpy as np
from sim_v02 import simulate, P

NAMES = ["Vel", "Res", "Pot", "Tem", "Int"]

def field(N, H, base, rng, jitter=4):
    a = np.tile(np.array(base, float), (N, H, 1))
    a += rng.integers(-jitter, jitter + 1, a.shape)
    return np.clip(a, 0, 100)

def sensitivity(dist, N=1500, base=60, delta=10, seed=1, p=P):
    """Horse 0 gets +delta in one attribute; paired seeds. Returns win-rate & time gain."""
    rng = np.random.default_rng(seed)
    a = field(N, 8, [base] * 5, rng)
    st = rng.integers(0, 3, (N, 8))
    t0 = simulate(a, st, dist, seed=seed, p=p)
    out = {}
    for k in range(5):
        b = a.copy(); b[:, 0, k] += delta
        t1 = simulate(b, st, dist, seed=seed, p=p)
        win = (np.nanargmin(t1, axis=1) == 0).mean()
        out[NAMES[k]] = dict(gain_s=float(np.nanmean(t0[:, 0] - t1[:, 0])), win=float(win))
    out["_base_win"] = float((np.nanargmin(t0, axis=1) == 0).mean())
    return out

def breed_race(breeds, dist, N=2000, seed=3, p=P, jitter=6):
    rng = np.random.default_rng(seed)
    keys = list(breeds)
    a = np.tile(np.array([breeds[k] for k in keys], float), (N, 1, 1))
    a += rng.integers(-jitter, jitter + 1, a.shape)
    a = np.clip(a, 0, 90)
    st = rng.integers(0, 3, (N, len(keys)))
    t = simulate(a, st, dist, seed=seed, p=p)
    w = np.bincount(np.nanargmin(t, axis=1), minlength=len(keys)) / N
    mt = np.nanmean(t, axis=0)
    return {k: (float(w[i]), float(mt[i])) for i, k in enumerate(keys)}

def strategy_test(dist, base, N=2000, seed=5, p=P):
    rng = np.random.default_rng(seed)
    a = field(N, 8, base, rng, jitter=3)
    st = rng.integers(0, 3, (N, 8))
    t = simulate(a, st, dist, seed=seed, p=p)
    win = np.nanargmin(t, axis=1)
    ws = st[np.arange(N), win]
    share = np.bincount(st.ravel(), minlength=3) / st.size
    rate = np.bincount(ws, minlength=3) / N
    return {s: round(float(rate[i] / share[i] / 8), 3) for i, s in enumerate(["Agr", "Equ", "Con"])}

if __name__ == "__main__":
    t0 = time.time()
    for d in (500, 1500):
        print(d, json.dumps(sensitivity(d, N=800), indent=None))
    print("t", round(time.time() - t0, 1))
