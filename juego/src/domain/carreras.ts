// Carreras contra IA (GDD v0.2 §9.1, §11.2, §11.3, §16): modos, premios, límite diario, campeonato semanal,
// historial y bono del tutorial.
import cfg from "../../config/balance/recompensas.json" with { type: "json" };
import type { Rng } from "../sim/rng.ts";
import type { Partida } from "./partida.ts";
import { enviarARecuperacion } from "./edificios.ts";
import { contar, finDelDia, mover, premioConLimite, semanaDe } from "./economia.ts";
import { BIENESTAR, despuesDeCorrer } from "./bienestar.ts";

export type Modo = "practica" | "casual" | "campeonato" | "online" | "ranked" | "guerra";
/** Modos que se eligen libremente; el campeonato tiene su propia inscripción. */
/** Modos contra la IA que se eligen en Carreras. Práctica se quitó el 15/11/2026 (pedido del usuario); queda en el tipo por el historial. */
export const MODOS: Modo[] = ["casual"];
export const NOMBRE_MODO: Record<Modo, string> = { practica: "Práctica", casual: "Casual", campeonato: "Campeonato", online: "Online casual", ranked: "Ranked", guerra: "Guerra de clanes" };
const C = cfg.campeonato;

export function participantes(modo: Modo): number { return modo === "campeonato" ? C.participantes : cfg.modos[modo].participantes; }

// ------------------------------------------------------------------ campeonato semanal (§11.3)

export interface Campeonato { semana: number; distancia: 500 | 1500; superficie: "cesped" | "tierra"; corrido: boolean; }
export const INSCRIPCION_CAMPEONATO = C.inscripcion;
export const PREMIOS_CAMPEONATO = C.premios;
export const ENTRENO_RIVALES_CAMPEONATO = C.entrenoRivalesMaximo;

/** Sábado o domingo, hora local. */
export function esFinDeSemana(ahora: number): boolean { const d = new Date(ahora).getDay(); return d === 0 || d === 6; }
/** Cuándo abre el próximo campeonato (sábado 00:00) o, si está abierto, cuándo cierra (lunes 00:00). */
export function proximoCambioCampeonato(ahora: number): number {
  let t = finDelDia(ahora);
  for (let k = 0; k < 8 && esFinDeSemana(t) === esFinDeSemana(ahora); k++) t = finDelDia(t + 1);
  return t;
}
/** La inscripción de esta semana, si la hay. */
export function campeonatoDeLaSemana(p: Partida, ahora: number): Campeonato | null {
  return p.campeonato && p.campeonato.semana === semanaDe(ahora) ? p.campeonato : null;
}

export function inscribirCampeonato(p: Partida, ahora: number, rng: Rng): { ok: true } | { ok: false; motivo: string } {
  if (!esFinDeSemana(ahora)) return { ok: false, motivo: "El campeonato se juega el fin de semana." };
  if (campeonatoDeLaSemana(p, ahora)) return { ok: false, motivo: "Ya te inscribiste en el campeonato de esta semana." };
  if (p.oro < C.inscripcion) return { ok: false, motivo: `La inscripción cuesta ${C.inscripcion} Oro.` };
  mover(p, "oro", -C.inscripcion, "campeonato:inscripcion", ahora);
  p.campeonato = { semana: semanaDe(ahora), distancia: sortearDistancia(rng), superficie: rng.next() < 0.5 ? "cesped" : "tierra", corrido: false };
  return { ok: true };
}

/** Sorteo de la próxima carrera; si ya hay uno pendiente se mantiene (no se puede volver a sortear). */
export function sorteoPendiente(p: Partida, rng: Rng): { distancia: 500 | 1500; superficie: "cesped" | "tierra" } {
  if (!p.sorteo) p.sorteo = { distancia: sortearDistancia(rng), superficie: rng.next() < 0.5 ? "cesped" : "tierra" };
  return p.sorteo;
}

/** La distancia se sortea 50/50 y se revela antes de elegir caballo (§9.1). */
export function sortearDistancia(rng: Rng): 500 | 1500 { return rng.next() < 0.5 ? 500 : 1500; }

export function recompensa(modo: Modo, distancia: number, posicion: number): number {
  if (modo === "campeonato") return C.premios[Math.min(posicion, C.premios.length) - 1];
  const tabla = distancia >= 1500 ? cfg.modos[modo].oro1500 : cfg.modos[modo].oro500;
  return tabla[Math.min(posicion, 4) - 1];
}

export interface RegistroCarrera {
  id: string;
  fecha: number;
  modo: Modo;
  distancia: number;
  superficie: string;
  caballoId: string;
  caballoNombre: string;
  estrategia: string;
  posicion: number;
  participantes: number;
  tiempo: number;          // segundos
  diferencia: number;      // segundos con el ganador (0 si ganó)
  fotoFinal: boolean;
  oro: number;             // premio cobrado (incluye el bono del tutorial si correspondió)
  seed: number;
  simVersion: string;
  /** Fase 6.5: se lesionó y se retiró (no cobra premio de puesto). */
  lesion?: boolean;
  /** 7.5: se corrió sin conexión con un token y se cobró al sincronizar. */
  offline?: boolean;
}

export type DatosCarrera = Omit<RegistroCarrera, "id" | "oro" | "fecha">;

/** Cobra el premio, suma al historial del caballo y del jugador y manda al caballo a recuperación. */
export function registrarCarrera(p: Partida, d: DatosCarrera, ahora: number): { oro: number; bonoTutorial: number; reducido: boolean } {
  const c = p.caballos.find((x) => x.id === d.caballoId);
  // §11.2: límite diario; el campeonato (§11.3) y las guerras de clanes (§14, se premian al terminar la guerra) no cuentan.
  const { oro, reducido } = d.lesion ? { oro: 0, reducido: false } : d.modo === "campeonato" || d.modo === "guerra"
    ? { oro: recompensa(d.modo, d.distancia, d.posicion), reducido: false }
    : premioConLimite(p, recompensa(d.modo, d.distancia, d.posicion), ahora);
  if (d.modo === "campeonato" && p.campeonato) p.campeonato.corrido = true;
  let bonoTutorial = 0;
  if (!p.tutorial.terminado) {
    bonoTutorial = cfg.bonoTutorial;                 // §11.1: +1.500 al terminar el tutorial (paso 6 de §16)
    p.tutorial = { paso: 8, terminado: true };
  }
  const ref = `r-${ahora.toString(36)}-${d.seed.toString(36)}`;
  mover(p, "oro", oro, d.modo === "campeonato" ? "campeonato:premio" : reducido ? "carrera:reducida" : "carrera", ahora, ref);
  mover(p, "oro", bonoTutorial, "tutorial", ahora, ref);
  contar(p, "carreras", ahora);
  if (d.posicion <= 3 && !d.lesion) contar(p, "podios", ahora);
  if (c) {
    c.carreras += 1;
    if (d.posicion === 1 && !d.lesion) c.victorias += 1;
    despuesDeCorrer(c, d.distancia, ahora);
    if (d.lesion) c.lesiones = (c.lesiones ?? 0) + 1;
    enviarARecuperacion(p, c.id, d.distancia, ahora, d.lesion ? BIENESTAR.lesion.recuperacionExtraMin : 0);
  }
  const hist = p.historial ?? [];
  hist.unshift({ ...d, id: ref, fecha: ahora, oro: oro + bonoTutorial });
  p.historial = hist.slice(0, cfg.historialMaximo);
  // El online, el campeonato y las carreras offline (la distancia sale del token) no usan el sorteo pendiente
  if ((d.modo === "practica" || d.modo === "casual") && !d.offline) delete p.sorteo;
  return { oro, bonoTutorial, reducido };
}
