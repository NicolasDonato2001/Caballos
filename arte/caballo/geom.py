import numpy as np
from scipy.spatial import cKDTree


def dist_punto_tri(P, A, B, C):
    """Distancia de puntos P (n,3) a triángulos (n,3)x3 (Ericson). Vectorizada."""
    ab, ac, ap = B - A, C - A, P - A
    d1, d2 = (ab * ap).sum(1), (ac * ap).sum(1)
    bp = P - B; d3, d4 = (ab * bp).sum(1), (ac * bp).sum(1)
    cp = P - C; d5, d6 = (ab * cp).sum(1), (ac * cp).sum(1)
    va, vb, vc = d3 * d6 - d5 * d4, d5 * d2 - d1 * d6, d1 * d4 - d3 * d2
    den = np.maximum(va + vb + vc, 1e-20)
    v, w = vb / den, vc / den
    Q = A + ab * v[:, None] + ac * w[:, None]                       # interior
    m = (d1 <= 0) & (d2 <= 0); Q[m] = A[m]
    m = (d3 >= 0) & (d4 <= d3); Q[m] = B[m]
    m = (d6 >= 0) & (d5 <= d6); Q[m] = C[m]
    m = (vc <= 0) & (d1 >= 0) & (d3 <= 0); t = d1 / np.maximum(d1 - d3, 1e-20); Q[m] = (A + ab * t[:, None])[m]
    m = (vb <= 0) & (d2 >= 0) & (d6 <= 0); t = d2 / np.maximum(d2 - d6, 1e-20); Q[m] = (A + ac * t[:, None])[m]
    m = (va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0)
    t = (d4 - d3) / np.maximum((d4 - d3) + (d5 - d6), 1e-20); Q[m] = (B + (C - B) * t[:, None])[m]
    return np.linalg.norm(P - Q, axis=1)


class Superficie:
    def __init__(self, V, F):
        self.V, self.F = V, F
        self.arbol = cKDTree(V[F].mean(1))

    def distancia(self, P, k=24):
        _, idx = self.arbol.query(P, k=k)
        best = np.full(len(P), np.inf)
        for j in range(k):
            f = self.F[idx[:, j]]
            best = np.minimum(best, dist_punto_tri(P, self.V[f[:, 0]], self.V[f[:, 1]], self.V[f[:, 2]]))
        return best
