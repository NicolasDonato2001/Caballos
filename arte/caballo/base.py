"""Prepara la malla base a partir del STL original (LowPolyFigures, CC BY 4.0):
orienta, escala a 1,60 m a la cruz, suelda vértices y simplifica conservando las facetas."""
import struct, heapq
import numpy as np


def leer_stl(p):
    b = open(p, 'rb').read()
    n = struct.unpack('<I', b[80:84])[0]
    d = np.frombuffer(b, dtype=np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')]), count=n, offset=84)
    V = d['v'].reshape(-1, 3).astype(float)
    u, inv = np.unique(np.round(V, 5), axis=0, return_inverse=True)
    F = inv.reshape(-1, 3)
    F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
    return u, F


def componentes(n, F):
    etiq = np.arange(n)
    while True:
        m = etiq[F].min(1)
        nuevo = etiq.copy()
        for c in range(3):
            np.minimum.at(nuevo, F[:, c], m)
        nuevo = nuevo[nuevo]
        if np.array_equal(nuevo, etiq):
            return etiq
        etiq = nuevo


def aristas_info(F):
    e = np.sort(np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), axis=1)
    u, c = np.unique(e, axis=0, return_counts=True)
    return u, c


def simplificar(V, F, objetivo, borde_peso=0.0):
    """Colapso de aristas con métrica de error cuádrico (Garland-Heckbert). Conserva los planos de las facetas."""
    V = V.copy()
    nv = len(V)
    caras = [list(f) for f in F]
    vivas = np.ones(len(caras), bool)
    vcaras = [set() for _ in range(nv)]
    for i, f in enumerate(caras):
        for v in f:
            vcaras[v].add(i)
    Q = np.zeros((nv, 4, 4))

    def plano(f):
        a, b, c = V[f[0]], V[f[1]], V[f[2]]
        n = np.cross(b - a, c - a)
        ar = np.linalg.norm(n)
        if ar < 1e-14:
            return None, 0.0
        n = n / ar
        return np.append(n, -n @ a), ar / 2

    for f in caras:
        p, ar = plano(f)
        if p is None:
            continue
        K = np.outer(p, p) * ar
        for v in f:
            Q[v] += K

    def costo(a, b):
        Qs = Q[a] + Q[b]
        A = Qs[:3, :3]
        try:
            if abs(np.linalg.det(A)) > 1e-12:
                x = np.linalg.solve(A, -Qs[:3, 3])
                m = (V[a] + V[b]) / 2
                if np.linalg.norm(x - m) > 3 * np.linalg.norm(V[a] - V[b]):
                    x = m
            else:
                x = (V[a] + V[b]) / 2
        except np.linalg.LinAlgError:
            x = (V[a] + V[b]) / 2
        h = np.append(x, 1.0)
        return float(h @ Qs @ h), x

    heap = []
    version = np.zeros(nv, int)
    vivos = np.ones(nv, bool)

    def empujar(a, b):
        if a > b:
            a, b = b, a
        c, x = costo(a, b)
        heapq.heappush(heap, (c, a, b, version[a], version[b], tuple(x)))

    vistos = set()
    for f in caras:
        for i in range(3):
            a, b = f[i], f[(i + 1) % 3]
            k = (min(a, b), max(a, b))
            if k not in vistos:
                vistos.add(k)
                empujar(a, b)
    n_caras = len(caras)
    while n_caras > objetivo and heap:
        c, a, b, va, vb, x = heapq.heappop(heap)
        if not (vivos[a] and vivos[b]) or version[a] != va or version[b] != vb:
            continue
        x = np.array(x)
        # vecinos comunes: deben ser exactamente 2 (variedad)
        na = {v for fi in vcaras[a] for v in caras[fi]} - {a}
        nb = {v for fi in vcaras[b] for v in caras[fi]} - {b}
        if len((na & nb) - {a, b}) != 2:
            continue
        # no invertir caras
        ok = True
        for fi in (vcaras[a] | vcaras[b]):
            f = caras[fi]
            if a in f and b in f:
                continue
            p0 = [V[v] for v in f]
            p1 = [x if v in (a, b) else V[v] for v in f]
            n0 = np.cross(p0[1] - p0[0], p0[2] - p0[0])
            n1 = np.cross(p1[1] - p1[0], p1[2] - p1[0])
            l0, l1 = np.linalg.norm(n0), np.linalg.norm(n1)
            if l1 < 1e-12 or (n0 @ n1) < 0.2 * l0 * l1:
                ok = False
                break
        if not ok:
            continue
        # colapsar b en a
        V[a] = x
        Q[a] = Q[a] + Q[b]
        for fi in list(vcaras[b]):
            f = caras[fi]
            if a in f:
                vivas[fi] = False
                n_caras -= 1
                for v in f:
                    vcaras[v].discard(fi)
            else:
                f[f.index(b)] = a
                vcaras[a].add(fi)
        vcaras[b] = set()
        vivos[b] = False
        version[a] += 1
        for v in {v for fi in vcaras[a] for v in caras[fi]} - {a}:
            empujar(a, v)
    idx = -np.ones(nv, int)
    usados = np.unique(np.array([caras[i] for i in range(len(caras)) if vivas[i]]))
    idx[usados] = np.arange(len(usados))
    F2 = idx[np.array([caras[i] for i in range(len(caras)) if vivas[i]])]
    return V[usados], F2


def cargar_base(ruta_stl):
    V0, F = leer_stl(ruta_stl)
    # ejes del STL: X lateral, Y arriba, Z adelante → generador: X lateral, Y adelante, Z arriba
    V = np.stack([V0[:, 0], V0[:, 2], V0[:, 1]], 1)
    F = F[:, ::-1].copy()
    V[:, 2] -= V[:, 2].min()
    return V, F


if __name__ == '__main__':
    import sys, time
    V, F = cargar_base('/home/claude/ref/usuario/caballo.stl')
    et = componentes(len(V), F)
    print('verts', len(V), 'caras', len(F), 'componentes', len(np.unique(et)))
    u, c = aristas_info(F)
    print('aristas', len(u), 'borde(1)', (c == 1).sum(), 'no variedad(>2)', (c > 2).sum())
    print('ext', V.min(0), V.max(0), 'asimetría x', V[:, 0].min() + V[:, 0].max())
