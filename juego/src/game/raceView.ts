// Reproduce en 3D una carrera calculada por el simulador, en tiempo real.
// El simulador avanza a paso fijo; el render interpola entre ticks. La cámara no altera nada.
import {
  Color3, Color4, DirectionalLight, Engine, HemisphericLight, Mesh, Scene, ShadowGenerator, Vector3,
} from "@babylonjs/core";
import carrera from "../../config/balance/carrera.json";
import { RaceSim, type RaceParams } from "../sim/race.ts";
import type { RaceInput, RaceResult } from "../sim/types.ts";
import { Course } from "../render/course.ts";
import { buildTrack, type Hipodromo } from "../render/track.ts";
import { coloresDe } from "../domain/aspecto.ts";
import { COATS, HorseView } from "../render/horse.ts";
import { CaballoGLB, HorseModelView } from "../render/horseModel.ts";
import { RaceCameras, type CamMode } from "../render/cameras.ts";
import type { Entrant } from "./field.ts";
import type { SonidoCarrera } from "../audio/sonidoCarrera.ts";

export const PARAMS = carrera as unknown as RaceParams;

export interface RaceViewCallbacks {
  onHud(h: HudState): void;
  onFinish(result: RaceResult): void;
  onAnnounce(text: string): void;
}

export interface HudState {
  t: number; distance: number; position: number; total: number; remaining: number;
  order: number[]; speed: number; camMode: CamMode; auto: boolean; fps: number; phase: "previa" | "carrera" | "final";
  replay: boolean;
}

export class RaceView {
  readonly scene: Scene;
  private sim!: RaceSim;
  private course!: Course;
  private horses: (HorseView | HorseModelView)[] = [];
  private trackMeshes: Mesh[] = [];
  private hipodromo: Hipodromo | null = null;
  private cams!: RaceCameras;
  private shadows: ShadowGenerator;
  private acc = 0;
  private prevS = new Float64Array(0); private prevLat = new Float64Array(0);
  private visExtra: number[] = []; private visV: number[] = []; private yaws: number[] = [];
  private phase: "previa" | "carrera" | "final" = "previa";
  private finishShown = false;
  private time = 0;
  speedMult = 1;
  /** Cámara lenta al cruzar la meta (solo visual: el simulador no cambia). */
  camaraLenta = true;
  private lento = 1;
  private playerIndex = 0;
  private entrants: Entrant[] = [];
  private replay = false;
  private pendingStart = false;
  /** Fase 10: el sonido de la carrera (lo pone main.ts). Solo escucha: no cambia nada de la carrera. */
  sonido: SonidoCarrera | null = null;
  private superficie: "cesped" | "tierra" = "tierra";

  private engine: Engine; private cb: RaceViewCallbacks;

  constructor(engine: Engine, cb: RaceViewCallbacks) {
    this.engine = engine; this.cb = cb;
    const scene = (this.scene = new Scene(engine));
    scene.clearColor = new Color4(0.64, 0.79, 0.92, 1);
    scene.fogMode = Scene.FOGMODE_EXP2; scene.fogDensity = 0.0011; scene.fogColor = new Color3(0.72, 0.83, 0.92);
    scene.skipPointerMovePicking = true;
    const hemi = new HemisphericLight("cielo", new Vector3(0.2, 1, 0.1), scene);
    hemi.intensity = 0.62; hemi.groundColor = new Color3(0.32, 0.36, 0.28);
    const sun = new DirectionalLight("sol", new Vector3(-0.45, -1, 0.35), scene);
    sun.intensity = 1.05; sun.position = new Vector3(60, 120, -60);
    sun.autoUpdateExtends = true;
    this.shadows = new ShadowGenerator(2048, sun);
    this.shadows.useBlurExponentialShadowMap = true; this.shadows.blurKernel = 16; this.shadows.setDarkness(0.35);
    scene.onBeforeRenderObservable.add(() => this.frame(engine.getDeltaTime() / 1000));
  }

  get camera(): RaceCameras { return this.cams; }

  /** Prepara la escena para una carrera (o su repetición). */
  load(input: RaceInput, entrants: Entrant[], playerIndex: number, replay = false): void {
    for (const m of this.trackMeshes) m.dispose(false, true);
    for (const h of this.horses) { if ("dispose" in h) h.dispose(); h.root.dispose(false, true); for (const m of h.meshes) m.dispose(false, true); }
    this.horses = []; this.trackMeshes = [];
    this.entrants = entrants; this.playerIndex = playerIndex; this.replay = replay;
    this.sim = new RaceSim(input, PARAMS);
    this.superficie = input.surface === "cesped" ? "cesped" : "tierra";
    this.course = new Course(input.distance, PARAMS.laneWidth, input.participants.length);
    this.hipodromo = buildTrack(this.scene, this.course, input.surface);
    this.trackMeshes = this.hipodromo.meshes;
    this.hipodromo.marcador(entrants.map((e) => e.number));
    entrants.forEach((e, i) => {
      const hv = CaballoGLB.para(this.scene)
        ? new HorseModelView(this.scene, i, { composicion: e.caballo.composicion, pelaje: e.caballo.pelaje, forma: e.caballo.forma, colores: coloresDe(e.caballo), rasgos: e.caballo.rasgos, linaje: e.caballo.linaje }, e.isPlayer)
        : new HorseView(this.scene, i, COATS[e.coat % COATS.length], e.number, e.isPlayer);
      for (const m of hv.meshes) this.shadows.addShadowCaster(m, false);
      this.horses.push(hv);
    });
    const n = entrants.length;
    this.prevS = Float64Array.from(this.sim.s); this.prevLat = Float64Array.from(this.sim.lat);
    this.visExtra = new Array(n).fill(0); this.visV = new Array(n).fill(0);
    this.yaws = new Array(n).fill(0);
    this.acc = 0; this.phase = "previa"; this.finishShown = false; this.pendingStart = false; this.lento = 1;
    this.cams?.cam.dispose();
    this.cams = new RaceCameras(this.scene, this.course);
    this.cams.mode = "lateral";
    this.cams.snap(0, this.sim.lat[playerIndex]);
    this.placeHorses(0, 0.016);
  }

  /** Detiene la carrera en curso al salir de la pantalla (la escena deja de dibujarse y no avanza). */
  pausar(): void { this.pendingStart = false; if (this.phase === "carrera") this.phase = "final"; this.sonido?.detener(); }

  /** Cuenta regresiva y largada. */
  start(): void {
    if (this.pendingStart) return;
    this.pendingStart = true;
    this.sonido?.iniciar(this.superficie, this.sim.n);
    const steps = ["3", "2", "1"];
    steps.forEach((txt, k) => setTimeout(() => this.cb.onAnnounce(txt), k * 700));
    setTimeout(() => {
      this.cb.onAnnounce("¡Largaron!");
      this.phase = "carrera";
      this.hipodromo?.abrirGateras();
      this.sonido?.largada(this.sim.n);
      // El partidor se retira cuando los caballos ya salieron (en 1.500 m la pista vuelve a pasar por ahí).
      setTimeout(() => { for (const m of this.scene.meshes.filter((x) => x.name === "partidor")) m.setEnabled(false); }, 4000);
      setTimeout(() => this.cb.onAnnounce(""), 900);
    }, steps.length * 700);
  }

  private frame(rawDt: number): void {
    if (!this.sim) return;
    const dt = Math.min(rawDt, 0.1);
    this.time += dt;
    const simDt = PARAMS.dt;
    if (this.phase === "carrera") {
      // Cámara lenta: con la toma de meta y algún caballo a menos de 14 m de la línea, el tiempo corre al 30 %.
      let objetivo = 1;
      if (this.camaraLenta && this.cams.actual === "meta") {
        for (let i = 0; i < this.sim.n; i++) {
          const d = this.course.distance - this.sim.s[i];
          if (!this.sim.finished[i] && d < 14) { objetivo = 0.3; break; }
        }
      }
      this.lento += (objetivo - this.lento) * Math.min(1, dt * 6);
      this.acc += dt * this.speedMult * this.lento;
      while (this.acc >= simDt && !this.sim.finishedAll) {
        this.prevS.set(this.sim.s); this.prevLat.set(this.sim.lat);
        this.sim.step();
        this.acc -= simDt;
      }
      if (this.sim.finishedAll && !this.finishShown) {
        this.finishShown = true; this.phase = "final";
        setTimeout(() => this.cb.onFinish(this.sim.result()), 2200);
      }
    } else if (this.phase === "final") {
      this.acc = simDt;
    }
    const alpha = this.phase === "carrera" ? Math.min(this.acc / simDt, 1) : 1;
    this.placeHorses(alpha, dt);
    this.updateHud();
    if (this.sonido) this.oir(dt);
  }

  /** Le pasa al sonido dónde está la cámara y cada caballo, y a qué velocidad corre el tiempo. */
  private oir(dt: number): void {
    const cam = this.cams.cam, der = cam.getDirection(Vector3.Right()), sim = this.sim;
    let lider = 0, alguno = false;
    for (let i = 0; i < sim.n; i++) { if (sim.finished[i]) alguno = true; else lider = Math.max(lider, sim.s[i]); }
    this.sonido!.actualizar({
      fase: this.phase, escala: this.phase === "carrera" ? this.speedMult * this.lento : 1,
      camara: { x: cam.position.x, y: cam.position.y, z: cam.position.z }, derecha: { x: der.x, z: der.z },
      caballos: this.horses.map((h, i) => {
        const p = h.root.getAbsolutePosition();
        const v = this.phase === "previa" ? 0 : sim.finished[i] ? this.visV[i] : sim.v[i];
        return { x: p.x, y: p.y, z: p.z, v };
      }),
      restanLider: alguno ? 0 : this.course.distance - lider, distancia: this.course.distance, alguienLlego: alguno,
    }, dt);
  }

  private placeHorses(alpha: number, dt: number): void {
    const sim = this.sim, c = this.course, n = this.horses.length;
    let leader = 0, sumS = 0;
    for (let i = 0; i < n; i++) {
      let s = this.prevS[i] + (sim.s[i] - this.prevS[i]) * alpha;
      const lat = this.prevLat[i] + (sim.lat[i] - this.prevLat[i]) * alpha;
      let v = sim.v[i];
      if (sim.finished[i]) {
        // Después de la meta el caballo frena y pasa al trote/paso (solo visual).
        if (this.visV[i] === 0) this.visV[i] = v;
        this.visV[i] = Math.max(1.4, this.visV[i] - 2.2 * dt);
        if (this.visExtra[i] > c.postRun - 15) this.visV[i] = Math.max(0, this.visV[i] - 2 * dt);
        this.visExtra[i] += this.visV[i] * dt;
        s = c.distance + this.visExtra[i];
        v = this.visV[i];
      }
      if (this.phase === "previa") v = 0;
      const pos = c.world(s, lat, 0);
      const p = c.rail(s);
      const latRate = ((sim.lat[i] - this.prevLat[i]) / PARAMS.dt) * c.laneWidth;
      const o = Course.outward(p.heading);
      const dx = Math.cos(p.heading) * Math.max(v, 0.5) + o.x * latRate;
      const dz = Math.sin(p.heading) * Math.max(v, 0.5) + o.z * latRate;
      const yaw = Math.atan2(dx, dz);
      let dy = yaw - this.yaws[i];
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      this.yaws[i] += dy * Math.min(1, dt * 8);
      if (this.phase === "previa") this.yaws[i] = yaw;
      this.horses[i].update(pos, this.yaws[i], v, dt, this.time);
      if (!sim.finished[i] && sim.s[i] > sim.s[leader]) leader = i;
      sumS += Math.min(s, c.distance);
    }
    const pi = this.playerIndex;
    const ps = Math.min(this.prevS[pi] + (sim.s[pi] - this.prevS[pi]) * alpha, c.distance);
    let alguno = false;
    for (let i = 0; i < n; i++) if (sim.finished[i]) { alguno = true; break; }
    this.cams.update(ps, sim.lat[pi], Math.max(...Array.from(sim.s)), sumS / n, dt, this.phase === "final", alguno);
  }

  private updateHud(): void {
    const order = this.sim.standings();
    this.hipodromo?.marcador(order.map((i) => this.entrants[i].number));
    const pi = this.playerIndex;
    this.cb.onHud({
      t: this.sim.tick * PARAMS.dt, distance: this.course.distance,
      position: order.indexOf(pi) + 1, total: order.length,
      remaining: Math.max(0, this.course.distance - this.sim.s[pi]),
      order: order.map((i) => this.entrants[i].number),
      speed: this.speedMult, camMode: this.cams.mode, auto: this.cams.auto,
      fps: this.engine.getFps(), phase: this.phase, replay: this.replay,
    });
  }
}
