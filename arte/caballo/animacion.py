"""Aires del caballo generados por cinemática inversa: los cascos siguen la pisada real de cada aire
(apoyo sin patinar + vuelo) y las articulaciones se resuelven para alcanzarla. Todo en el plano sagital.
Cada aire es un ciclo en el lugar de duración 1 (se reproduce a velocidad = v / zancada)."""
import numpy as np
from scipy.optimize import least_squares
from rig import Rig

N = 32   # cuadros por ciclo


def rot2(v, a):
    c, s = np.cos(a), np.sin(a)
    return np.array([v[0] * c - v[1] * s, v[0] * s + v[1] * c])


def suave(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def campana(s, centro, ancho):
    """Pulso suave (0..1) centrado en 'centro' con semiancho 'ancho', dentro de s∈[0,1]."""
    return np.clip(np.cos(np.clip((s - centro) / ancho, -1, 1) * np.pi / 2), 0, 1) ** 2


AIRES = {
    # fase de apoyo (inicio) de cada pata: TI/TD traseras izq/der, DI/DD delanteras; apoyo = fracción del ciclo en el suelo
    "Paso": dict(zancada=1.75, fases=dict(TI=0.0, DI=0.25, TD=0.5, DD=0.75), apoyoD=0.62, apoyoT=0.62,
                 altoD=0.11, altoT=0.08, offD=-0.20, offT=0.00, nudo=0.28, bote=(2, 0.008, 0.10), cabeceo=(2, 0.5, 0.45),
                 cuello=-9, cuelloOsc=(2, 3.5, 0.30), lomo=0, cola=-5, colaCae=0, casco=-30, rodilla=0.6, oreja=0),
    "Trote": dict(zancada=2.9, fases=dict(TI=0.0, DD=0.0, TD=0.5, DI=0.5), apoyoD=0.38, apoyoT=0.40,
                  altoD=0.20, altoT=0.15, offD=-0.20, offT=0.02, nudo=0.42, bote=(2, 0.026, 0.46), cabeceo=(2, 0.4, 0.2),
                  cuello=-5, cuelloOsc=(2, 1.0, 0.3), lomo=0, cola=-14, colaCae=2, casco=-38, rodilla=1.0, oreja=0),
    "Medio": dict(zancada=3.8, fases=dict(TI=0.0, TD=0.26, DI=0.26, DD=0.52), apoyoD=0.29, apoyoT=0.31,
                  altoD=0.26, altoT=0.20, offD=-0.20, offT=0.02, nudo=0.50, bote=(1, 0.032, 0.92), cabeceo=(1, 3.4, 0.70),
                  cuello=-8, cuelloOsc=(1, 4.5, 0.60), lomo=5, cola=-20, colaCae=4, casco=-40, rodilla=1.0, oreja=-8),
    "Galope": dict(zancada=6.6, fases=dict(TI=0.0, TD=0.09, DI=0.36, DD=0.46), apoyoD=0.17, apoyoT=0.18,
                   altoD=0.34, altoT=0.26, offD=-0.20, offT=0.03, nudo=0.62, bote=(1, 0.025, 0.84), cabeceo=(1, 2.8, 0.60),
                   cuello=-22, cuelloOsc=(1, 5.0, 0.52), lomo=9, cola=-30, colaCae=7, casco=-45, rodilla=1.0, oreja=-16),
}


class Animador:
    def __init__(self, rig=None):
        self.rig = rig or Rig()
        r = self.rig
        P = lambda n: r.reposo[r.idx[n]][1:]
        self.cad = {}
        for dt, nombres, punta in (("D", ["Escapula", "Humero", "Radio", "CanaD", "CuartillaD", "CascoD"], (0.560, 0.0)),
                                   ("T", ["Femur", "Tibia", "CanaT", "CuartillaT", "CascoT"], (-0.635, 0.0))):
            pts = [P(n + "_I") for n in nombres] + [np.array(punta)]
            self.cad[dt] = dict(nombres=nombres, seg=[pts[i + 1] - pts[i] for i in range(len(pts) - 1)], raiz=pts[0], punta=np.array(punta))

    # ------------------------------------------------------------ cinemática de una extremidad (2D)
    def _mano(self, base, P, phi, eps, k, fet, beta):
        s = self.cad["D"]["seg"]
        aE = P + 0.30 * phi
        aH = aE + 0.20 * phi - eps
        aR = P + phi
        aK = aR - k
        aM = aK + fet
        p = base + rot2(s[0], aE) + rot2(s[1], aH) + rot2(s[2], aR) + rot2(s[3], aK) + rot2(s[4], aM) + rot2(s[5], beta)
        loc = dict(Escapula=0.30 * phi, Humero=0.20 * phi - eps, Radio=0.50 * phi + eps, CanaD=-k, CuartillaD=fet, CascoD=beta - aM)
        return p, loc

    def _pata(self, base, P, A, q, fet, beta):
        s = self.cad["T"]["seg"]
        aF = P + A
        aT = aF - q
        aH = aT + 0.9 * q
        aM = aH + fet
        p = base + rot2(s[0], aF) + rot2(s[1], aT) + rot2(s[2], aH) + rot2(s[3], aM) + rot2(s[4], beta)
        loc = dict(Femur=A, Tibia=-q, CanaT=0.9 * q, CuartillaT=fet, CascoT=beta - aM)
        return p, loc

    # ------------------------------------------------------------ pisada
    def _pisada(self, a, pata, t):
        """Devuelve (en_apoyo, objetivo punta (y,z), beta, nudo, s) para la pata en la fase t del ciclo."""
        dt = pata[0]
        d = a["apoyo" + dt]
        S = a["zancada"]
        tau = (t - a["fases"][pata]) % 1.0
        y0 = self.cad[dt]["punta"][0] + a["off" + dt]
        y_td, y_lo = y0 + d * S / 2, y0 - d * S / 2
        casco_max = np.radians(a["casco"])
        if tau < d:                                    # apoyo: la punta retrocede a velocidad constante
            u = tau / d
            y, z = y_td - S * tau, 0.0
            beta = casco_max * suave((u - 0.76) / 0.24)            # al final el talón se levanta (despegue)
            beta += np.radians(5) * (1 - suave(u / 0.10))           # entra apenas de talón
            nudo = a["nudo"] * np.sin(np.pi * min(1.0, u / 0.92)) ** 0.7 * (1 - 0.6 * suave((u - 0.80) / 0.2))
            if beta > 0:
                z = 0.17 * np.sin(beta)
            return True, np.array([y, z]), beta, nudo, u
        s = (tau - d) / (1 - d)                        # vuelo
        m = -S * (1 - d)                               # velocidad de la punta al despegar/aterrizar (continuidad)
        h00, h10, h01, h11 = 2 * s ** 3 - 3 * s ** 2 + 1, s ** 3 - 2 * s ** 2 + s, -2 * s ** 3 + 3 * s ** 2, s ** 3 - s ** 2
        y = h00 * y_lo + h10 * m + h01 * y_td + h11 * m
        alto = a["alto" + dt]
        z = alto * (np.sin(np.pi * s ** 0.80) ** 1.5) + 0.17 * np.sin(np.radians(5)) * suave((s - 0.9) / 0.1)
        beta = casco_max * (1 - suave(s / 0.55)) + np.radians(-22) * campana(s, 0.22, 0.30) + np.radians(5) * suave((s - 0.80) / 0.2)
        nudo = -a["nudo"] * 1.5 * campana(s, 0.38, 0.45) - 0.12 * (1 - suave(s / 0.2)) * 0
        return False, np.array([y, z]), beta, nudo, s

    # ------------------------------------------------------------ cuerpo
    def _cuerpo(self, a, t, bajar=0.0):
        n, amp, fase = a["bote"]
        dz = amp * np.cos(2 * np.pi * (n * t - fase * n)) - bajar
        n2, amp2, fase2 = a["cabeceo"]
        cab = np.radians(amp2) * np.cos(2 * np.pi * (n2 * t - fase2 * n2))       # + = morro abajo
        lomo = np.radians(a["lomo"]) * np.cos(2 * np.pi * (t - 0.93))            # + = recogido (posteriores entran bajo el cuerpo)
        nc, ac, fc = a["cuelloOsc"]
        osc = np.radians(ac) * np.cos(2 * np.pi * (nc * t - fc * nc))            # + = cuello abajo
        cu = np.radians(a["cuello"])
        rot = {
            "Cuerpo": (-cab, 0, 0),
            "Pelvis": (lomo, 0, 0),
            "Torax": (-0.35 * lomo, 0, 0),
            "Cuello1": (cu * 0.55 - osc * 0.6 + 0.35 * lomo + cab * 0.5, 0, 0),
            "Cuello2": (cu * 0.30 - osc * 0.3, 0, 0),
            "Cuello3": (cu * 0.15 - osc * 0.1, 0, 0),
            "Cabeza": (-cu * 0.62 + osc * 0.55, 0, 0),
            "Cola1": (np.radians(a["cola"]) + 0.5 * lomo + np.radians(3) * np.sin(2 * np.pi * (n * t - 0.1)), 0, 0),
            "Cola2": (np.radians(a["cola"]) * 0.25 + np.radians(a["colaCae"]) + np.radians(5) * np.sin(2 * np.pi * (n * t - 0.3)), 0, 0),
            "Cola3": (np.radians(a["cola"]) * 0.10 + np.radians(a["colaCae"]) * 1.4 + np.radians(7) * np.sin(2 * np.pi * (n * t - 0.5)), 0, 0),
            "Cola4": (np.radians(a["colaCae"]) * 1.6 + np.radians(9) * np.sin(2 * np.pi * (n * t - 0.7)), 0, 0),
            "Oreja_I": (np.radians(a["oreja"]), 0, 0), "Oreja_D": (np.radians(a["oreja"]), 0, 0),
        }
        return rot, {"Mov": (0, 0, dz)}

    def _bases(self, rot, tras):
        r = self.rig
        G = r.matrices(rot, tras)
        ang = lambda n: np.arctan2(G[r.idx[n]][2, 1], G[r.idx[n]][1, 1])
        return (G[r.idx["Escapula_I"]][1:3, 3], ang("Torax")), (G[r.idx["Femur_I"]][1:3, 3], ang("Pelvis"))

    # ------------------------------------------------------------ ciclo completo
    def generar(self, nombre, n=N, verboso=False):
        a = AIRES[nombre]
        ts = np.arange(n) / n
        bajar = np.zeros(n)
        for vuelta in range(4):
            cuadros = [self._cuerpo(a, t, bajar[i]) for i, t in enumerate(ts)]
            bases = [self._bases(*c) for c in cuadros]
            falta = np.zeros(n)
            sol = {p: [None] * n for p in ("DI", "DD", "TI", "TD")}
            for pata in sol:
                dt = pata[0]
                info = [self._pisada(a, pata, t) for t in ts]
                # empezar por el primer cuadro de apoyo y avanzar en el tiempo (continuidad)
                i0 = next(i for i in range(n) if info[i][0] and not info[i - 1][0])
                x = np.array([0.0, 0.05]) if dt == "D" else np.array([0.0, 0.1])
                eps_apoyo = {}
                for paso in range(n):
                    i = (i0 + paso) % n
                    apoyo, obj, beta, nudo, s = info[i]
                    base, P = bases[i][0 if dt == "D" else 1]
                    if dt == "T":
                        f = lambda u: self._pata(base, P, u[0], u[1], nudo, beta)[0] - obj
                        res = least_squares(f, x, bounds=([-1.3, -0.45], [1.3, 1.9]))
                        x = res.x
                        sol[pata][i] = self._pata(base, P, x[0], x[1], nudo, beta)[1]
                    else:
                        if apoyo:
                            f = lambda u: self._mano(base, P, u[0], u[1], 0.0, nudo, beta)[0] - obj
                            xa = np.array([x[0], eps_apoyo.get("ult", 0.05)])
                            res = least_squares(f, xa, bounds=([-1.3, -0.62], [1.3, 0.9]))
                            x = np.array([res.x[0], 0.0])
                            eps_apoyo["ult"] = res.x[1]
                            eps_apoyo.setdefault("ini", res.x[1])
                            sol[pata][i] = self._mano(base, P, res.x[0], res.x[1], 0.0, nudo, beta)[1]
                        else:
                            e0, e1 = eps_apoyo["ult"], eps_apoyo["ini"]
                            eps = e0 + (e1 - e0) * suave(s) + 0.22 * a["rodilla"] * np.sin(np.pi * s) ** 2
                            f = lambda u: self._mano(base, P, u[0], eps, u[1], nudo, beta)[0] - obj
                            res = least_squares(f, np.array([x[0], max(x[1], 0.05)]), bounds=([-1.4, 0.0], [1.6, 2.4]))
                            x = res.x
                            sol[pata][i] = self._mano(base, P, x[0], eps, x[1], nudo, beta)[1]
                    err = np.linalg.norm(res.fun)
                    if apoyo and err > 1e-4:
                        falta[i] = max(falta[i], abs(res.fun[1]) + 0.3 * abs(res.fun[0]))
                    sol[pata][i]["_err"] = err
            if verboso:
                print(nombre, "vuelta", vuelta, "falta máx %.4f" % falta.max(), "bajar máx %.3f" % bajar.max())
            if falta.max() < 5e-4:
                break
            # bajar el cuerpo donde no se llega, con transición suave (ciclo cerrado)
            k = np.exp(-0.5 * (np.arange(-6, 7) / 2.2) ** 2); k /= k.max()
            env = np.array([max(falta[(i + j) % n] * k[j + 6] for j in range(-6, 7)) for i in range(n)])
            bajar = bajar + env * 1.15
        # armar los cuadros
        poses = []
        for i in range(n):
            rot, tras = cuadros[i]
            rot = dict(rot)
            for pata, lado in (("DI", "_I"), ("DD", "_D"), ("TI", "_I"), ("TD", "_D")):
                for h, v in sol[pata][i].items():
                    if not h.startswith("_"):
                        rot[h + lado] = (v, 0, 0)
            poses.append((rot, dict(tras)))
        errs = {p: max(sol[p][i]["_err"] for i in range(n)) for p in sol}
        return poses, dict(error=errs, bajar=bajar)

    def quieto(self, n=64):
        """Reposo: respira, mueve apenas la cabeza, la cola y las orejas (ciclo de 4 s)."""
        poses = []
        for i in range(n):
            t = i / n
            w = 2 * np.pi * t
            rot = {
                "Cuello1": (np.radians(1.2) * np.sin(w), 0, np.radians(1.5) * np.sin(w + 1.0)),
                "Cuello2": (np.radians(0.8) * np.sin(w + 0.4), 0, 0),
                "Cabeza": (np.radians(1.5) * np.sin(2 * w + 0.5), 0, np.radians(2.0) * np.sin(w + 1.3)),
                "Cola1": (np.radians(2) * np.sin(2 * w), np.radians(7) * np.sin(2 * w + 0.3), 0),
                "Cola2": (0, np.radians(9) * np.sin(2 * w - 0.5), 0),
                "Cola3": (0, np.radians(10) * np.sin(2 * w - 1.2), 0),
                "Cola4": (0, np.radians(10) * np.sin(2 * w - 1.9), 0),
                "Oreja_I": (np.radians(-14) * campana(t, 0.30, 0.10), 0, np.radians(10) * campana(t, 0.30, 0.10)),
                "Oreja_D": (np.radians(-12) * campana(t, 0.72, 0.09), 0, np.radians(-9) * campana(t, 0.72, 0.09)),
                "Torax": (np.radians(0.35) * np.sin(2 * w), 0, 0),
            }
            poses.append((rot, {"Mov": (0, 0, 0.004 * np.sin(2 * w))}))
        return poses
