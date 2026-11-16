import numpy as np, cv2, sys
from razas import Modelador, RAZAS
from vista import ver
sys.path.insert(0, '/home/claude/Caballos/arte/generador')
from render import lamina
NOMBRES = {"PuraSangre": "Pura Sangre", "Arabe": "Arabe", "CuartoDeMilla": "Cuarto de Milla", "AkhalTeke": "Akhal-Teke",
           "Appaloosa": "Appaloosa", "Criollo": "Criollo", "Andaluz": "Andaluz", "Frison": "Frison"}
PEL = {"PuraSangre": ([0.42, 0.20, 0.10], [0.06, 0.05, 0.05]), "Arabe": ([0.62, 0.61, 0.60], [0.75, 0.74, 0.72]),
       "CuartoDeMilla": ([0.55, 0.30, 0.14], [0.50, 0.26, 0.12]), "AkhalTeke": ([0.74, 0.56, 0.28], [0.20, 0.15, 0.10]),
       "Appaloosa": ([0.36, 0.22, 0.14], [0.10, 0.08, 0.07]), "Criollo": ([0.60, 0.50, 0.36], [0.10, 0.08, 0.07]),
       "Andaluz": ([0.70, 0.69, 0.67], [0.82, 0.81, 0.79]), "Frison": ([0.07, 0.07, 0.08], [0.03, 0.03, 0.04])}
def colores(mod, raza):
    cuerpo, crin = PEL[raza]
    pal = np.array([cuerpo, crin, crin, [0.14, 0.12, 0.11]])
    return pal[mod.reg]
if __name__ == '__main__':
    d = np.load('base_8000.npz'); V, F = d['V'], d['F']
    mod = Modelador(V, F)
    a, b = [], []
    for r in RAZAS:
        Vr, J, p = mod.raza(r)
        Vs = Vr * p['alzada']
        C = colores(mod, r)
        cy = (Vs[:, 1].min() + Vs[:, 1].max()) / 2
        a += ver(Vs, F, C, vistas=((90, 3),), ancho=800, alto=640, escala=235, centro=(0, cy, 1.13))
        b += ver(Vs, F, C, vistas=((48, 12),), ancho=800, alto=640, escala=235, centro=(0, cy, 1.13))
        np.save('/tmp/raza_%s.npy' % r, Vs)
    rot = [NOMBRES[r] for r in RAZAS]
    cv2.imwrite('/tmp/razas_lado.png', lamina(a, 4, rot))
    cv2.imwrite('/tmp/razas_34.png', lamina(b, 4, rot))
