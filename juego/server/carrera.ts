// Carreras contra la IA en el servidor (Fase 7): el servidor sortea los rivales y la semilla, simula y cobra.
// El cliente recibe la misma entrada y la reproduce: el simulador es determinista, así todos ven el mismo resultado.
import { readFileSync } from "node:fs";
import { simulateRace, type RaceParams } from "../src/sim/race.ts";
import { newRaceSetup, type RaceSetup } from "../src/game/field.ts";
import type { Partida } from "../src/domain/partida.ts";
import type { Strategy } from "../src/sim/types.ts";
import { puedeCorrer } from "../src/domain/edificios.ts";
import {
  campeonatoDeLaSemana, ENTRENO_RIVALES_CAMPEONATO, participantes, registrarCarrera, type Modo,
} from "../src/domain/carreras.ts";

export const PARAMS: RaceParams = JSON.parse(readFileSync(new URL("../config/balance/carrera.json", import.meta.url), "utf8"));
const ESTRATEGIAS: Strategy[] = ["agresiva", "equilibrada", "conservadora"];

export interface Corrida { ok: true; setup: RaceSetup; cobro: { oro: number; bonoTutorial: number; reducido: boolean }; }

export function correr(p: Partida, caballoId: string, modo: Modo, estrategia: Strategy, ahora: number): Corrida | { ok: false; motivo: string } {
  const c = p.caballos.find((x) => x.id === caballoId);
  if (!c) return { ok: false, motivo: "No se encontró el caballo." };
  const r = puedeCorrer(c, ahora);
  if (!r.ok) return r;
  if (!ESTRATEGIAS.includes(estrategia)) return { ok: false, motivo: "Estrategia desconocida." };
  if (modo !== "casual" && modo !== "campeonato") return { ok: false, motivo: "Modo desconocido." };
  const camp = campeonatoDeLaSemana(p, ahora);
  const sorteo = modo === "campeonato" ? (camp && !camp.corrido ? camp : null) : p.sorteo;
  if (!sorteo) return { ok: false, motivo: modo === "campeonato" ? "Primero inscribite en el campeonato." : "Primero sorteá la distancia." };
  const setup = newRaceSetup(PARAMS._version, estrategia, c, {
    n: participantes(modo), distance: sorteo.distancia, surface: sorteo.superficie,
    entrenoRivales: modo === "campeonato" ? ENTRENO_RIVALES_CAMPEONATO : undefined,
  });
  const res = simulateRace(setup.input, PARAMS);
  const i = setup.playerIndex;
  const lesion = res.injured.includes(i);
  const best = res.finishTimes[res.order[0]];
  const tiempo = lesion ? 0 : res.finishTimes[i];
  const cobro = registrarCarrera(p, {
    modo, distancia: sorteo.distancia, superficie: sorteo.superficie, caballoId: c.id, caballoNombre: c.nombre, estrategia,
    posicion: res.order.indexOf(i) + 1, participantes: setup.entrants.length, tiempo, diferencia: lesion ? 0 : tiempo - best,
    fotoFinal: res.photoFinish, seed: setup.input.seed, simVersion: setup.input.simVersion, ...(lesion ? { lesion: true } : {}),
  }, ahora);
  return { ok: true, setup, cobro };
}
