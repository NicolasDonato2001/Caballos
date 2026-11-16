# -*- coding: utf-8 -*-
"""
GENERADOR DE CABALLOS — Proyecto Caballos, Fase 2.
Se ejecuta con Blender en modo fondo (ver generar.bat):
    blender -b -P generar_caballos.py

Crea, 100 % por código y sin assets externos:
  * Una malla low-poly de caballo (cuerpo, crin, cola, orejas, ojos, cascos).
  * 8 variantes de raza como SHAPE KEYS sobre la MISMA topología (GDD §10.4).
  * Un esqueleto con pesos calculados por distancia a los huesos (sin "heat weighting", que falla seguido).
  * Animaciones en el lugar: Quieto, Paso, Trote, Medio (galope corto), Galope. Un ciclo = 24 cuadros = 1 s a 24 fps.
  * Exporta  juego/public/modelos/caballo.glb
  * Renderiza vistas de control en  arte/previews/*.png

Convenciones: Blender Z arriba, el caballo mira hacia +Y (en el juego queda mirando a +Z).
Cada hueso tiene su eje X local = eje X del mundo (lateral): todos los movimientos de marcha son rotaciones en X.
Ángulo positivo en X = la parte inferior del hueso se mueve hacia ADELANTE.
"""
import bpy, bmesh, math, os, sys, json
from mathutils import Vector, Matrix

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, "..", ".."))
SALIDA_GLB = os.path.join(RAIZ, "juego", "public", "modelos", "caballo.glb")
SALIDA_PREV = os.path.join(RAIZ, "arte", "previews")
FPS = 24
CICLO = 24  # cuadros por zancada

def log(*a):
    print("[caballos]", *a, flush=True)

# -----------------------------------------------------------------------------
# 1) ANATOMÍA BASE: grafo de nodos (posición, radio lateral, radio vertical)
# -----------------------------------------------------------------------------
# Medidas en metros. Altura a la cruz ≈ 1,60 m. Largo ≈ 2,4 m.
def anatomia(p):
    """Devuelve nodos {nombre: (x,y,z, rx, rz)} y aristas para una raza con parámetros p."""
    L, N, G, H, C, P = p["patas"], p["cuello"], p["grosor"], p["cabeza"], p["grupa"], p["huesoPata"]
    cuello_grosor = p.get("cuelloGrosor", 1.0)
    largo = p.get("largo", 1.0)
    alto_cuerpo = 1.27 + (L - 1.0) * 0.9   # centro del tronco; cruz ≈ 1,60 m. Patas más largas → cuerpo más alto
    yb = lambda y: y * largo                 # largo del tronco
    n = {}
    # Tronco (de atrás hacia adelante)
    n["colaRaiz"] = (0, yb(-0.86), alto_cuerpo + 0.12, 0.15 * G, 0.15 * G)
    n["grupa"]    = (0, yb(-0.60), alto_cuerpo + 0.06, 0.29 * G * C, 0.30 * G * C)
    n["lomo"]     = (0, yb(-0.22), alto_cuerpo + 0.00, 0.31 * G, 0.32 * G)
    n["espalda"]  = (0, yb(0.16),  alto_cuerpo - 0.01, 0.32 * G, 0.33 * G)
    n["cruz"]     = (0, yb(0.50),  alto_cuerpo + 0.04, 0.28 * G, 0.31 * G)
    n["pecho"]    = (0, yb(0.78),  alto_cuerpo - 0.10, 0.24 * G, 0.27 * G)
    # Cuello y cabeza
    ang = math.radians(p.get("anguloCuello", 52))      # inclinación del cuello sobre la horizontal
    base = Vector((0, yb(0.70), alto_cuerpo + 0.10))   # el cuello nace sobre la cruz/pecho, no delante
    d = Vector((0, math.cos(ang), math.sin(ang)))
    lc = 0.80 * N
    for i, (nom, t, rx, rz) in enumerate([("cuello1", 0.22, 0.20, 0.27), ("cuello2", 0.58, 0.15, 0.20), ("nuca", 0.94, 0.11, 0.13)]):
        q = base + d * (lc * t)
        k = cuello_grosor * (G ** 0.5)
        n[nom] = (0, q.y, q.z, rx * k, rz * k)
    nuca = Vector(n["nuca"][:3])
    hd = Vector((0, math.cos(math.radians(-52)), math.sin(math.radians(-52))))  # la cabeza baja hacia adelante
    lh = 0.64 * H
    for nom, t, rx, rz in [("frente", 0.16, 0.115, 0.14), ("cara", 0.55, 0.095, 0.115), ("hocico", 0.93, 0.085, 0.095)]:
        q = nuca + hd * (lh * t)
        n[nom] = (0, q.y, q.z, rx * H, rz * H)
    # Manos (patas delanteras) y patas traseras
    for lado, sx in (("I", 1), ("D", -1)):
        x = 0.16 * sx * (G ** 0.5)
        y0 = yb(0.66)
        n["hombro" + lado] = (x, y0 + 0.02, alto_cuerpo - 0.12, 0.12 * G, 0.14 * G)
        n["codo" + lado]   = (x, y0 - 0.05, alto_cuerpo - 0.32, 0.095 * P, 0.10 * P)
        n["rodilla" + lado]= (x, y0 + 0.00, 0.53 * L, 0.062 * P, 0.07 * P)
        n["menudilloD" + lado] = (x, y0 + 0.02, 0.17 * L, 0.05 * P * p.get("cerneja", 1.0), 0.055 * P * p.get("cerneja", 1.0))
        n["cascoD" + lado] = (x, y0 + 0.06, 0.035, 0.058 * P, 0.05 * P)
        y1 = yb(-0.58)
        n["cadera" + lado] = (x * 1.08, y1, alto_cuerpo - 0.05, 0.16 * G * C, 0.17 * G * C)
        n["babilla" + lado]= (x * 1.10, y1 + 0.16, alto_cuerpo - 0.40, 0.12 * G * C, 0.13 * G * C)
        n["corvejon" + lado]=(x, y1 - 0.20, 0.56 * L, 0.068 * P, 0.075 * P)
        n["menudilloT" + lado] = (x, y1 - 0.14, 0.17 * L, 0.05 * P * p.get("cerneja", 1.0), 0.055 * P * p.get("cerneja", 1.0))
        n["cascoT" + lado] = (x, y1 - 0.12, 0.035, 0.058 * P, 0.05 * P)
    aristas = [("colaRaiz", "grupa"), ("grupa", "lomo"), ("lomo", "espalda"), ("espalda", "cruz"), ("cruz", "pecho"),
               ("pecho", "cuello1"), ("cuello1", "cuello2"), ("cuello2", "nuca"), ("nuca", "frente"), ("frente", "cara"), ("cara", "hocico")]
    for lado in "ID":
        aristas += [("pecho", "hombro" + lado), ("hombro" + lado, "codo" + lado), ("codo" + lado, "rodilla" + lado),
                    ("rodilla" + lado, "menudilloD" + lado), ("menudilloD" + lado, "cascoD" + lado),
                    ("grupa", "cadera" + lado), ("cadera" + lado, "babilla" + lado), ("babilla" + lado, "corvejon" + lado),
                    ("corvejon" + lado, "menudilloT" + lado), ("menudilloT" + lado, "cascoT" + lado)]
    return n, aristas

# Parámetros por raza (1,0 = base). Proporciones, no colores: el pelaje lo pinta el juego según la genética.
BASE = dict(patas=1.0, cuello=1.0, grosor=1.0, cabeza=1.0, grupa=1.0, huesoPata=1.0, largo=1.0, anguloCuello=52)
RAZAS = {
    "PuraSangre":    dict(patas=1.07, cuello=1.08, grosor=0.90, cabeza=0.97, grupa=0.96, huesoPata=0.90, largo=1.05, anguloCuello=46),
    "Arabe":         dict(patas=0.99, cuello=1.02, grosor=0.90, cabeza=0.84, grupa=0.95, huesoPata=0.88, largo=0.93, anguloCuello=58),
    "CuartoDeMilla": dict(patas=0.95, cuello=0.90, grosor=1.08, cabeza=0.95, grupa=1.20, huesoPata=1.05, largo=0.96, anguloCuello=44),
    "AkhalTeke":     dict(patas=1.08, cuello=1.18, grosor=0.84, cabeza=0.98, grupa=0.92, huesoPata=0.86, largo=1.07, anguloCuello=60, cuelloGrosor=0.85),
    "Appaloosa":     dict(patas=1.00, cuello=1.00, grosor=1.00, cabeza=1.00, grupa=1.02, huesoPata=1.00, largo=1.00, anguloCuello=50),
    "Criollo":       dict(patas=0.93, cuello=0.95, grosor=1.06, cabeza=1.02, grupa=1.05, huesoPata=1.08, largo=0.97, anguloCuello=48, cuelloGrosor=1.10),
    "Andaluz":       dict(patas=0.99, cuello=1.00, grosor=1.05, cabeza=1.00, grupa=1.08, huesoPata=1.02, largo=0.98, anguloCuello=62, cuelloGrosor=1.22, crin=1.45),
    "Frison":        dict(patas=1.02, cuello=1.02, grosor=1.12, cabeza=1.04, grupa=1.08, huesoPata=1.20, largo=1.02, anguloCuello=64, cuelloGrosor=1.25, cerneja=1.55, crin=1.6),
}
# Escala global por raza (alzada). Se aplica en el juego, no en la malla, para no despegar los cascos del suelo.
ESCALA = {"PuraSangre": 1.03, "Arabe": 0.94, "CuartoDeMilla": 0.97, "AkhalTeke": 1.01, "Appaloosa": 0.98,
          "Criollo": 0.94, "Andaluz": 0.99, "Frison": 1.05}

def params(nombre=None):
    p = dict(BASE)
    if nombre:
        p.update(RAZAS[nombre])
    return p

# -----------------------------------------------------------------------------
# 2) MALLAS
# -----------------------------------------------------------------------------
def limpiar():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def malla_skin(nombre, nodos, aristas, raiz, subdiv=1):
    """Crea una malla por Skin modifier (+ subdivisión) y la devuelve ya evaluada (modificadores aplicados)."""
    nombres = list(nodos.keys())
    idx = {k: i for i, k in enumerate(nombres)}
    me = bpy.data.meshes.new(nombre + "_grafo")
    me.from_pydata([nodos[k][:3] for k in nombres], [(idx[a], idx[b]) for a, b in aristas], [])
    ob = bpy.data.objects.new(nombre + "_grafo", me)
    bpy.context.scene.collection.objects.link(ob)
    sk = ob.modifiers.new("Skin", "SKIN")
    sk.branch_smoothing = 0.6
    sk.use_smooth_shade = False
    capa = me.skin_vertices[0].data
    for k, i in idx.items():
        capa[i].radius = (nodos[k][3], nodos[k][4])
        capa[i].use_root = (k == raiz)
    if subdiv:
        sd = ob.modifiers.new("Sub", "SUBSURF")
        sd.levels = subdiv
        sd.render_levels = subdiv
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    nueva = bpy.data.meshes.new_from_object(ev)
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    return nueva

def crin_y_cola(n, p):
    """Nodos de la crin (sobre el cuello) y la cola, como cadenas aparte."""
    largo_crin = p.get("crin", 1.0)
    crin = {}
    # La crin sigue la cresta: puntos sobre la parte superior del cuello (nuca → cuello2 → cuello1 → cruz)
    cadena = ["nuca", "cuello2", "cuello1", "cruz"]
    pts = []
    for a, b in zip(cadena, cadena[1:]):
        for t in (0.0, 0.5):
            A, B = Vector(n[a][:3]), Vector(n[b][:3])
            ra, rb = n[a][4], n[b][4]
            q = A.lerp(B, t)
            dirc = (B - A).normalized()
            arriba = Vector((0, -dirc.z, dirc.y))
            if arriba.z < 0: arriba = -arriba
            pts.append(q + arriba * ((ra + (rb - ra) * t) * 0.88))
    pts.append(Vector(n["cruz"][:3]) + Vector((0, 0.0, n["cruz"][4] * 0.9)))
    for i, q in enumerate(pts):
        u = i / (len(pts) - 1)
        crin["c%d" % i] = (0, q.y, q.z, 0.022, (0.035 + 0.035 * math.sin(math.pi * min(1, u * 1.3))) * largo_crin)
    pasos = len(pts) - 1
    tope = Vector(n["frente"][:3]) + Vector((0, 0.02, n["frente"][4] * 0.95))
    crin["copete"] = (0, tope.y, tope.z, 0.025, 0.04)
    aristas_crin = [("c%d" % i, "c%d" % (i + 1)) for i in range(pasos)] + [("c0", "copete")]
    r = Vector(n["colaRaiz"][:3])
    cola = {}
    puntos = [(0.06, 0.04, 0.045, 0.045), (-0.06, -0.06, 0.06, 0.06), (-0.14, -0.30, 0.085, 0.08), (-0.18, -0.58, 0.10, 0.09), (-0.19, -0.82, 0.08, 0.07)]
    for i, (dy, dz, rx, rz) in enumerate(puntos):
        cola["t%d" % i] = (0, r.y + dy, r.z + dz, rx, rz)
    aristas_cola = [("t%d" % i, "t%d" % (i + 1)) for i in range(len(puntos) - 1)]
    return crin, aristas_crin, cola, aristas_cola

def crear_objeto(nombre, me, material):
    ob = bpy.data.objects.new(nombre, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(material)
    for poly in me.polygons:
        poly.use_smooth = False   # facetado (low-poly)
    return ob

def material(nombre, rgb, rough=0.8):
    m = bpy.data.materials.new(nombre)
    if hasattr(m, "use_nodes") and not m.use_nodes:
        m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*rgb, 1)
        bsdf.inputs["Roughness"].default_value = rough
    m.diffuse_color = (*rgb, 1)
    return m

def _marco(a, b):
    e1 = (b - a)
    largo = max(e1.length, 1e-6)
    e1 = e1 / largo
    ref = Vector((1, 0, 0)) if abs(e1.x) < 0.9 else Vector((0, 0, 1))
    e2 = (ref - e1 * ref.dot(e1)).normalized()
    e3 = e1.cross(e2)
    return e1, e2, e3, largo

def deformar_hacia(coords, n0, aristas, n1, extra=1.0):
    """Lleva cada vértice de la malla base a la anatomía n1 siguiendo su tramo de esqueleto más cercano.
    Conserva la topología (misma cantidad y orden de vértices) → las razas son shape keys compatibles."""
    tramos = []
    for a, b in aristas:
        A0, B0, A1, B1 = Vector(n0[a][:3]), Vector(n0[b][:3]), Vector(n1[a][:3]), Vector(n1[b][:3])
        f0, f1 = _marco(A0, B0), _marco(A1, B1)
        tramos.append((A0, B0, A1, B1, f0, f1, n0[a], n0[b], n1[a], n1[b]))
    salida = []
    for p in coords:
        cand = []
        for tr in tramos:
            A0, B0 = tr[0], tr[1]
            ab = B0 - A0
            t = max(0.0, min(1.0, (p - A0).dot(ab) / max(ab.length_squared, 1e-9)))
            q = A0 + ab * t
            cand.append(((p - q).length, t, tr))
        cand.sort(key=lambda c: c[0])
        acum, wsum = Vector((0, 0, 0)), 0.0
        for d, t, tr in cand[:2]:
            A0, B0, A1, B1, f0, f1, na0, nb0, na1, nb1 = tr
            e1, e2, e3, L0 = f0
            g1, g2, g3, L1 = f1
            q0 = A0 + (B0 - A0) * t
            off = p - q0
            o1, o2, o3 = off.dot(e1), off.dot(e2), off.dot(e3)
            rx0 = na0[3] + (nb0[3] - na0[3]) * t; rz0 = na0[4] + (nb0[4] - na0[4]) * t
            rx1 = na1[3] + (nb1[3] - na1[3]) * t; rz1 = na1[4] + (nb1[4] - na1[4]) * t
            k2 = rx1 / max(rx0, 1e-4); k3 = rz1 / max(rz0, 1e-4)
            km = (k2 + k3) / 2
            q1 = A1 + (B1 - A1) * t
            nuevo = q1 + g1 * o1 + g2 * (o2 * km * extra) + g3 * (o3 * km * extra)
            w = 1.0 / max(d, 0.01) ** 4
            acum += nuevo * w; wsum += w
        salida.append(acum / wsum)
    return salida

# -----------------------------------------------------------------------------
# 3) ESQUELETO
# -----------------------------------------------------------------------------
def huesos_desde(n):
    """Lista de huesos (nombre, cabeza, cola, padre)."""
    V = lambda k: Vector(n[k][:3])
    centro = (V("lomo") + V("espalda")) / 2
    hs = [
        ("Raiz", Vector((0, 0, 0)), Vector((0, 0.35, 0)), None),
        ("Cuerpo", centro, centro + Vector((0, 0.25, 0)), "Raiz"),
        ("Grupa", centro, V("grupa"), "Cuerpo"),
        ("Torax", centro + Vector((0, 0.25, 0)), V("cruz"), "Cuerpo"),
        ("Cuello1", V("pecho") + Vector((0, 0.06, 0.18)), V("cuello2"), "Torax"),
        ("Cuello2", V("cuello2"), V("nuca"), "Cuello1"),
        ("Cabeza", V("nuca"), V("hocico"), "Cuello2"),
        ("Cola1", V("colaRaiz"), V("colaRaiz") + Vector((0, -0.14, -0.24)), "Grupa"),
        ("Cola2", V("colaRaiz") + Vector((0, -0.14, -0.24)), V("colaRaiz") + Vector((0, -0.22, -0.60)), "Cola1"),
        ("Cola3", V("colaRaiz") + Vector((0, -0.22, -0.60)), V("colaRaiz") + Vector((0, -0.25, -0.95)), "Cola2"),
    ]
    for l in "ID":
        hs += [
            ("Hombro" + l, V("hombro" + l), V("codo" + l), "Torax"),
            ("Antebrazo" + l, V("codo" + l), V("rodilla" + l), "Hombro" + l),
            ("CanaD" + l, V("rodilla" + l), V("menudilloD" + l), "Antebrazo" + l),
            ("CuartillaD" + l, V("menudilloD" + l), V("cascoD" + l), "CanaD" + l),
            ("Muslo" + l, V("cadera" + l), V("babilla" + l), "Grupa"),
            ("Pierna" + l, V("babilla" + l), V("corvejon" + l), "Muslo" + l),
            ("CanaT" + l, V("corvejon" + l), V("menudilloT" + l), "Pierna" + l),
            ("CuartillaT" + l, V("menudilloT" + l), V("cascoT" + l), "CanaT" + l),
        ]
    return hs

def crear_esqueleto(n):
    arm = bpy.data.armatures.new("Esqueleto")
    ob = bpy.data.objects.new("Esqueleto", arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.edit_bones
    for nom, cab, col, padre in huesos_desde(n):
        b = eb.new(nom)
        b.head, b.tail = cab, col
        d = (col - cab).normalized()
        # Eje Z del hueso en el plano sagital y perpendicular al hueso → eje X local = X del mundo.
        b.align_roll(Vector((0, -d.z, d.y)) if abs(d.x) < 0.9 else Vector((0, 0, 1)))
        if padre:
            b.parent = eb[padre]
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in ob.pose.bones:
        pb.rotation_mode = "XYZ"
    return ob

def dist_segmento(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (p - (a + ab * t)).length

def pesar(malla_ob, esq_ob, region=None):
    """Pesos por cercanía a los huesos (2 influencias), respetando lado izquierdo/derecho."""
    huesos = [(b.name, b.head_local.copy(), b.tail_local.copy()) for b in esq_ob.data.bones if b.name != "Raiz"]
    grupos = {h[0]: malla_ob.vertex_groups.new(name=h[0]) for h in huesos}
    for v in malla_ob.data.vertices:
        p = v.co
        cand = []
        for nom, a, b in huesos:
            if region and not region(nom):
                continue
            lado = nom[-1] if nom[-1] in "ID" and nom not in ("Cuerpo",) and nom[:-1] in (
                "Hombro", "Antebrazo", "CanaD", "CuartillaD", "Muslo", "Pierna", "CanaT", "CuartillaT") else None
            if lado == "I" and p.x < -0.02: continue
            if lado == "D" and p.x > 0.02: continue
            cand.append((dist_segmento(p, a, b), nom))
        cand.sort()
        top = cand[:2]
        ws = [1.0 / max(d, 0.02) ** 4 for d, _ in top]
        s = sum(ws)
        for (d, nom), w in zip(top, ws):
            grupos[nom].add([v.index], w / s, "REPLACE")
    mod = malla_ob.modifiers.new("Esqueleto", "ARMATURE")
    mod.object = esq_ob
    malla_ob.parent = esq_ob

# -----------------------------------------------------------------------------
# 4) ANIMACIONES (en el lugar). +X = la punta del hueso hacia adelante.
# -----------------------------------------------------------------------------
AIRES = {
    #          amplitud hombro/cadera, flexión, desfasajes (MI, MD, PI, PD), rebote, cabeceo
    "Paso":   dict(A=0.26, F=0.55, fases=dict(MI=0.25, MD=0.75, PI=0.0, PD=0.5), bote=0.015, cab=0.05, vuelo=0.0),
    "Trote":  dict(A=0.34, F=0.85, fases=dict(MI=0.0, MD=0.5, PI=0.5, PD=0.0), bote=0.04, cab=0.02, vuelo=0.0),
    "Medio":  dict(A=0.44, F=0.95, fases=dict(MI=0.30, MD=0.62, PI=0.0, PD=0.30), bote=0.06, cab=0.10, vuelo=0.0),
    "Galope": dict(A=0.55, F=1.10, fases=dict(MI=0.50, MD=0.60, PI=0.0, PD=0.10), bote=0.08, cab=0.14, vuelo=0.04),
}

def poner(esq, hueso, ang, f):
    pb = esq.pose.bones[hueso]
    pb.rotation_euler = (ang, 0, 0)
    pb.keyframe_insert("rotation_euler", frame=f)

def pose_reposo(esq):
    for pb in esq.pose.bones:
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)

def accion(esq, nombre):
    if esq.animation_data is None:
        esq.animation_data_create()
    pose_reposo(esq)
    act = bpy.data.actions.new(nombre)
    act.use_fake_user = True
    esq.animation_data.action = act
    return act

def animar_aire(esq, nombre, a):
    act = accion(esq, nombre)
    for f in range(0, CICLO + 1, 2):
        ph = (f % CICLO) / CICLO
        for pata, fase in a["fases"].items():
            c = 2 * math.pi * ((ph - fase) % 1.0)
            # Apoyo (c en 0..π): la pata barre de adelante (+A) hacia atrás (−A). Vuelo (π..2π): vuelve y se flexiona.
            barrido = a["A"] * math.cos(c)
            flex = a["F"] * max(0.0, -math.sin(c))
            carga = max(0.0, math.sin(c))           # apoyo pleno a mitad del apoyo
            l = "I" if pata[1] == "I" else "D"
            if pata[0] == "M":   # mano
                poner(esq, "Hombro" + l, barrido * 0.55, f)
                poner(esq, "Antebrazo" + l, barrido * 0.45 + flex * 0.25, f)
                poner(esq, "CanaD" + l, -flex * 0.95, f)
                poner(esq, "CuartillaD" + l, -flex * 0.45 + 0.18 * carga, f)
            else:                # pata trasera
                poner(esq, "Muslo" + l, barrido * 0.70, f)
                poner(esq, "Pierna" + l, -flex * 0.55 + barrido * 0.2, f)
                poner(esq, "CanaT" + l, flex * 0.75, f)
                poner(esq, "CuartillaT" + l, -flex * 0.35 + 0.15 * carga, f)
        k = 2 * math.pi * ph
        # Rebote del cuerpo (dos por ciclo en paso/trote, uno en galope) y balanceo de columna
        rebotes = 1 if nombre in ("Medio", "Galope") else 2
        cu = esq.pose.bones["Cuerpo"]
        cu.location = (0, 0, a["bote"] * abs(math.sin(k * rebotes / 1)) - a["bote"] * 0.5)
        cu.keyframe_insert("location", frame=f)
        poner(esq, "Cuerpo", (a["vuelo"] * math.sin(k)), f)
        poner(esq, "Grupa", a["vuelo"] * 0.8 * math.sin(k + 0.6), f)
        poner(esq, "Cuello1", a["cab"] * math.sin(k * (2 if nombre == "Paso" else 1) + 1.2), f)
        poner(esq, "Cabeza", -a["cab"] * 0.6 * math.sin(k * (2 if nombre == "Paso" else 1) + 1.6), f)
        poner(esq, "Cola1", -0.35 - a["A"] * 0.5 + 0.05 * math.sin(k * 2), f)
        poner(esq, "Cola2", 0.10 * math.sin(k * 2 + 0.8), f)
    return act

def animar_quieto(esq):
    act = accion(esq, "Quieto")
    T = 96  # 4 s
    for f in range(0, T + 1, 4):
        k = 2 * math.pi * f / T
        for pb in esq.pose.bones:   # todas las articulaciones en reposo (define la pose de pie)
            if pb.name not in ("Cuello1", "Cabeza", "Cola1", "Cola2", "Cuerpo", "Raiz"):
                poner(esq, pb.name, 0.0, f)
        poner(esq, "Cuello1", 0.03 * math.sin(k), f)
        poner(esq, "Cabeza", 0.04 * math.sin(k * 2 + 0.5), f)
        poner(esq, "Cola1", -0.15 + 0.06 * math.sin(k * 3), f)
        poner(esq, "Cola2", 0.08 * math.sin(k * 3 + 1.0), f)
        cu = esq.pose.bones["Cuerpo"]
        cu.location = (0, 0, 0.006 * math.sin(k * 2))
        cu.keyframe_insert("location", frame=f)
    return act

def curvas(act):
    """F-curves de una acción, en Blender clásico (act.fcurves) o con acciones por capas (4.4+ / 5.x)."""
    res = []
    try:
        res.extend(act.fcurves)
    except (AttributeError, TypeError):
        pass
    try:
        for capa in act.layers:
            for tira in capa.strips:
                for bolsa in tira.channelbags:
                    res.extend(bolsa.fcurves)
    except (AttributeError, TypeError):
        pass
    return res

def ciclos_lineales():
    # Curvas lineales: el ciclo empalma sin frenadas en los extremos
    for act in bpy.data.actions:
        for fc in curvas(act):
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"

# -----------------------------------------------------------------------------
# 5) EXPORTACIÓN Y VISTAS PREVIAS
# -----------------------------------------------------------------------------
def exportar(ruta):
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    opciones = dict(filepath=ruta, export_format="GLB", export_animations=True, export_animation_mode="ACTIONS",
                    export_morph=True, export_skins=True, export_apply=False, export_yup=True,
                    export_force_sampling=True, export_frame_range=False)
    while True:
        try:
            bpy.ops.export_scene.gltf(**opciones)
            return
        except TypeError as e:
            # Versiones distintas de Blender aceptan opciones distintas: se quita la que falla y se reintenta
            msg = str(e)
            quitada = next((k for k in list(opciones) if k != "filepath" and k in msg), None)
            if not quitada:
                raise
            log("opción no soportada, se omite:", quitada)
            opciones.pop(quitada)

def camara_lateral(alto=1.05, dist=7.0, ortho=3.9):
    cam_d = bpy.data.cameras.new("Cam")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = ortho
    cam = bpy.data.objects.new("Cam", cam_d)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = (dist, 0.25, alto)
    cam.rotation_euler = (math.radians(90), 0, math.radians(90))
    bpy.context.scene.camera = cam
    return cam

def preparar_render():
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "MATERIAL"
    sc.display.shading.show_shadows = True
    sc.display.shading.show_cavity = True
    sc.render.resolution_x, sc.render.resolution_y = 900, 700
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "PNG"

def render(nombre):
    os.makedirs(SALIDA_PREV, exist_ok=True)
    bpy.context.scene.render.filepath = os.path.join(SALIDA_PREV, nombre + ".png")
    bpy.ops.render.render(write_still=True)

# -----------------------------------------------------------------------------
# 6) PROGRAMA
# -----------------------------------------------------------------------------
def main():
    limpiar()
    sc = bpy.context.scene
    sc.render.fps = FPS
    m_pelo = material("Pelaje", (0.42, 0.25, 0.14), 0.75)
    m_crin = material("Crin", (0.08, 0.06, 0.05), 0.9)
    m_ojo = material("Ojos", (0.02, 0.02, 0.02), 0.2)

    n0, ar0 = anatomia(params())
    # --- Cuerpo base + shape keys por raza (misma topología)
    cuerpo_me = malla_skin("Cuerpo", n0, ar0, "espalda")
    cuerpo = crear_objeto("Cuerpo", cuerpo_me, m_pelo)
    crin0, acr, cola0, aco = crin_y_cola(n0, params())
    crin = crear_objeto("Crin", malla_skin("Crin", crin0, acr, "c3"), m_crin)
    cola = crear_objeto("Cola", malla_skin("Cola", cola0, aco, "t0"), m_crin)
    errores = []
    # --- Orejas y ojos (piezas rígidas que siguen a la cabeza)
    piezas = []
    frente = Vector(n0["frente"][:3])
    for sx in (1, -1):
        bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.045, radius2=0.0, depth=0.17,
                                        location=frente + Vector((0.055 * sx, -0.07, 0.14)), rotation=(math.radians(-15), math.radians(8 * sx), 0))
        o = bpy.context.active_object; o.name = "Oreja"; o.data.materials.append(m_pelo); piezas.append(o)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.028, location=frente + Vector((0.095 * sx, 0.05, 0.01)))
        o = bpy.context.active_object; o.name = "Ojo"; o.data.materials.append(m_ojo); piezas.append(o)
    # unir orejas y ojos al cuerpo no: quedan como un objeto "Cabeza" rígido
    bpy.ops.object.select_all(action="DESELECT")
    for o in piezas: o.select_set(True)
    bpy.context.view_layer.objects.active = piezas[0]
    bpy.ops.object.join()
    detalles = bpy.context.active_object; detalles.name = "Detalles"
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)  # vértices en coordenadas del mundo
    for poly in detalles.data.polygons: poly.use_smooth = False

    # --- Variantes de raza por deformación de la malla base (misma topología en todas las piezas)
    piezas_forma = [(cuerpo, 1.0), (crin, 1.0), (cola, 1.0), (detalles, 1.0)]
    for ob, _ in piezas_forma:
        ob.shape_key_add(name="Basis")
    for raza in RAZAS:
        p = params(raza)
        n1, _ = anatomia(p)
        for ob, _ in piezas_forma:
            extra = p.get("crin", 1.0) if ob is crin else 1.0
            nuevas = deformar_hacia([v.co.copy() for v in ob.data.vertices], n0, ar0, n1, extra)
            sk = ob.shape_key_add(name=raza)
            for i, co in enumerate(nuevas):
                sk.data[i].co = co
    log("Variantes de raza creadas:", list(RAZAS))

    # --- Esqueleto y pesos
    esq = crear_esqueleto(n0)
    pesar(cuerpo, esq)
    pesar(crin, esq, region=lambda h: h.startswith("Cuello") or h == "Cabeza" or h == "Torax")
    pesar(cola, esq, region=lambda h: h.startswith("Cola") or h == "Grupa")
    pesar(detalles, esq, region=lambda h: h == "Cabeza")

    # --- Animaciones
    animar_quieto(esq)
    for nom, a in AIRES.items():
        animar_aire(esq, nom, a)
    ciclos_lineales()
    esq.animation_data.action = bpy.data.actions["Galope"]
    sc.frame_start, sc.frame_end = 0, CICLO

    # --- Metadatos para el juego (escala por raza, nombres)
    meta = dict(version="caballo-gen-0.2", fps=FPS, ciclo=CICLO, escala=ESCALA, razas=list(RAZAS),
                zancada=dict(Paso=1.7, Trote=2.8, Medio=4.2, Galope=6.6),
                vertices=len(cuerpo.data.vertices), errores=errores)
    esq["caballos_meta"] = json.dumps(meta)
    exportar(SALIDA_GLB)
    with open(os.path.join(os.path.dirname(SALIDA_GLB), "caballo_meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=1)
    log("GLB exportado:", SALIDA_GLB, "| vértices cuerpo:", len(cuerpo.data.vertices))

    # --- Vistas previas
    preparar_render()
    camara_lateral()
    luz = bpy.data.objects.new("Sol", bpy.data.lights.new("Sol", "SUN")); sc.collection.objects.link(luz)
    esq.animation_data.action = bpy.data.actions["Quieto"]
    pose_reposo(esq)
    sc.frame_set(0)
    render("raza_00_base")
    for i, raza in enumerate(RAZAS, 1):
        for ob in (cuerpo, crin, cola, detalles):
            for kb in ob.data.shape_keys.key_blocks:
                kb.value = 1.0 if kb.name == raza else 0.0
        render("raza_%02d_%s" % (i, raza))
    for ob in (cuerpo, crin, cola, detalles):
        for kb in ob.data.shape_keys.key_blocks: kb.value = 0.0
    for aire in ("Paso", "Trote", "Galope"):
        pose_reposo(esq)
        esq.animation_data.action = bpy.data.actions[aire]
        for k, f in enumerate((0, 6, 12, 18)):
            sc.frame_set(f)
            render("aire_%s_%d" % (aire, k))
    # Vista 3/4 en perspectiva de 4 razas
    cam = bpy.context.scene.camera
    cam.data.type = "PERSP"; cam.data.lens = 45
    cam.location = (4.6, 3.6, 2.1)
    dirv = Vector((0, 0.2, 1.05)) - cam.location
    cam.rotation_euler = dirv.to_track_quat("-Z", "Y").to_euler()
    pose_reposo(esq)
    esq.animation_data.action = bpy.data.actions["Quieto"]
    sc.frame_set(0)
    for raza in ("PuraSangre", "CuartoDeMilla", "Andaluz", "Frison"):
        for ob in (cuerpo, crin, cola, detalles):
            for kb in ob.data.shape_keys.key_blocks:
                kb.value = 1.0 if kb.name == raza else 0.0
        render("tres_cuartos_%s" % raza)
    log("Vistas previas en", SALIDA_PREV)
    log("LISTO")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        log("ERROR:", e)
        sys.exit(1)
