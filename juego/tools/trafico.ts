// Mide el tráfico de las carreras: cuántas veces dos caballos se superponen (se "atraviesan") y cómo se reparten
// los carriles. Uso: node tools/trafico.ts [carreras]
import { readFileSync } from "node:fs";
import { simulateRace, type RaceParams } from "../src/sim/race.ts";
import { Rng } from "../src/sim/rng.ts";
import type { Attrs, Participant, RaceInput, Strategy } from "../src/sim/types.ts";

const P: RaceParams = JSON.parse(readFileSync(new URL("../config/balance/carrera.json", import.meta.url), "utf8"));
const STR: Strategy[] = ["agresiva", "equilibrada", "conservadora"];
const LARGO = 2.4, ANCHO_LAT = 0.6;   // cuerpo de un caballo (m) y separación lateral mínima (carriles de 1,2 m)

export function medir(N: number, n: number, dist: 500 | 1500) {
  let cuadros = 0, conSuperp = 0, paresSuperp = 0;
  const carrilesFinal = new Array(14).fill(0);
  const carrilesMitad = new Array(14).fill(0);
  for (let k = 0; k < N; k++) {
    const rng = new Rng(1000 + k);
    const participants: Participant[] = Array.from({ length: n }, (_, i) => ({
      id: `c${i}`, attrs: Array.from({ length: 5 }, () => 55 + rng.int(25)) as unknown as Attrs, strategy: STR[rng.int(3)],
    }));
    const input: RaceInput = { simVersion: P._version, seed: rng.nextU32(), distance: dist, surface: "cesped", participants };
    const r = simulateRace(input, P);
    for (const fr of r.frames) {
      cuadros++;
      let hay = false;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const a = fr.horses[i], b = fr.horses[j];
        if (a.done || b.done) continue;
        if (Math.abs(a.lat - b.lat) * 1 < ANCHO_LAT / P.laneWidth * 1.2 && Math.abs(a.s - b.s) < LARGO) { paresSuperp++; hay = true; }
      }
      if (hay) conSuperp++;
      for (const h of fr.horses) {
        if (h.done) continue;
        const f = h.s / dist;
        if (f > 0.9) carrilesFinal[Math.min(13, Math.round(h.lat))]++;
        else if (f > 0.4 && f < 0.6) carrilesMitad[Math.min(13, Math.round(h.lat))]++;
      }
    }
  }
  const pct = (a: number[]) => { const t = a.reduce((x, y) => x + y, 0); return a.slice(0, n + 1).map((x) => Math.round((x / t) * 100)); };
  return { cuadrosConSuperposicion: +(conSuperp / cuadros * 100).toFixed(1) + "%", paresPorCuadro: +(paresSuperp / cuadros).toFixed(2),
    carrilesMitadPct: pct(carrilesMitad), carrilesFinalPct: pct(carrilesFinal) };
}

if (process.argv[1]?.endsWith("trafico.ts")) {
  const N = Number(process.argv[2] ?? 150);
  for (const n of [8, 12]) for (const d of [500, 1500] as const) console.log(n, d, JSON.stringify(medir(N, n, d)));
}
