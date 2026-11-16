"""Razas: perfiles medios, techos genéticos y búsqueda del mejor ejemplar posible por raza y distancia."""
import itertools, json, sys
import numpy as np
from sim_v02 import simulate, P

ATTR = ["Vel", "Res", "Pot", "Tem", "Int"]
# Perfil medio (suma 330) — identidad de la v0.1 conservada, sumas igualadas
PROFILE = {
    "Pura Sangre":     [74, 60, 68, 60, 68],
    "Árabe":           [62, 72, 60, 67, 69],
    "Cuarto de Milla": [68, 56, 78, 62, 66],
    "Akhal-Teke":      [68, 72, 62, 62, 66],
    "Appaloosa":       [67, 66, 66, 63, 68],
    "Criollo":         [58, 74, 62, 74, 62],
    "Andaluz":         [64, 64, 70, 62, 70],
    "Frisón":          [65, 64, 72, 65, 64],
}
# Techo genético natural por raza (suma 410, máx 90). Presupuesto natural: 360.
CEIL = {
    "Pura Sangre":     [90, 82, 86, 74, 78],
    "Árabe":           [80, 90, 72, 88, 80],
    "Cuarto de Milla": [86, 72, 90, 80, 82],
    "Akhal-Teke":      [86, 88, 78, 78, 80],
    "Appaloosa":       [82, 82, 82, 82, 82],
    "Criollo":         [80, 90, 76, 90, 74],
    "Andaluz":         [82, 78, 86, 80, 84],
    "Frisón":          [80, 80, 90, 86, 74],
}

def fit_proxy(dist, n=3000, seed=21, p=P):
    """Regresión cuadrática del tiempo medio en un pelotón aleatorio."""
    rng = np.random.default_rng(seed)
    a = rng.integers(40, 91, (n, 8, 5)).astype(float)
    st = rng.integers(0, 3, (n, 8))
    t = simulate(a, st, dist, seed=seed, p=p)
    X = a.reshape(-1, 5); y = t.reshape(-1)
    m = ~np.isnan(y); X, y = X[m], y[m]
    feats = lambda X: np.column_stack([np.ones(len(X)), X, X ** 2 / 100])
    coef, *_ = np.linalg.lstsq(feats(X), y, rcond=None)
    pred = feats(X) @ coef
    r2 = 1 - ((y - pred) ** 2).sum() / ((y - y.mean()) ** 2).sum()
    return coef, r2, feats

def best_alloc(ceil, coef, feats, budget=360, step=2):
    """Mejor reparto (según el proxy) dentro de los techos y el presupuesto."""
    best = None
    rngs = [range(40, c + 1, step) for c in ceil[:4]]
    for v in itertools.product(*rngs):
        i = budget - sum(v)
        if i < 40 or i > ceil[4]: continue
        x = np.array([[*v, i]], float)
        t = float((feats(x) @ coef)[0])
        if best is None or t < best[0]: best = (t, [*v, i])
    return best

if __name__ == "__main__":
    out = {}
    for d in (500, 1500):
        coef, r2, feats = fit_proxy(d)
        print(d, "R2 proxy", round(r2, 3))
        out[d] = {}
        for b, c in CEIL.items():
            t, x = best_alloc(c, coef, feats)
            out[d][b] = x
            print(f"  {b:16s} mejor {x} proxy {t:.2f}s")
    json.dump(out, open("best_allocs.json", "w"), ensure_ascii=False)
