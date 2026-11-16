"""Las 8 razas como deformaciones del caballo base: proporciones por hueso + rasgos propios (perfil, crin, cola...).
Todas comparten la malla (misma topología) → en el juego se mezclan según la composición racial."""
import numpy as np
from rig import Rig, euler, _suave
from regiones import regiones, CRIN, COLA

BASE = dict(
    alzada=1.0,                       # escala global (se aplica en el juego)
    patas=1.0,                        # largo de antebrazo/pierna y cañas
    largo=1.0,                        # largo del tronco
    ancho=1.0, hondo=1.0,             # barril: ancho y profundidad
    vientre=0.0,                      # vientre recogido (0..1)
    cruz=0.0,                         # cruz más alta (m)
    grupa=1.0, grupaCaida=0.0,        # masa de los cuartos y caída de la grupa (m)
    musculo=1.0,                      # grosor de paleta, brazo, antebrazo, muslo y pierna
    hueso=1.0,                        # grosor de cañas, nudos y cascos
    cerneja=0.0,                      # pelo en los nudos (0..1)
    cuelloLargo=1.0, cuelloGrosor=1.0, cuelloAngulo=0.0, cuelloArco=0.0,
    cabeza=1.0, cabezaAncho=1.0, perfil=0.0, cabezaAngulo=0.0,
    crin=1.0, cola=1.0, colaGrosor=1.0, colaPorte=0.0,
)

RAZAS = {
    "PuraSangre": dict(alzada=1.03, patas=1.07, largo=1.05, ancho=0.92, hondo=1.02, vientre=0.55, cruz=0.035, grupa=0.97,
                       musculo=0.95, hueso=0.90, cuelloLargo=1.10, cuelloGrosor=0.90, cuelloAngulo=-9, cabeza=0.98, cabezaAncho=0.93,
                       crin=0.70, cola=0.95, colaGrosor=0.85),
    "Arabe": dict(alzada=0.94, patas=1.00, largo=0.95, ancho=0.93, hondo=0.97, vientre=0.25, grupa=0.96, grupaCaida=-0.02,
                  musculo=0.93, hueso=0.88, cuelloLargo=1.03, cuelloGrosor=0.90, cuelloAngulo=5, cuelloArco=0.7, cabeza=0.90,
                  cabezaAncho=1.02, perfil=-1.0, crin=1.10, cola=1.05, colaPorte=30),
    "CuartoDeMilla": dict(alzada=0.97, patas=0.94, largo=1.00, ancho=1.09, hondo=1.04, grupa=1.22, grupaCaida=0.02, musculo=1.20,
                          hueso=1.05, cuelloLargo=0.92, cuelloGrosor=1.06, cuelloAngulo=-11, cabeza=0.94, cabezaAncho=1.07,
                          crin=0.80, cola=1.00),
    "AkhalTeke": dict(alzada=1.01, patas=1.07, largo=1.08, ancho=0.85, hondo=0.95, vientre=0.8, cruz=0.03, grupa=0.92, musculo=0.88,
                      hueso=0.87, cuelloLargo=1.15, cuelloGrosor=0.80, cuelloAngulo=10, cabeza=1.02, cabezaAncho=0.90, perfil=0.15,
                      crin=0.30, cola=0.80, colaGrosor=0.70),
    "Appaloosa": dict(alzada=0.98, patas=0.98, ancho=1.04, grupa=1.10, musculo=1.08, hueso=1.02, cuelloLargo=0.98, cuelloAngulo=-5,
                      crin=0.50, cola=0.72, colaGrosor=0.65),
    "Criollo": dict(alzada=0.93, patas=0.92, largo=1.00, ancho=1.10, hondo=1.05, grupa=1.08, grupaCaida=0.03, musculo=1.10, hueso=1.13,
                    cuelloLargo=0.92, cuelloGrosor=1.13, cuelloAngulo=-6, cabeza=1.05, cabezaAncho=1.06, perfil=0.55, crin=1.25,
                    cola=1.12, colaGrosor=1.15),
    "Andaluz": dict(alzada=0.99, patas=0.99, largo=0.97, ancho=1.05, hondo=1.02, grupa=1.08, grupaCaida=0.025, musculo=1.08, hueso=1.03,
                    cuelloLargo=1.00, cuelloGrosor=1.20, cuelloAngulo=7, cuelloArco=0.9, cabeza=1.00, perfil=0.65, cabezaAngulo=-3,
                    crin=1.60, cola=1.30, colaGrosor=1.20),
    "Frison": dict(alzada=1.05, patas=1.00, largo=1.00, ancho=1.10, hondo=1.05, grupa=1.10, grupaCaida=0.02, musculo=1.13, hueso=1.20,
                   cerneja=1.0, cuelloLargo=1.03, cuelloGrosor=1.18, cuelloAngulo=11, cuelloArco=0.8, cabeza=1.05, perfil=0.25,
                   cabezaAngulo=-3, crin=1.90, cola=1.40, colaGrosor=1.35),
}


def _marco_hueso(j, t):
    u = t - j
    L = np.linalg.norm(u)
    u = u / max(L, 1e-9)
    ex = np.array([1.0, 0, 0]) - u * u[0]
    n = np.linalg.norm(ex)
    ex = ex / n if n > 1e-6 else np.array([0, 1.0, 0])
    es = np.cross(u, ex)
    return u, ex, es


class Modelador:
    def __init__(self, V, F):
        self.V, self.F = V, F
        self.rig = Rig()
        self.orden, self.Wk = self.rig.pesos(V)
        self.reg = regiones(V, F)
        self.vreg = np.zeros(len(V), int)             # región por vértice (crin/cola si alguna de sus caras lo es)
        for r in (COLA, CRIN):
            self.vreg[np.unique(F[self.reg == r])] = r
        r = self.rig
        self.W = np.zeros((len(V), len(r.nombres)))
        np.put_along_axis(self.W, self.orden, self.Wk, 1)
        self.wb = lambda nombre: sum(self.W[:, i] for i, n in enumerate(r.nombres) if n.split("_")[0] == nombre)

    # ------------------------------------------------------------ escultura previa (en el espacio base)
    def _esculpir(self, p):
        V = self.V.copy()
        x, y, z = V[:, 0], V[:, 1], V[:, 2]
        wT, wP = self.wb("Torax"), self.wb("Pelvis")
        tronco = wT + wP
        # vientre recogido: sube la línea inferior hacia el flanco
        if p["vientre"]:
            abajo = _suave((1.20 - z) / 0.30) * tronco
            hacia_atras = _suave((0.30 - y) / 0.75)
            V[:, 2] += p["vientre"] * 0.085 * abajo * hacia_atras
        # cruz
        if p["cruz"]:
            V[:, 2] += p["cruz"] * _suave((z - 1.40) / 0.15) * np.exp(-((y - 0.20) / 0.20) ** 2) * (self.vreg != CRIN)
        # caída de la grupa
        if p["grupaCaida"]:
            V[:, 2] -= p["grupaCaida"] * 2.2 * _suave((-0.55 - y) / 0.35) * _suave((z - 1.25) / 0.2) * wP
        # perfil de la cabeza: + convexo (acarnerado), − cóncavo (árabe)
        if p["perfil"]:
            j, t = self.rig.reposo[self.rig.idx["Cabeza"]], self.rig.punta[self.rig.idx["Cabeza"]]
            u, ex, es = _marco_hueso(j, t)
            hn = np.array([0, -u[2], u[1]])
            if hn[2] < 0:
                hn = -hn
            s = ((V - j) @ u) / np.linalg.norm(t - j)
            o = (V - j) @ hn
            dorsal = _suave((o - 0.0) / 0.06) * self.wb("Cabeza")
            if p["perfil"] < 0:      # plato del árabe: hundido entre los ojos y los ollares, frente abombada
                bulto = -0.040 * np.exp(-((s - 0.62) / 0.17) ** 2) + 0.018 * np.exp(-((s - 0.22) / 0.14) ** 2)
                amp = -p["perfil"]
            else:
                bulto = 0.036 * np.exp(-((s - 0.60) / 0.24) ** 2)
                amp = p["perfil"]
            V += (amp * bulto * dorsal)[:, None] * hn
        # crin: largo y volumen
        if p["crin"] != 1.0:
            m = self.vreg == CRIN
            n_linea = np.array([0, -0.757, 0.653])
            s = (y - 0.38) * (-0.757) + (z - 1.49) * 0.653          # altura sobre el pliegue del cuello
            k = p["crin"] - 1.0
            cuello = m & (y < 0.99)
            caida = np.clip(1 - s / 0.13, 0, 1)                      # 1 en el borde inferior, 0 en la cresta
            lado = np.sign(x) * _suave(np.abs(x) / 0.03)
            lejos_nuca = 1 - _suave((y - 0.80) / 0.16)                # junto a las orejas la crin no crece
            if k > 0:
                baja = np.array([0, 0.10, -1.0]) / np.linalg.norm([0.10, 1.0])
                V[cuello] += (k * 0.17 * caida[cuello] * lejos_nuca[cuello])[:, None] * baja
                V[cuello, 0] += k * 0.030 * lado[cuello] * (0.4 + 0.6 * caida[cuello]) * lejos_nuca[cuello]
            else:                                                    # crin rala: se pega al cuello
                V[cuello] -= (k * 0.10 * (1 - caida[cuello]) * 0.5)[:, None] * n_linea * 0 
                V[cuello, 0] *= (1 + 0.45 * k * _suave(np.abs(x[cuello]) / 0.05))
                V[cuello] += (k * 0.045 * (1 - caida[cuello]))[:, None] * n_linea
            cop = m & (y >= 0.99)                                    # copete
            V[cop, 2] -= k * 0.05 * _suave((y[cop] - 1.03) / 0.12)
            V[cop, 1] += k * 0.03 * _suave((y[cop] - 1.03) / 0.12)
        # cernejas (pelo largo en los nudos)
        if p["cerneja"]:
            wn = self.wb("CuartillaD") + self.wb("CuartillaT") + 0.6 * (self.wb("CascoD") + self.wb("CascoT"))
            wn = wn * _suave((0.33 - z) / 0.10) * _suave((z - 0.015) / 0.03)
            cx = np.where(x > 0, 1, -1) * np.where(y > 0, 0.160, 0.187)
            cy = np.where(y > 0, 0.425, -0.770)
            atras = _suave((cy - y + 0.02) / 0.06)
            V[:, 1] -= p["cerneja"] * 0.075 * wn * atras
            V[:, 0] += p["cerneja"] * 0.30 * wn * (x - cx)
            V[:, 2] -= p["cerneja"] * 0.045 * wn * atras * _suave((z - 0.10) / 0.08)
        return V

    # ------------------------------------------------------------ proporciones por hueso
    def _escalas(self, p, patas_t=1.0):
        """{hueso: (largo, ancho lateral, grosor sagital)} y rotaciones de forma (grados sobre X)."""
        e, r = {}, {}
        e["Torax"] = (p["largo"], p["ancho"], p["hondo"])
        e["Pelvis"] = (p["largo"], p["ancho"] * (0.5 + 0.5 * p["grupa"]), 0.5 + 0.5 * p["hondo"])
        cg = p["cuelloGrosor"]
        e["Cuello1"] = (p["cuelloLargo"], 0.5 + 0.5 * cg, 0.6 + 0.4 * cg)
        e["Cuello2"] = (p["cuelloLargo"], cg, cg)
        e["Cuello3"] = (p["cuelloLargo"], cg, cg)
        c = p["cabeza"]
        e["Cabeza"] = (c, c * p["cabezaAncho"], c)
        e["Oreja"] = (c ** 0.5, c ** 0.5, c ** 0.5)
        m, h, g = p["musculo"], p["hueso"], p["grupa"]
        e["Escapula"] = (1.0, m, 1.0)
        e["Humero"] = (1.0, m, m)
        e["Radio"] = (p["patas"], 0.5 * (m + h), 0.5 * (m + h))
        e["CanaD"] = (p["patas"], h, h)
        e["CuartillaD"] = (1.0, h, h)
        e["CascoD"] = (h ** 0.5, h ** 0.7, h ** 0.7)
        e["Femur"] = (1.0, m * g ** 0.5, g)
        e["Tibia"] = (p["patas"] * patas_t, 0.5 * (m + h), 0.6 * m + 0.4 * h)
        e["CanaT"] = (p["patas"] * patas_t, h, h)
        e["CuartillaT"] = (1.0, h, h)
        e["CascoT"] = (h ** 0.5, h ** 0.7, h ** 0.7)
        for i in (1, 2, 3, 4):
            e["Cola%d" % i] = (p["cola"], p["colaGrosor"], p["colaGrosor"])
        a, arco = p["cuelloAngulo"], p["cuelloArco"]
        r["Cuello1"] = a + 8 * arco
        r["Cuello2"] = 1 * arco
        r["Cuello3"] = -7 * arco
        r["Cabeza"] = -a * 0.6 - 5 * arco + p["cabezaAngulo"]
        r["Cola1"] = -p["colaPorte"]
        r["Cola2"] = p["colaPorte"] * 0.45
        r["Cola3"] = p["colaPorte"] * 0.40
        return e, r

    def _transformar(self, V, p, patas_t=1.0, subir=0.0):
        rg = self.rig
        esc, rot = self._escalas(p, patas_t)
        n = len(rg.nombres)
        M = np.zeros((n, 3, 3)); S = np.zeros((n, 3, 3)); R = np.zeros((n, 3, 3)); Jn = np.zeros((n, 3))
        for i, nom in enumerate(rg.nombres):
            base = nom.split("_")[0]
            j, t = rg.reposo[i], rg.punta[i]
            pa = rg.padre[i]
            if base in esc:
                u, ex, es = _marco_hueso(j, t)
                l, tx, ts = esc[base]
                S[i] = l * np.outer(u, u) + tx * np.outer(ex, ex) + ts * np.outer(es, es)
            else:
                S[i] = np.eye(3)
            Rloc = euler(np.radians(rot.get(base, 0.0)), 0, 0)
            if pa < 0:
                R[i] = Rloc; Jn[i] = j
            else:
                R[i] = R[pa] @ Rloc
                Jn[i] = Jn[pa] + R[pa] @ S[pa] @ (j - rg.reposo[pa])
            if nom == "Cuerpo":
                Jn[i] = Jn[i] + [0, 0, subir]
            M[i] = R[i] @ S[i]
        out = np.zeros_like(V)
        for k in range(self.orden.shape[1]):
            b = self.orden[:, k]
            out += self.Wk[:, k:k + 1] * (np.einsum('nij,nj->ni', M[b], V - rg.reposo[b]) + Jn[b])
        return out, Jn

    def raza(self, nombre=None, **extra):
        p = dict(BASE)
        if nombre:
            p.update(RAZAS[nombre])
        p.update(extra)
        V0 = self._esculpir(p)
        mano = (self.wb("CascoD") > 0.5); pata = (self.wb("CascoT") > 0.5)
        pt, subir = 1.0, 0.0
        for _ in range(6):                      # apoyar los cuatro cascos en el suelo
            V1, J = self._transformar(V0, p, pt, subir)
            zf, zh = V1[mano, 2].min(), V1[pata, 2].min()
            subir -= zf
            alto_pata = 0.93 - 0.215
            pt *= 1 + (zh - zf) / (alto_pata * p["patas"] * pt)
        V1, J = self._transformar(V0, p, pt, subir)
        return V1, J, p
