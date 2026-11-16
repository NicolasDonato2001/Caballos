// CABALLO PROVISORIO (placeholder) — Fase 1.
// Modelo articulado hecho con primitivas para validar movimiento, cámaras y lectura de carrera.
// Se reemplaza en la Fase 2 por los modelos GLB de cada raza (GDD §10.4). No es un asset final.
import {
  Color3, DynamicTexture, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3,
} from "@babylonjs/core";

export interface Coat { body: Color3; mane: Color3; legs: Color3; }

export const COATS: Coat[] = [
  { body: Color3.FromHexString("#7a4a2a"), mane: Color3.FromHexString("#1d1410"), legs: Color3.FromHexString("#241a14") }, // castaño
  { body: Color3.FromHexString("#9c5a2c"), mane: Color3.FromHexString("#b56d38"), legs: Color3.FromHexString("#8a4d26") }, // alazán
  { body: Color3.FromHexString("#1f1b1a"), mane: Color3.FromHexString("#0d0b0b"), legs: Color3.FromHexString("#141111") }, // negro
  { body: Color3.FromHexString("#b9b6b0"), mane: Color3.FromHexString("#e8e5df"), legs: Color3.FromHexString("#8d8a86") }, // tordillo
  { body: Color3.FromHexString("#c9a35e"), mane: Color3.FromHexString("#efe2c2"), legs: Color3.FromHexString("#b08a4c") }, // palomino
  { body: Color3.FromHexString("#a88a62"), mane: Color3.FromHexString("#3b2e22"), legs: Color3.FromHexString("#3b2e22") }, // bayo
  { body: Color3.FromHexString("#5a3a26"), mane: Color3.FromHexString("#1a120d"), legs: Color3.FromHexString("#1a120d") }, // zaino oscuro
  { body: Color3.FromHexString("#8c6f5e"), mane: Color3.FromHexString("#3a2c25"), legs: Color3.FromHexString("#3a2c25") }, // rosillo
];
export const CLOTH_COLORS = ["#c0392b", "#f5f5f5", "#2e6fd1", "#f2c84b", "#2f8f4e", "#111111", "#e67e22", "#d24d9c", "#6a3fb5", "#7fd4e0", "#8a8a8a", "#a33"];

type LegName = "LF" | "RF" | "LH" | "RH";
interface Leg { name: LegName; front: boolean; upper: TransformNode; lower: TransformNode; }

/** Desfasajes de fase por aire (0–1). Galope transverso con mano derecha. */
const GAITS = {
  paso:   { stride: 1.7, offsets: { LH: 0.0, LF: 0.25, RH: 0.5, RF: 0.75 }, up: 0.32, low: 0.55, bob: 0.025, pitch: 0.0 },
  trote:  { stride: 2.8, offsets: { LF: 0.0, RH: 0.0, RF: 0.5, LH: 0.5 }, up: 0.42, low: 0.95, bob: 0.06, pitch: 0.0 },
  medio:  { stride: 4.2, offsets: { LH: 0.0, RH: 0.30, LF: 0.30, RF: 0.62 }, up: 0.45, low: 0.85, bob: 0.09, pitch: 0.05 },
  galope: { stride: 6.6, offsets: { LH: 0.0, RH: 0.10, LF: 0.50, RF: 0.60 }, up: 0.52, low: 0.95, bob: 0.11, pitch: 0.07 },
} as const;
type GaitName = keyof typeof GAITS;

function gaitWeights(v: number): [GaitName, GaitName, number] {
  // [aire A, aire B, peso de B] — mezcla suave entre aires según la velocidad
  if (v < 1.8) return ["paso", "paso", 0];
  if (v < 3.0) return ["paso", "trote", (v - 1.8) / 1.2];
  if (v < 5.5) return ["trote", "trote", 0];
  if (v < 7.0) return ["trote", "medio", (v - 5.5) / 1.5];
  if (v < 10.0) return ["medio", "medio", 0];
  if (v < 12.5) return ["medio", "galope", (v - 10) / 2.5];
  return ["galope", "galope", 0];
}

export class HorseView {
  readonly root: TransformNode;
  private body: TransformNode;
  private neck: TransformNode;
  private tail: TransformNode;
  private legs: Leg[] = [];
  private phase = 0;
  readonly meshes: Mesh[] = [];
  private marker: Mesh;

  readonly index: number;

  constructor(scene: Scene, index: number, coat: Coat, number: number, isPlayer: boolean) {
    this.index = index;
    const name = `caballo${index}`;
    this.root = new TransformNode(name, scene);
    this.body = new TransformNode(`${name}_cuerpo`, scene);
    this.body.parent = this.root;
    this.body.position.y = 1.32;

    const mat = (n: string, c: Color3) => {
      const m = new StandardMaterial(`${name}_${n}`, scene);
      m.diffuseColor = c; m.specularColor = new Color3(0.12, 0.12, 0.12);
      return m;
    };
    const mBody = mat("pelo", coat.body), mMane = mat("crin", coat.mane), mLegs = mat("patas", coat.legs);
    const mHoof = mat("casco", Color3.FromHexString("#1a1614"));
    const add = (m: Mesh, parent: TransformNode, material: StandardMaterial) => {
      m.parent = parent; m.material = material; this.meshes.push(m); return m;
    };

    // Tronco: barril, pecho y grupa
    const barrel = add(MeshBuilder.CreateSphere(`${name}_barril`, { diameter: 1, segments: 12 }, scene), this.body, mBody);
    barrel.scaling.set(0.62, 0.7, 1.55);
    const chest = add(MeshBuilder.CreateSphere(`${name}_pecho`, { diameter: 1, segments: 10 }, scene), this.body, mBody);
    chest.scaling.set(0.6, 0.72, 0.62); chest.position.set(0, 0.05, 0.62);
    const rump = add(MeshBuilder.CreateSphere(`${name}_grupa`, { diameter: 1, segments: 10 }, scene), this.body, mBody);
    rump.scaling.set(0.64, 0.7, 0.7); rump.position.set(0, 0.08, -0.6);

    // Cuello y cabeza
    this.neck = new TransformNode(`${name}_cuelloPivote`, scene);
    this.neck.parent = this.body; this.neck.position.set(0, 0.22, 0.78); this.neck.rotation.x = 0.75; // + inclina hacia adelante
    const neckM = add(MeshBuilder.CreateCylinder(`${name}_cuello`, { height: 0.85, diameterTop: 0.26, diameterBottom: 0.46, tessellation: 10 }, scene), this.neck, mBody);
    neckM.position.y = 0.4;
    const mane = add(MeshBuilder.CreateBox(`${name}_crin`, { width: 0.06, height: 0.8, depth: 0.12 }, scene), this.neck, mMane);
    mane.position.set(0, 0.42, -0.16);
    const headPivot = new TransformNode(`${name}_cabezaPivote`, scene);
    headPivot.parent = this.neck; headPivot.position.y = 0.82; headPivot.rotation.x = 1.55;
    const head = add(MeshBuilder.CreateCylinder(`${name}_cabeza`, { height: 0.62, diameterTop: 0.17, diameterBottom: 0.27, tessellation: 10 }, scene), headPivot, mBody);
    head.position.y = 0.26;
    const muzzle = add(MeshBuilder.CreateSphere(`${name}_hocico`, { diameter: 0.2, segments: 6 }, scene), headPivot, mLegs);
    muzzle.position.y = 0.56;
    for (const sx of [-0.07, 0.07]) {
      const ear = add(MeshBuilder.CreateCylinder(`${name}_oreja`, { height: 0.16, diameterTop: 0, diameterBottom: 0.07, tessellation: 4 }, scene), headPivot, mBody);
      ear.position.set(sx, 0.0, -0.08); ear.rotation.x = -2.1;
    }

    // Cola
    this.tail = new TransformNode(`${name}_colaPivote`, scene);
    this.tail.parent = this.body; this.tail.position.set(0, 0.25, -0.92); this.tail.rotation.x = -2.6; // cuelga hacia atrás
    const tailM = add(MeshBuilder.CreateCylinder(`${name}_cola`, { height: 0.75, diameterTop: 0.1, diameterBottom: 0.2, tessellation: 6 }, scene), this.tail, mMane);
    tailM.position.y = 0.37;

    // Patas: hombro/cadera → antebrazo/muslo → caña → casco
    const legDefs: [LegName, number, number, boolean][] = [
      ["LF", 0.2, 0.62, true], ["RF", -0.2, 0.62, true], ["LH", 0.2, -0.62, false], ["RH", -0.2, -0.62, false],
    ];
    for (const [ln, x, z, front] of legDefs) {
      const upper = new TransformNode(`${name}_${ln}_sup`, scene);
      upper.parent = this.body; upper.position.set(x, -0.18, z);
      const u = add(MeshBuilder.CreateCylinder(`${name}_${ln}_u`, { height: 0.62, diameterTop: front ? 0.2 : 0.26, diameterBottom: 0.12, tessellation: 8 }, scene), upper, front ? mBody : mBody);
      u.position.y = -0.31;
      const lower = new TransformNode(`${name}_${ln}_inf`, scene);
      lower.parent = upper; lower.position.y = -0.6;
      const l = add(MeshBuilder.CreateCylinder(`${name}_${ln}_l`, { height: 0.5, diameterTop: 0.1, diameterBottom: 0.085, tessellation: 8 }, scene), lower, mLegs);
      l.position.y = -0.25;
      const hoof = add(MeshBuilder.CreateCylinder(`${name}_${ln}_casco`, { height: 0.09, diameterTop: 0.1, diameterBottom: 0.13, tessellation: 8 }, scene), lower, mHoof);
      hoof.position.y = -0.52;
      this.legs.push({ name: ln, front, upper, lower });
    }

    // Mantilla con número (lectura de carrera)
    const tex = new DynamicTexture(`${name}_numTex`, { width: 128, height: 128 }, scene, false);
    const bg = CLOTH_COLORS[(number - 1) % CLOTH_COLORS.length];
    const fg = bg === "#f5f5f5" || bg === "#f2c84b" || bg === "#7fd4e0" ? "#111111" : "#ffffff";
    tex.drawText(String(number), null, 92, "bold 84px Arial", fg, bg, true, true);
    const clothMat = new StandardMaterial(`${name}_mantilla`, scene);
    clothMat.diffuseTexture = tex; clothMat.specularColor = new Color3(0.05, 0.05, 0.05);
    for (const side of [-1, 1]) {
      const cloth = add(MeshBuilder.CreatePlane(`${name}_mantilla${side}`, { width: 0.62, height: 0.5 }, scene), this.body, clothMat);
      cloth.position.set(0.322 * side, 0.12, 0.05);
      cloth.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    }
    const saddle = add(MeshBuilder.CreateBox(`${name}_montura`, { width: 0.5, height: 0.08, depth: 0.55 }, scene), this.body, mat("montura", Color3.FromHexString("#2b2420")));
    saddle.position.set(0, 0.37, 0.1);

    // Marcador del caballo del jugador
    this.marker = MeshBuilder.CreateCylinder(`${name}_marcador`, { height: 0.5, diameterTop: 0.45, diameterBottom: 0, tessellation: 4 }, scene);
    const mm = new StandardMaterial(`${name}_marcadorMat`, scene);
    mm.emissiveColor = Color3.FromHexString("#d8b24a"); mm.diffuseColor = Color3.FromHexString("#d8b24a");
    this.marker.material = mm; this.marker.parent = this.root; this.marker.position.y = 3.0;
    this.marker.isVisible = isPlayer;
    this.phase = (index * 0.137) % 1;
  }

  /** Coloca y anima el caballo. `v` en m/s, `dt` segundos reales de render. */
  update(pos: Vector3, yaw: number, v: number, dt: number, time: number): void {
    this.root.position.copyFrom(pos);
    this.root.rotation.y = yaw;
    const [ga, gb, w] = gaitWeights(v);
    const A = GAITS[ga], B = GAITS[gb];
    const stride = A.stride + (B.stride - A.stride) * w;
    // La frecuencia de zancada sale de la velocidad: el casco apoyado no patina.
    const freq = v > 0.05 ? v / stride : 0;
    this.phase = (this.phase + freq * dt) % 1;
    const moving = Math.min(1, v / 0.6);
    for (const leg of this.legs) {
      const angA = this.legAngles(A, leg, this.phase);
      const angB = this.legAngles(B, leg, this.phase);
      const up = (angA[0] + (angB[0] - angA[0]) * w) * moving;
      const low = (angA[1] + (angB[1] - angA[1]) * w) * moving;
      leg.upper.rotation.x = up;
      leg.lower.rotation.x = low;
    }
    const bob = A.bob + (B.bob - A.bob) * w;
    const pitch = A.pitch + (B.pitch - A.pitch) * w;
    const cyc = this.phase * Math.PI * 2;
    this.body.position.y = 1.32 + Math.abs(Math.sin(cyc)) * bob * moving - (1 - moving) * 0.02;
    this.body.rotation.x = Math.sin(cyc) * pitch * moving;
    // Al galope el cuello se estira hacia adelante y cabecea con la zancada
    this.neck.rotation.x = 0.75 + Math.min(0.35, v * 0.02) + Math.sin(cyc + 0.6) * (0.06 + pitch) * moving + (1 - moving) * Math.sin(time * 0.7 + this.index) * 0.04;
    this.tail.rotation.x = -(2.6 - Math.min(0.9, v * 0.05)) + Math.sin(cyc * 2) * 0.05 * moving;
    this.tail.rotation.z = Math.sin(time * 1.3 + this.index) * 0.08;
    this.marker.rotation.y = time * 2;
  }

  private legAngles(g: (typeof GAITS)[GaitName], leg: Leg, phase: number): [number, number] {
    const off = g.offsets[leg.name];
    const c = (((phase - off + 1) % 1)) * Math.PI * 2;
    // Ángulo positivo = pata hacia atrás. Apoyo: sin(c) crece (la pata barre de adelante hacia atrás con el casco en el piso).
    // Vuelo: sin(c) decrece (vuelve adelante) y la articulación se flexiona, máximo a mitad del vuelo.
    const swing = Math.sin(c) * g.up;
    const flex = Math.max(0, -Math.cos(c)) * g.low;
    // Manos: la rodilla pliega la caña hacia atrás (+). Patas: el corvejón la lleva hacia adelante (−).
    return leg.front ? [swing, flex] : [swing * 0.9, -flex * 0.8];
  }

  setPlayerMarker(visible: boolean): void { this.marker.isVisible = visible; }
}
