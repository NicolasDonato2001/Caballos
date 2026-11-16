// Lámina de revisión (herramienta de desarrollo, GDD §24.3: «se revisan en láminas»): caballos de distintas cruzas,
// los linajes raros y la variación individual, uno al lado del otro y de perfil. Abrir /lamina.html con el servidor de Vite.
import { ArcRotateCamera, Color4, DirectionalLight, Engine, HemisphericLight, Matrix, MeshBuilder, Scene, StandardMaterial, Color3, Vector3 } from "@babylonjs/core";
import { CaballoGLB, HorseModelView } from "./render/horseModel.ts";
import { caballoDeRaza, type Caballo } from "./domain/caballo.ts";
import { Rng } from "./sim/rng.ts";
import { potrillo } from "./domain/crianza.ts";
import { LINAJES, RASGOS, rasgoDePar, rasgosVisibles, linaje } from "./domain/rasgos.ts";
import { fenotipo } from "./domain/pelaje.ts";

const canvas = document.getElementById("render") as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true });
const scene = new Scene(engine);
scene.clearColor = Color4.FromHexString("#efe9daff");
const cam = new ArcRotateCamera("cam", -Math.PI / 2, 1.35, 30, new Vector3(0, 1.2, 0), scene);
cam.attachControl(canvas, true); cam.wheelPrecision = 20;
new HemisphericLight("h", new Vector3(0, 1, 0), scene).intensity = 0.75;
const sol = new DirectionalLight("s", new Vector3(-0.4, -1, 0.6), scene); sol.intensity = 1.1;
const piso = MeshBuilder.CreateGround("piso", { width: 60, height: 12 }, scene);
const pm = new StandardMaterial("pm", scene); pm.diffuseColor = Color3.FromHexString("#d9cfb4"); pm.specularColor = Color3.Black(); piso.material = pm;

const RAZAS = ["Pura Sangre Inglés", "Árabe", "Cuarto de Milla", "Akhal-Teke", "Appaloosa", "Criollo", "Andaluz", "Frisón"];
interface Ficha { c: Caballo; titulo: string; sub: string; }

function cruza(rng: Rng, a: string, b: string, conRasgo = true): Caballo {
  for (let k = 0; k < 200; k++) {
    const h = potrillo(rng, caballoDeRaza(rng, { raza: a, sexo: "macho" }), caballoDeRaza(rng, { raza: b, sexo: "hembra" }), "x", 0);
    h.estado = "disponible";
    if (!conRasgo || h.rasgos?.includes(rasgoDePar(a, b)!)) return h;
  }
  throw new Error("sin rasgo");
}
/** Un pelaje liso (zaino o alazán) para comparar formas sin que el color distraiga. */
function pelajeLiso(): Caballo["pelaje"] {
  const rng = new Rng(3);
  for (let k = 0; k < 500; k++) {
    const c = caballoDeRaza(rng, { raza: "Pura Sangre Inglés" });
    const f = fenotipo(c.pelaje);
    if (/^(Alazán|Zaino)$/.test(f.nombre) && c.pelaje.marcas.cara === 0 && c.pelaje.marcas.patas.every((x) => x === 0)) return c.pelaje;
  }
  return caballoDeRaza(rng, { raza: "Criollo" }).pelaje;
}
/** Comparación A/B: el mismo caballo (misma sangre, mismo pelaje, forma neutra) sin y con un rasgo. */
function comparar(id: string): Ficha[] {
  const RAZAS_DE: Record<string, [string, string]> = {};
  for (let i = 0; i < RAZAS.length; i++) for (let j = i + 1; j < RAZAS.length; j++) { const r = rasgoDePar(RAZAS[i], RAZAS[j])!; RAZAS_DE[r] ??= [RAZAS[i], RAZAS[j]]; }
  const [a, b] = RAZAS_DE[id];
  const base = caballoDeRaza(new Rng(8), { raza: a });
  base.composicion = { [a]: 0.5, [b]: 0.5 }; base.forma = [0, 0, 0, 0]; base.pelaje = JSON.parse(JSON.stringify(pelajeLiso()));
  const con: Caballo = { ...base, rasgos: [id], pelaje: JSON.parse(JSON.stringify(base.pelaje)) };
  if (RASGOS[id].marcasPatas) con.pelaje.marcas.patas = [3, 3, 3, 3];
  if (RASGOS[id].marcaCara) con.pelaje.marcas.cara = 3;
  return [{ c: base, titulo: `${a} × ${b}`, sub: "sin el rasgo" }, { c: con, titulo: RASGOS[id].nombre, sub: RASGOS[id].descripcion }];
}

function grupo(g: string): Ficha[] {
  const rng = new Rng(11);
  if (g.startsWith("r:")) return comparar(g.slice(2));
  if (g === "linajes") {
    return Object.entries(LINAJES).flatMap(([id, l]) => {
      const base = cruza(rng, l.razas[0], l.razas[1], false);
      const raro: Caballo = { ...base, linaje: id };
      return [{ c: base, titulo: `${l.razas[0]} × ${l.razas[1]}`, sub: "cruza común" }, { c: raro, titulo: `Linaje ${l.nombre}`, sub: rasgosVisibles(raro).map((r) => RASGOS[r].nombre).join(" · ") }];
    });
  }
  if (g === "forma") {
    return Array.from({ length: 8 }, (_, i) => {
      const c = caballoDeRaza(new Rng(500 + i), { raza: "Criollo" });
      c.forma = [[-1, -1, -1, -1], [1, 1, 1, 1], [0, 1, 0, 0], [0, -1, 0, 0], [0, 0, 1, 0], [0, 0, -1, 0], [0, 0, 0, 1], [0, 0, 0, -1]][i];
      return { c, titulo: "Criollo", sub: `forma ${c.forma.join(" ")}` };
    });
  }
  const pares: [string, string][] = [];
  for (let i = 0; i < RAZAS.length; i++) for (let j = i + 1; j < RAZAS.length; j++) pares.push([RAZAS[i], RAZAS[j]]);
  // Un ejemplo por rasgo distinto (11), con la cruza que lo da
  const vistos = new Set<string>();
  const out: Ficha[] = [];
  for (const [a, b] of pares) {
    const r = rasgoDePar(a, b)!;
    if (vistos.has(r)) continue;
    vistos.add(r);
    const c = cruza(rng, a, b);
    out.push({ c, titulo: `${a} × ${b}`, sub: rasgosVisibles(c).map((x) => RASGOS[x].nombre).join(" · ") });
  }
  return out;
}

let vistas: { v: HorseModelView; f: Ficha; x: number }[] = [];
let vel = 0;
const rotulos = document.getElementById("rotulos")!;
async function mostrar(g: string) {
  await CaballoGLB.cargar(scene);
  for (const { v } of vistas) { v.dispose(); v.root.dispose(false, true); for (const m of v.meshes) m.dispose(false, true); }
  rotulos.innerHTML = "";
  const fichas = grupo(g);
  const paso = fichas.length <= 2 ? 3.3 : 4.2;
  vistas = fichas.map((f, i) => {
    const x = (i - (fichas.length - 1) / 2) * paso;
    const v = new HorseModelView(scene, 100 + i, { composicion: f.c.composicion, pelaje: f.c.pelaje, forma: f.c.forma, rasgos: f.c.rasgos, linaje: f.c.linaje }, false);
    return { v, f, x };
  });
  cam.radius = fichas.length <= 2 ? 12.5 : Math.max(18, fichas.length * paso * 0.9);
  for (const { f } of vistas) {
    const d = document.createElement("div");
    d.className = "rotulo";
    d.innerHTML = `<b>${f.titulo}</b>${f.sub || "—"}<br><small>${linaje(f.c.linaje)?.nombre ?? fenotipo(f.c.pelaje).nombre}</small>`;
    rotulos.appendChild(d);
  }
}
let t = 0;
scene.onBeforeRenderObservable.add(() => {
  const dt = engine.getDeltaTime() / 1000; t += dt;
  const vp = cam.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
  vistas.forEach(({ v, x }, i) => {
    v.update(new Vector3(x, 0, 0), Math.PI / 2, vel, dt, t);
    const s = Vector3.Project(new Vector3(x, -0.3, 0), Matrix.Identity(), scene.getTransformMatrix(), vp);
    const el = rotulos.children[i] as HTMLElement | undefined;
    if (el) { el.style.left = `${s.x / engine.getHardwareScalingLevel()}px`; el.style.top = `${s.y / engine.getHardwareScalingLevel()}px`; }
  });
});
document.querySelectorAll<HTMLButtonElement>("#barra button").forEach((b) => b.onclick = () => {
  if (b.dataset.g) void mostrar(b.dataset.g);
  if (b.dataset.v) vel = Number(b.dataset.v);
});
const selR = document.getElementById("rasgo") as HTMLSelectElement;
for (const [id, r] of Object.entries(RASGOS)) selR.add(new Option(r.nombre, id));
selR.onchange = () => { if (selR.value) void mostrar(`r:${selR.value}`); };
engine.runRenderLoop(() => scene.render());
window.addEventListener("resize", () => engine.resize());
const g = new URLSearchParams(location.search).get("g") ?? "cruzas";
void mostrar(g);
(window as unknown as { lamina: unknown }).lamina = { scene, cam, mostrar, setVel: (v: number) => { vel = v; } };
