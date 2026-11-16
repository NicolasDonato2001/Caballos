// Geometría de la pista. Coincide con las curvas del simulador (config/balance/carrera.json):
// 500 m: recta 200 · curva 160 (80°) · recta 140   → curva del 40 % al 72 %
// 1.500 m: recta 180 · curva 360 (180°) · recta 390 · curva 360 · recta 210 → curvas 12–36 % y 62–86 %
import { Vector3 } from "@babylonjs/core";

export const TURN_RADIUS = 360 / Math.PI; // ≈114,6 m: misma curva para ambos trazados

interface Seg { kind: "recta" | "curva"; len: number; }

export interface Pose { x: number; z: number; heading: number; }

export class Course {
  readonly segs: Seg[];
  readonly length: number;
  /** Metros extra antes de la salida y después de la meta (zona de frenado). */
  readonly preRun = 25;
  readonly postRun = 90;
  readonly railOffset = 0.9;   // del borde interior al carril 0
  readonly laneWidth: number;
  readonly lanes: number;

  readonly distance: 500 | 1500;

  constructor(distance: 500 | 1500, laneWidth: number, lanes: number) {
    this.distance = distance;
    this.laneWidth = laneWidth;
    this.lanes = lanes;
    this.segs = distance === 500
      ? [{ kind: "recta", len: 200 }, { kind: "curva", len: 160 }, { kind: "recta", len: 140 }]
      : [{ kind: "recta", len: 180 }, { kind: "curva", len: 360 }, { kind: "recta", len: 390 }, { kind: "curva", len: 360 }, { kind: "recta", len: 210 }];
    this.length = this.segs.reduce((a, s) => a + s.len, 0);
  }

  /** Pose del borde interior (cuerda) a `s` metros de la salida. Admite s < 0 y s > distancia. */
  rail(s: number): Pose {
    let x = 0, z = 0, h = 0;
    if (s < 0) return { x: Math.cos(h) * s, z: Math.sin(h) * s, heading: h };
    let rest = s;
    for (const seg of this.segs) {
      const d = Math.min(rest, seg.len);
      if (seg.kind === "recta") {
        x += Math.cos(h) * d; z += Math.sin(h) * d;
      } else {
        // giro hacia la izquierda (centro del lado interior)
        const cx = x - Math.sin(h) * TURN_RADIUS, cz = z + Math.cos(h) * TURN_RADIUS;
        const h2 = h + d / TURN_RADIUS;
        x = cx + Math.sin(h2) * TURN_RADIUS; z = cz - Math.cos(h2) * TURN_RADIUS;
        h = h2;
      }
      rest -= d;
      if (rest <= 0) return { x, z, heading: h };
    }
    // después de la meta: sigue recto
    return { x: x + Math.cos(h) * rest, z: z + Math.sin(h) * rest, heading: h };
  }

  /** Normal hacia el lado exterior de la pista. */
  static outward(h: number): { x: number; z: number } { return { x: Math.sin(h), z: -Math.cos(h) }; }

  /** Posición en el mundo para un caballo en (s, carril). */
  world(s: number, lat: number, y = 0): Vector3 {
    const p = this.rail(s);
    const o = Course.outward(p.heading);
    const off = this.railOffset + lat * this.laneWidth;
    return new Vector3(p.x + o.x * off, y, p.z + o.z * off);
  }

  /** Ancho total de la superficie de carrera. */
  get width(): number { return this.railOffset * 2 + (this.lanes + 1) * this.laneWidth; }

  /** Puntos a lo largo de la pista con un desplazamiento lateral fijo (para mallas). */
  path(offset: number, step = 2, y = 0): Vector3[] {
    const pts: Vector3[] = [];
    for (let s = -this.preRun; s <= this.distance + this.postRun; s += step) {
      const p = this.rail(s), o = Course.outward(p.heading);
      pts.push(new Vector3(p.x + o.x * offset, y, p.z + o.z * offset));
    }
    return pts;
  }
}
