// Carreras offline (Fase 7.5, GDD §15). Con conexión, el servidor entrega tokens firmados; sin conexión, cada carrera
// Casual gasta uno. El token fija la semilla: la distancia, la superficie, los rivales y el resultado salen de ella,
// así el servidor puede repetir la carrera exactamente al sincronizar y recién ahí acreditar el premio.
// Este módulo es puro: lo usan el cliente (para correr sin conexión) y el servidor (para validar).
import cfg from "../../config/balance/offline.json" with { type: "json" };
import { Rng } from "../sim/rng.ts";
import { simulateRace, type RaceParams } from "../sim/race.ts";
import type { Strategy } from "../sim/types.ts";
import { newRaceSetup, type RaceSetup } from "../game/field.ts";
import type { Partida } from "./partida.ts";
import { puedeCorrer } from "./edificios.ts";
import { participantes, registrarCarrera } from "./carreras.ts";
import { diaDe } from "./economia.ts";

export const OFFLINE = cfg;
/** Lo que el cliente guarda de cada token. La firma la verifica solo el servidor. */
export interface TokenCarrera { id: string; dia: number; seed: number; vence: number; firma: string; }
/** Una carrera corrida sin conexión, esperando a sincronizar. */
export interface CarreraPendiente { token: TokenCarrera; caballoId: string; estrategia: Strategy; jugadoEn: number; }

/** Distancia y superficie del token (las sortea su semilla, no el jugador). */
export function carreraDeToken(seed: number): { distancia: 500 | 1500; superficie: "cesped" | "tierra" } {
  const r = new Rng((seed ^ 0x5bd1e995) >>> 0);
  return { distancia: r.next() < 0.5 ? 500 : 1500, superficie: r.next() < 0.5 ? "cesped" : "tierra" };
}

/** El próximo token que se puede usar ahora: de hoy o de días anteriores, sin vencer, el más viejo primero. */
export function proximoToken(tokens: readonly TokenCarrera[], ahora: number): TokenCarrera | null {
  const hoy = diaDe(ahora);
  return [...tokens].filter((t) => t.dia <= hoy && t.vence > ahora).sort((a, b) => a.dia - b.dia || a.vence - b.vence)[0] ?? null;
}
/** Cuántas carreras offline quedan hoy. */
export function quedanHoy(tokens: readonly TokenCarrera[], ahora: number): number {
  const hoy = diaDe(ahora);
  return tokens.filter((t) => t.dia <= hoy && t.vence > ahora).length;
}

const ESTRATEGIAS: Strategy[] = ["agresiva", "equilibrada", "conservadora"];

/**
 * Corre una carrera Casual con el token: arma la carrera con su semilla, la simula y la registra en la partida.
 * La usan el cliente (sin conexión, para mostrarla) y el servidor (al sincronizar, que es la que vale).
 */
export function correrConToken(p: Partida, token: Pick<TokenCarrera, "seed">, caballoId: string, estrategia: Strategy, ahora: number, params: RaceParams):
  { ok: true; setup: RaceSetup; cobro: { oro: number; bonoTutorial: number; reducido: boolean }; posicion: number } | { ok: false; motivo: string } {
  const c = p.caballos.find((x) => x.id === caballoId);
  if (!c) return { ok: false, motivo: "No se encontró el caballo." };
  const listo = puedeCorrer(c, ahora);
  if (!listo.ok) return listo;
  if (c.disponibleDesde !== undefined && ahora < c.disponibleDesde)
    return { ok: false, motivo: "A esa hora el caballo todavía no estaba disponible (estaba en recuperación, entrenando o creciendo)." };
  if (!ESTRATEGIAS.includes(estrategia)) return { ok: false, motivo: "Estrategia desconocida." };
  const { distancia, superficie } = carreraDeToken(token.seed);
  const setup = newRaceSetup(params._version, estrategia, c, { n: participantes("casual"), distance: distancia, surface: superficie, semilla: token.seed, ahora });
  const res = simulateRace(setup.input, params);
  const i = setup.playerIndex;
  const lesion = res.injured.includes(i);
  const best = res.finishTimes[res.order[0]];
  const tiempo = lesion ? 0 : res.finishTimes[i];
  const posicion = res.order.indexOf(i) + 1;
  const cobro = registrarCarrera(p, {
    modo: "casual", distancia, superficie, caballoId: c.id, caballoNombre: c.nombre, estrategia,
    posicion, participantes: setup.entrants.length, tiempo, diferencia: lesion ? 0 : tiempo - best,
    fotoFinal: res.photoFinish, seed: setup.input.seed, simVersion: setup.input.simVersion, offline: true, ...(lesion ? { lesion: true } : {}),
  }, ahora);
  return { ok: true, setup, cobro, posicion };
}
