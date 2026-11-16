"""Lee caballo.glb + meta y reproduce lo que hará el juego: mezcla de raza, articulaciones por raza, animación y skinning."""
import sys, json, numpy as np, cv2
sys.path.insert(0, '/home/claude/ref'); sys.path.insert(0, '/home/claude/Caballos/arte/generador')
from ver_ref import leer_glb
from render import dibujar, lamina
D = '/home/claude/Caballos/juego/public/modelos/'
js, acc = leer_glb(D + 'caballo.glb'); meta = json.load(open(D + 'caballo_meta.json'))
pr = js['meshes'][0]['primitives'][0]
P = acc(pr['attributes']['POSITION']).astype(float); Nn = acc(pr['attributes']['NORMAL']).astype(float)
J = acc(pr['attributes']['JOINTS_0']).astype(int); W = acc(pr['attributes']['WEIGHTS_0']).astype(float)
reg = np.round(acc(pr['attributes']['COLOR_0'])[:, 0] * 10).astype(int)
T = [acc(t['POSITION']).astype(float) / 32767 for t in pr['targets']]
nodos = js['nodes']; nb = len(js['skins'][0]['joints'])
ibm = acc(js['skins'][0]['inverseBindMatrices']).reshape(nb, 4, 4).transpose(0, 2, 1)
padre = [-1] * nb
for i, n in enumerate(nodos[:nb]):
    for c in n.get('children', []): padre[c] = i
def qm(q):
    x, y, z, w = q
    return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
def pose(anim, t, comp):
    a = next(a for a in js['animations'] if a['name'] == anim)
    loc = {n['name']: np.array(n['translation']) for n in nodos[:nb]}
    for r, w in comp.items():
        pass
    tr = {n: sum(w * np.array(meta['juntasRaza'][r][n]) for r, w in comp.items()) for n in loc}
    rot = {}
    for ch in a['channels']:
        s = a['samplers'][ch['sampler']]; ti = acc(s['input']); out = acc(s['output'])
        k = int(np.searchsorted(ti, t, side='right') - 1); k = min(k, len(ti) - 2); f = (t - ti[k]) / (ti[k+1] - ti[k])
        v = out[k] * (1 - f) + out[k+1] * f
        nm = nodos[ch['target']['node']]['name']
        if ch['target']['path'] == 'rotation': rot[nm] = v / np.linalg.norm(v)
        else: tr[nm] = tr[nm] + v
    Gm = np.zeros((nb, 4, 4))
    for i in range(nb):
        nm = nodos[i]['name']; L = np.eye(4); L[:3, 3] = tr[nm]
        if nm in rot: L[:3, :3] = qm(rot[nm])
        Gm[i] = L if padre[i] < 0 else Gm[padre[i]] @ L
    return Gm
def skin(comp, anim, t):
    Pm = P + sum(w * T[meta['razas'].index(r)] for r, w in comp.items())
    M = pose(anim, t, comp) @ ibm
    h = np.c_[Pm, np.ones(len(Pm))]
    out = sum(W[:, k:k+1] * np.einsum('nij,nj->ni', M[J[:, k]], h)[:, :3] for k in range(4))
    esc = sum(w * meta['escala'][r] for r, w in comp.items())
    return out * esc
def a_gen(X): return np.stack([-X[:, 0], X[:, 2], X[:, 1]], 1)   # glTF → generador para dibujar
pal = np.array([[0.5, 0.27, 0.13], [0.07, 0.06, 0.06], [0.07, 0.06, 0.06], [0.16, 0.14, 0.13]])
Cc = pal[reg]
ims, rot = [], []
casos = [({'PuraSangre': 1}, 'Quieto', 0), ({'Frison': 1}, 'Quieto', 0), ({'Arabe': 0.5, 'CuartoDeMilla': 0.5}, 'Quieto', 0),
         ({'PuraSangre': 1}, 'Galope', 0.25), ({'Criollo': 1}, 'Trote', 0.1), ({'AkhalTeke': 1}, 'Galope', 0.6)]
for comp, anim, t in casos:
    X = a_gen(skin(comp, anim, t))
    F = np.arange(len(X)).reshape(-1, 3)
    fn = np.cross(X[F[:, 1]] - X[F[:, 0]], X[F[:, 2]] - X[F[:, 0]]); fn /= np.linalg.norm(fn, axis=1, keepdims=True) + 1e-12
    Nv = np.repeat(fn, 3, 0)
    ims.append(dibujar(X, F, Nv, Cc, az=90, el=3, ancho=760, alto=600, escala=230, centro=(0, 0.05, 1.1)))
    rot.append('%s %s t=%.2f  pie min %.3f' % ('+'.join(comp), anim, t, X[:, 2].min()))
cv2.imwrite('/tmp/glb_check.png', lamina(ims, 3, rot))
print('ok', [r for r in rot])
