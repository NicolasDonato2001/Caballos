import sys, numpy as np, cv2, time
from rig import Rig
from animacion import Animador, AIRES
from vista import ver
sys.path.insert(0, '/home/claude/Caballos/arte/generador')
from render import lamina
d = np.load('base_8000.npz'); V, F = d['V'], d['F']
rig = Rig(); orden, Wk = rig.pesos(V)
from regiones import regiones
pal = np.array([[0.50, 0.27, 0.13], [0.07, 0.06, 0.06], [0.07, 0.06, 0.06], [0.16, 0.14, 0.13]])
C = pal[regiones(V, F)]
an = Animador(rig)
aires = sys.argv[1:] or list(AIRES)
for nombre in aires:
    t = time.time()
    poses, info = an.generar(nombre, verboso=True)
    print(nombre, 'errores', {k: round(v, 5) for k, v in info['error'].items()}, 'bajar %.3f' % info['bajar'].max(), 't %.1f' % (time.time() - t))
    ims = []
    for i in range(0, 32, 4):
        rot, tras = poses[i]
        Vp = rig.deformar(V, orden, Wk, rig.matrices(rot, tras))
        ims += ver(Vp, F, C, vistas=((90, 2),), ancho=640, alto=520, escala=205, centro=(0, 0.05, 1.05))
    cv2.imwrite('/tmp/anim_%s.png' % nombre, lamina(ims, 4, ['%s %.2f' % (nombre, i / 32) for i in range(0, 32, 4)]))
