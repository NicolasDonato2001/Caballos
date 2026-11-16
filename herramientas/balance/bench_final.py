"""Batería de balance v0.2 — validación con semillas distintas a las usadas para calibrar."""
import json
import numpy as np
from sim_v02 import simulate, P
from bench import sensitivity, breed_race, field
from breeds import PROFILE, CEIL

def strategies_by_archetype(dist, N=1500, seed=77):
    """Para cada arquetipo: 8 copias (±3) con estrategias aleatorias. Índice 1.0 = neutral."""
    arch = {"Velocista": [78, 55, 75, 60, 62], "Fondista": [62, 78, 58, 74, 58],
            "Táctico": [64, 64, 64, 64, 74], "Equilibrado": [66, 66, 66, 66, 66]}
    out = {}
    for name, base in arch.items():
        rng = np.random.default_rng(seed)
        a = field(N, 8, base, rng, jitter=3)
        st = rng.integers(0, 3, (N, 8))
        t = simulate(a, st, dist, seed=seed, p=P)
        w = np.nanargmin(t, axis=1)
        ws = st[np.arange(N), w]
        share = np.bincount(st.ravel(), minlength=3) / st.size
        rate = np.bincount(ws, minlength=3) / N
        out[name] = {s: round(float(rate[i] / share[i] / 8), 2) for i, s in enumerate(["Agresiva", "Equilibrada", "Conservadora"])}
    return out

def endgame(dist, allocs, N=2000, seed=91):
    """Carrera entre el mejor ejemplar posible de cada raza (sin entrenamiento)."""
    br = {b: allocs[str(dist)][b] for b in allocs[str(dist)]}
    return breed_race(br, dist, N=N, seed=seed, jitter=0)

def saddle_gain(dist, N=1500, seed=55):
    rng = np.random.default_rng(seed)
    a = field(N, 8, [65] * 5, rng)
    st = rng.integers(0, 3, (N, 8))
    t0 = simulate(a, st, dist, seed=seed, p=P)
    out = {}
    for name, d in {"Sprint": {0: 2, 2: 1}, "Resistencia": {1: 2, 3: 1}, "Táctica": {4: 2, 3: 1}}.items():
        b = a.copy()
        for k, v in d.items(): b[:, 0, k] += v
        t1 = simulate(b, st, dist, seed=seed, p=P)
        out[name] = round(float(np.nanmean(t0[:, 0] - t1[:, 0])), 3)
    out["tiempo_medio"] = round(float(np.nanmean(t0)), 2)
    return out

def training_gain(dist, N=1500, seed=56):
    rng = np.random.default_rng(seed)
    a = field(N, 8, [70] * 5, rng)
    st = rng.integers(0, 3, (N, 8))
    b = a.copy(); b[:, 0, :] += 15
    t0 = simulate(a, st, dist, seed=seed, p=P); t1 = simulate(b, st, dist, seed=seed, p=P)
    return dict(seg=round(float(np.nanmean(t0[:, 0] - t1[:, 0])), 2),
                win_entrenado=round(float((np.nanargmin(t1, axis=1) == 0).mean()), 3))

if __name__ == "__main__":
    R = {}
    for d in (500, 1500):
        s = sensitivity(d, N=1200, seed=1234)
        R[f"sens_{d}"] = {k: round(v["win"], 3) for k, v in s.items() if k != "_base_win"}
        R[f"sens_{d}"]["base"] = round(s["_base_win"], 3)
        R[f"sens_seg_{d}"] = {k: round(v["gain_s"], 3) for k, v in s.items() if k != "_base_win"}
        R[f"razas_{d}"] = {k: round(v[0], 3) for k, v in breed_race(PROFILE, d, N=3000, seed=4321).items()}
        R[f"estrategias_{d}"] = strategies_by_archetype(d)
        R[f"montura_{d}"] = saddle_gain(d)
        R[f"entreno_{d}"] = training_gain(d)
    try:
        allocs = json.load(open("best_allocs.json"))
        for d in (500, 1500):
            R[f"endgame_{d}"] = {k: round(v[0], 3) for k, v in endgame(d, allocs).items()}
    except FileNotFoundError:
        pass
    json.dump(R, open("bench_final.json", "w"), ensure_ascii=False, indent=1)
    print(json.dumps(R, ensure_ascii=False, indent=1))
