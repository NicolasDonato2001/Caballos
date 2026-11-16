"""Pesos de piel, cinemática directa y deformación (linear blend skinning) del caballo."""
import numpy as np
from esqueleto import huesos

# radio de influencia de cada hueso (m): grosor típico del cuerpo a su alrededor
RADIO = {"Torax": 0.40, "Pelvis": 0.30, "Cuello1": 0.27, "Cuello2": 0.20, "Cuello3": 0.15, "Cabeza": 0.15, "Oreja": 0.04,
         "Cola1": 0.11, "Cola2": 0.11, "Cola3": 0.11, "Cola4": 0.11,
         "Escapula": 0.13, "Humero": 0.13, "Radio": 0.085, "CanaD": 0.055, "CuartillaD": 0.050, "CascoD": 0.065,
         "Femur": 0.19, "Tibia": 0.115, "CanaT": 0.058, "CuartillaT": 0.050, "CascoT": 0.065}
SIN_PESO = ("Raiz", "Mov", "Cuerpo")


def _suave(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def _dist_seg(P, a, b):
    ab = b - a
    t = np.clip(((P - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1)


class Rig:
    def __init__(self, juntas=None):
        self.h = huesos()
        self.nombres = [x[0] for x in self.h]
        self.idx = {n: i for i, n in enumerate(self.nombres)}
        self.padre = [self.idx[x[1]] if x[1] else -1 for x in self.h]
        self.reposo = np.array([x[2] for x in self.h])        # posiciones de mundo en reposo
        self.punta = np.array([x[3] for x in self.h])
        if juntas is not None:
            self.reposo = np.array(juntas, float)

    # ---------------------------------------------------------------- pesos
    def pesos(self, V, temp=0.22, max_inf=4):
        n = len(self.h)
        S = np.full((len(V), n), np.inf)
        for i, (nom, p, j, t) in enumerate(self.h):
            if nom in SIN_PESO:
                continue
            base = nom.split("_")[0]
            d = _dist_seg(V, j, t)
            S[:, i] = d / RADIO[base]
        W = np.exp(-(S - S.min(1, keepdims=True)) / temp)
        for i, nom in enumerate(self.nombres):
            base = nom.split("_")[0]
            if nom.endswith("_I"):
                W[:, i] *= _suave((V[:, 0] + 0.02) / 0.04)
            elif nom.endswith("_D"):
                W[:, i] *= _suave((-V[:, 0] + 0.02) / 0.04)
            if base.startswith("Cola"):       # la cola no arrastra la grupa
                W[:, i] *= _suave((-0.915 - V[:, 1]) / 0.05) * (np.abs(V[:, 0]) < 0.2)
            if base == "Oreja":
                W[:, i] *= _suave((V[:, 2] - 2.045) / 0.03)
            if base in ("Pelvis", "Femur"):   # el pelo de la cola solo sigue a la cola
                W[:, i] *= 1 - 0.999 * _suave((-0.96 - V[:, 1]) / 0.05)
        # conservar las mayores influencias
        orden = np.argsort(-W, axis=1)[:, :max_inf]
        Wk = np.take_along_axis(W, orden, 1)
        Wk[Wk < 0.02 * Wk.max(1, keepdims=True)] = 0
        Wk /= Wk.sum(1, keepdims=True)
        return orden, Wk

    # ---------------------------------------------------------------- pose
    def matrices(self, rot=None, tras=None, juntas=None):
        """rot: {hueso: (rx, ry, rz) en radianes, locales}; tras: {hueso: (dx, dy, dz)}.
        Devuelve matrices 4x4 de mundo por hueso (reposo → pose)."""
        rep = self.reposo if juntas is None else juntas
        n = len(self.h)
        G = np.zeros((n, 4, 4))
        for i in range(n):
            p = self.padre[i]
            L = np.eye(4)
            loc = rep[i] - (rep[p] if p >= 0 else 0)
            if tras and self.nombres[i] in tras:
                loc = loc + np.asarray(tras[self.nombres[i]], float)
            L[:3, 3] = loc
            if rot and self.nombres[i] in rot:
                L[:3, :3] = euler(*rot[self.nombres[i]])
            G[i] = L if p < 0 else G[p] @ L
        return G

    def deformar(self, V, orden, Wk, G, juntas=None):
        rep = self.reposo if juntas is None else juntas
        out = np.zeros_like(V)
        for k in range(orden.shape[1]):
            b = orden[:, k]
            loc = V - rep[b]
            out += Wk[:, k:k + 1] * (np.einsum('nij,nj->ni', G[b][:, :3, :3], loc) + G[b][:, :3, 3])
        return out

    def articulaciones(self, G):
        return G[:, :3, 3]


def euler(rx, ry, rz):
    cx, sx, cy, sy, cz, sz = np.cos(rx), np.sin(rx), np.cos(ry), np.sin(ry), np.cos(rz), np.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx
