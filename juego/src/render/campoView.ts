// Campo isométrico del establecimiento (GDD v0.2 §3; estilo decidido el 15/11/2026: campo argentino).
// Campo 2.0 (§24.4): parcela de 90 × 66 m rodeada de llanura y sierras bajas; el jugador mueve y gira los edificios,
// el potrero y el molino, y el campo se rehace con los caminos nuevos. Decoración libre sobre cuadrícula (Fase 6).
// Todo es geometría low poly generada por código: sin texturas, colores planos, sombras suaves.
// Cámara isométrica fija: se arrastra para desplazar, rueda o botones para acercar. Tocar un edificio lo elige.
import {
  AbstractMesh, ArcRotateCamera, Camera, Color3, Color4, DirectionalLight, Engine, HemisphericLight, Matrix, Mesh, MeshBuilder,
  type Material, type Observer, PointerEventTypes, Quaternion, Scene, ShadowGenerator, StandardMaterial, TransformNode, Vector3, VertexBuffer, VertexData,
} from "@babylonjs/core";
import { CaballoGLB, HorseModelView, tamanoDe } from "./horseModel.ts";
import { coloresDe } from "../domain/aspecto.ts";
import type { Caballo } from "../domain/caballo.ts";
import type { TipoEdificio } from "../domain/partida.ts";
import { CELDA, CELDAS, objeto, type Ocupacion, type Puesto } from "../domain/decoracion.ts";
import type { Ubicacion } from "../domain/campo.ts";
import { centroDe, construirDeco } from "./decoracion3d.ts";
import {
  ALTO, ANCHO, caminosDe, DISPOSICION_INICIAL, girar, NATURALES, PATIO, PIEZAS, rectDe, type Disposicion, type Pieza, type Rect,
} from "../domain/campo.ts";

/** Dónde está cada pieza (metros; X este, Z norte). Lo decide el jugador; se cambia con aplicarDisposicion(). */
let D: Disposicion = { ...DISPOSICION_INICIAL };
const V = (p: Pieza) => new Vector3(D[p].x, 0, D[p].z);
const ROT = (p: Pieza) => D[p].rot * Math.PI / 2;
/** Punto local de una pieza (sin rotar) llevado al mundo. */
const enMundo = (p: Pieza, x: number, z: number) => { const [a, b] = girar(x, z, D[p].rot); return new Vector3(D[p].x + a, 0, D[p].z + b); };
const EDIFICIOS: TipoEdificio[] = ["establo", "entrenamiento", "recuperacion"];
const POTRERO_W = 22, POTRERO_H = 15;
const LAGUNA = (() => { const l = NATURALES.find((n) => n.nombre === "laguna")!; return { x: l.x, z: l.z, r: 4 }; })();
const OMBU = NATURALES.find((n) => n.nombre === "ombú")!;
const PATIO_R = 4.8;
const HORNERO_X = 8.5;
let CAMINOS = caminosDe(D);
/** ¿El punto está sobre un camino o el patio? */
function sobreCamino(x: number, z: number, margen = 0): boolean {
  if (Math.hypot(x - PATIO.x, z - PATIO.z) < PATIO_R + margen) return true;
  for (const [x1, z1, x2, z2, w] of CAMINOS) {
    const dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / L2));
    if (Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t)) < w / 2 + margen) return true;
  }
  return false;
}
const suave = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Altura del terreno: el campo casi plano, la llanura con lomas suaves y, lejos (sobre todo al fondo), sierras bajas. */
export function alturaSuelo(x: number, z: number): number {
  const fuera = Math.max(0, Math.abs(x) - ANCHO / 2 - 2) + Math.max(0, Math.abs(z) - ALTO / 2 - 2);
  let h = (Math.sin(x * 0.37) * Math.cos(z * 0.29) * 0.12 + Math.sin(x * 0.11 + z * 0.17) * 0.18) * (fuera > 0 ? 2.2 : 0.6) - 0.05;
  h += suave(28, 55, fuera) * Math.sin(x * 0.035 + 0.7) * Math.cos(z * 0.04) * 1.6;           // lomas de la llanura
  const d = Math.hypot(x, z * 1.25), s = suave(56, 96, d);
  if (s > 0) {
    const fondo = Math.max(0, (z - x) / (Math.hypot(x, z) * Math.SQRT2));                   // la cámara mira al noroeste
    const cresta = 1 - Math.abs(Math.sin(x * 0.031 + Math.cos(z * 0.021) * 2.2));
    const ruido = 0.55 + 0.45 * Math.sin(x * 0.051 + 1.7) * Math.cos(z * 0.043 + 0.4);
    h += s * (5 + 19 * cresta * ruido) * suave(0.3, 0.85, fondo);          // solo al fondo (norte y oeste)
  }
  return h;
}
const dentro = (r: Rect, x: number, z: number, m = 0) => Math.abs(x - r.x) < r.w / 2 + m && Math.abs(z - r.z) < r.h / 2 + m;


const hex = (h: string) => Color3.FromHexString(h);
export type Seleccion = { tipo: "pieza"; pieza: Pieza } | { tipo: "deco"; uid: string };

export class CampoView {
  readonly scene: Scene;
  private cam: ArcRotateCamera;
  private sombras: ShadowGenerator;
  private mats = new Map<string, StandardMaterial>();
  private zoom = 44;
  private etiquetas = new Map<TipoEdificio, HTMLDivElement>();
  private capa: HTMLDivElement | null = null;
  private caballos: { vista: HorseModelView; c: Caballo; fase: number }[] = [];
  private claveCaballos = "";
  private listo: Promise<boolean>;
  private t = 0;
  /** Solo responde al mouse o al dedo mientras se ve (las tres escenas comparten el lienzo). */
  activo = false;
  /** Se llama al tocar un edificio. */
  alElegir: (t: TipoEdificio) => void = () => {};

  // ---- mover cosas como en Clash of Clans (§11.5, §24.4)
  // Tocar algo lo selecciona (borde dorado). Apretar sobre lo seleccionado y arrastrar lo mueve en tiempo real; al soltar
  // queda puesto si entra, o vuelve a su lugar si no. Arrastrar sobre otra cosa mueve la cámara.
  /** Lo seleccionado: un edificio/potrero/molino o un adorno. */
  seleccion: Seleccion | null = null;
  alSeleccionar: (s: Seleccion | null) => void = () => {};
  /** Al soltar lo que se arrastró en un lugar válido. La interfaz lo guarda. */
  alSoltarPieza: (pz: Pieza, u: Ubicacion) => void = () => {};
  alSoltarDeco: (uid: string, cx: number, cz: number) => void = () => {};
  /** Objeto nuevo (recién elegido en el Mercado): tocar o arrastrar lo mueve; se compra con ✓. */
  alMoverNuevo: (cx: number, cz: number) => void = () => {};
  /** Reglas (las pone la interfaz): ¿entra ahí? */
  validarPieza: (pz: Pieza, u: Ubicacion) => boolean = () => false;
  validarDeco: (id: string, cx: number, cz: number, rot: number, uid?: string) => boolean = () => false;
  private decos = new Map<string, { mesh: Mesh | null; estatua?: HorseModelView; clave: string; puesto: Puesto }>();
  private fantasma: { id: string; rot: number; mesh: Mesh | null; huella: Mesh; cx: number; cz: number; uid?: string } | null = null;
  private grilla: Mesh | null = null;
  private bloqueadasCache: Ocupacion | null = null;
  private fantasmaPieza: { pieza: Pieza; u: Ubicacion; nodo: TransformNode; huella: Mesh; flecha: Mesh; ocultas: AbstractMesh[] } | null = null;
  /** Botones flotantes (girar, guardar, comprar…) que la interfaz pone sobre lo seleccionado o el objeto nuevo. */
  private botonera: HTMLElement | null = null;
  ponerBotonera(el: HTMLElement | null): void { this.botonera = el; }

  private readonly engine: Engine;

  constructor(engine: Engine) {
    this.engine = engine;
    const scene = new Scene(engine);
    this.scene = scene;
    // Bruma de la llanura: lo lejano (sierras) se funde con el cielo del horizonte
    scene.clearColor = Color4.FromHexString("#cfdde3ff");
    scene.fogMode = Scene.FOGMODE_LINEAR; scene.fogColor = hex("#cfdde3"); scene.fogStart = 175; scene.fogEnd = 340;

    const cam = new ArcRotateCamera("camaraCampo", -Math.PI / 4, 0.98, 120, new Vector3(0, 0, -2), scene);
    cam.mode = Camera.ORTHOGRAPHIC_CAMERA;
    cam.minZ = 1; cam.maxZ = 400;
    this.cam = cam;

    const cielo = new HemisphericLight("cieloCampo", new Vector3(0.1, 1, -0.2), scene);
    cielo.intensity = 0.62; cielo.groundColor = hex("#6f7a52");
    const sol = new DirectionalLight("solCampo", new Vector3(-0.55, -1, 0.35), scene);
    sol.position = new Vector3(40, 60, -30); sol.intensity = 1.0;
    sol.shadowMinZ = 1; sol.shadowMaxZ = 200;
    this.sombras = new ShadowGenerator(2048, sol);
    this.sombras.useBlurExponentialShadowMap = true; this.sombras.blurKernel = 12; this.sombras.setDarkness(0.38);

    this.construirMundo();
    this.controles();
    this.listo = CaballoGLB.cargar(scene);

    scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min(0.1, engine.getDeltaTime() / 1000);
      this.t += dt;
      this.ajustarOrto();
      this.moverCaballos(dt);
      this.ubicarEtiquetas();
      this.ubicarBotonera();
    });
  }

  // ------------------------------------------------------------------ armar y rehacer el campo

  private mundo: { meshes: AbstractMesh[]; nodos: TransformNode[]; mats: Material[] } | null = null;
  private obsMundo: Observer<Scene>[] = [];
  /** Rectángulo que ocupa cada pieza y árboles (x, z, radio) que hay que esquivar. */
  private rects = {} as Record<Pieza, Rect>;
  private arbolesFijos: [number, number, number][] = [];
  /** Mientras se arma una pieza, todo lo que se crea queda marcado con ella (para tocarla al acomodar). */
  private piezaActual: Pieza | null = null;

  private construirMundo(): void {
    const m0 = new Set(this.scene.meshes), n0 = new Set(this.scene.transformNodes), t0 = new Set(this.scene.materials);
    CAMINOS = caminosDe(D);
    for (const pz of PIEZAS) this.rects[pz] = rectDe(pz, D[pz]);
    this.copias.clear(); this.arbolesFijos = []; this.bloqueadasCache = null;
    this.terreno();
    this.caminos();
    this.alambrado();
    this.conPieza("establo", () => this.establo());
    this.conPieza("entrenamiento", () => this.entrenamiento());
    this.conPieza("recuperacion", () => this.recuperacion());
    this.conPieza("potrero", () => this.potrero());
    this.conPieza("molino", () => this.molino());
    this.arboles();
    this.detalles();
    this.optimizar(new Set(this.scene.meshes.filter((m) => !m0.has(m))));
    const propios = new Set<Material>(this.mats.values());
    this.mundo = {
      meshes: this.scene.meshes.filter((m) => !m0.has(m)),
      nodos: this.scene.transformNodes.filter((n) => !n0.has(n)),
      mats: this.scene.materials.filter((m) => !t0.has(m) && !propios.has(m)),
    };
  }

  private conPieza(pz: Pieza, f: () => void): void { this.piezaActual = pz; f(); this.piezaActual = null; }

  private desarmarMundo(): void {
    if (!this.mundo) return;
    for (const o of this.obsMundo) this.scene.onBeforeRenderObservable.remove(o);
    this.obsMundo = [];
    for (const m of this.mundo.meshes) m.dispose(false, false);
    for (const n of this.mundo.nodos) n.dispose(false, false);
    for (const m of this.mundo.mats) m.dispose();
    this.mundo = null;
  }

  /** Campo 2.0: pone cada pieza donde dice la partida y rehace el campo (caminos, pasto, árboles) si cambió algo. */
  aplicarDisposicion(d: Disposicion): void {
    if (JSON.stringify(d) === JSON.stringify(D)) return;
    D = { ...d };
    this.ponerFantasmaPieza(null);
    this.desarmarMundo();
    this.construirMundo();
    if (this.grilla) { this.verGrilla(false); this.verGrilla(true); }
    this.seleccionar(this.seleccion, false);
  }

  /** ¿Ese punto cae dentro de alguna pieza (edificio, potrero, molino)? */
  private enPieza(x: number, z: number, m = 0): boolean {
    return PIEZAS.some((pz) => dentro(this.rects[pz], x, z, m));
  }

  // ------------------------------------------------------------------ utilidades

  private mat(color: string): StandardMaterial {
    let m = this.mats.get(color);
    if (!m) {
      m = new StandardMaterial(`m${color}`, this.scene);
      m.diffuseColor = hex(color); m.specularColor = Color3.Black();
      this.mats.set(color, m);
    }
    return m;
  }

  /** Malla low poly: color plano, proyecta y recibe sombras, opcionalmente asociada a un edificio. */
  private pieza(m: Mesh, color: string, padre?: TransformNode, edificio?: TipoEdificio, sombra = true): Mesh {
    m.material = this.mat(color);
    if (padre) m.parent = padre;
    if (sombra) this.sombras.addShadowCaster(m, false);
    m.receiveShadows = true;
    const pz = edificio ?? this.piezaActual;
    if (pz) { m.metadata = { edificio, pieza: pz }; m.isPickable = true; }
    else m.isPickable = false;
    return m;
  }

  private caja(n: string, w: number, h: number, d: number, x: number, y: number, z: number, color: string, padre?: TransformNode, ed?: TipoEdificio) {
    const b = MeshBuilder.CreateBox(n, { width: w, height: h, depth: d }, this.scene);
    b.position.set(x, y + h / 2, z);
    return this.pieza(b, color, padre, ed);
  }

  /** Techo a dos aguas a lo largo de X: dos chapas inclinadas que sobresalen un poco, más los hastiales (triángulos de pared). */
  private techo(n: string, largo: number, ancho: number, alto: number, x: number, y: number, z: number, color: string, pared: string, padre?: TransformNode, ed?: TipoEdificio) {
    const hw = ancho / 2, faldon = Math.hypot(hw, alto), ang = Math.atan2(alto, hw);
    for (const s of [-1, 1]) {
      const f = MeshBuilder.CreateBox(`${n}F${s}`, { width: largo + 0.6, height: 0.16, depth: faldon + 0.5 }, this.scene);
      f.position.set(x, y + alto / 2 + 0.08, z + s * hw / 2);
      f.rotation.x = s * ang;
      this.pieza(f, color, padre, ed);
    }
    this.pieza(this.prisma(`${n}H`, largo, ancho, alto), pared, padre, ed).position.set(x, y, z);
  }

  /** Prisma triangular (base `ancho` en Z, punta a `alto`) extruido a lo largo de X, con caras planas. */
  private prisma(n: string, largo: number, ancho: number, alto: number): Mesh {
    const L = largo / 2, W = ancho / 2;
    const A = [-L, 0, -W], B = [-L, 0, W], C = [-L, alto, 0], D = [L, 0, -W], E = [L, 0, W], F = [L, alto, 0];
    const caras = [[A, C, B], [D, E, F], [A, D, F, C], [B, C, F, E], [A, B, E, D]];
    const pos: number[] = [], ind: number[] = [];
    for (const c of caras) {
      const i0 = pos.length / 3;
      for (const v of c) pos.push(...v);
      ind.push(i0, i0 + 1, i0 + 2);
      if (c.length === 4) ind.push(i0, i0 + 2, i0 + 3);
    }
    const nor: number[] = [];
    VertexData.ComputeNormals(pos, ind, nor);
    const m = new Mesh(n, this.scene);
    const vd = new VertexData(); vd.positions = pos; vd.indices = ind; vd.normals = nor;
    vd.applyToMesh(m);
    return m;
  }

  /** Copias de una malla (pasto, postes, flores…): se anotan y al final se dibujan todas juntas como "thin instances". */
  private copias = new Map<Mesh, { position: Vector3; rotation: Vector3; scaling: Vector3 }[]>();
  private inst(base: Mesh): { position: Vector3; rotation: Vector3; scaling: Vector3 } {
    const c = { position: Vector3.Zero(), rotation: Vector3.Zero(), scaling: Vector3.One() };
    let l = this.copias.get(base);
    if (!l) { l = []; this.copias.set(base, l); }
    l.push(c);
    return c;
  }

  /**
   * Rendimiento: el campo tiene miles de piezas. Las copias pasan a thin instances (una llamada de dibujo por tipo) y
   * todo lo estático se une en pocas mallas por material y edificio (se conserva el edificio para poder tocarlo).
   */
  private optimizar(candidatas: Set<AbstractMesh>): void {
    for (const [base, l] of this.copias) {
      const buf = new Float32Array(l.length * 16);
      l.forEach((c, i) => Matrix.Compose(c.scaling, Quaternion.FromEulerVector(c.rotation), c.position).copyToArray(buf, i * 16));
      base.position.setAll(0); base.rotation.setAll(0); base.scaling.setAll(1); base.parent = null;
      base.thinInstanceSetBuffer("matrix", buf, 16, true);
      base.thinInstanceRefreshBoundingInfo();
      base.freezeWorldMatrix();
    }
    const sombra = new Set(this.sombras.getShadowMap()?.renderList ?? []);
    const grupos = new Map<string, Mesh[]>();
    for (const m of candidatas) {
      if (!(m instanceof Mesh) || this.copias.has(m) || m.name === "pasto" || m.name.startsWith("mlAspa") || !m.material || m.getTotalVertices() === 0) continue;
      const clave = [m.material.name, m.metadata?.edificio ?? "", m.metadata?.pieza ?? "", sombra.has(m) ? 1 : 0, m.receiveShadows ? 1 : 0, m.getVerticesDataKinds().sort().join()].join("|");
      let g = grupos.get(clave);
      if (!g) { g = []; grupos.set(clave, g); }
      g.push(m);
    }
    for (const [clave, ms] of grupos) {
      if (ms.length < 2) { ms[0].freezeWorldMatrix(); continue; }
      const ed = ms[0].metadata?.edificio, pz = ms[0].metadata?.pieza, recibe = ms[0].receiveShadows, proyecta = clave.split("|")[3] === "1";
      for (const m of ms) this.sombras.removeShadowCaster(m, false);
      const u = Mesh.MergeMeshes(ms, true, true, undefined, false, false);
      if (!u) continue;
      u.receiveShadows = recibe;
      u.isPickable = !!pz;
      if (pz) u.metadata = { edificio: ed, pieza: pz };
      if (proyecta) this.sombras.addShadowCaster(u, false);
      u.freezeWorldMatrix();
    }
  }

  private nodo(n: string, p: Vector3, rotY = 0): TransformNode {
    const t = new TransformNode(n, this.scene);
    t.position.copyFrom(p); t.rotation.y = rotY;
    return t;
  }

  // ------------------------------------------------------------------ escenario

  private terreno(): void {
    // Un solo terreno grande: el campo casi plano, la llanura ondulada alrededor y sierras bajas al fondo (§24.4),
    // así nunca se ve el borde del mundo. Caras planas y color por vértice, como el resto del campo.
    const T = 440, N = 150;
    const g = MeshBuilder.CreateGround("pasto", { width: T, height: T, subdivisions: N }, this.scene);
    const pos = g.getVerticesData(VertexBuffer.PositionKind)!;
    for (let i = 0; i < pos.length; i += 3) pos[i + 1] = alturaSuelo(pos[i], pos[i + 2]);
    g.updateVerticesData(VertexBuffer.PositionKind, pos);
    g.convertToFlatShadedMesh();
    const n = g.getTotalVertices();
    const col = new Float32Array(n * 4);
    const p2 = g.getVerticesData(VertexBuffer.PositionKind)!;
    const base = [0.46, 0.62, 0.30], seco = [0.62, 0.66, 0.36], monte = [0.50, 0.56, 0.32], piedra = [0.62, 0.57, 0.47], cumbre = [0.72, 0.68, 0.58];
    const mezcla = (a: number[], b: number[], t: number) => a.map((v, k) => v + (b[k] - v) * Math.max(0, Math.min(1, t)));
    for (let i = 0; i < n; i += 3) {
      // color por triángulo: altura media de sus tres vértices
      const x = p2[i * 3], z = p2[i * 3 + 2];
      const y = (p2[i * 3 + 1] + p2[i * 3 + 4] + p2[i * 3 + 7]) / 3;
      const r = (Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
      const k = Math.abs(r) * 0.35 + (Math.sin(x * 0.2) * Math.cos(z * 0.15) * 0.5 + 0.5) * 0.25;
      let c = mezcla(base, seco, k);
      if (y > 2) c = mezcla(c, monte, (y - 2) / 4);
      if (y > 7) c = mezcla(c, piedra, (y - 7) / 6 + Math.abs(r) * 0.25);
      if (y > 15) c = mezcla(c, cumbre, (y - 15) / 5);
      for (let v = 0; v < 3; v++) { for (let q = 0; q < 3; q++) col[(i + v) * 4 + q] = c[q]; col[(i + v) * 4 + 3] = 1; }
    }
    g.setVerticesData(VertexBuffer.ColorKind, col);
    const m = new StandardMaterial("pastoMat", this.scene);
    m.specularColor = Color3.Black(); m.diffuseColor = Color3.White();
    g.material = m; g.receiveShadows = true; g.isPickable = false;
    // Suelo invisible y plano para saber qué casilla se toca
    const suelo = MeshBuilder.CreateGround("suelo", { width: ANCHO + 10, height: ALTO + 10 }, this.scene);
    suelo.isVisible = false; suelo.isPickable = true;
  }

  private caminos(): void {
    const tierra = "#c9a774";
    const tramo = (n: string, x1: number, z1: number, x2: number, z2: number, w: number) => {
      const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz);
      const c = MeshBuilder.CreateGround(n, { width: w, height: L }, this.scene);
      c.position.set((x1 + x2) / 2, 0.06, (z1 + z2) / 2);
      c.rotation.y = Math.atan2(dx, dz);
      this.pieza(c, tierra, undefined, undefined, false);
    };
    CAMINOS.forEach(([x1, z1, x2, z2, w], i) => {
      tramo(`camino${i}`, x1, z1, x2, z2, w);
      // codo redondeado donde se juntan dos tramos
      const codo = MeshBuilder.CreateDisc(`codo${i}`, { radius: w / 2, tessellation: 10 }, this.scene);
      codo.rotation.x = Math.PI / 2; codo.position.set(x2, 0.062, z2);
      this.pieza(codo, tierra, undefined, undefined, false);
    });
    const patio = MeshBuilder.CreateDisc("patio", { radius: PATIO_R, tessellation: 12 }, this.scene);
    patio.rotation.x = Math.PI / 2; patio.position.set(PATIO.x, 0.065, PATIO.z);
    this.pieza(patio, tierra, undefined, undefined, false);
  }

  private alambrado(): void {
    const poste = MeshBuilder.CreateCylinder("poste", { height: 1.3, diameter: 0.16, tessellation: 5 }, this.scene);
    this.pieza(poste, "#7b5a3a");
    poste.position.y = 0.65; poste;
    const hx = ANCHO / 2, hz = ALTO / 2;
    let k = 0;
    const tramo = (x1: number, z1: number, x2: number, z2: number) => {
      const L = Math.hypot(x2 - x1, z2 - z1), n = Math.ceil(L / 3);
      for (let i = 0; i <= n; i++) {
        const p = this.inst(poste);
        p.position.set(x1 + (x2 - x1) * i / n, 0.65, z1 + (z2 - z1) * i / n);
      }
      for (const h of [0.45, 0.8, 1.15]) {
        const a = MeshBuilder.CreateBox(`alambre${k++}`, { width: 0.025, height: 0.025, depth: L }, this.scene);
        a.position.set((x1 + x2) / 2, h, (z1 + z2) / 2); a.rotation.y = Math.atan2(x2 - x1, z2 - z1);
        this.pieza(a, "#5b5f63", undefined, undefined, false);
      }
    };
    tramo(-hx, -hz, -2.5, -hz); tramo(2.5, -hz, hx, -hz);
    tramo(hx, -hz, hx, hz); tramo(hx, hz, -hx, hz); tramo(-hx, hz, -hx, -hz);
    // Tranquera: dos postes gruesos y una hoja de cinco tablas con diagonal
    const tq = this.nodo("tranquera", new Vector3(0, 0, -hz));
    for (const x of [-2.6, 2.6]) this.pieza(MeshBuilder.CreateCylinder(`tqPoste${x}`, { height: 1.9, diameter: 0.3, tessellation: 6 }, this.scene), "#6b4a2e", tq).position.set(x, 0.95, 0);
    const hoja = this.nodo("tqHoja", new Vector3(-2.45, 0, 0));
    hoja.parent = tq; hoja.rotation.y = -1.1;   // abierta: el campo recibe
    for (let i = 0; i < 5; i++) this.caja(`tqTabla${i}`, 4.6, 0.1, 0.07, 2.3, 0.25 + i * 0.27, 0, "#a57c50", hoja);
    const diag = this.caja("tqDiag", 4.9, 0.1, 0.07, 2.3, 0.6, 0.04, "#a57c50", hoja);
    diag.rotation.z = 0.22;
  }

  private establo(): void {
    const e = "establo" as const;
    const n = this.nodo("edEstablo", V(e), ROT(e));
    // Galpón de paredes encaladas, zócalo de ladrillo, techo de chapa roja y portones de madera
    this.caja("estZocalo", 12.4, 0.5, 8.4, 0, 0, 0, "#9c5a3c", n, e);
    this.caja("estParedes", 12, 3.1, 8, 0, 0.5, 0, "#efe8d8", n, e);
    this.techo("estTecho", 12, 8, 2.4, 0, 3.6, 0, "#a3402f", "#efe8d8", n, e);
    this.caja("estPorton", 2.6, 2.5, 0.12, 0, 0.5, -4.04, "#7a5232", n, e);
    for (const s of [-1, 1]) this.caja(`estCruz${s}`, 0.12, 2.9, 0.06, 0, 0.3, -4.12, "#5e3f26", n, e).rotation.z = s * 0.72;
    for (const x of [-4.2, -2.4, 2.4, 4.2]) this.caja(`estVentana${x}`, 1.0, 0.8, 0.1, x, 2.0, -4.04, "#3b4b42", n, e);
    this.caja("estCumbrera", 12.7, 0.18, 0.34, 0, 5.95, 0, "#7c2e22", n, e);
    // Bebedero y fardos de pasto al costado
    this.caja("estBebedero", 2.2, 0.5, 0.7, -7.6, 0, -2.5, "#8a8f93", n, e);
    for (const [x, z] of [[7.4, 1.5], [7.4, 2.8], [8.5, 2.1]] as const) {
      const f = MeshBuilder.CreateCylinder(`estFardo${x}${z}`, { height: 1.2, diameter: 1.3, tessellation: 8 }, this.scene);
      f.rotation.x = Math.PI / 2; f.position.set(x, 0.65, z);
      this.pieza(f, "#d8bd6a", n, e);
    }
  }

  private entrenamiento(): void {
    const e = "entrenamiento" as const;
    const n = this.nodo("edEntreno", V(e), ROT(e));
    // Picadero redondo de arena con cerco de madera, y un tinglado para monturas
    const arena = MeshBuilder.CreateCylinder("pcArena", { height: 0.12, diameter: 15, tessellation: 24 }, this.scene);
    arena.position.y = 0.06;
    this.pieza(arena, "#dcc596", n, e, false);
    const R = 7.6, postes = 20;
    for (let i = 0; i < postes; i++) {
      const a = (i / postes) * Math.PI * 2;
      if (Math.abs(a - Math.PI * 1.25) < 0.17) continue;      // abertura hacia el camino
      const po = MeshBuilder.CreateCylinder(`pcPoste${i}`, { height: 1.5, diameter: 0.18, tessellation: 5 }, this.scene);
      po.position.set(Math.cos(a) * R, 0.75, Math.sin(a) * R);
      this.pieza(po, "#7b5a3a", n, e);
      const a2 = ((i + 1) / postes) * Math.PI * 2;
      if (Math.abs(a2 - Math.PI * 1.25) < 0.17) continue;
      const L = 2 * R * Math.sin(Math.PI / postes);
      for (const h of [0.7, 1.25]) {
        const tb = MeshBuilder.CreateBox(`pcTabla${i}${h}`, { width: L, height: 0.14, depth: 0.08 }, this.scene);
        tb.position.set(Math.cos((a + a2) / 2) * R, h, Math.sin((a + a2) / 2) * R);
        tb.rotation.y = -(a + a2) / 2 + Math.PI / 2;
        this.pieza(tb, "#a57c50", n, e);
      }
    }
    const tg = this.nodo("tinglado", new Vector3(10.5, 0, 2), 0);
    tg.parent = n;
    for (const [x, z] of [[-2.2, -1.6], [2.2, -1.6], [-2.2, 1.6], [2.2, 1.6]] as const) this.caja(`tgPoste${x}${z}`, 0.22, 2.8, 0.22, x, 0, z, "#6b4a2e", tg, e);
    const chapa = this.caja("tgChapa", 5.4, 0.12, 4.2, 0, 2.8, 0, "#7d8a8f", tg, e);
    chapa.rotation.x = 0.12;
    this.caja("tgCaballete", 1.4, 0.9, 0.35, -0.8, 0, 0.6, "#8b6239", tg, e);
    this.caja("tgMontura", 0.7, 0.25, 0.5, -0.8, 0.9, 0.6, "#4a2f1d", tg, e);
  }

  private recuperacion(): void {
    const e = "recuperacion" as const;
    const n = this.nodo("edRecup", V(e), ROT(e));
    // Casita blanca con galería y techo verde, bebedero y sombra de árboles (descanso)
    this.caja("rcParedes", 7, 2.8, 5, 0, 0, 0, "#f4efe4", n, e);
    this.techo("rcTecho", 7, 5, 1.7, 0, 2.8, 0, "#3f6b4f", "#f4efe4", n, e);
    this.caja("rcGaleria", 7.2, 0.12, 2.2, 0, 2.5, -3.6, "#3f6b4f", n, e);
    for (const x of [-3.3, -1.1, 1.1, 3.3]) this.caja(`rcColumna${x}`, 0.18, 2.5, 0.18, x, 0, -4.55, "#e9e1cf", n, e);
    this.caja("rcPuerta", 1.1, 2.0, 0.1, 0, 0, -2.54, "#4f6e5b", n, e);
    for (const x of [-2.2, 2.2]) this.caja(`rcVentana${x}`, 0.9, 0.8, 0.1, x, 1.2, -2.54, "#33433b", n, e);
    // Cruz verde de "cuidado" sobre la puerta (señal, no medicina: no hay veterinaria en el juego)
    this.caja("rcCruzV", 0.18, 0.6, 0.06, 0, 2.05, -2.58, "#5c9b6c", n, e);
    this.caja("rcCruzH", 0.6, 0.18, 0.06, 0, 2.26, -2.58, "#5c9b6c", n, e);
    this.caja("rcBebedero", 2.4, 0.5, 0.8, -5.2, 0, -3.4, "#8a8f93", n, e);
    const agua = this.caja("rcAgua", 2.2, 0.02, 0.6, -5.2, 0.49, -3.4, "#6aa6c9", n, e);
    agua.receiveShadows = false;
  }

  private potrero(): void {
    const w = POTRERO_W, h = POTRERO_H;
    const n = this.nodo("potrero", V("potrero"), ROT("potrero"));
    const poste = MeshBuilder.CreateCylinder("ptPoste", { height: 1.4, diameter: 0.14, tessellation: 5 }, this.scene);
    this.pieza(poste, "#7b5a3a");
    let k = 0;
    const lado = (x1: number, z1: number, x2: number, z2: number, hueco = false) => {
      const L = Math.hypot(x2 - x1, z2 - z1), c = Math.ceil(L / 2.5);
      for (let i = 0; i <= c; i++) {
        const pi = this.inst(poste);
        pi.position.copyFrom(enMundo("potrero", x1 + (x2 - x1) * i / c, z1 + (z2 - z1) * i / c)); pi.position.y = 0.7;
      }
      if (hueco) return;
      for (const yy of [0.55, 1.1]) {
        const tb = MeshBuilder.CreateBox(`ptT${k++}`, { width: 0.07, height: 0.12, depth: L }, this.scene);
        tb.position.set((x1 + x2) / 2, yy, (z1 + z2) / 2); tb.rotation.y = Math.atan2(x2 - x1, z2 - z1);
        this.pieza(tb, "#b48a5c", n);
      }
    };
    const x0 = -w / 2, x1 = w / 2, z0 = -h / 2, z1 = h / 2;
    // la abertura del lado este (x1) mira al camino
    lado(x0, z0, x1, z0); lado(x1, z0, x1, z1 - 3); lado(x1, z1 - 3, x1, z1, true); lado(x1, z1, x0, z1); lado(x0, z1, x0, z0);
  }

  private molino(): void {
    // Molino de viento con tanque australiano: ícono del campo argentino
    const n = this.nodo("molino", V("molino"), ROT("molino"));
    const L = 9;
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const pata = MeshBuilder.CreateCylinder(`mlPata${dx}${dz}`, { height: L, diameterTop: 0.08, diameterBottom: 0.12, tessellation: 4 }, this.scene);
      pata.position.set(dx * 0.6, L / 2, dz * 0.6);
      pata.rotation.z = -dx * 0.12; pata.rotation.x = dz * 0.12;
      this.pieza(pata, "#7f868a", n);
    }
    for (const y of [2, 4.5, 7]) {
      const anillo = MeshBuilder.CreateTorus(`mlAnillo${y}`, { diameter: 2.2 - y * 0.2, thickness: 0.06, tessellation: 4 }, this.scene);
      anillo.position.y = y; anillo.rotation.y = Math.PI / 4;
      this.pieza(anillo, "#7f868a", n);
    }
    const rueda = this.nodo("mlRueda", new Vector3(0, L + 0.2, -0.4));
    rueda.parent = n;
    for (let i = 0; i < 12; i++) {
      const aspa = MeshBuilder.CreateBox(`mlAspa${i}`, { width: 0.32, height: 1.5, depth: 0.03 }, this.scene);
      aspa.position.set(0, 0.95, 0); aspa.setPivotPoint(new Vector3(0, -0.95, 0));
      aspa.rotation.z = (i / 12) * Math.PI * 2; aspa.rotation.y = 0.4;
      this.pieza(aspa, "#c9cdd0", rueda);
    }
    const cola = this.caja("mlCola", 0.05, 0.9, 1.6, 0, L - 0.25, 1.2, "#c9cdd0", n);
    cola.rotation.x = 0.05;
    this.obsMundo.push(this.scene.onBeforeRenderObservable.add(() => { rueda.rotation.z += 0.025; }));
    const tanque = MeshBuilder.CreateCylinder("tanque", { height: 1.3, diameter: 7, tessellation: 18 }, this.scene);
    tanque.position.set(6.5, 0.65, 0.5);
    this.pieza(tanque, "#9aa2a5", n);
    const agua = MeshBuilder.CreateCylinder("tanqueAgua", { height: 0.05, diameter: 6.7, tessellation: 18 }, this.scene);
    agua.position.set(6.5, 1.22, 0.5);
    this.pieza(agua, "#5f9cc0", n, undefined, false);
  }

  private arboles(): void {
    // Copa de varios bultos (uno grande y dos o tres chicos corridos) para que no parezca una pelota.
    const copa = (n: string, x: number, z: number, r: number, alto: number, verde: string, troncoAlto: number, tronco = "#6d4c33", lejos = false) => {
      const y0 = lejos ? alturaSuelo(x, z) - 0.2 : 0, sombra = !lejos;
      const t = MeshBuilder.CreateCylinder(`${n}T`, { height: troncoAlto, diameterTop: r * 0.18, diameterBottom: r * 0.3, tessellation: 6 }, this.scene);
      t.position.set(x, y0 + troncoAlto / 2, z);
      this.pieza(t, tronco, undefined, undefined, sombra);
      const c = MeshBuilder.CreateIcoSphere(`${n}C`, { radius: r, subdivisions: 1, flat: true }, this.scene);
      c.scaling.y = alto / r; c.position.set(x, y0 + troncoAlto + alto * 0.7, z);
      c.rotation.y = x * 0.7 + z;
      this.pieza(c, verde, undefined, undefined, sombra);
      const h = (Math.sin(x * 3.1 + z * 1.7) + 1) / 2;
      const claro = Color3.FromHexString(verde).scale(1.12).toHexString();
      for (let k = 0; k < 3; k++) {
        const a = k * 2.1 + h * 3, rr = r * (0.48 + 0.12 * ((k + h * 3) % 1));
        const b = MeshBuilder.CreateIcoSphere(`${n}B${k}`, { radius: rr, subdivisions: 1, flat: true }, this.scene);
        b.scaling.y = (alto / r) * 0.85;
        b.position.set(x + Math.cos(a) * r * 0.62, y0 + troncoAlto + alto * (0.55 + 0.25 * (k % 2)), z + Math.sin(a) * r * 0.62);
        b.rotation.y = a;
        this.pieza(b, k === 1 ? claro : verde, undefined, undefined, sombra);
      }
    };
    // Ombú junto al patio (fijo), cortina de eucaliptos al norte y paraísos sueltos. Si el jugador puso una pieza
    // encima de un árbol, ese árbol no se planta.
    this.arbolesFijos.push([OMBU.x, OMBU.z, 3.6]);
    copa("ombu", OMBU.x, OMBU.z, 4.2, 3.4, "#3f6e3a", 2.2);
    for (let i = 0; i < 15; i++) {
      const x = -42 + i * 6 + (i % 2) * 1.2, z = ALTO / 2 - 2.5 + (i % 3) * 0.6;
      if (this.enPieza(x, z, 1.2)) continue;
      this.arbolesFijos.push([x, z, 1.3]);
      copa(`euca${i}`, x, z, 1.5, 4.2, i % 2 ? "#5b7d55" : "#4d7149", 4.5 + (i % 3) * 0.8, "#cfc4a8");
    }
    const paraisos = [[7, -19], [-4, -22], [36, 22], [-38, 5], [5, 8], [27, -21], [40, 2], [-40, -29], [-12, 26], [24, 27]] as const;
    paraisos.forEach(([x, z], k) => {
      if (this.enPieza(x, z, 1.4) || sobreCamino(x, z, 1)) return;
      this.arbolesFijos.push([x, z, 1.4]);
      copa(`paraiso${k}`, x, z, 1.8, 1.9, k % 2 ? "#5f8a46" : "#6b9450", 1.8);
    });
    // Fuera del alambrado: montes de árboles sueltos en la llanura (sin sombra: están lejos)
    for (let i = 0, puestos = 0; i < 80 && puestos < 34; i++) {
      const a = i * 2.39996, r = 58 + (i * 37 % 41);
      const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.85;
      if (Math.abs(x) < ANCHO / 2 + 5 && Math.abs(z) < ALTO / 2 + 5) continue;
      if ((x < -46 && x > -76 && z > -42 && z < -20) || (x > 48 && x < 66 && z > -34 && z < 0)) continue;   // cultivos
      copa(`lejos${i}`, x, z, 2 + (i % 3) * 0.4, 2.6, i % 2 ? "#557a48" : "#4c6f43", 2.5, "#6d4c33", true);
      puestos++;
    }
  }

  // ------------------------------------------------------------------ detalles (vida del campo)

  /** Lugares donde no va pasto alto ni flores: edificios, caminos, picadero, potrero, molino, laguna. */
  private libre(x: number, z: number, margen = 0, conCaminos = true): boolean {
    const circ = (cx: number, cz: number, r: number) => Math.hypot(x - cx, z - cz) < r + margen;
    if (this.enPieza(x, z, margen)) return false;
    if (conCaminos && sobreCamino(x, z, margen)) return false;   // patio y caminos
    if (circ(LAGUNA.x, LAGUNA.z, LAGUNA.r * 1.35 + 0.8)) return false;
    for (const [ax, az, r] of this.arbolesFijos) if (circ(ax, az, r)) return false;
    if (circ(HORNERO_X, -ALTO / 2 + 0.5, 1)) return false;
    if (Math.abs(Math.abs(x) - ANCHO / 2) < 0.6 || Math.abs(Math.abs(z) - ALTO / 2) < 0.6) return false;  // alambrado
    return true;
  }

  private detalles(): void {
    let semilla = 20251115;
    const az = () => { semilla = (semilla * 1664525 + 1013904223) >>> 0; return semilla / 4294967296; };
    const sc = this.scene;
    const base = (m: Mesh, color: string) => { m.material = this.mat(color); m.isPickable = false; m.receiveShadows = true; return m; };

    // Matas de pasto: pirámides finas de tres verdes (instancias: una sola llamada de dibujo por color)
    const matas = ["#4f7a38", "#6b8f43", "#86a24f"].map((c, i) => base(MeshBuilder.CreateCylinder(`mata${i}`, { height: 0.55, diameterTop: 0, diameterBottom: 0.34, tessellation: 3 }, sc), c));
    for (let k = 0, puestas = 0; k < 7000 && puestas < 1500; k++) {
      const fuera = puestas > 1050;
      const x = (az() - 0.5) * (fuera ? ANCHO + 70 : ANCHO - 2), z = (az() - 0.5) * (fuera ? ALTO + 60 : ALTO - 2);
      if (!fuera && !this.libre(x, z, 0.4)) continue;
      if (fuera && Math.abs(x) < ANCHO / 2 + 1 && Math.abs(z) < ALTO / 2 + 1) continue;
      puestas++;
      const mi = this.inst(matas[Math.floor(az() * 3)]);
      const h = 0.6 + az() * 0.9, y0 = fuera ? alturaSuelo(x, z) + 0.05 : 0;
      mi.position.set(x, y0 + 0.25 * h, z); mi.scaling.set(1, h, 1); mi.rotation.y = az() * 6.28;
      // a veces dos o tres hojas juntas
      if (az() < 0.5) {
        const m2 = this.inst(matas[Math.floor(az() * 3)]);
        m2.position.set(x + 0.18, y0 + 0.2 * h, z + 0.1); m2.scaling.set(0.8, h * 0.8, 0.8); m2.rotation.set(0, az() * 6.28, 0.25);
      }
    }

    // Flores silvestres en manchones: margaritas, verbenas y flores amarillas
    const flores = ["#f4efe2", "#f2cf44", "#b88fd8", "#d9534f"].map((c, i) => base(MeshBuilder.CreateIcoSphere(`flor${i}`, { radius: 0.1, subdivisions: 1, flat: true }, sc), c));
    for (let k = 0, m = 0; k < 1000 && m < 120; k++) {
      const x = (az() - 0.5) * (ANCHO - 4), z = (az() - 0.5) * (ALTO - 4);
      if (!this.libre(x, z, 1)) continue;
      const f = flores[Math.floor(az() * flores.length)];
      for (let j = 0; j < 7; j++) {
        const fi = this.inst(f);
        fi.position.set(x + (az() - 0.5) * 1.3, 0.22 + az() * 0.12, z + (az() - 0.5) * 1.3);
      }
      m++;
    }

    // Piedras sueltas
    const piedra = base(MeshBuilder.CreateIcoSphere("piedra", { radius: 0.4, subdivisions: 1, flat: true }, sc), "#9b9a90");
    for (const [x, z, s] of [[-33, 15, 1.1], [-32, 15.8, 0.6], [40, -12, 0.8], [38, -31, 1.3], [29, -28, 0.7], [-8, -28, 0.9], [8, 27, 0.7], [-41, -8, 1], [42, 16, 0.9], [-24, 29, 0.8]] as const) {
      if (!this.libre(x, z, s)) continue;
      const pi = this.inst(piedra);
      pi.position.set(x, 0.1, z); pi.scaling.set(s * 1.2, s * 0.6, s); pi.rotation.y = x;
    }

    this.laguna();
    this.cortaderas(az);
    this.hornero(new Vector3(HORNERO_X, 0, -ALTO / 2));
    this.detallesEstablo();
    this.detallesRecuperacion();
    this.detallesPicadero();
    this.detallesPotrero();
    this.cultivos(az);
  }

  private laguna(): void {
    const { x, z, r } = LAGUNA;
    const orilla = MeshBuilder.CreateDisc("orilla", { radius: r + 0.7, tessellation: 14 }, this.scene);
    orilla.rotation.x = Math.PI / 2; orilla.position.set(x, 0.05, z); orilla.scaling.set(1.35, 1, 1);
    this.pieza(orilla, "#b5a77a", undefined, undefined, false);
    const agua = MeshBuilder.CreateDisc("agua", { radius: r, tessellation: 14 }, this.scene);
    agua.rotation.x = Math.PI / 2; agua.position.set(x, 0.08, z); agua.scaling.set(1.35, 1, 1);
    const ma = new StandardMaterial("aguaMat", this.scene);
    ma.diffuseColor = hex("#5d9ec4"); ma.specularColor = new Color3(0.5, 0.55, 0.6); ma.specularPower = 48;
    agua.material = ma; agua.receiveShadows = true; agua.isPickable = false;
    // juncos en la orilla
    const junco = MeshBuilder.CreateCylinder("junco", { height: 1.4, diameterTop: 0, diameterBottom: 0.07, tessellation: 3 }, this.scene);
    junco.material = this.mat("#5f7f3a"); junco.isPickable = false;
    const punta = MeshBuilder.CreateCapsule("juncoPunta", { radius: 0.05, height: 0.32 }, this.scene);
    punta.material = this.mat("#6b4a2e"); punta.isPickable = false;
    for (let i = 0; i < 46; i++) {
      const a = i * 0.83 + (i % 3) * 0.2, d = r * (0.92 + (i % 4) * 0.06);
      if (Math.sin(a) > 0.55) continue;              // el lado de la vista queda despejado
      const jx = x + Math.cos(a) * d * 1.35, jz = z + Math.sin(a) * d;
      for (let j = 0; j < 3; j++) {
        const ji = this.inst(junco);
        const h = 0.8 + ((i * 7 + j * 3) % 5) * 0.12;
        ji.position.set(jx + j * 0.12, 0.7 * h, jz + (j % 2) * 0.1); ji.scaling.y = h; ji.rotation.z = (j - 1) * 0.12;
        if (j === 1 && i % 2 === 0) { const pu = this.inst(punta); pu.position.set(jx + 0.12, 1.25 * h, jz); }
      }
    }
  }

  /** Cortaderas (pasto de la pampa): mata de hojas largas y penachos color crema. */
  private cortaderas(az: () => number): void {
    const hoja = MeshBuilder.CreateCylinder("cortHoja", { height: 1.8, diameterTop: 0, diameterBottom: 0.16, tessellation: 3 }, this.scene);
    hoja.material = this.mat("#7c8d4a"); hoja.isPickable = false;
    const penacho = MeshBuilder.CreateCylinder("cortPenacho", { height: 0.9, diameterTop: 0, diameterBottom: 0.32, tessellation: 5 }, this.scene);
    penacho.material = this.mat("#efe4c4"); penacho.isPickable = false;
    const lugares: [number, number][] = [[LAGUNA.x - 6.5, LAGUNA.z + 2.5], [LAGUNA.x + 4.8, LAGUNA.z + 3.4], [-42, -29], [42, 29], [-42, 11], [41.5, -3], [-11, -30], [22, 29.5], [-30, 30], [43, -20]];
    lugares.forEach(([x, z], i) => {
      if (this.enPieza(x, z, 1) || sobreCamino(x, z, 1)) return;
      this.arbolesFijos.push([x, z, 0.9]);
      for (let j = 0; j < 14; j++) {
        const a = j * 0.45, inc = 0.15 + az() * 0.35;
        const h = this.inst(hoja);
        h.position.set(x + Math.cos(a) * 0.15, 0.8, z + Math.sin(a) * 0.15);
        h.rotation.set(Math.sin(a) * inc, 0, -Math.cos(a) * inc);
      }
      for (let j = 0; j < 5; j++) {
        const a = j * 1.26 + az();
        const pe = this.inst(penacho);
        const alto = 2.2 + az() * 0.6;
        pe.position.set(x + Math.cos(a) * 0.35, alto, z + Math.sin(a) * 0.35);
        pe.rotation.set(Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18);
        const tallo = MeshBuilder.CreateCylinder(`cortT${i}_${j}`, { height: alto - 0.3, diameter: 0.035, tessellation: 3 }, this.scene);
        tallo.position.set(x + Math.cos(a) * 0.2, (alto - 0.3) / 2, z + Math.sin(a) * 0.2);
        tallo.rotation.copyFrom(pe.rotation);
        this.pieza(tallo, "#b9a874", undefined, undefined, false);
      }
    });
  }

  /** Nido de hornero sobre un poste del alambrado: el pájaro nacional argentino. */
  private hornero(p: Vector3): void {
    const n = this.nodo("hornero", p);
    this.pieza(MeshBuilder.CreateCylinder("hrPoste", { height: 1.6, diameter: 0.22, tessellation: 6 }, this.scene), "#6b4a2e", n).position.y = 0.8;
    const nido = MeshBuilder.CreateSphere("hrNido", { diameter: 0.6, segments: 4, slice: 0.55 }, this.scene);
    nido.position.y = 1.6; nido.scaling.set(1.15, 1, 0.9);
    this.pieza(nido, "#a8714a", n);
    const boca = MeshBuilder.CreateDisc("hrBoca", { radius: 0.09, tessellation: 6 }, this.scene);
    boca.position.set(0.12, 1.72, -0.27);
    this.pieza(boca, "#3a2618", n, undefined, false);
    // el hornero, chiquito, en la punta
    const ave = MeshBuilder.CreateSphere("hrAve", { diameter: 0.18, segments: 3 }, this.scene);
    ave.position.set(-0.22, 1.85, -0.05); ave.scaling.set(1.3, 0.9, 0.9);
    this.pieza(ave, "#b06b3e", n);
  }

  private detallesEstablo(): void {
    const e = "establo" as const;
    const n = this.nodo("detEstablo", V(e), ROT(e));
    // Palenque (para atar caballos) frente al portón
    for (const x of [-5.2, -2.2]) this.caja(`palPoste${x}`, 0.2, 1.2, 0.2, x, 0, -6.2, "#6b4a2e", n, e);
    this.caja("palBarra", 3.4, 0.12, 0.12, -3.7, 1.0, -6.2, "#8b6239", n, e);
    // Farol sobre el portón y marcos blancos en las ventanas
    this.caja("estFarolBrazo", 0.08, 0.08, 0.5, 0, 3.2, -4.3, "#2f2f2f", n, e);
    this.caja("estFarol", 0.32, 0.4, 0.32, 0, 2.85, -4.55, "#e8d27a", n, e);
    for (const x of [-4.2, -2.4, 2.4, 4.2]) {
      this.caja(`estMarcoA${x}`, 1.2, 0.1, 0.08, x, 2.4, -4.1, "#fbf7ee", n, e);
      this.caja(`estMarcoB${x}`, 1.2, 0.1, 0.08, x, 1.9, -4.1, "#fbf7ee", n, e);
      this.caja(`estMarcoC${x}`, 0.08, 0.8, 0.08, x, 2.0, -4.1, "#fbf7ee", n, e);
    }
    // Veleta en la cumbrera: poste, flecha y cruz de los puntos cardinales
    this.caja("veletaPoste", 0.07, 1.3, 0.07, 3.5, 6.0, 0, "#2f2f2f", n, e);
    this.caja("veletaCruzA", 0.9, 0.05, 0.05, 3.5, 6.85, 0, "#2f2f2f", n, e);
    this.caja("veletaCruzB", 0.05, 0.05, 0.9, 3.5, 6.85, 0, "#2f2f2f", n, e);
    this.caja("veletaFlecha", 1.3, 0.18, 0.05, 3.5, 7.15, 0, "#2f2f2f", n, e).rotation.y = 0.6;
    // Alero lateral con fardos y una carretilla con pasto
    this.caja("aleroPosteA", 0.18, 2.4, 0.18, -8.6, 0, 3.4, "#6b4a2e", n, e);
    this.caja("aleroPosteB", 0.18, 2.4, 0.18, -8.6, 0, -1.4, "#6b4a2e", n, e);
    const alero = this.caja("aleroChapa", 2.8, 0.1, 5.6, -7.4, 2.4, 1.0, "#a3402f", n, e);
    alero.rotation.z = -0.18;
    for (const [x, y, z] of [[-7.6, 0, 2.6], [-7.6, 0, 1.2], [-7.6, 0.75, 1.9]] as const) this.caja(`aleroFardo${z}${y}`, 1.1, 0.75, 1.3, x, y, z, "#d9c070", n, e);
    const carr = this.nodo("carretilla", new Vector3(5.9, 0, -5.6), 0.5); carr.parent = n;
    this.caja("carrBatea", 1.1, 0.45, 0.75, 0, 0.35, 0, "#3f6b8a", carr, e);
    this.caja("carrPasto", 1.0, 0.18, 0.65, 0, 0.8, 0, "#d9c070", carr, e);
    const rueda = MeshBuilder.CreateCylinder("carrRueda", { height: 0.12, diameter: 0.5, tessellation: 8 }, this.scene);
    rueda.rotation.z = Math.PI / 2; rueda.position.set(0.7, 0.25, 0);
    this.pieza(rueda, "#2f2f2f", carr, e);
    for (const z of [-0.3, 0.3]) this.caja(`carrMango${z}`, 1.0, 0.06, 0.06, -0.8, 0.55, z, "#8b6239", carr, e);
  }

  private detallesRecuperacion(): void {
    const e = "recuperacion" as const;
    const n = this.nodo("detRecup", V(e), ROT(e));
    // Banco bajo la galería, macetas con flores y un farol
    this.caja("rcBanco", 1.8, 0.1, 0.45, -1.9, 0.45, -3.2, "#8b6239", n, e);
    for (const x of [-2.6, -1.2]) this.caja(`rcBancoPata${x}`, 0.1, 0.45, 0.4, x, 0, -3.2, "#6b4a2e", n, e);
    for (const [x, c] of [[-3.3, "#d9534f"], [1.9, "#f2cf44"], [3.3, "#b88fd8"]] as const) {
      const m = MeshBuilder.CreateCylinder(`rcMaceta${x}`, { height: 0.45, diameterTop: 0.55, diameterBottom: 0.38, tessellation: 7 }, this.scene);
      m.position.set(x, 0.23, -4.2);
      this.pieza(m, "#b5643a", n, e);
      const f = MeshBuilder.CreateIcoSphere(`rcFlores${x}`, { radius: 0.32, subdivisions: 1, flat: true }, this.scene);
      f.position.set(x, 0.62, -4.2); f.scaling.y = 0.7;
      this.pieza(f, "#4f7a38", n, e);
      for (let k = 0; k < 4; k++) this.pieza(MeshBuilder.CreateIcoSphere(`rcFlor${x}${k}`, { radius: 0.09, subdivisions: 1, flat: true }, this.scene), c, n, e)
        .position.set(x + Math.cos(k * 1.6) * 0.2, 0.78, -4.2 + Math.sin(k * 1.6) * 0.2);
    }
    this.caja("rcFarol", 0.26, 0.34, 0.26, 2.6, 2.05, -2.7, "#e8d27a", n, e);
    // Baldes junto al bebedero
    for (const x of [-6.8, -6.3]) {
      const b = MeshBuilder.CreateCylinder(`rcBalde${x}`, { height: 0.42, diameterTop: 0.42, diameterBottom: 0.32, tessellation: 7 }, this.scene);
      b.position.set(x, 0.21, -4.4);
      this.pieza(b, "#8a8f93", n, e);
    }
  }

  private detallesPicadero(): void {
    const e = "entrenamiento" as const;
    const n = this.nodo("detPicadero", V(e), ROT(e));
    // Huella del caballo dando vueltas: anillo de arena más oscura
    const huella = MeshBuilder.CreateTorus("pcHuella", { diameter: 10.4, thickness: 1.2, tessellation: 28 }, this.scene);
    huella.scaling.y = 0.02; huella.position.y = 0.125;
    this.pieza(huella, "#c9ae7c", n, e, false);
    // Dos tachos y un rastrillo apoyado en el cerco
    for (const [x, z, c] of [[-4.5, 3.6, "#2e6fd1"], [-3.6, 4.4, "#c0392b"]] as const) {
      const t = MeshBuilder.CreateCylinder(`pcTacho${x}`, { height: 0.9, diameter: 0.6, tessellation: 9 }, this.scene);
      t.position.set(x, 0.57, z);
      this.pieza(t, c, n, e);
    }
    const rastrillo = this.caja("pcRastrillo", 0.06, 1.7, 0.06, 7.95, 0, -1.2, "#8b6239", n, e);
    rastrillo.rotation.z = 0.35;
    // Mangas y monturas colgadas en el tinglado
    this.caja("tgMontura2", 0.7, 0.25, 0.5, 9.7, 0.9, 2.6, "#6b3f22", n, e);
    this.caja("tgCaballete2", 1.4, 0.9, 0.35, 9.7, 0, 2.6, "#8b6239", n, e);
    this.caja("tgManta", 0.6, 0.5, 0.06, 11.8, 1.1, 0.42, "#2e5a87", n, e);
  }

  private detallesPotrero(): void {
    const w = POTRERO_W, h = POTRERO_H;
    this.piezaActual = "potrero";
    const n = this.nodo("detPotrero", V("potrero"), ROT("potrero"));
    // Comedero con pasto, bebedero y piedra de sal
    this.caja("ptComedero", 2.4, 0.6, 0.9, -w / 2 + 2, 0, h / 2 - 1.4, "#8b6239", n);
    this.caja("ptPasto", 2.2, 0.3, 0.7, -w / 2 + 2, 0.6, h / 2 - 1.4, "#d9c070", n);
    this.caja("ptBebedero", 2.2, 0.5, 0.7, w / 2 - 2.2, 0, -h / 2 + 1.3, "#8a8f93", n);
    this.caja("ptAgua", 2.0, 0.02, 0.5, w / 2 - 2.2, 0.49, -h / 2 + 1.3, "#6aa6c9", n);
    this.caja("ptSal", 0.4, 0.3, 0.4, -1, 0, -h / 2 + 1.2, "#e9e2d8", n);
    this.piezaActual = null;
  }

  /** Fuera del alambrado: lotes de trigo y un girasolar, como en la llanura. */
  private cultivos(az: () => number): void {
    // Trigo: franjas doradas con surcos
    for (let i = 0; i < 9; i++) {
      const f = MeshBuilder.CreateGround(`trigo${i}`, { width: 24, height: 1.6 }, this.scene);
      f.position.set(-ANCHO / 2 - 16, 0.12 + (i % 2) * 0.03, -ALTO / 2 - 6 + i * 1.75);
      this.pieza(f, i % 2 ? "#d8bb62" : "#cdae55", undefined, undefined, false);
    }
    // Girasoles: tallo + flor (instancias), en hileras al este
    const tallo = MeshBuilder.CreateCylinder("gsTallo", { height: 1.6, diameter: 0.07, tessellation: 3 }, this.scene);
    tallo.material = this.mat("#5f7f3a"); tallo.isPickable = false;
    const flor = MeshBuilder.CreateCylinder("gsFlor", { height: 0.08, diameter: 0.55, tessellation: 8 }, this.scene);
    flor.material = this.mat("#f2c12e"); flor.isPickable = false;
    const centro = MeshBuilder.CreateCylinder("gsCentro", { height: 0.1, diameter: 0.26, tessellation: 6 }, this.scene);
    centro.material = this.mat("#5a3a1e"); centro.isPickable = false;
    let k = 0;
    for (let fila = 0; fila < 9; fila++) for (let j = 0; j < 22; j++) {
      const x = ANCHO / 2 + 6 + fila * 1.4 + (az() - 0.5) * 0.3, z = -ALTO / 2 + 2 + j * 1.25 + (az() - 0.5) * 0.3;
      const t = this.inst(tallo); t.position.set(x, 0.8, z);
      for (const [m, dy] of [[flor, 1.62], [centro, 1.66]] as const) {
        const fi = this.inst(m);
        fi.position.set(x, dy, z - 0.08); fi.rotation.x = -1.1;   // miran al sol (al norte, hacia la cámara)
      }
      k++;
    }
  }

  // ------------------------------------------------------------------ cámara y entrada

  private ajustarOrto(): void {
    const w = this.engine.getRenderWidth(), h = this.engine.getRenderHeight();
    const asp = w / Math.max(1, h);
    const v = this.zoom / 2;
    this.cam.orthoLeft = -v * asp; this.cam.orthoRight = v * asp;
    this.cam.orthoTop = v; this.cam.orthoBottom = -v;
  }

  acercar(f: number): void { this.zoom = Math.min(72, Math.max(14, this.zoom * f)); }

  private controles(): void {
    let abajo: { x: number; y: number; mov: number } | null = null;
    // Qué se agarró al apretar: el objeto nuevo, lo seleccionado o nada (cámara). desfase = centro − punto agarrado.
    let agarre: { que: "nuevo" | "sel"; desfase: [number, number]; empezado: boolean } | null = null;
    this.scene.onPointerObservable.add((pi) => {
      if (!this.activo) { abajo = null; agarre = null; return; }
      const ev = pi.event as PointerEvent & WheelEvent;
      if (pi.type === PointerEventTypes.POINTERWHEEL) { this.acercar(ev.deltaY > 0 ? 1.1 : 0.9); return; }
      if (pi.type === PointerEventTypes.POINTERDOWN) {
        abajo = { x: ev.clientX, y: ev.clientY, mov: 0 };
        agarre = null;
        const q = this.sueloBajoPuntero();
        if (!q) return;
        if (this.fantasma && !this.fantasma.uid && this.tocaFantasma(q)) {
          const c = this.centroFantasma()!;
          agarre = { que: "nuevo", desfase: [c[0] - q[0], c[1] - q[1]], empezado: true };
        } else if (this.seleccion && this.tocaSeleccion(q)) {
          const c = this.centroSeleccion()!;
          agarre = { que: "sel", desfase: [c[0] - q[0], c[1] - q[1]], empezado: false };
        }
        return;
      }
      if (pi.type === PointerEventTypes.POINTERMOVE && abajo && agarre) {
        abajo.mov += Math.abs(ev.clientX - abajo.x) + Math.abs(ev.clientY - abajo.y);
        abajo.x = ev.clientX; abajo.y = ev.clientY;
        if (!agarre.empezado) {
          if (abajo.mov < 6) return;               // un toque con temblor no es arrastrar
          agarre.empezado = this.empezarArrastre();
          if (!agarre.empezado) { agarre = null; return; }
        }
        const q = this.sueloBajoPuntero();
        if (q) this.arrastrarA(q[0] + agarre.desfase[0], q[1] + agarre.desfase[1]);
        return;
      }
      if (pi.type === PointerEventTypes.POINTERMOVE && abajo) {
        const dx = ev.clientX - abajo.x, dy = ev.clientY - abajo.y;
        abajo.mov += Math.abs(dx) + Math.abs(dy); abajo.x = ev.clientX; abajo.y = ev.clientY;
        // desplazar sobre el suelo: derecha de la cámara y "adelante" proyectado
        const porPx = this.zoom / Math.max(1, this.engine.getRenderHeight() * this.engine.getHardwareScalingLevel());
        const der = this.cam.getDirection(Vector3.Right()); der.y = 0; der.normalize();
        const ade = this.cam.getDirection(Vector3.Forward()); ade.y = 0; ade.normalize();
        const k = 1 / Math.max(0.3, Math.cos(this.cam.beta));      // en el suelo, la profundidad se ve acortada
        const t = this.cam.target.add(der.scale(-dx * porPx)).add(ade.scale(dy * porPx * k));
        t.x = Math.max(-ANCHO / 2 - 20, Math.min(ANCHO / 2 + 20, t.x)); t.z = Math.max(-ALTO / 2 - 20, Math.min(ALTO / 2 + 20, t.z));
        this.cam.target.copyFrom(t);
        return;
      }
      if (pi.type === PointerEventTypes.POINTERUP && abajo) {
        const fue = agarre, mov = abajo.mov;
        abajo = null; agarre = null;
        if (fue?.que === "sel" && fue.empezado) { this.soltar(); return; }
        if (fue?.que === "nuevo" && mov >= 6) return;
        if (mov >= 8) return;                       // fue un arrastre de cámara
        this.tocar();
      }
    });
  }

  /** Un toque: elige lo que hay debajo; en el suelo, lleva ahí al objeto nuevo o quita la selección. */
  private tocar(): void {
    const r = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (m) => !!m.metadata?.deco || !!m.metadata?.pieza);
    let uid = r?.pickedMesh?.metadata?.deco as string | undefined;
    const pz = r?.pickedMesh?.metadata?.pieza as Pieza | undefined;
    // Objetos finos (un farol): también vale tocar su casilla
    if (!uid && !pz) {
      const q = this.sueloBajoPuntero();
      if (q) for (const [id, d] of this.decos) {
        const o = objeto(d.puesto.id);
        if (!o) continue;
        const [w, h] = d.puesto.rot % 2 ? [o.h, o.w] : [o.w, o.h];
        if (dentro({ x: (d.puesto.cx + w / 2) * CELDA, z: (d.puesto.cz + h / 2) * CELDA, w: w * CELDA, h: h * CELDA }, q[0], q[1], 0.3)) { uid = id; break; }
      }
    }
    if (this.fantasma && !this.fantasma.uid) {            // colocando algo nuevo: el toque lo lleva ahí
      const c = this.celdaBajoPuntero();
      if (c) { this.moverFantasma(c[0], c[1]); this.alMoverNuevo(c[0], c[1]); }
      return;
    }
    if (uid) this.seleccionar({ tipo: "deco", uid });
    else if (pz) {
      this.seleccionar({ tipo: "pieza", pieza: pz });
      const ed = r?.pickedMesh?.metadata?.edificio as TipoEdificio | undefined;
      if (ed) this.alElegir(ed);
    } else this.seleccionar(null);
  }

  /** Marca lo seleccionado con un borde dorado. */
  seleccionar(s: Seleccion | null, avisar = true): void {
    this.seleccion = s;
    for (const [id, d] of this.decos) if (d.mesh) d.mesh.renderOutline = s?.tipo === "deco" && s.uid === id;
    for (const m of this.mundo?.meshes ?? []) {
      if (!(m instanceof Mesh) || !m.metadata?.pieza) continue;
      const on = s?.tipo === "pieza" && m.metadata.pieza === s.pieza;
      m.renderOutline = on;
      if (on) { m.outlineColor = hex("#e8c04f"); m.outlineWidth = 0.08; }
    }
    if (avisar) this.alSeleccionar(s);
  }

  private sueloBajoPuntero(): [number, number] | null {
    const r = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (m) => m.name === "suelo");
    return r?.hit && r.pickedPoint ? [r.pickedPoint.x, r.pickedPoint.z] : null;
  }

  private rectSeleccion(): Rect | null {
    const s = this.seleccion;
    if (!s) return null;
    if (s.tipo === "pieza") return this.rects[s.pieza];
    const d = this.decos.get(s.uid), o = d && objeto(d.puesto.id);
    if (!d || !o) return null;
    const [w, h] = d.puesto.rot % 2 ? [o.h, o.w] : [o.w, o.h];
    return { x: (d.puesto.cx + w / 2) * CELDA, z: (d.puesto.cz + h / 2) * CELDA, w: w * CELDA, h: h * CELDA };
  }
  private centroSeleccion(): [number, number] | null {
    const s = this.seleccion;
    if (s?.tipo === "pieza") return [D[s.pieza].x, D[s.pieza].z];
    const r = this.rectSeleccion();
    return r ? [r.x, r.z] : null;
  }
  /** Apretar sobre lo seleccionado (o cerca, con margen para el dedo). */
  private tocaSeleccion(q: [number, number]): boolean {
    const r = this.rectSeleccion();
    return !!r && dentro(r, q[0], q[1], 1.2);
  }
  private centroFantasma(): [number, number] | null {
    const f = this.fantasma;
    if (!f) return null;
    const o = objeto(f.id)!;
    const [w, h] = f.rot % 2 ? [o.h, o.w] : [o.w, o.h];
    return [(f.cx + w / 2) * CELDA, (f.cz + h / 2) * CELDA];
  }

  /** Empieza a arrastrar lo seleccionado: aparece la copia que sigue al dedo y se esconde el original. */
  private empezarArrastre(): boolean {
    const s = this.seleccion;
    if (!s) return false;
    this.verGrilla(true);
    if (s.tipo === "pieza") { this.ponerFantasmaPieza(s.pieza); return !!this.fantasmaPieza; }
    const d = this.decos.get(s.uid);
    if (!d) return false;
    this.ponerFantasma(d.puesto.id, d.puesto.rot, d.puesto.cx, d.puesto.cz, s.uid);
    if (d.mesh) d.mesh.isVisible = false;
    for (const m of d.estatua?.meshes ?? []) m.isVisible = false;
    return true;
  }

  /** Lleva lo que se arrastra a un centro (metros): las piezas van al metro, los adornos a la casilla. */
  private arrastrarA(x: number, z: number): void {
    if (this.fantasmaPieza) {
      const u = [Math.round(x), Math.round(z)];
      if (u[0] !== this.fantasmaPieza.u.x || u[1] !== this.fantasmaPieza.u.z) this.moverFantasmaPieza(u[0], u[1]);
      return;
    }
    const f = this.fantasma;
    if (!f) return;
    const o = objeto(f.id)!;
    const [w, h] = f.rot % 2 ? [o.h, o.w] : [o.w, o.h];
    const cx = Math.round(x / CELDA - w / 2), cz = Math.round(z / CELDA - h / 2);
    if (cx !== f.cx || cz !== f.cz) { this.moverFantasma(cx, cz); if (!f.uid) this.alMoverNuevo(cx, cz); }
  }

  /** Al soltar: si entra, queda ahí (lo guarda la interfaz); si no, vuelve a su lugar. */
  private soltar(): void {
    this.verGrilla(!!this.fantasma && !this.fantasma.uid);
    if (this.fantasmaPieza) {
      const { pieza, u } = this.fantasmaPieza;
      const cambio = u.x !== D[pieza].x || u.z !== D[pieza].z;
      const ok = cambio && this.validarPieza(pieza, u);
      this.ponerFantasmaPieza(null);
      if (ok) this.alSoltarPieza(pieza, u);
      return;
    }
    const f = this.fantasma;
    if (!f?.uid) return;
    const d = this.decos.get(f.uid);
    const cambio = !d || f.cx !== d.puesto.cx || f.cz !== d.puesto.cz;
    const ok = cambio && this.validarDeco(f.id, f.cx, f.cz, f.rot, f.uid);
    const { uid, cx, cz } = f;
    this.ponerFantasma(null);
    if (d?.mesh) d.mesh.isVisible = true;
    for (const m of d?.estatua?.meshes ?? []) m.isVisible = true;
    if (ok) this.alSoltarDeco(uid, cx, cz);
  }

  /** Objeto nuevo elegido en el Mercado (null lo saca). Aparece en el centro de la vista, con la cuadrícula. */
  ponerNuevo(id: string | null, rot = 0, cx?: number, cz?: number): void {
    if (this.fantasma?.uid) return;
    // Como en Clash of Clans: aparece en el lugar libre más cercano al centro de la vista
    if (id && cx === undefined) {
      const o = objeto(id);
      const [w, h] = o ? (rot % 2 ? [o.h, o.w] : [o.w, o.h]) : [1, 1];
      const c0 = Math.round(this.cam.target.x / CELDA - w / 2), z0 = Math.round(this.cam.target.z / CELDA - h / 2);
      buscar: for (let r = 0; r < 14; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (this.validarDeco(id, c0 + dx, z0 + dz, rot)) { cx = c0 + dx; cz = z0 + dz; break buscar; }
      }
    }
    this.ponerFantasma(id, rot, cx, cz);
    this.verGrilla(!!id);
    if (id) this.seleccionar(null);
  }
  get celdaNuevo(): [number, number] | null { return this.fantasma && !this.fantasma.uid ? [this.fantasma.cx, this.fantasma.cz] : null; }

  /** Ubica la botonera flotante encima de lo seleccionado o del objeto nuevo. */
  private ubicarBotonera(): void {
    const b = this.botonera;
    if (!b) return;
    let p: Vector3 | null = null;
    const cf = this.centroFantasma();
    if (cf && !this.fantasma?.uid) p = new Vector3(cf[0], 3.2, cf[1]);
    else if (this.seleccion && !this.fantasma && !this.fantasmaPieza) {
      const c = this.centroSeleccion(), r = this.rectSeleccion();
      if (c && r) p = new Vector3(c[0], 1.5, r.z - r.h / 2 - 0.5);   // delante (abajo en pantalla)
    }
    if (!p) { b.style.visibility = "hidden"; return; }
    const vp = this.cam.viewport.toGlobal(this.engine.getRenderWidth(), this.engine.getRenderHeight());
    const k = this.engine.getHardwareScalingLevel();
    const s = Vector3.Project(p, Matrix.Identity(), this.scene.getTransformMatrix(), vp);
    b.style.visibility = "visible";
    b.style.transform = `translate(${s.x * k}px, ${s.y * k}px) translate(-50%, ${cf && !this.fantasma?.uid ? "-100%" : "0"})`;
  }

  // ------------------------------------------------------------------ decoración

  /** Lo fijo del campo por celda: "fijo" (edificios, potrero, molino, laguna, árboles) o "camino" (caminos y patio). */
  celdasBloqueadas(): Ocupacion {
    if (this.bloqueadasCache) return this.bloqueadasCache;
    const b: Ocupacion = new Map();
    const pts = [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]];
    for (let x = CELDAS.x0; x <= CELDAS.x1; x++) for (let z = CELDAS.z0; z <= CELDAS.z1; z++) {
      if (pts.some(([u, v]) => !this.libre((x + u) * CELDA, (z + v) * CELDA, 0.15, false))) b.set(`${x},${z}`, "fijo");
      else if (pts.some(([u, v]) => sobreCamino((x + u) * CELDA, (z + v) * CELDA, 0.1))) b.set(`${x},${z}`, "camino");
    }
    return (this.bloqueadasCache = b);
  }

  private celdaBajoPuntero(): [number, number] | null {
    const r = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (m) => m.name === "suelo");
    if (!r?.hit || !r.pickedPoint) return null;
    const o = this.fantasma ? objeto(this.fantasma.id) : null;
    const [w, h] = o ? (this.fantasma!.rot % 2 ? [o.h, o.w] : [o.w, o.h]) : [1, 1];
    return [Math.round(r.pickedPoint.x / CELDA - w / 2), Math.round(r.pickedPoint.z / CELDA - h / 2)];
  }

  /** Cuadrícula y celdas bloqueadas, visibles mientras se decora. */
  verGrilla(si: boolean): void {
    if (!si) { this.grilla?.dispose(); this.grilla = null; return; }
    if (this.grilla) return;
    const lineas: Vector3[][] = [];
    for (let x = CELDAS.x0; x <= CELDAS.x1 + 1; x++) lineas.push([new Vector3(x * CELDA, 0.12, CELDAS.z0 * CELDA), new Vector3(x * CELDA, 0.12, (CELDAS.z1 + 1) * CELDA)]);
    for (let z = CELDAS.z0; z <= CELDAS.z1 + 1; z++) lineas.push([new Vector3(CELDAS.x0 * CELDA, 0.12, z * CELDA), new Vector3((CELDAS.x1 + 1) * CELDA, 0.12, z * CELDA)]);
    const g = MeshBuilder.CreateLineSystem("grilla", { lines: lineas }, this.scene);
    g.color = new Color3(1, 1, 1); g.alpha = 0.35; g.isPickable = false;
    // celdas bloqueadas: baldosas rojizas translúcidas
    const tile = MeshBuilder.CreateGround("bloqueada", { width: CELDA * 0.92, height: CELDA * 0.92 }, this.scene);
    const tm = new StandardMaterial("bloqueadaMat", this.scene);
    tm.diffuseColor = hex("#b34a3c"); tm.alpha = 0.32; tm.specularColor = Color3.Black(); tm.disableLighting = true; tm.emissiveColor = hex("#b34a3c");
    tile.material = tm; tile.isPickable = false; tile.parent = g;
    const buf: number[] = [];
    for (const [k, tipo] of this.celdasBloqueadas()) {
      if (tipo !== "fijo") continue;
      const [x, z] = k.split(",").map(Number);
      buf.push(...Matrix.Translation((x + 0.5) * CELDA, 0.11, (z + 0.5) * CELDA).asArray());
    }
    tile.thinInstanceSetBuffer("matrix", new Float32Array(buf), 16, true);
    this.grilla = g;
  }

  /** Muestra un objeto "fantasma" para elegir dónde ponerlo (null lo saca). */
  private ponerFantasma(id: string | null, rot = 0, cx?: number, cz?: number, uid?: string): void {
    if (this.fantasma) { this.fantasma.mesh?.dispose(false, false); this.fantasma.huella.dispose(false, true); this.fantasma = null; }
    if (!id) return;
    const o = objeto(id);
    if (!o) return;
    const mesh = construirDeco(this.scene, id, (c) => this.mat(c), "fantasma");
    if (mesh) { mesh.visibility = 0.9; mesh.isPickable = true; mesh.metadata = { fantasma: true }; mesh.rotation.y = rot * Math.PI / 2; }
    const huella = MeshBuilder.CreateGround("huella", { width: o.w * CELDA, height: o.h * CELDA }, this.scene);
    const hm = new StandardMaterial("huellaMat", this.scene);
    hm.disableLighting = true; hm.alpha = 0.45; hm.specularColor = Color3.Black();
    huella.material = hm; huella.isPickable = true; huella.metadata = { fantasma: true }; huella.rotation.y = rot * Math.PI / 2;
    const ini = cx !== undefined && cz !== undefined ? [cx, cz] : [Math.round(this.cam.target.x / CELDA), Math.round(this.cam.target.z / CELDA)];
    this.fantasma = { id, rot, mesh, huella, cx: ini[0], cz: ini[1], uid };
    this.moverFantasma(ini[0], ini[1]);
  }

  moverFantasma(cx: number, cz: number): void {
    const f = this.fantasma;
    if (!f) return;
    const o = objeto(f.id)!;
    const [w, h] = f.rot % 2 ? [o.h, o.w] : [o.w, o.h];
    f.cx = cx; f.cz = cz;
    const c = centroDe(cx, cz, w, h, CELDA);
    f.mesh?.position.copyFrom(c);
    f.huella.position.set(c.x, 0.13, c.z);
    const ok = this.validarDeco(f.id, cx, cz, f.rot, f.uid);
    (f.huella.material as StandardMaterial).emissiveColor = ok ? hex("#3fae5a") : hex("#c0392b");
  }



  /** ¿El punto (en el suelo) cae sobre el objeto nuevo? Con margen para el dedo. */
  private tocaFantasma(q: [number, number]): boolean {
    const f = this.fantasma;
    if (!f) return false;
    const o = objeto(f.id)!;
    const [w, h] = f.rot % 2 ? [o.h, o.w] : [o.w, o.h];
    const c = this.centroFantasma()!;
    return Math.abs(q[0] - c[0]) < w * CELDA / 2 + 1.2 && Math.abs(q[1] - c[1]) < h * CELDA / 2 + 1.2;
  }

  /**
   * Muestra una pieza "fantasma" (copia translúcida del edificio, con su huella verde o roja y una flecha hacia la
   * puerta) para elegir dónde va. La pieza real se esconde mientras tanto. null la saca y vuelve a mostrar la real.
   */
  private ponerFantasmaPieza(pieza: Pieza | null, u?: Ubicacion): void {
    const f = this.fantasmaPieza;
    if (f) {
      f.nodo.dispose(false, false); f.huella.dispose(false, true); f.flecha.dispose(false, true);
      for (const m of f.ocultas) if (!m.isDisposed()) m.isVisible = true;
      this.fantasmaPieza = null;
    }
    if (!pieza || !this.mundo) return;
    const nodo = new TransformNode("fantasmaPieza", this.scene);
    const ocultas: AbstractMesh[] = [];
    for (const m of this.mundo.meshes) {
      if (m.metadata?.pieza !== pieza || !(m instanceof Mesh) || !m.isVisible) continue;
      const c = m.clone(`fp_${m.name}`, null, true);
      if (!c) continue;
      c.unfreezeWorldMatrix();
      c.parent = nodo; c.visibility = 0.55; c.isPickable = true; c.metadata = { fantasma: true };
      m.isVisible = false; ocultas.push(m);
    }
    const huella = MeshBuilder.CreateGround("huellaPieza", { width: 1, height: 1 }, this.scene);
    const hm = new StandardMaterial("huellaPiezaMat", this.scene);
    hm.disableLighting = true; hm.alpha = 0.4; hm.specularColor = Color3.Black();
    huella.material = hm; huella.isPickable = true; huella.metadata = { fantasma: true };
    const flecha = MeshBuilder.CreateDisc("flechaPieza", { radius: 1.2, tessellation: 3 }, this.scene);
    flecha.material = hm; flecha.rotation.x = Math.PI / 2; flecha.isPickable = false;
    this.fantasmaPieza = { pieza, u: { ...(u ?? D[pieza]) }, nodo, huella, flecha, ocultas };
    this.moverFantasmaPieza(this.fantasmaPieza.u.x, this.fantasmaPieza.u.z, this.fantasmaPieza.u.rot);
  }

  private moverFantasmaPieza(x: number, z: number, rot?: 0 | 1 | 2 | 3): void {
    const f = this.fantasmaPieza;
    if (!f) return;
    f.u = { x, z, rot: rot ?? f.u.rot };
    // Las copias tienen la posición vieja "horneada": se llevan con un nodo que gira y traslada la diferencia
    const viejo = D[f.pieza], dr = (f.u.rot - viejo.rot + 4) % 4;
    const [ax, az] = girar(viejo.x, viejo.z, dr);
    f.nodo.rotation.y = dr * Math.PI / 2;
    f.nodo.position.set(x - ax, 0.02, z - az);
    const r = rectDe(f.pieza, f.u);
    f.huella.position.set(r.x, 0.14, r.z); f.huella.scaling.set(r.w, 1, r.h);
    const puerta: Record<Pieza, [number, number]> = { establo: [0, -1], entrenamiento: [-0.7, -0.7], recuperacion: [0, -1], potrero: [1, 0], molino: [0, -1] };
    const [px, pz] = girar(puerta[f.pieza][0], puerta[f.pieza][1], f.u.rot);
    f.flecha.position.set(r.x + px * (r.w / 2 + 1.6), 0.15, r.z + pz * (r.h / 2 + 1.6));
    f.flecha.rotation.y = Math.atan2(px, pz) - Math.PI / 2;
    const ok = this.validarPieza(f.pieza, f.u);
    (f.huella.material as StandardMaterial).emissiveColor = ok ? hex("#3fae5a") : hex("#c0392b");
  }



  /** Dibuja los objetos puestos (rehace solo los que cambiaron). */
  async mostrarDecoracion(puestos: Puesto[]): Promise<void> {
    if (!(await this.listo)) return;
    const vivos = new Set(puestos.map((p) => p.uid));
    for (const [uid, d] of this.decos) if (!vivos.has(uid)) { this.borrarDeco(d); this.decos.delete(uid); }
    for (const p of puestos) {
      const clave = `${p.id}|${p.cx}|${p.cz}|${p.rot}`;
      const ya = this.decos.get(p.uid);
      if (ya && ya.clave === clave) { ya.puesto = p; continue; }
      if (ya) this.borrarDeco(ya);
      const o = objeto(p.id);
      if (!o) continue;
      const [w, h] = p.rot % 2 ? [o.h, o.w] : [o.w, o.h];
      const c = centroDe(p.cx, p.cz, w, h, CELDA);
      const mesh = construirDeco(this.scene, p.id, (col) => this.mat(col), `deco_${p.uid}`);
      let estatua: HorseModelView | undefined;
      if (mesh) {
        mesh.position.copyFrom(c); mesh.rotation.y = p.rot * Math.PI / 2;
        mesh.metadata = { deco: p.uid }; mesh.isPickable = true; mesh.receiveShadows = true;
        mesh.outlineColor = hex("#e8c04f"); mesh.outlineWidth = 0.06;
        this.sombras.addShadowCaster(mesh, false);
      }
      if (p.id === "estatua" || p.id === "estatuaOro") {
        estatua = new HorseModelView(this.scene, 800 + this.decos.size, { composicion: { Criollo: 1 }, pelaje: { genotipo: { E: [true, true], A: [true, true], Cr: [false, false], D: [false, false], G: [false, false], Rn: [false, false], To: [false, false], Lp: [false, false] }, marcas: { cara: 0, patas: [0, 0, 0, 0] }, semillaManchas: 1 }, tamano: 0.8 }, false);
        estatua.estatua(new Vector3(c.x, 1.32, c.z), p.rot * Math.PI / 2 + Math.PI / 2,
          p.id === "estatuaOro" ? hex("#d8b24a") : hex("#7a5a3a"), p.id === "estatuaOro" ? 0.9 : 0.35);
        for (const m of estatua.meshes) { m.isPickable = true; m.metadata = { deco: p.uid }; this.sombras.addShadowCaster(m, false); }
      }
      this.decos.set(p.uid, { mesh, estatua, clave, puesto: p });
    }
    if (this.seleccion?.tipo === "deco" && !this.decos.has(this.seleccion.uid)) this.seleccionar(null);
    else this.seleccionar(this.seleccion, false);
  }

  private borrarDeco(d: { mesh: Mesh | null; estatua?: HorseModelView }): void {
    d.mesh?.dispose(false, false);
    if (d.estatua) { d.estatua.dispose(); d.estatua.root.dispose(false, true); for (const m of d.estatua.meshes) m.dispose(false, true); }
  }

  // ------------------------------------------------------------------ etiquetas (HTML sobre el 3D)

  /** Capa HTML donde van los carteles de los edificios (los arma esta vista; React solo pasa el contenedor). */
  ponerCapa(div: HTMLDivElement | null): void {
    this.capa = div;
    this.etiquetas.clear();
    if (!div) return;
    div.innerHTML = "";
    for (const t of EDIFICIOS) {
      const e = document.createElement("button");
      e.className = "cartel";
      e.onclick = () => this.alElegir(t);
      div.appendChild(e);
      this.etiquetas.set(t, e as unknown as HTMLDivElement);
    }
  }

  textoCartel(t: TipoEdificio, html: string): void {
    const e = this.etiquetas.get(t);
    if (e && e.innerHTML !== html) e.innerHTML = html;
  }

  private ubicarEtiquetas(): void {
    if (!this.capa) return;
    const vp = this.cam.viewport.toGlobal(this.engine.getRenderWidth(), this.engine.getRenderHeight());
    const k = this.engine.getHardwareScalingLevel();
    const altura: Record<TipoEdificio, number> = { establo: 7.6, entrenamiento: 3.5, recuperacion: 5.6 };
    for (const [t, e] of this.etiquetas) {
      const p = V(t).add(new Vector3(0, altura[t], 0));
      const s = Vector3.Project(p, Matrix.Identity(), this.scene.getTransformMatrix(), vp);
      e.style.transform = `translate(${s.x * k}px, ${s.y * k}px) translate(-50%, -100%)`;
    }
  }

  // ------------------------------------------------------------------ caballos en el campo

  /** Muestra los caballos: los disponibles pastan en el potrero, los que entrenan caminan en el picadero y los que se
   *  recuperan descansan junto al Centro de recuperación. */
  async mostrarCaballos(lista: Caballo[]): Promise<void> {
    const clave = JSON.stringify(lista.map((c) => [c.id, c.estado, c.pelaje.semillaManchas, c.composicion, coloresDe(c)]));
    if (clave === this.claveCaballos) return;
    this.claveCaballos = clave;
    if (!(await this.listo) || clave !== this.claveCaballos) return;
    for (const h of this.caballos) { h.vista.dispose(); h.vista.root.dispose(false, true); for (const m of h.vista.meshes) m.dispose(false, true); }
    this.caballos = [];
    lista.forEach((c, i) => {
      const v = new HorseModelView(this.scene, 500 + i, { composicion: c.composicion, pelaje: c.pelaje, forma: c.forma, tamano: tamanoDe(c), colores: coloresDe(c), rasgos: c.rasgos, linaje: c.linaje }, false);
      for (const m of v.meshes) { this.sombras.addShadowCaster(m, false); m.isPickable = false; }
      this.caballos.push({ vista: v, c, fase: (i * 0.37) % 1 });
    });
  }

  private moverCaballos(dt: number): void {
    const enPicadero = this.caballos.filter((h) => h.c.estado === "entrenando");
    const enRecup = this.caballos.filter((h) => h.c.estado === "recuperacion" || h.c.estado === "colaRecuperacion");
    const sueltos = this.caballos.filter((h) => !enPicadero.includes(h) && !enRecup.includes(h));
    enPicadero.forEach((h, i) => {
      const v = 1.6, R = 5.2;
      h.fase += (v / (2 * Math.PI * R)) * dt;
      const a = (h.fase + i / Math.max(1, enPicadero.length)) * Math.PI * 2;
      const p = V("entrenamiento").add(new Vector3(Math.cos(a) * R, 0, Math.sin(a) * R));
      h.vista.update(p, Math.atan2(-Math.sin(a), Math.cos(a)), v, dt, this.t);
    });
    enRecup.forEach((h, i) => {
      const p = enMundo("recuperacion", -6.8 + (i % 3) * 1.6, -6.2 - Math.floor(i / 3) * 2.6);
      h.vista.update(p, 0.3 + i * 0.4 + ROT("recuperacion"), 0, dt, this.t);
    });
    sueltos.forEach((h, i) => {
      // pastan quietos en lugares fijos del potrero, mirando a distintos lados
      const cols = 3, fila = Math.floor(i / cols), col = i % cols;
      const p = enMundo("potrero", -POTRERO_W / 2 + 3.5 + col * 6.5 + (fila % 2) * 1.8, -POTRERO_H / 2 + 3 + fila * 3.4);
      h.vista.update(p, 0.8 + i * 1.3 + ROT("potrero"), 0, dt, this.t);
    });
  }
}
