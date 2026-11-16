// Armado de una carrera de prueba (Fase 1): sorteo de distancia, superficie y rivales.
// La aleatoriedad de esta preparación NO forma parte del simulador: el resultado depende solo de la semilla.
import razas from "../../config/balance/razas.json" with { type: "json" };
import type { Participant, RaceInput, Strategy } from "../sim/types.ts";
import { Rng } from "../sim/rng.ts";
import { atributos, caballoDeRaza, caballoInicial, type Caballo } from "../domain/caballo.ts";
import { BIENESTAR, riesgoDe } from "../domain/bienestar.ts";
import { objetivoRivales, rivalDeTier } from "../domain/tiers.ts";

export interface Entrant { participant: Participant; breed: string; number: number; coat: number; isPlayer: boolean; caballo: Caballo; /** Online: nombre del jugador dueño (los bots no tienen). */ dueno?: string; }

export interface RaceSetup { input: RaceInput; entrants: Entrant[]; playerIndex: number; }

const STRATS: Strategy[] = ["agresiva", "equilibrada", "conservadora"];
const rint = (n: number) => Math.floor(Math.random() * n);

export interface OpcionesCarrera {
  n?: number; distance?: 500 | 1500; surface?: "cesped" | "tierra";
  /** Campeonato: rivales más fuertes (con el jugador, dentro de su tier; sin jugador, hasta tantos puntos de entrenamiento). */ entrenoRivales?: number;
  /** 7.5: con semilla, todo el armado (lugar, rivales, estrategias, semilla de la carrera) sale de ella: el servidor lo repite igual. */ semilla?: number;
  /** Hora para el riesgo de lesión del caballo del jugador (por defecto, ahora). */ ahora?: number;
}

/** Mezcla con un generador dado (Fisher–Yates: igual en todos los navegadores, a diferencia de sort con azar). */
function mezclar<T>(l: T[], azar: () => number): T[] {
  for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(azar() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; }
  return l;
}

export function newRaceSetup(simVersion: string, playerStrategy: Strategy = "equilibrada", jugador?: Caballo, o: OpcionesCarrera = {}): RaceSetup {
  const fuente = o.semilla !== undefined ? new Rng(o.semilla >>> 0) : null;
  const azar = fuente ? () => fuente.next() : Math.random;
  const rint = (k: number) => Math.floor(azar() * k);
  const distance = o.distance ?? (azar() < 0.5 ? 500 : 1500);
  const surface = o.surface ?? (azar() < 0.5 ? "cesped" : "tierra");
  const breeds = Object.keys(razas.razas);
  const n = o.n ?? 8;
  const playerIndex = rint(n);
  const coats = mezclar(Array.from({ length: n }, (_, i) => i), azar);
  const entrants: Entrant[] = [];
  const rng = new Rng((azar() * 4294967296) >>> 0);
  // Fase 5.5: los rivales salen del tier del caballo del jugador (en el campeonato, algo más fuertes)
  const rango = jugador ? objetivoRivales(jugador, !!o.entrenoRivales) : null;
  for (let i = 0; i < n; i++) {
    const isPlayer = i === playerIndex;
    const breed = isPlayer ? (jugador ? Object.keys(jugador.composicion)[0] : razas.caballoInicial.raza) : breeds[rint(breeds.length)];
    const caballo = isPlayer ? (jugador ?? caballoInicial(rng, "Tu caballo", "macho"))
      : rango ? rivalDeTier(rng, breed, rango) : caballoDeRaza(rng, { raza: breed });
    if (!isPlayer && !rango && o.entrenoRivales) caballo.entreno = caballo.entreno.map(() => rng.int(o.entrenoRivales! + 1));
    const attrs = atributos(caballo);
    entrants.push({
      participant: {
        id: isPlayer ? "jugador" : `ia${i}`, attrs, strategy: isPlayer ? playerStrategy : STRATS[rint(3)], ai: !isPlayer,
        // Fase 6.5: el caballo del jugador corre con su riesgo (carga y herraduras); los rivales, con el mínimo
        riesgo: isPlayer && jugador ? riesgoDe(jugador, o.ahora ?? Date.now()) : BIENESTAR.riesgo.rivales,
      },
      breed, number: i + 1, coat: isPlayer ? 0 : coats[i], isPlayer, caballo,
    });
  }
  const seed = (azar() * 4294967296) >>> 0;
  return {
    input: { simVersion, seed, distance, surface, participants: entrants.map((e) => e.participant) },
    entrants, playerIndex,
  };
}

/** Fase 7.2: carrera con varios jugadores (online). Los bots completan con rivales del tier medio de los jugadores.
 *  `playerIndex` queda en −1: cada cliente marca su propio caballo al reproducirla. */
export function newRaceSetupOnline(simVersion: string, humanos: { caballo: Caballo; estrategia: Strategy; dueno: string }[],
  o: { distance: 500 | 1500; surface: "cesped" | "tierra"; n: number; ahora: number }): RaceSetup {
  const breeds = Object.keys(razas.razas);
  const rng = new Rng((Math.random() * 4294967296) >>> 0);
  const n = Math.max(o.n, humanos.length);
  // Bots: del rango que cubre a los jugadores (el más débil y el más fuerte)
  const rangos = humanos.map((h) => objetivoRivales(h.caballo));
  const rango: [number, number] = [Math.min(...rangos.map((r) => r[0])), Math.max(...rangos.map((r) => r[1]))];
  const lugares = Array.from({ length: n }, (_, i) => i).sort(() => Math.random() - 0.5);
  const entrants: Entrant[] = new Array(n);
  humanos.forEach((h, k) => {
    const i = lugares[k];
    entrants[i] = {
      participant: { id: `j${k}`, attrs: atributos(h.caballo), strategy: h.estrategia, ai: false, riesgo: riesgoDe(h.caballo, o.ahora) },
      breed: Object.keys(h.caballo.composicion)[0], number: i + 1, coat: 0, isPlayer: false, caballo: h.caballo, dueno: h.dueno,
    };
  });
  for (let i = 0; i < n; i++) {
    if (entrants[i]) continue;
    const breed = breeds[rint(breeds.length)];
    const caballo = rivalDeTier(rng, breed, rango);
    entrants[i] = {
      participant: { id: `ia${i}`, attrs: atributos(caballo), strategy: STRATS[rint(3)], ai: true, riesgo: BIENESTAR.riesgo.rivales },
      breed, number: i + 1, coat: i, isPlayer: false, caballo,
    };
  }
  const seed = (Math.random() * 4294967296) >>> 0;
  return { input: { simVersion, seed, distance: o.distance, surface: o.surface, participants: entrants.map((e) => e.participant) }, entrants, playerIndex: -1 };
}
