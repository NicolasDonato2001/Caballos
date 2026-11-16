"""Exporta el caballo al juego: juego/public/modelos/caballo.glb + caballo_meta.json.
- Malla facetada (low poly) con 8 variantes de raza como morph targets.
- Esqueleto con pesos; los aires (Quieto, Paso, Trote, Medio, Galope) como animaciones.
- COLOR_0.r guarda la región (cuerpo/crin/cola/casco) para pintar el pelaje en el juego.
- meta: desplazamientos de articulaciones por raza (el juego los mezcla según la composición).
Ejes: generador (X, Y adelante, Z arriba) → glTF (−X, Y arriba, Z adelante): adelante = +Z."""
import json, struct, os, sys
import numpy as np
from rig import Rig
from razas import Modelador, RAZAS
from animacion import Animador, AIRES, N
from regiones import regiones

C = np.array([[-1, 0, 0], [0, 0, 1], [0, 1, 0]], float)   # gen → glTF (adelante = +Z, como espera Babylon)
g = lambda v: np.asarray(v, float) @ C.T

def quat(R):
    m = R; t = np.trace(m)
    if t > 0:
        s = np.sqrt(t + 1.0) * 2; w = 0.25 * s
        x = (m[2, 1] - m[1, 2]) / s; y = (m[0, 2] - m[2, 0]) / s; z = (m[1, 0] - m[0, 1]) / s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = np.sqrt(1 + m[0, 0] - m[1, 1] - m[2, 2]) * 2; w = (m[2, 1] - m[1, 2]) / s
        x = 0.25 * s; y = (m[0, 1] + m[1, 0]) / s; z = (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = np.sqrt(1 + m[1, 1] - m[0, 0] - m[2, 2]) * 2; w = (m[0, 2] - m[2, 0]) / s
        x = (m[0, 1] + m[1, 0]) / s; y = 0.25 * s; z = (m[1, 2] + m[2, 1]) / s
    else:
        s = np.sqrt(1 + m[2, 2] - m[0, 0] - m[1, 1]) * 2; w = (m[1, 0] - m[0, 1]) / s
        x = (m[0, 2] + m[2, 0]) / s; y = (m[1, 2] + m[2, 1]) / s; z = 0.25 * s
    q = np.array([x, y, z, w]); return q / np.linalg.norm(q)

def normales_planas(V, F):
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)

class GLB:
    def __init__(self):
        self.bin = bytearray(); self.js = dict(asset=dict(version="2.0", generator="Caballos arte/caballo/exportar.py"),
                                               bufferViews=[], accessors=[])
    def acc(self, arr, tipo, comp, target=None, minmax=False):
        arr = np.ascontiguousarray(arr)
        while len(self.bin) % 4: self.bin.append(0)
        bv = dict(buffer=0, byteOffset=len(self.bin), byteLength=arr.nbytes)
        if target: bv["target"] = target
        self.bin += arr.tobytes(); self.js["bufferViews"].append(bv)
        a = dict(bufferView=len(self.js["bufferViews"]) - 1, componentType=comp, count=len(arr), type=tipo)
        if minmax:
            a["min"] = arr.reshape(len(arr), -1).min(0).tolist(); a["max"] = arr.reshape(len(arr), -1).max(0).tolist()
        self.js["accessors"].append(a); return len(self.js["accessors"]) - 1
    def guardar(self, ruta):
        while len(self.bin) % 4: self.bin.append(0)
        self.js["buffers"] = [dict(byteLength=len(self.bin))]
        j = json.dumps(self.js, separators=(",", ":")).encode()
        while len(j) % 4: j += b" "
        out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(j) + 8 + len(self.bin))
        out += struct.pack("<I4s", len(j), b"JSON") + j + struct.pack("<I4s", len(self.bin), b"BIN\x00") + bytes(self.bin)
        open(ruta, "wb").write(out)

def main(destino):
    d = np.load(os.path.join(os.path.dirname(__file__), "base_8000.npz")); V, F = d["V"], d["F"]
    mod = Modelador(V, F); rig = mod.rig
    orden, Wk = mod.orden, mod.Wk
    reg = regiones(V, F)
    nb = len(rig.nombres)
    # ---- razas: vértices y articulaciones
    razas = list(RAZAS)
    Jbase = rig.reposo.copy()
    formas, juntas, alzada = {}, {}, {}
    for r in razas:
        Vr, Jn, p = mod.raza(r)
        dJ = Jn - Jbase
        Vm = Vr - np.einsum("nk,nkj->nj", Wk, dJ[orden])     # compensa el corrimiento de articulaciones (ver meta)
        formas[r], juntas[r], alzada[r] = Vm, Jn, p["alzada"]
    # ---- malla facetada
    Fv = F.reshape(-1)
    Pb = g(V[Fv]).astype(np.float32)
    Nb = np.repeat(g(normales_planas(V, F)), 3, 0).astype(np.float32)
    col = np.zeros((len(Fv), 4), np.float32); col[:, 0] = np.repeat(reg, 3) / 10.0; col[:, 3] = 1
    J0 = orden[Fv].astype(np.uint16); W0 = Wk[Fv].astype(np.float32)
    W0 /= W0.sum(1, keepdims=True)
    idx = np.arange(len(Fv), dtype=np.uint16)
    G = GLB()
    attrs = dict(POSITION=G.acc(Pb, "VEC3", 5126, 34962, True), NORMAL=G.acc(Nb, "VEC3", 5126, 34962),
                 COLOR_0=G.acc(col, "VEC4", 5126, 34962), JOINTS_0=G.acc(J0, "VEC4", 5123, 34962), WEIGHTS_0=G.acc(W0, "VEC4", 5126, 34962))
    targets = []
    for r in razas:
        P = g(formas[r][Fv]) - Pb
        Nn = np.repeat(g(normales_planas(formas[r], F)), 3, 0) - Nb
        # KHR_mesh_quantization: desplazamientos en int16 normalizado (precisión 0,03 mm; todos los |Δ| < 1)
        assert np.abs(P).max() < 1.0
        qp = np.round(P * 32767).astype(np.int16); qn = np.round(np.clip(Nn, -1, 1) * 32767).astype(np.int16)
        ip = G.acc(qp, "VEC3", 5122, None, True); G.js["accessors"][ip]["normalized"] = True
        G.js["accessors"][ip]["min"] = (qp.min(0) / 32767).tolist(); G.js["accessors"][ip]["max"] = (qp.max(0) / 32767).tolist()
        inn = G.acc(qn, "VEC3", 5122); G.js["accessors"][inn]["normalized"] = True
        targets.append(dict(POSITION=ip, NORMAL=inn))
    G.js["extensionsUsed"] = ["KHR_mesh_quantization"]; G.js["extensionsRequired"] = ["KHR_mesh_quantization"]
    G.js["materials"] = [dict(name="Pelaje", pbrMetallicRoughness=dict(baseColorFactor=[1, 1, 1, 1], metallicFactor=0, roughnessFactor=0.78))]
    G.js["meshes"] = [dict(name="Caballo", primitives=[dict(attributes=attrs, indices=G.acc(idx, "SCALAR", 5123, 34963), material=0, targets=targets)],
                           weights=[0] * len(razas), extras=dict(targetNames=razas))]
    # ---- nodos: huesos (0..nb-1) + nodo de la malla
    nodos = []
    for i, n in enumerate(rig.nombres):
        pa = rig.padre[i]
        loc = Jbase[i] - (Jbase[pa] if pa >= 0 else 0)
        nodos.append(dict(name=n, translation=g(loc).tolist()))
    for i in range(nb):
        hijos = [k for k in range(nb) if rig.padre[k] == i]
        if hijos: nodos[i]["children"] = hijos
    nodos.append(dict(name="Caballo", mesh=0, skin=0))
    G.js["nodes"] = nodos
    ibm = np.zeros((nb, 4, 4), np.float32)
    for i in range(nb):
        M = np.eye(4); M[:3, 3] = -g(Jbase[i]); ibm[i] = M.T          # column-major
    G.js["skins"] = [dict(name="Esqueleto", joints=list(range(nb)), skeleton=0, inverseBindMatrices=G.acc(ibm.reshape(nb, 16), "MAT4", 5126))]
    G.js["scenes"] = [dict(nodes=[0, nb])]; G.js["scene"] = 0
    # ---- animaciones
    an = Animador(rig)
    ciclos = {"Quieto": (an.quieto(), 4.0)}
    for a in AIRES:
        poses, info = an.generar(a)
        ciclos[a] = (poses, 1.0)
        print(a, "error máx de pisada %.3f m" % max(info["error"].values()))
    anims = []
    for nombre, (poses, dur) in ciclos.items():
        n = len(poses)
        t = (np.arange(n + 1) / n * dur).astype(np.float32)
        ta = G.acc(t, "SCALAR", 5126, None, True)
        canales, samplers = [], []
        for i, hn in enumerate(rig.nombres):
            if hn == "Raiz": continue
            q = np.array([quat(C @ __import__("rig").euler(*poses[k % n][0].get(hn, (0, 0, 0))) @ C.T) for k in range(n + 1)])
            for k in range(1, len(q)):
                if q[k] @ q[k - 1] < 0: q[k] = -q[k]
            samplers.append(dict(input=ta, output=G.acc(q.astype(np.float32), "VEC4", 5126), interpolation="LINEAR"))
            canales.append(dict(sampler=len(samplers) - 1, target=dict(node=i, path="rotation")))
        im = rig.idx["Mov"]
        tr = np.array([g(poses[k % n][1].get("Mov", (0, 0, 0))) for k in range(n + 1)], np.float32)
        samplers.append(dict(input=ta, output=G.acc(tr, "VEC3", 5126), interpolation="LINEAR"))
        canales.append(dict(sampler=len(samplers) - 1, target=dict(node=im, path="translation")))
        anims.append(dict(name=nombre, samplers=samplers, channels=canales))
    G.js["animations"] = anims
    os.makedirs(destino, exist_ok=True)
    G.guardar(os.path.join(destino, "caballo.glb"))
    # ---- meta
    def locales(J):
        return {n: g(J[i] - (J[rig.padre[i]] if rig.padre[i] >= 0 else 0)).round(5).tolist() for i, n in enumerate(rig.nombres)}
    meta = dict(version="caballo-1.0", origen="Modelo base: 'Low Poly Horse Standing' (LowPolyFigures, CC BY 4.0), modificado.",
                razas=razas, escala=alzada, zancada={a: AIRES[a]["zancada"] for a in AIRES}, ciclo=1.0,
                juntasBase=locales(Jbase), juntasRaza={r: locales(juntas[r]) for r in razas},
                regiones=dict(cuerpo=0, crin=1, cola=2, casco=3))
    json.dump(meta, open(os.path.join(destino, "caballo_meta.json"), "w"), ensure_ascii=False)
    print("GLB", os.path.getsize(os.path.join(destino, "caballo.glb")) // 1024, "KB,", len(Fv), "vértices,", len(F), "caras")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/home/claude/Caballos/juego/public/modelos")
