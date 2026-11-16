// Cámaras de carrera: seguimiento, lateral (TV), aérea, llegada y meta (de frente a la línea, como la cámara de foto
// final). Nunca influyen en el resultado.
import { Scene, UniversalCamera, Vector3 } from "@babylonjs/core";
import { Course } from "./course.ts";

export type CamMode = "seguimiento" | "lateral" | "aerea" | "llegada" | "meta";

export class RaceCameras {
  readonly cam: UniversalCamera;
  mode: CamMode = "lateral";
  auto = true;
  private pos = new Vector3(0, 5, -20);
  /** Modo que se está mostrando de verdad (en automático puede diferir de `mode`). */
  actual: CamMode = "lateral";
  /** Cuándo cruzó la meta el primero (s de carrera, -1 si nadie) para sostener la toma de meta un momento. */
  private tPrimero = -1;
  private reloj = 0;
  private look = new Vector3(0, 1, 0);

  private course: Course;

  constructor(scene: Scene, course: Course) {
    this.course = course;
    this.cam = new UniversalCamera("camaraCarrera", this.pos.clone(), scene);
    this.cam.minZ = 0.3; this.cam.maxZ = 2500; this.cam.fov = 0.8;
    this.cam.inputs.clear(); // la cámara la controla el juego
    scene.activeCamera = this.cam;
  }

  /** `focusS/focusLat`: caballo seguido; `leaderS`: punta; `packS`: centro del pelotón. */
  update(focusS: number, focusLat: number, leaderS: number, packS: number, dt: number, finished: boolean, alguienLlego = false): void {
    const c = this.course;
    this.reloj += dt;
    if (alguienLlego && this.tPrimero < 0) this.tPrimero = this.reloj;
    if (!alguienLlego) this.tPrimero = -1;
    let mode = this.mode;
    if (this.auto) {
      // Automático: llegada cuando faltan 70 m; los últimos metros y el cruce, de frente a la línea; después, llegada.
      const sostener = this.tPrimero >= 0 && this.reloj - this.tPrimero < 2.2;
      if (!finished && (c.distance - leaderS < 28 || sostener)) mode = "meta";
      else if (c.distance - leaderS < 70 || finished) mode = "llegada";
    }
    const cambio = mode !== this.actual;
    this.actual = mode;
    if (mode === "meta") {
      // Cámara fija sobre la prolongación de la línea de meta, del lado de afuera, a la altura del lomo: la línea se ve
      // recta y los caballos la cruzan de costado (como la cámara de foto final).
      const f = c.rail(c.distance), o = Course.outward(f.heading), w = c.width;
      // Un poco antes de la línea (0,8 m) para que el poste de afuera no tape el centro de la toma.
      const ax = Math.cos(f.heading) * -0.8, az = Math.sin(f.heading) * -0.8;
      this.pos.set(f.x + o.x * (w + 9) + ax, 2.4, f.z + o.z * (w + 9) + az);
      this.look.set(f.x + o.x * (w * 0.45), 1.25, f.z + o.z * (w * 0.45));
      this.cam.fov = 0.5;
      this.cam.position.copyFrom(this.pos);
      this.cam.setTarget(this.look);
      return;
    }
    if (cambio) this.cam.fov = 0.8;
    let tp: Vector3, tl: Vector3, k = 4;
    const w = c.width;
    if (mode === "seguimiento") {
      const p = c.rail(focusS), fwd = new Vector3(Math.cos(p.heading), 0, Math.sin(p.heading));
      const o = Course.outward(p.heading);
      const h = c.world(focusS, focusLat, 0);
      tp = h.subtract(fwd.scale(11)).add(new Vector3(o.x * 3, 4.2, o.z * 3));
      tl = h.add(fwd.scale(6)).add(new Vector3(0, 1.3, 0));
      k = 5;
    } else if (mode === "lateral") {
      const s = focusS * 0.6 + packS * 0.4;
      const p = c.rail(s), o = Course.outward(p.heading);
      tp = c.world(s + 2, 0, 0).add(new Vector3(o.x * (w + 22), 6.5, o.z * (w + 22)));
      tl = c.world(s, Math.min(focusLat, 4), 1.2);
      k = 3;
    } else if (mode === "aerea") {
      const p = c.rail(packS), fwd = new Vector3(Math.cos(p.heading), 0, Math.sin(p.heading));
      const o = Course.outward(p.heading);
      const mid = c.world(packS, 4, 0);
      tp = mid.subtract(fwd.scale(26)).add(new Vector3(o.x * 18, 34, o.z * 18));
      tl = mid.add(fwd.scale(10));
      k = 2.5;
    } else {
      // llegada: fija al costado de la meta, mirando la línea
      const f = c.rail(c.distance), o = Course.outward(f.heading);
      tp = c.world(c.distance + 6, 0, 0).add(new Vector3(o.x * (w + 16), 4.5, o.z * (w + 16)));
      tl = c.world(Math.min(Math.max(leaderS, c.distance - 25), c.distance + 30), 3, 1.2);
      k = 3;
    }
    const a = 1 - Math.exp(-k * dt);
    this.pos = Vector3.Lerp(this.pos, tp, a);
    this.look = Vector3.Lerp(this.look, tl, Math.min(1, a * 1.6));
    this.cam.position.copyFrom(this.pos);
    this.cam.setTarget(this.look);
  }

  /** Coloca la cámara de inmediato (sin suavizado), al empezar. */
  snap(focusS: number, focusLat: number): void {
    for (let i = 0; i < 60; i++) this.update(focusS, focusLat, focusS, focusS, 0.2, false);
  }
}
