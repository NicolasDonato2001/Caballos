import sys, numpy as np, cv2
sys.path.insert(0, '/home/claude/Caballos/arte/generador')
from render import dibujar, lamina

def plano(V, F, C=None):
    """Vértices duplicados por cara, normales planas (aspecto facetado)."""
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-12)
    Vf = V[F].reshape(-1, 3)
    Ff = np.arange(len(Vf)).reshape(-1, 3)
    Nf = np.repeat(fn, 3, axis=0)
    if C is None:
        Cf = np.tile([0.5, 0.3, 0.17], (len(Vf), 1))
    elif C.shape[0] == len(F):
        Cf = np.repeat(C, 3, axis=0)
    else:
        Cf = C[F].reshape(-1, 3)
    return Vf, Ff, Nf, Cf

def ver(V, F, C=None, vistas=((90, 3), (50, 12)), **kw):
    Vf, Ff, Nf, Cf = plano(V, F, C)
    kw.setdefault('ancho', 900); kw.setdefault('alto', 760)
    return [dibujar(Vf, Ff, Nf, Cf, az=a, el=e, **kw) for a, e in vistas]
