"""Esqueleto del caballo base (metros; X lateral izq +, Y adelante, Z arriba). Reposo = de pie.
Cada hueso: (nombre, padre, posición de su articulación). Los laterales terminan en _I y se espejan a _D."""
import numpy as np

ESCALA_STL = 2.56        # lleva el STL original a 1,60 m a la cruz

_B = [
    ("Raiz", None, (0, 0, 0)),
    ("Mov", "Raiz", (0, 0, 0)),               # rebote y avance del cuerpo (única traslación animada)
    ("Cuerpo", "Mov", (0, -0.10, 1.30)),      # cabeceo de todo el tronco
    ("Torax", "Cuerpo", (0, -0.12, 1.36)),
    ("Pelvis", "Cuerpo", (0, -0.42, 1.44)),
    ("Cuello1", "Torax", (0, 0.50, 1.36)),
    ("Cuello2", "Cuello1", (0, 0.66, 1.60)),
    ("Cuello3", "Cuello2", (0, 0.81, 1.82)),
    ("Cabeza", "Cuello3", (0, 0.94, 1.99)),
    ("Oreja_I", "Cabeza", (0.070, 1.035, 2.07)),
    ("Cola1", "Pelvis", (0, -0.93, 1.40)),
    ("Cola2", "Cola1", (0, -1.03, 1.18)),
    ("Cola3", "Cola2", (0, -1.14, 0.92)),
    ("Cola4", "Cola3", (0, -1.24, 0.66)),
    ("Escapula_I", "Torax", (0.130, 0.26, 1.46)),
    ("Humero_I", "Escapula_I", (0.170, 0.64, 1.10)),
    ("Radio_I", "Humero_I", (0.165, 0.385, 0.84)),
    ("CanaD_I", "Radio_I", (0.160, 0.425, 0.50)),
    ("CuartillaD_I", "CanaD_I", (0.160, 0.405, 0.215)),
    ("CascoD_I", "CuartillaD_I", (0.160, 0.455, 0.085)),
    ("Femur_I", "Pelvis", (0.150, -0.68, 1.22)),
    ("Tibia_I", "Femur_I", (0.190, -0.52, 0.93)),
    ("CanaT_I", "Tibia_I", (0.185, -0.80, 0.60)),
    ("CuartillaT_I", "CanaT_I", (0.185, -0.785, 0.215)),
    ("CascoT_I", "CuartillaT_I", (0.190, -0.735, 0.085)),
]
# extremo libre de los huesos sin hijo (para pesos y dibujo)
PUNTAS = {"Cabeza": (0, 1.38, 1.60), "Oreja_I": (0.085, 1.07, 2.16), "Cola4": (0, -1.33, 0.40),
          "CascoD_I": (0.160, 0.50, 0.0), "CascoT_I": (0.190, -0.69, 0.0), "Pelvis": (0, -0.90, 1.38),
          "Torax": (0, 0.40, 1.30), "Cuerpo": (0, -0.10, 1.30), "Mov": (0, 0, 0), "Raiz": (0, 0, 0)}


def huesos():
    """Lista ordenada (padres antes que hijos): nombre, padre, articulación, punta."""
    out = []
    for n, p, j in _B:
        j = np.array(j, float)
        if n.endswith("_I"):
            out.append((n, p, j))
            out.append((n[:-1] + "D", (p[:-1] + "D") if p.endswith("_I") else p, j * [-1, 1, 1]))
        else:
            out.append((n, p, j))
    nombres = [o[0] for o in out]
    hijos = {n: [] for n in nombres}
    for n, p, j in out:
        if p:
            hijos[p].append(n)
    pos = {n: j for n, p, j in out}
    res = []
    for n, p, j in out:
        base = n[:-1] + "I" if n.endswith("_D") else n
        if base in PUNTAS:
            t = np.array(PUNTAS[base], float) * ([-1, 1, 1] if n.endswith("_D") else [1, 1, 1])
        else:
            t = pos[hijos[n][0]]
        res.append((n, p, j, t))
    return res
