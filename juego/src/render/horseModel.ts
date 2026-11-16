// Caballo a partir de caballo.glb (generado por arte/caballo/exportar.py sobre el modelo low poly de LowPolyFigures, CC BY 4.0).
// - Forma: mezcla de las 8 variantes de raza (morph targets) + articulaciones por raza (meta.juntasRaza), según la composición.
// - Pelaje: colores por vértice calculados desde la genética (domain/pelaje.ts), sin texturas.
// - Movimiento: animaciones Quieto/Paso/Trote/Medio/Galope mezcladas según la velocidad real.
import {
  AnimationGroup, AssetContainer, Color3, LoadAssetContainerAsync, Mesh, MeshBuilder, Scene,
  StandardMaterial, TransformNode, Vector3, VertexBuffer,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { fenotipo, type Fenotipo, type Pelaje } from "../domain/pelaje.ts";
import { formaVisible } from "../domain/rasgos.ts";

/** Nombre de raza en el juego → nombre de la variante (shape key) en el GLB. */
export const RAZA_A_MORPH: Record<string, string> = {
  "Pura Sangre Inglés": "PuraSangre", "Árabe": "Arabe", "Cuarto de Milla": "CuartoDeMilla", "Akhal-Teke": "AkhalTeke",
  "Appaloosa": "Appaloosa", "Criollo": "Criollo", "Andaluz": "Andaluz", "Frisón": "Frison",
};

interface Meta {
  razas: string[]; escala: Record<string, number>; zancada: Record<string, number>; ciclo: number;
  juntasBase: Record<string, number[]>; juntasRaza: Record<string, Record<string, number[]>>;
}

export class CaballoGLB {
  private static porEscena = new Map<Scene, AssetContainer>();
  static meta: Meta | null = null;

  /** Modelo ya cargado para esa escena (la carrera y la ficha 3D tienen cada una el suyo). */
  static para(scene: Scene): AssetContainer | null { return CaballoGLB.porEscena.get(scene) ?? null; }

  /** Carga el modelo una vez por escena. Devuelve false si no existe (se usa el caballo provisorio). */
  static async cargar(scene: Scene, url = "/modelos/caballo.glb"): Promise<boolean> {
    if (CaballoGLB.porEscena.has(scene)) return true;
    try {
      const head = await fetch(url, { method: "HEAD" });
      if (!head.ok) return false;
      if (!CaballoGLB.meta) {
        const m = await fetch(url.replace("caballo.glb", "caballo_meta.json"));
        CaballoGLB.meta = m.ok ? await m.json() : null;
      }
      CaballoGLB.porEscena.set(scene, await LoadAssetContainerAsync(url, scene));
      return true;
    } catch (e) {
      console.warn("[caballos] no se pudo cargar el modelo GLB; se usa el provisorio", e);
      return false;
    }
  }
}

const GAITS = ["Paso", "Trote", "Medio", "Galope"] as const;
const UMBRALES: [number, string, string][] = [
  // [velocidad, aire bajo, aire alto] — mezcla entre aires vecinos
  [0.6, "Quieto", "Paso"], [2.4, "Paso", "Trote"], [6.0, "Trote", "Medio"], [11.0, "Medio", "Galope"],
];

export interface Apariencia {
  composicion: Record<string, number>; pelaje: Pelaje; forma?: number[]; /** 1 = adulto; menor para un potrillo que crece. */ tamano?: number;
  /** Aspecto comprado y montura puesta (colores hex). */ colores?: { crin?: string; cascos?: string; manta?: string; montura?: string };
  /** Fase 5.5: rasgos de su cruza y linaje raro (cambian forma y colores). */ rasgos?: string[]; linaje?: string;
}

export class HorseModelView {
  readonly root: TransformNode;
  readonly meshes: Mesh[] = [];
  readonly fenotipo: Fenotipo;
  private groups = new Map<string, AnimationGroup>();
  private marker: Mesh;
  private zancada: Record<string, number>;
  private escala = 1;
  readonly index: number;

  constructor(scene: Scene, index: number, ap: Apariencia, isPlayer: boolean) {
    this.index = index;
    const c = CaballoGLB.para(scene)!;
    const meta = CaballoGLB.meta;
    this.zancada = meta?.zancada ?? { Paso: 1.75, Trote: 2.9, Medio: 3.8, Galope: 6.6 };
    const inst = c.instantiateModelsToScene((n: string) => `c${index}_${n}`, true, { doNotInstantiate: true });
    this.root = new TransformNode(`caballo${index}`, scene);
    for (const r of inst.rootNodes) r.parent = this.root;
    // Escala de alzada por raza (promedio ponderado)
    let esc = 0, total = 0;
    for (const [r, w] of Object.entries(ap.composicion)) { esc += w * (meta?.escala?.[RAZA_A_MORPH[r]] ?? 1); total += w; }
    // Forma individual + rasgos de la cruza + linaje (Fase 5.5)
    const fv = formaVisible(ap);
    esc = (total > 0 ? esc / total : 1) * (ap.tamano ?? 1) * fv.escala;
    this.escala = esc;
    this.root.scaling.setAll(esc);
    // Proporciones del esqueleto: posición de cada articulación mezclada según la composición racial
    if (meta?.juntasRaza) {
      for (const n of inst.rootNodes) {
        for (const tn of n.getChildTransformNodes(false)) {
          const nombre = tn.name.replace(/^c\d+_/, "");
          if (!meta.juntasBase[nombre]) continue;
          const p = [0, 0, 0];
          for (const [r, w] of Object.entries(ap.composicion)) {
            const j = meta.juntasRaza[RAZA_A_MORPH[r]]?.[nombre] ?? meta.juntasBase[nombre];
            for (let k = 0; k < 3; k++) p[k] += (w / (total || 1)) * j[k];
          }
          tn.position.set(p[0], p[1], p[2]);
        }
      }
      // Proporciones propias: cuello, largo de los remos (levantando el cuerpo lo mismo) y largo del lomo
      for (const n of inst.rootNodes) {
        for (const tn of n.getChildTransformNodes(false)) {
          const nombre = tn.name.replace(/^c\d+_/, "");
          if (/^(Cuello2|Cuello3|Cabeza)$/.test(nombre)) tn.position.scaleInPlace(fv.cuello);
          else if (/^(Radio|CanaD|CuartillaD|Tibia|CanaT|CuartillaT)_/.test(nombre)) tn.position.scaleInPlace(fv.patas);
          else if (/^(Pelvis|Cuello1)$/.test(nombre)) tn.position.z *= fv.cuerpo;
          else if (/^Escapula_/.test(nombre)) tn.position.z *= fv.cuerpo;
          if (nombre === "Cuerpo") tn.position.y += (fv.patas - 1) * 0.94;
        }
      }
    }
    this.fenotipo = fenotipo(ap.pelaje);
    if (fv.cuerpoColor) { const k = Color3.FromHexString(fv.cuerpoColor); this.fenotipo = { ...this.fenotipo, cuerpo: [k.r, k.g, k.b], extremos: null, tordillo: false, rosillo: false, tobiano: false }; }
    if (fv.leopardo) this.fenotipo = { ...this.fenotipo, leopardo: true };
    if (fv.crin) { const k = Color3.FromHexString(fv.crin); this.fenotipo = { ...this.fenotipo, crin: [k.r, k.g, k.b] }; }
    for (const n of inst.rootNodes) {
      for (const m of n.getChildMeshes(false)) {
        const mesh = m as Mesh;
        this.meshes.push(mesh);
        // Formas de raza: influencias = composición racial
        const mtm = mesh.morphTargetManager;
        if (mtm) {
          if (index > 0) mesh.morphTargetManager = mtm.clone(); // cada caballo con su propia mezcla
          const man = mesh.morphTargetManager!;
          for (let t = 0; t < man.numTargets; t++) {
            const tg = man.getTarget(t);
            const clave = meta?.razas?.includes(tg.name) ? tg.name : meta?.razas?.[t];
            const raza = Object.keys(RAZA_A_MORPH).find((k) => RAZA_A_MORPH[k] === clave);
            // Un rasgo corre la mezcla hacia la forma de una raza, sin pasar nunca del puro (sumar formas de más deforma)
            const extra = Object.values(fv.morph).reduce((x, y) => x + y, 0);
            tg.influence = raza ? ((ap.composicion[raza] ?? 0) / (total || 1) + (fv.morph[raza] ?? 0)) / (1 + extra) : 0;
          }
        }
        mesh.alwaysSelectAsActiveMesh = true;   // el esqueleto mueve la malla fuera de su caja original
        pintar(mesh, this.fenotipo, ap.pelaje.semillaManchas, ap.colores);
        if (fv.brillo) {   // brillo metálico (Akhal-Teke, linajes): menos rugoso y un toque de metal
          const mat = mesh.material as unknown as { metallic?: number; roughness?: number } | null;
          if (mat && mat.metallic !== undefined) { mat.metallic = 0.35; mat.roughness = 0.38; }
        }
      }
    }
    for (const g of inst.animationGroups) {
      const nombre = g.name.replace(/^c\d+_/, "");
      this.groups.set(nombre, g);
      g.start(true, 1, g.from, g.to, false);
      g.weight = nombre === "Quieto" ? 1 : 0;
    }
    // Marcador del caballo del jugador
    this.marker = MeshBuilder.CreateCylinder(`c${index}_marcador`, { height: 0.5, diameterTop: 0.45, diameterBottom: 0, tessellation: 4 }, scene);
    const mm = new StandardMaterial(`c${index}_marcadorMat`, scene);
    mm.emissiveColor = Color3.FromHexString("#d8b24a"); mm.diffuseColor = Color3.FromHexString("#d8b24a");
    this.marker.material = mm; this.marker.parent = this.root; this.marker.position.y = 3.0 / (esc || 1);
    this.marker.isVisible = isPlayer;
  }

  /** Igual que el caballo provisorio: posición, orientación, velocidad (m/s) y tiempos de render. */
  update(pos: Vector3, yaw: number, v: number, _dt: number, time: number): void {
    this.root.position.copyFrom(pos);
    this.root.rotation.y = yaw;
    // Pesos por velocidad
    const pesos: Record<string, number> = { Quieto: 0, Paso: 0, Trote: 0, Medio: 0, Galope: 0 };
    if (v <= UMBRALES[0][0]) pesos.Quieto = 1;
    else {
      let hecho = false;
      for (let k = 1; k < UMBRALES.length; k++) {
        const [u0, a] = UMBRALES[k - 1], [u1, , b] = UMBRALES[k];
        if (v < u1) { const w = (v - u0) / (u1 - u0); pesos[a] += 1 - w; pesos[b] += w; hecho = true; break; }
      }
      if (!hecho) {
        const [u0, a, b] = UMBRALES[UMBRALES.length - 1];
        const w = Math.min(1, (v - u0) / 3 + 0.5);
        pesos[a] += 1 - w; pesos[b] += w;
      }
      if (v < UMBRALES[1][0]) { const w = (v - UMBRALES[0][0]) / (UMBRALES[1][0] - UMBRALES[0][0]); pesos.Quieto = Math.max(0, 1 - w * 3); }
    }
    // Velocidad de reproducción: un ciclo por zancada (todos los aires duran 1 s a 24 fps)
    for (const g of GAITS) {
      const grp = this.groups.get(g);
      if (!grp) continue;
      grp.weight = pesos[g];
      grp.speedRatio = Math.max(0.05, v / (this.zancada[g] * this.escala));
    }
    const q = this.groups.get("Quieto");
    if (q) q.weight = pesos.Quieto;
    this.marker.rotation.y = time * 2;
  }

  setPlayerMarker(visible: boolean): void { this.marker.isVisible = visible; }

  /** Libera animaciones y el esqueleto clonado (los nodos y mallas los libera la carrera). */
  /** Lo deja quieto como una estatua, de un solo color (sin pelaje): para la decoración. */
  estatua(pos: Vector3, yaw: number, color: Color3, brillo = 0.4): void {
    this.update(pos, yaw, 0, 0.016, 0);
    for (const g of this.groups.values()) g.goToFrame(g.from), g.pause();
    const m = new StandardMaterial(`estatuaMat${this.index}`, this.root.getScene());
    m.diffuseColor = color; m.specularColor = new Color3(brillo, brillo, brillo); m.specularPower = 24;
    for (const mesh of this.meshes) { mesh.useVertexColors = false; mesh.material = m; }
    this.marker.isVisible = false;
  }

  dispose(): void {
    for (const g of this.groups.values()) g.dispose();
    this.groups.clear();
    for (const m of this.meshes) m.skeleton?.dispose();
  }
}

// ---------------- Pintura del pelaje por vértice ----------------

function hash3(x: number, y: number, z: number, s: number): number {
  let h = Math.imul((x | 0) ^ Math.imul(y | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ s, 0x9e3779b1);
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  return ((h >>> 0) % 10000) / 10000;
}
/** Ruido de valor 3D suave (determinista por semilla). */
function ruido(x: number, y: number, z: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  let r = 0;
  for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) for (let dz = 0; dz < 2; dz++) {
    r += hash3(xi + dx, yi + dy, zi + dz, s) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  }
  return r;
}
const mezcla = (a: number[], b: number[], t: number) => a.map((x, i) => x + (b[i] - x) * t);

/** Pinta cada faceta (triángulo) según su región (COLOR_0.r: 0 cuerpo, 1 crin, 2 cola, 3 casco), el hueso dominante,
 *  su posición en el modelo (Y arriba, Z adelante) y el fenotipo. Una faceta = un color: estética low poly. */
const rgbHex = (h?: string) => { if (!h) return null; const c = Color3.FromHexString(h); return [c.r, c.g, c.b]; };

export function pintar(mesh: Mesh, f: Fenotipo, semilla: number, colores?: Apariencia["colores"]): void {
  const cCrin = rgbHex(colores?.crin), cCascos = rgbHex(colores?.cascos), cManta = rgbHex(colores?.manta), cMontura = rgbHex(colores?.montura);
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const reg = mesh.getVerticesData(VertexBuffer.ColorKind);
  if (!pos) return;
  const idx = mesh.getVerticesData(VertexBuffer.MatricesIndicesKind);
  const wts = mesh.getVerticesData(VertexBuffer.MatricesWeightsKind);
  const nor = mesh.getVerticesData(VertexBuffer.NormalKind);
  const bones = mesh.skeleton?.bones.map((b: { name: string }) => b.name.replace(/^c\d+_/, "")) ?? [];
  const n = pos.length / 3;
  const col = new Float32Array(n * 4);
  const blanco = [0.94, 0.93, 0.9], casco = [0.17, 0.15, 0.14], cascoClaro = [0.62, 0.56, 0.47];
  const crin = cCrin ?? (f.tordillo ? mezcla(f.crin, [0.86, 0.86, 0.85], 0.6) : f.crin);
  for (let t = 0; t + 2 < n; t += 3) {
    const x = (pos[3 * t] + pos[3 * t + 3] + pos[3 * t + 6]) / 3;
    const y = (pos[3 * t + 1] + pos[3 * t + 4] + pos[3 * t + 7]) / 3;
    const z = (pos[3 * t + 2] + pos[3 * t + 5] + pos[3 * t + 8]) / 3;
    const ny = nor ? nor[3 * t + 1] : 0, nz = nor ? nor[3 * t + 2] : 0;
    const region = reg ? Math.round(reg[4 * t] * 10) : 0;
    // hueso dominante de la faceta
    let hueso = "";
    if (idx && wts && bones.length) {
      const suma = new Map<number, number>();
      for (let v = t; v < t + 3; v++) for (let k = 0; k < 4; k++) suma.set(idx[4 * v + k], (suma.get(idx[4 * v + k]) ?? 0) + wts[4 * v + k]);
      let mejor = -1, wmax = -1;
      for (const [b, w] of suma) if (w > wmax) { wmax = w; mejor = b; }
      hueso = bones[mejor] ?? "";
    }
    const pata = /Cana|Cuartilla|Casco|Radio|Tibia/.test(hueso);
    const mano = /CanaD|CuartillaD|CascoD|Radio/.test(hueso);
    const lado = hueso.endsWith("_I") ? 0 : 1;
    const cabeza = hueso === "Cabeza" || hueso.startsWith("Oreja");
    const marcaPata = f.marcas.patas[(mano ? 0 : 2) + lado] ?? 0;
    let c: number[] = f.cuerpo.slice();
    if (region === 1 || region === 2) c = crin.slice();
    else if (region === 3) c = cCascos ?? (marcaPata > 0 ? cascoClaro : casco);
    else {
      if (f.tordillo) {
        const m = ruido(x * 7, y * 7, z * 7, semilla);
        c = mezcla([0.78, 0.78, 0.77], [0.5, 0.5, 0.5], m > 0.6 ? 0.55 : 0.1);
      }
      if (f.rosillo && !cabeza && !pata) c = mezcla(c, blanco, 0.45 + 0.15 * ruido(x * 12, y * 12, z * 12, semilla));
      if (f.raya && Math.abs(x) < 0.06 && y > 1.3 && ny > 0.6 && z < 0.45 && !cabeza) c = mezcla(c, f.crin, 0.75);
      if (f.extremos && pata && y < 0.62) c = mezcla(c, f.extremos, Math.min(1, (0.62 - y) / 0.18));
      if (cabeza && z > 1.2 && y < 1.78) c = mezcla(c, f.extremos ?? [0.2, 0.17, 0.15], 0.35);
      if (f.tobiano && !cabeza) {
        const m = ruido(x * 1.6 + 3, y * 1.3, z * 1.1, semilla ^ 0x51);
        if (m > 0.52 || (pata && y < 0.8)) c = blanco.slice();
      }
      if (f.leopardo && z < 0.1 && y > 0.8) {
        const celda = 0.16;
        const cx = Math.floor(x / celda), cy = Math.floor(y / celda), cz = Math.floor(z / celda);
        const h = hash3(cx, cy, cz, semilla);
        const dx = x / celda - cx - 0.5, dy = y / celda - cy - 0.5, dz = z / celda - cz - 0.5;
        const lunar = h > 0.45 && dx * dx + dy * dy + dz * dz < 0.09 + h * 0.06;
        c = lunar ? f.cuerpo.slice() : blanco.slice();
      }
      if (pata && marcaPata > 0 && y < [0, 0.16, 0.32, 0.52][marcaPata]) c = blanco.slice();
      if (cabeza && f.marcas.cara > 0 && nz > 0.25) {
        const ancho = [0, 0.035, 0.05, 0.09][f.marcas.cara];
        if (Math.abs(x) < ancho && (f.marcas.cara >= 2 || y > 1.86)) c = blanco.slice();
      }
    }
    // Manta y montura sobre el lomo (detrás de la cruz, delante de la grupa): se pintan sobre el cuerpo
    if (region === 0 && !cabeza && !pata && !hueso.startsWith("Cuello")) {
      if (cManta && z > -0.32 && z < 0.5 && y > 1.06) c = (y < 1.12 || z < -0.27 || z > 0.45) ? mezcla(cManta, [0.85, 0.72, 0.3], 0.55) : cManta.slice();
      if (cMontura && z > -0.14 && z < 0.34 && y > 1.3) c = (z > 0.27 || z < -0.08) ? mezcla(cMontura, [0, 0, 0], 0.35) : cMontura.slice();
    }
    for (let v = t; v < t + 3; v++) { col[4 * v] = c[0]; col[4 * v + 1] = c[1]; col[4 * v + 2] = c[2]; col[4 * v + 3] = 1; }
  }
  mesh.makeGeometryUnique();
  mesh.setVerticesData(VertexBuffer.ColorKind, col, false, 4);
  mesh.useVertexColors = true;
  mesh.hasVertexAlpha = false;
  const mat = mesh.material as unknown as { albedoColor?: Color3; diffuseColor?: Color3; metallic?: number; roughness?: number } | null;
  if (mat) {
    if (mat.albedoColor) mat.albedoColor = Color3.White();
    if (mat.diffuseColor) mat.diffuseColor = Color3.White();
    if (mat.metallic !== undefined) mat.metallic = 0;
    if (mat.roughness !== undefined) mat.roughness = 0.78;
  }
}

/** Tamaño en pantalla: el potrillo que crece se ve más chico (tamaño fijo; no cambia sus atributos). */
export function tamanoDe(c: { estado: string }): number { return c.estado === "creciendo" ? 0.62 : 1; }
