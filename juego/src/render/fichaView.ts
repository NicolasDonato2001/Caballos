// Escena de la ficha 3D: un caballo sobre una tarima, con cámara orbital (arrastrar para girar, pellizcar/rueda para acercar).
// Comparte el lienzo y el motor con la carrera; main.ts decide qué escena se dibuja.
import {
  ArcRotateCamera, Color3, Color4, DirectionalLight, Engine, HemisphericLight, MeshBuilder, Scene, ShadowGenerator,
  StandardMaterial, Vector3, Viewport,
} from "@babylonjs/core";
import { CaballoGLB, HorseModelView, tamanoDe } from "./horseModel.ts";
import { coloresDe } from "../domain/aspecto.ts";
import type { Caballo } from "../domain/caballo.ts";

/** Rectángulo libre de interfaz, en píxeles CSS, donde debe verse el caballo. */
export interface Area { izquierda: number; derecha: number; arriba: number; abajo: number; }

export class FichaView {
  readonly scene: Scene;
  private cam: ArcRotateCamera;
  private sombras: ShadowGenerator;
  private actual: HorseModelView | null = null;
  private clave = "";
  private listo: Promise<boolean>;
  private t = 0;

  private readonly engine: Engine;

  constructor(engine: Engine) {
    this.engine = engine;
    const scene = new Scene(engine);
    this.scene = scene;
    scene.clearColor = new Color4(0.93, 0.91, 0.86, 1);
    scene.ambientColor = new Color3(0.3, 0.3, 0.3);
    this.cam = new ArcRotateCamera("camaraFicha", Math.PI * 0.18, 1.32, 6.6, new Vector3(0, 1.05, 0), scene);
    this.cam.lowerRadiusLimit = 3.2; this.cam.upperRadiusLimit = 8.5;
    this.cam.lowerBetaLimit = 0.7; this.cam.upperBetaLimit = 1.52;
    this.cam.wheelDeltaPercentage = 0.01; this.cam.pinchDeltaPercentage = 0.004;
    this.cam.panningSensibility = 0; this.cam.minZ = 0.1; this.cam.fov = 0.62;
    this.cam.useAutoRotationBehavior = true;
    const auto = this.cam.autoRotationBehavior!;
    auto.idleRotationSpeed = 0.18; auto.idleRotationWaitTime = 2500; auto.idleRotationSpinupTime = 1500;
    const cielo = new HemisphericLight("cieloFicha", new Vector3(0.2, 1, -0.3), scene);
    cielo.intensity = 0.62; cielo.groundColor = new Color3(0.55, 0.5, 0.42);
    const sol = new DirectionalLight("solFicha", new Vector3(-0.5, -1, 0.45), scene);
    sol.position = new Vector3(6, 10, -6); sol.intensity = 1.05;
    this.sombras = new ShadowGenerator(1024, sol);
    this.sombras.useBlurExponentialShadowMap = true; this.sombras.blurKernel = 24; this.sombras.setDarkness(0.45);
    // Tarima: disco claro con un borde dorado suave
    const tarima = MeshBuilder.CreateCylinder("tarima", { diameter: 4.4, height: 0.08, tessellation: 64 }, scene);
    tarima.position.y = -0.04;
    const mt = new StandardMaterial("tarimaMat", scene);
    mt.diffuseColor = Color3.FromHexString("#f6f1e5"); mt.specularColor = Color3.Black();
    tarima.material = mt; tarima.receiveShadows = true;
    const borde = MeshBuilder.CreateTorus("tarimaBorde", { diameter: 4.4, thickness: 0.05, tessellation: 64 }, scene);
    const mb = new StandardMaterial("tarimaBordeMat", scene);
    mb.diffuseColor = Color3.FromHexString("#c9a94f"); mb.specularColor = Color3.Black();
    borde.material = mb;
    this.listo = CaballoGLB.cargar(scene);
    scene.onBeforeRenderObservable.add(() => {
      this.t += engine.getDeltaTime() / 1000;
      this.actual?.update(Vector3.Zero(), 0, 0, 0, this.t);
    });
  }

  /** Muestra un caballo (se reconstruye solo si cambió algo de su apariencia). */
  async mostrar(c: Caballo | null): Promise<void> {
    const clave = c ? JSON.stringify([c.id, c.composicion, c.pelaje, c.forma, c.estado === "creciendo", coloresDe(c)]) : "";
    if (clave === this.clave) return;
    this.clave = clave;
    if (!(await this.listo)) return;
    if (clave !== this.clave) return;           // llegó otro pedido mientras cargaba
    if (this.actual) {
      this.actual.dispose(); this.actual.root.dispose(false, true);
      for (const m of this.actual.meshes) m.dispose(false, true);
      this.actual = null;
    }
    if (!c) return;
    const h = new HorseModelView(this.scene, 900, { composicion: c.composicion, pelaje: c.pelaje, forma: c.forma, tamano: tamanoDe(c), colores: coloresDe(c), rasgos: c.rasgos, linaje: c.linaje }, false);
    h.root.rotation.y = 0;
    for (const m of h.meshes) this.sombras.addShadowCaster(m, false);
    this.actual = h;
  }

  /** Ubica el caballo en la parte de la pantalla que deja libre la interfaz. */
  encuadrar(a: Area): void {
    const w = this.engine.getRenderWidth() / this.engine.getHardwareScalingLevel() || window.innerWidth;
    const W = window.innerWidth || w, H = window.innerHeight || 1;
    const x = Math.max(0, Math.min(0.9, a.izquierda / W));
    const ancho = Math.max(0.1, 1 - x - Math.max(0, a.derecha) / W);
    const y = Math.max(0, Math.min(0.9, a.abajo / H));
    const alto = Math.max(0.1, 1 - y - Math.max(0, a.arriba) / H);
    this.cam.viewport = new Viewport(x, y, ancho, alto);
  }

  activar(canvas: HTMLCanvasElement, si: boolean): void {
    if (si) this.cam.attachControl(canvas, true);
    else this.cam.detachControl();
  }
}
