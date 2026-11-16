// Punto de entrada. El juego arranca en el campo (React + Babylon). La pantalla Carreras (React) elige modo, distancia,
// caballo y estrategia; acá se arma y se muestra la carrera (Babylon + simulador, lógica de la Fase 1) y su resultado.
import { Engine } from "@babylonjs/core";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { App, type Juego } from "./ui/App.tsx";
import { FichaView } from "./render/fichaView.ts";
import { CampoView } from "./render/campoView.ts";
import { BIENESTAR } from "./domain/bienestar.ts";
import { almacenPorDefecto } from "./domain/partida.ts";
import { RaceView, PARAMS, type HudState } from "./game/raceView.ts";
import { SonidoCarrera } from "./audio/sonidoCarrera.ts";
import { CaballoGLB } from "./render/horseModel.ts";
import { newRaceSetup, type RaceSetup } from "./game/field.ts";
import type { RaceResult } from "./sim/types.ts";
import type { ResultadoJugador } from "./ui/App.tsx";
import type { CamMode } from "./render/cameras.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("render");
const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, antialias: true });
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
window.addEventListener("resize", () => engine.resize());

const CAM_TXT: Record<CamMode, string> = { seguimiento: "Seguimiento", lateral: "Lateral", aerea: "Aérea", llegada: "Llegada", meta: "Meta" };

let setup: RaceSetup = newRaceSetup(PARAMS._version);
let lastResult: RaceResult | null = null;
let esRepeticion = false;
/** rating: solo en las Ranked (7.3), lo calcula el servidor. */
type Cobro = { oro: number; bonoTutorial: number; reducido: boolean;
  rating?: { antes: number; despues: number; carreras: number; colocacion: boolean; division: { nombre: string; color: string } | null };
  /** 7.5: carrera offline: el Oro se cobra al reconectar. */ pendiente?: boolean;
  /** 7.4: apuesta de la carrera online. */ apuesta?: { en: string; monto: number; pago: number; dividendo: number | null; devuelta: boolean } };
let alTerminarCarrera: ((r: ResultadoJugador) => Cobro) | null = null;
let alVolver: (() => void) | null = null;
let modo: "menu" | "carrera" = "menu";

const sonido = new SonidoCarrera();
const view = new RaceView(engine, {
  onHud: renderHud,
  onFinish: showResults,
  onAnnounce: (t) => { const a = $("anuncio"); a.textContent = t; a.classList.toggle("visible", !!t); },
});
const ficha = new FichaView(engine);
const campo = new CampoView(engine);
let vista3D: "campo" | "ficha" = "campo";
engine.runRenderLoop(() => {
  if (modo === "menu") (vista3D === "campo" ? campo.scene : ficha.scene).render();
  else if (view.scene.activeCamera) view.scene.render(); // la cámara de carrera existe recién tras cargar la primera carrera
});

// ---------- HUD ----------
function renderHud(h: HudState): void {
  if (h.phase === "previa" && !$("hudTop").classList.contains("visible")) return;
  const ord = (n: number) => `${n}.º`;
  $("hudPos").textContent = `${ord(h.position)} / ${h.total}`;
  $("hudRest").textContent = h.phase === "carrera" || h.phase === "final" ? `${Math.ceil(h.remaining)} m` : "—";
  $("hudTime").textContent = `${h.t.toFixed(1)} s`;
  $("hudDist").textContent = (h.distance === 500 ? "500 m" : "1.500 m") + (h.replay ? " · REPETICIÓN" : "");
  $("hudOrder").innerHTML = h.order.map((n) => `<span class="num n${n} ${n === setup.entrants[setup.playerIndex].number ? "yo" : ""}">${n}</span>`).join("");
  $("hudFps").textContent = `${Math.round(h.fps)} FPS`;
  document.querySelectorAll<HTMLButtonElement>(".cam").forEach((b) => b.classList.toggle("on", !h.auto && b.dataset.c === h.camMode || (h.auto && b.dataset.c === "auto")));
  document.querySelectorAll<HTMLButtonElement>(".vel").forEach((b) => b.classList.toggle("on", Number(b.dataset.v) === h.speed));
}
document.querySelectorAll<HTMLButtonElement>(".cam").forEach((b) => b.onclick = (e) => {
  e.stopPropagation();
  const c = b.dataset.c!;
  if (c === "auto") view.camera.auto = true;
  else { view.camera.auto = false; view.camera.mode = c as CamMode; }
});
document.querySelectorAll<HTMLButtonElement>(".vel").forEach((b) => b.onclick = (e) => { e.stopPropagation(); view.speedMult = Number(b.dataset.v); });
// Fase 10: sonido. El botón pasa por fuerte → medio → silencio y se recuerda en este navegador.
view.sonido = sonido;
const NIVELES = [0.8, 0.4, 0];
function pintarSonido(): void {
  const b = $("sonido");
  b.textContent = sonido.volumen === 0 ? "🔇" : sonido.volumen < 0.6 ? "🔉" : "🔊";
  b.title = sonido.volumen === 0 ? "Sin sonido" : `Volumen ${Math.round(sonido.volumen * 100)} %`;
  b.setAttribute("aria-label", b.title);
}
$("sonido").onclick = (e) => {
  e.stopPropagation();
  const k = NIVELES.findIndex((x) => Math.abs(x - sonido.volumen) < 0.05);
  sonido.setVolumen(NIVELES[(k + 1) % NIVELES.length]);
  pintarSonido();
};
pintarSonido();
window.addEventListener("keydown", (e) => {
  if (modo !== "carrera" || (e.target as HTMLElement | null)?.tagName === "INPUT") return; // atajos solo en la carrera
  const map: Record<string, CamMode> = { Digit1: "seguimiento", Digit2: "lateral", Digit3: "aerea", Digit4: "llegada", Digit5: "meta" };
  if (map[e.code]) { view.camera.auto = false; view.camera.mode = map[e.code]; }
  if (e.code === "KeyA") view.camera.auto = true;
});
void CAM_TXT;

// ---------- Resultados ----------
function showResults(r: RaceResult): void {
  lastResult = r;
  const best = r.finishTimes[r.order[0]];
  const lesionados = new Set(r.injured ?? []);
  const rows = r.order.map((i, k) => {
    const e = setup.entrants[i];
    const t = r.finishTimes[i];
    const retirado = lesionados.has(i);
    const gap = k === 0 || retirado ? "" : `+${(t - best).toFixed(2)} s`;
    const nombre = e.isPlayer ? e.caballo.nombre : e.dueno ? `${e.caballo.nombre} <small>(${e.dueno})</small>` : e.breed;
    return `<tr class="${e.isPlayer ? "yo" : ""}"><td>${retirado ? "—" : `${k + 1}.º`}</td><td><span class="num n${e.number}">${e.number}</span></td><td>${nombre}</td><td>${retirado ? "Se lesionó" : `${t.toFixed(2)} s`}</td><td>${gap}</td></tr>`;
  }).join("");
  const pos = r.order.indexOf(setup.playerIndex) + 1;
  const lesion = lesionados.has(setup.playerIndex);
  // Las repeticiones no cuentan. La carrera real cobra el premio, va al historial y manda al caballo a recuperación.
  const tiempo = lesion ? 0 : r.finishTimes[setup.playerIndex];
  const cobro = !esRepeticion && alTerminarCarrera
    ? alTerminarCarrera({ posicion: pos, tiempo, diferencia: lesion ? 0 : tiempo - best, fotoFinal: r.photoFinish, seed: setup.input.seed,
        simVersion: setup.input.simVersion, participantes: setup.entrants.length, distancia: setup.input.distance, superficie: setup.input.surface,
        ...(lesion ? { lesion: true } : {}) })
    : null;
  if (cobro) alTerminarCarrera = null;
  $("panel").innerHTML = `
    <div class="card">
      <div class="eyebrow">Resultado${esRepeticion ? " · repetición" : ""}</div>
      <h1>${lesion ? "Se lesionó y no terminó" : pos === 1 ? "¡Ganaste!" : `Llegaste ${pos}.º`}</h1>
      ${cobro ? `<p class="premio">+${cobro.oro.toLocaleString("es-AR")} Oro${cobro.bonoTutorial ? ` · ¡Bono de bienvenida: +${cobro.bonoTutorial.toLocaleString("es-AR")} Oro!` : ""}</p>` : ""}
      ${cobro?.pendiente ? `<p class="muted">Carrera sin conexión: el Oro se acredita cuando vuelva la conexión con el servidor, que repite la carrera para validarla.</p>` : ""}
      ${cobro?.rating ? lineaRating(cobro.rating) : ""}
      ${cobro?.apuesta ? lineaApuesta(cobro.apuesta) : ""}
      ${cobro?.reducido ? `<p class="muted">Premio reducido al 25 %: ya corriste las carreras con premio completo de hoy.</p>` : ""}
      ${r.photoFinish ? `<p class="badge">Foto final: diferencia menor a 0,05 s</p>` : ""}
      ${lesion ? `<p class="muted">Un caballo lesionado no cobra premio de puesto. ${setup.entrants[setup.playerIndex].caballo.nombre} pasa al Centro de recuperación por más tiempo (${(setup.input.distance === 500 ? 15 : 30) + BIENESTAR.lesion.recuperacionExtraMin} min). Para que no se repita: dejalo descansar entre carreras y ponele herraduras.</p>`
        : `<p class="muted">${setup.entrants[setup.playerIndex].caballo.nombre} pasa al Centro de recuperación (${setup.input.distance === 500 ? "15" : "30"} min).</p>`}
      <table class="res"><thead><tr><th></th><th></th><th>Caballo</th><th>Tiempo</th><th>Dif.</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="actions">
        <button class="ghost" id="repe">Ver repetición</button>
        <button class="primary" id="volver">Volver al campo</button>
      </div>
    </div>`;
  $("panel").classList.add("visible");
  $("repe").onclick = () => {
    if (!lastResult) return;
    // Repetición: la misma entrada debe dar exactamente el mismo resultado (determinismo).
    const expected = lastResult.finishTimes.slice();
    view.load(setup.input, setup.entrants, setup.playerIndex, true);
    esRepeticion = true;
    $("panel").classList.remove("visible");
    view.start();
    (window as unknown as { __esperado: number[] }).__esperado = expected;
  };
  $("volver").onclick = volverAlEstablo;
  const exp = (window as unknown as { __esperado?: number[] }).__esperado;
  if (exp) {
    const same = exp.every((t, i) => Object.is(t, r.finishTimes[i]));
    console.info(`[repetición] resultado idéntico al original: ${same}`);
    (window as unknown as { __esperado?: number[] }).__esperado = undefined;
  }
}

/** 7.4: cómo le fue a la apuesta. */
function lineaApuesta(a: NonNullable<Cobro["apuesta"]>): string {
  const m = (x: number) => x.toLocaleString("es-AR");
  if (a.devuelta) return `<p class="apuesta-res">Apuesta de ${m(a.monto)} Oro a ${a.en}: se devolvió (nadie acertó o no largó).</p>`;
  if (a.pago > 0) return `<p class="apuesta-res gana">Apuesta a ${a.en}: ¡ganada! Cobrás <b>${m(a.pago)} Oro</b> (×${(a.dividendo ?? 1).toLocaleString("es-AR", { maximumFractionDigits: 2 })}).</p>`;
  return `<p class="apuesta-res pierde">Apuesta de ${m(a.monto)} Oro a ${a.en}: perdida.</p>`;
}

/** 7.3: cuánto cambió el rating en una Ranked. */
function lineaRating(r: NonNullable<Cobro["rating"]>): string {
  const d = r.despues - r.antes;
  const signo = d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "±0";
  const div = r.colocacion ? `Colocación ${r.carreras} de 10` : r.division ? `<b style="color:${r.division.color}">${r.division.nombre}</b>` : "";
  return `<p class="rating-cambio ${d > 0 ? "sube" : d < 0 ? "baja" : ""}">Rating ${r.antes.toLocaleString("es-AR")} → <b>${r.despues.toLocaleString("es-AR")}</b> (${signo}) · ${div}</p>`;
}

// ---------- Establo ↔ carrera ----------
const ui = $("ui");
const preparado = CaballoGLB.cargar(view.scene).then((ok) => {
  console.info(`[caballos] modelo GLB ${ok ? "cargado" : "no disponible: se usa el caballo provisorio"}`);
});

function ponerModo(m: "menu" | "carrera"): void {
  modo = m;
  ui.classList.toggle("oculto", m === "carrera");
  $("app").classList.toggle("menu", m === "menu");
  $("hud").classList.toggle("oculto", m === "menu");
  ficha.activar(canvas, m === "menu" && vista3D === "ficha");
  campo.activo = m === "menu" && vista3D === "campo";
  $("panel").classList.remove("visible");
  if (m === "menu") $("hudTop").classList.remove("visible");
}

function volverAlEstablo(): void {
  view.pausar();
  ponerModo("menu");
  const f = alVolver; alVolver = null; alTerminarCarrera = null;
  f?.();
}

const juego: Juego = {
  almacen: almacenPorDefecto(),
  ficha,
  campo,
  mostrar3D(v) {
    vista3D = v;
    ficha.activar(canvas, modo === "menu" && v === "ficha");
    campo.activo = modo === "menu" && v === "campo";
  },
  async reproducir(s, cobro, volver) {
    // Fase 7: la carrera ya la simuló y cobró el servidor; acá se reproduce con la misma entrada (mismo resultado).
    alTerminarCarrera = () => cobro; alVolver = volver;
    await preparado;
    // En la online cada cliente marca su propio caballo
    setup = { ...s, entrants: s.entrants.map((e, i) => ({ ...e, isPlayer: i === s.playerIndex })) };
    view.load(setup.input, setup.entrants, setup.playerIndex);
    esRepeticion = false;
    ponerModo("carrera");
    $("hudTop").classList.add("visible");
    view.start();
  },
  /** Fase 9: ver una carrera ya corrida (las de las guerras de clanes). Es una repetición: no cobra ni cambia nada. */
  async verCarrera(s, volver) {
    alTerminarCarrera = null; alVolver = volver;
    await preparado;
    setup = { ...s, entrants: s.entrants.map((e, i) => ({ ...e, isPlayer: i === s.playerIndex })) };
    view.load(setup.input, setup.entrants, setup.playerIndex, true);
    esRepeticion = true;
    ponerModo("carrera");
    $("hudTop").classList.add("visible");
    view.start();
  },
  async correr(c, o, terminada, volver) {
    alTerminarCarrera = terminada; alVolver = volver;
    await preparado;
    setup = newRaceSetup(PARAMS._version, o.estrategia, c, { n: o.participantes, distance: o.distancia, surface: o.superficie, entrenoRivales: o.entrenoRivales });
    view.load(setup.input, setup.entrants, setup.playerIndex);
    esRepeticion = false;
    ponerModo("carrera");
    $("hudTop").classList.add("visible");
    view.start();
  },
};
ponerModo("menu");
createRoot(ui).render(createElement(App, { juego }));
(window as unknown as { caballos: unknown }).caballos = { view, ficha, campo, engine, juego, get setup() { return setup; } };
