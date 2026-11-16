// Reglas de los tres edificios (GDD v0.2 §7, §8): mejoras, espacios, entrenamiento, recuperación y temporizadores.
// Todo recibe el instante `ahora` (ms) y un Rng: así las reglas son puras, deterministas y comprobables.
// En la Fase 7 el servidor pasa a ser la autoridad de estos temporizadores (§18); estas mismas funciones se reutilizan.
import cfg from "../../config/balance/edificios.json" with { type: "json" };
import type { Rng } from "../sim/rng.ts";
import type { Caballo } from "./caballo.ts";
import { TECHO_ESTABLO, type Partida, type TipoEdificio } from "./partida.ts";
import { nacer } from "./crianza.ts";
import { contar, mover, quitarMontura } from "./economia.ts";

export type Resultado = { ok: true } | { ok: false; motivo: string };
const MIN = 60_000;
const no = (motivo: string): Resultado => ({ ok: false, motivo });
const si: Resultado = { ok: true };

/** Copia profunda para que la interfaz trabaje sobre una partida nueva (React compara referencias). */
export function clonar(p: Partida): Partida { return JSON.parse(JSON.stringify(p)) as Partida; }

// ------------------------------------------------------------------ mejoras

export function costoMejora(nivel: number): { oro: number; minutos: number } | null {
  if (nivel >= cfg.nivelMaximo) return null;
  return { oro: cfg.mejoras.oro[nivel - 1], minutos: cfg.mejoras.minutos[nivel - 1] };
}

export function iniciarMejora(p: Partida, tipo: TipoEdificio, ahora: number): Resultado {
  const e = p.edificios[tipo];
  if (e.mejoraFin !== null) return no("Ya se está mejorando.");
  const c = costoMejora(e.nivel);
  if (!c) return no("Ya está en el nivel máximo.");
  if (p.oro < c.oro) return no(`Faltan ${(c.oro - p.oro).toLocaleString("es-AR")} de Oro.`);
  mover(p, "oro", -c.oro, "mejora", ahora, tipo);
  e.mejoraFin = ahora + c.minutos * MIN;
  return si;
}

// ------------------------------------------------------------------ espacios del establo

/** Precio del próximo espacio en Oro, o null si el nivel del establo no permite más. */
export function precioEspacio(p: Partida): number | null {
  if (p.espacios >= TECHO_ESTABLO[p.edificios.establo.nivel]) return null;
  return cfg.establo.precioEspacioOro[p.espacios - cfg.establo.espaciosGratis] ?? null;
}

export function comprarEspacio(p: Partida, moneda: "oro" | "gemas"): Resultado {
  const oro = precioEspacio(p);
  if (oro === null) return no("Mejorá el establo para tener más espacios.");
  if (moneda === "oro") {
    if (p.oro < oro) return no(`Faltan ${(oro - p.oro).toLocaleString("es-AR")} de Oro.`);
    mover(p, "oro", -oro, "espacio");
  } else {
    const g = cfg.establo.precioEspacioGemas;
    if (p.gemas < g) return no(`Faltan ${g - p.gemas} Gemas.`);
    mover(p, "gemas", -g, "espacio");
  }
  p.espacios += 1;
  return si;
}

// ------------------------------------------------------------------ entrenamiento (§7)

export function topeEntrenamiento(p: Partida): number { return cfg.entrenamiento.topePuntosPorNivel[p.edificios.entrenamiento.nivel - 1]; }
export function lugaresEntrenamiento(p: Partida): number { return cfg.entrenamiento.simultaneosPorNivel[p.edificios.entrenamiento.nivel - 1]; }
export function lugaresRecuperacion(p: Partida): number { return cfg.recuperacion.capacidadPorNivel[p.edificios.recuperacion.nivel - 1]; }
const cuantos = (p: Partida, estado: Caballo["estado"]) => p.caballos.filter((c) => c.estado === estado).length;

/** Índices de los atributos que todavía pueden subir con el tope actual. */
export function atributosEntrenables(c: Caballo, tope: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 5; i++) if (c.entreno[i] < tope && c.natural[i] + c.entreno[i] < cfg.entrenamiento.maximoFinal) out.push(i);
  return out;
}

/** Sorteo de una sesión: 2 atributos distintos (35 % un tercero) ponderados por predisposición; +1, o +2 con 20 %. */
export function sortearEntrenamiento(c: Caballo, tope: number, rng: Rng): number[] {
  const delta = [0, 0, 0, 0, 0];
  const libres = atributosEntrenables(c, tope);
  let k = cfg.entrenamiento.atributosSorteados + (rng.next() < cfg.entrenamiento.probTercerAtributo ? 1 : 0);
  k = Math.min(k, libres.length);
  const pool = libres.slice();
  for (let n = 0; n < k; n++) {
    const total = pool.reduce((s, i) => s + c.predisposicion[i], 0);
    let r = rng.next() * total, elegido = pool[pool.length - 1];
    for (const i of pool) { r -= c.predisposicion[i]; if (r < 0) { elegido = i; break; } }
    pool.splice(pool.indexOf(elegido), 1);
    const puntos = rng.next() < cfg.entrenamiento.probDosPuntos ? 2 : 1;
    const margen = Math.min(tope - c.entreno[elegido], cfg.entrenamiento.maximoFinal - c.natural[elegido] - c.entreno[elegido]);
    delta[elegido] = Math.max(0, Math.min(puntos, margen));
  }
  return delta;
}

export function puedeEntrenar(p: Partida, c: Caballo): Resultado {
  if (c.estado !== "disponible") return no("El caballo no está disponible.");
  if (atributosEntrenables(c, topeEntrenamiento(p)).length === 0) return no("Llegó al tope de entrenamiento de este nivel. Mejorá el Centro de entrenamiento.");
  if (cuantos(p, "entrenando") >= lugaresEntrenamiento(p)) return no("No hay lugares libres en el Centro de entrenamiento.");
  return si;
}

export function iniciarEntrenamiento(p: Partida, id: string, ahora: number, rng: Rng): Resultado {
  const c = p.caballos.find((x) => x.id === id);
  if (!c) return no("No se encontró el caballo.");
  const r = puedeEntrenar(p, c);
  if (!r.ok) return r;
  c.entrenoPendiente = sortearEntrenamiento(c, topeEntrenamiento(p), rng);
  c.estado = "entrenando";
  c.inicioEstado = ahora;
  c.finEstado = ahora + cfg.entrenamiento.minutos * MIN;
  return si;
}

/** Detiene el entrenamiento: el caballo vuelve disponible y no gana los puntos de esa sesión (pedido del usuario, §23.1). */
export function detenerEntrenamiento(p: Partida, id: string): Resultado {
  const c = p.caballos.find((x) => x.id === id);
  if (!c || c.estado !== "entrenando") return no("El caballo no está entrenando.");
  c.estado = "disponible"; c.finEstado = null;
  delete c.entrenoPendiente; delete c.inicioEstado;
  return si;
}

/** Libera (elimina) un caballo del establo. Solo si está disponible y no es el último (pedido del usuario, §23.1). */
export function liberarCaballo(p: Partida, id: string): Resultado {
  const c = p.caballos.find((x) => x.id === id);
  if (!c) return no("No se encontró el caballo.");
  if (p.caballos.length <= 1) return no("No podés liberar tu único caballo.");
  if (c.estado !== "disponible") return no("Solo se puede liberar un caballo disponible (detené antes lo que esté haciendo).");
  quitarMontura(c);
  p.caballos = p.caballos.filter((x) => x.id !== id);
  return si;
}

// ------------------------------------------------------------------ recuperación (§8.3)

export function minutosRecuperacion(distancia: number): number { return distancia >= 1500 ? cfg.recuperacion.minutos1500 : cfg.recuperacion.minutos500; }

/** Después de cada carrera el caballo entra al Centro de recuperación; si está lleno, espera en cola. */
export function enviarARecuperacion(p: Partida, id: string, distancia: number, ahora: number, extraMin = 0): Resultado {
  const c = p.caballos.find((x) => x.id === id);
  if (!c) return no("No se encontró el caballo.");
  const minutos = minutosRecuperacion(distancia) + extraMin;   // Fase 6.5: la lesión alarga el descanso
  if (cuantos(p, "recuperacion") < lugaresRecuperacion(p)) {
    c.estado = "recuperacion"; c.inicioEstado = ahora; c.finEstado = ahora + minutos * MIN; delete c.cola;
  } else {
    c.estado = "colaRecuperacion"; c.inicioEstado = ahora; c.finEstado = null; c.cola = { desde: ahora, minutos };
  }
  return si;
}

/** Saca un caballo del Centro de recuperación (o de su cola) antes de tiempo: queda disponible y puede entrenar,
 *  pero no puede correr hasta cumplir el descanso que le faltaba (opción b elegida por el usuario, §23.1). */
export function sacarDeRecuperacion(p: Partida, id: string, ahora: number): Resultado {
  const c = p.caballos.find((x) => x.id === id);
  if (!c) return no("No se encontró el caballo.");
  let hasta: number;
  if (c.estado === "recuperacion" && c.finEstado !== null) hasta = c.finEstado;
  else if (c.estado === "colaRecuperacion" && c.cola) hasta = ahora + c.cola.minutos * MIN;
  else return no("El caballo no está en recuperación.");
  c.estado = "disponible"; c.finEstado = null; c.descansoHasta = hasta;
  delete c.cola; delete c.inicioEstado;
  llenarRecuperacion(p, ahora);
  return si;
}

/** Puede correr: disponible y con el descanso cumplido. */
export function puedeCorrer(c: Caballo, ahora: number): Resultado {
  if (c.estado !== "disponible") return no("El caballo no está disponible.");
  if (c.descansoHasta !== undefined && c.descansoHasta > ahora) return no("Salió antes de la recuperación: todavía le falta descanso para correr.");
  return si;
}

/** Pasa a recuperación a los que esperan en cola, por orden de llegada, mientras haya lugar. */
function llenarRecuperacion(p: Partida, t: number): void {
  const cola = p.caballos.filter((c) => c.estado === "colaRecuperacion" && c.cola).sort((a, b) => a.cola!.desde - b.cola!.desde);
  for (const c of cola) {
    if (cuantos(p, "recuperacion") >= lugaresRecuperacion(p)) break;
    c.estado = "recuperacion"; c.inicioEstado = t; c.finEstado = t + c.cola!.minutos * MIN; delete c.cola;
  }
}

// ------------------------------------------------------------------ reloj

export type Suceso =
  | { tipo: "mejora"; edificio: TipoEdificio; nivel: number; t: number }
  | { tipo: "entrenamiento"; caballoId: string; puntos: number[]; t: number }
  | { tipo: "recuperado"; caballoId: string; t: number }
  | { tipo: "nacimiento"; caballoId: string; t: number }
  | { tipo: "crecido"; caballoId: string; t: number };

/** Aplica, en orden cronológico, todo lo que terminó hasta `ahora` (también lo ocurrido con el juego cerrado). */
export function actualizar(p: Partida, ahora: number): Suceso[] {
  const sucesos: Suceso[] = [];
  for (let guarda = 0; guarda < 10_000; guarda++) {
    let t = Infinity, accion: (() => void) | null = null;
    for (const tipo of Object.keys(p.edificios) as TipoEdificio[]) {
      const e = p.edificios[tipo];
      if (e.mejoraFin !== null && e.mejoraFin <= ahora && e.mejoraFin < t) {
        t = e.mejoraFin;
        accion = () => { e.nivel += 1; e.mejoraFin = null; sucesos.push({ tipo: "mejora", edificio: tipo, nivel: e.nivel, t }); llenarRecuperacion(p, t); };
      }
    }
    if (p.cruza && p.cruza.fin <= ahora && p.cruza.fin < t) {
      t = p.cruza.fin;
      accion = () => { const h = nacer(p, t); if (h) sucesos.push({ tipo: "nacimiento", caballoId: h.id, t }); };
    }
    for (const c of p.caballos) {
      if (c.estado === "creciendo" && c.finEstado !== null && c.finEstado <= ahora && c.finEstado < t) {
        t = c.finEstado;
        accion = () => { c.estado = "disponible"; c.finEstado = null; c.disponibleDesde = t; delete c.inicioEstado; sucesos.push({ tipo: "crecido", caballoId: c.id, t }); };
      }
      if ((c.estado === "entrenando" || c.estado === "recuperacion") && c.finEstado !== null && c.finEstado <= ahora && c.finEstado < t) {
        t = c.finEstado;
        accion = () => {
          if (c.estado === "entrenando") {
            const d = c.entrenoPendiente ?? [0, 0, 0, 0, 0];
            c.entreno = c.entreno.map((v, i) => v + d[i]);
            delete c.entrenoPendiente;
            sucesos.push({ tipo: "entrenamiento", caballoId: c.id, puntos: d, t });
            contar(p, "entrenamientos", t);
            c.estado = "disponible"; c.finEstado = null; c.disponibleDesde = t; delete c.inicioEstado;
          } else {
            c.estado = "disponible"; c.finEstado = null; c.disponibleDesde = t; delete c.inicioEstado;
            sucesos.push({ tipo: "recuperado", caballoId: c.id, t });
            llenarRecuperacion(p, t);
          }
        };
      }
    }
    if (!accion) break;
    accion();
  }
  llenarRecuperacion(p, ahora);
  for (const c of p.caballos) if (c.descansoHasta !== undefined && c.descansoHasta <= ahora) {
    c.disponibleDesde = Math.max(c.disponibleDesde ?? 0, c.descansoHasta);
    delete c.descansoHasta;
  }
  return sucesos;
}

/** Próximo instante en que algo termina (para programar la próxima actualización de la interfaz). */
export function proximoFin(p: Partida): number | null {
  let t = Infinity;
  for (const e of Object.values(p.edificios)) if (e.mejoraFin !== null) t = Math.min(t, e.mejoraFin);
  if (p.cruza) t = Math.min(t, p.cruza.fin);
  for (const c of p.caballos) {
    if (c.finEstado !== null) t = Math.min(t, c.finEstado);
    if (c.descansoHasta !== undefined) t = Math.min(t, c.descansoHasta);
  }
  return Number.isFinite(t) ? t : null;
}
