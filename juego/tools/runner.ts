// Runner headless: miles de carreras sin gráficos para medir el balance (GDD v0.2 §21).
// Uso: node tools/runner.ts [carreras_por_prueba]
import { readFileSync, writeFileSync } from "node:fs";
import { simulateRace, type RaceParams } from "../src/sim/race.ts";
import { Rng } from "../src/sim/rng.ts";
import type { Attrs, Participant, RaceInput, Strategy } from "../src/sim/types.ts";

export const PARAMS: RaceParams = JSON.parse(
  readFileSync(new URL("../config/balance/carrera.json", import.meta.url), "utf8"),
);
const STRATS: Strategy[] = ["agresiva", "equilibrada", "conservadora"];

export const PROFILE: Record<string, Attrs> = {
  "Pura Sangre": [74, 60, 68, 60, 68], "Árabe": [62, 72, 60, 67, 69], "Cuarto de Milla": [68, 56, 78, 62, 66],
  "Akhal-Teke": [68, 72, 62, 62, 66], "Appaloosa": [67, 66, 66, 63, 68], "Criollo": [58, 74, 62, 74, 62],
  "Andaluz": [64, 64, 70, 62, 70], "Frisón": [65, 64, 72, 65, 64],
};

/** Corre una carrera completa y devuelve los tiempos. */
export function race(attrs: Attrs[], strats: Strategy[], dist: 500 | 1500, seed: number): number[] {
  const participants: Participant[] = attrs.map((a, i) => ({ id: `c${i}`, attrs: a, strategy: strats[i] }));
  const input: RaceInput = { simVersion: PARAMS._version, seed, distance: dist, surface: "cesped", participants };
  return simulateRace(input, PARAMS).finishTimes;
}

const argmin = (xs: number[]) => xs.reduce((b, x, i) => (x < xs[b] ? i : b), 0);
const jitter = (rng: Rng, base: number[], j: number): Attrs =>
  base.map((x) => Math.min(100, Math.max(0, x + rng.int(2 * j + 1) - j))) as unknown as Attrs;

/** Sensibilidad: el caballo 0 recibe +10 en un atributo; misma carrera con y sin el extra. */
export function sensitivity(dist: 500 | 1500, N: number, seed = 1) {
  const names = ["Vel", "Res", "Pot", "Tem", "Int"];
  const wins = [0, 0, 0, 0, 0]; let base = 0; const gain = [0, 0, 0, 0, 0];
  const rng = new Rng(seed);
  for (let k = 0; k < N; k++) {
    const field = Array.from({ length: 8 }, () => jitter(rng, [60, 60, 60, 60, 60], 4));
    const st = Array.from({ length: 8 }, () => STRATS[rng.int(3)]);
    const s = rng.nextU32();
    const t0 = race(field, st, dist, s);
    if (argmin(t0) === 0) base++;
    for (let a = 0; a < 5; a++) {
      const f2 = field.map((x) => [...x]) as unknown as Attrs[];
      (f2[0] as unknown as number[])[a] += 10;
      const t1 = race(f2, st, dist, s);
      if (argmin(t1) === 0) wins[a]++;
      gain[a] += t0[0] - t1[0];
    }
  }
  const out: Record<string, { win: number; seg: number }> = {};
  names.forEach((nm, a) => (out[nm] = { win: wins[a] / N, seg: gain[a] / N }));
  return { base: base / N, ...out };
}

export function breeds(dist: 500 | 1500, N: number, seed = 3) {
  const keys = Object.keys(PROFILE); const w = new Array(keys.length).fill(0);
  const rng = new Rng(seed);
  for (let k = 0; k < N; k++) {
    const field = keys.map((b) => jitter(rng, PROFILE[b] as unknown as number[], 6).map((x) => Math.min(90, x)) as unknown as Attrs);
    const st = keys.map(() => STRATS[rng.int(3)]);
    w[argmin(race(field, st, dist, rng.nextU32()))]++;
  }
  return Object.fromEntries(keys.map((b, i) => [b, w[i] / N]));
}

export function strategies(dist: 500 | 1500, N: number, seed = 5) {
  const arch: Record<string, number[]> = {
    Velocista: [78, 55, 75, 60, 62], Fondista: [62, 78, 58, 74, 58], "Táctico": [64, 64, 64, 64, 74], Equilibrado: [66, 66, 66, 66, 66],
  };
  const out: Record<string, Record<string, number>> = {};
  for (const [nm, b] of Object.entries(arch)) {
    const rng = new Rng(seed); const winS = [0, 0, 0]; const share = [0, 0, 0];
    for (let k = 0; k < N; k++) {
      const field = Array.from({ length: 8 }, () => jitter(rng, b, 3));
      const st = Array.from({ length: 8 }, () => STRATS[rng.int(3)]);
      st.forEach((x) => share[STRATS.indexOf(x)]++);
      winS[STRATS.indexOf(st[argmin(race(field, st, dist, rng.nextU32()))])]++;
    }
    const tot = share.reduce((a, c) => a + c, 0);
    out[nm] = Object.fromEntries(STRATS.map((x, i) => [x, +(((winS[i] / N) / (share[i] / tot)) / 8).toFixed(3)]));
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("runner.ts")) {
  const N = Number(process.argv[2] ?? 600);
  const t0 = Date.now();
  const R: Record<string, unknown> = {};
  for (const d of [500, 1500] as const) {
    R[`sens_${d}`] = sensitivity(d, N);
    R[`razas_${d}`] = breeds(d, N * 2);
    R[`estrategias_${d}`] = strategies(d, N);
  }
  R["segundos"] = (Date.now() - t0) / 1000;
  writeFileSync(new URL("./runner_resultados.json", import.meta.url), JSON.stringify(R, null, 1));
  console.log(JSON.stringify(R, null, 1));
}
