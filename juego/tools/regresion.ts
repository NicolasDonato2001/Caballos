// Tabla de regresión del simulador (GDD §13 y §24.3): tiempo esperado de un caballo según sus atributos, por distancia.
// Se usa para el tier del caballo y para armar rivales de su nivel. Uso: node tools/regresion.ts [carreras]
// Ajusta t ≈ b0 + Σ b_i·a_i + Σ c_i·a_i² (a en 0–100) con mínimos cuadrados sobre carreras de 8 caballos.
import { readFileSync, writeFileSync } from "node:fs";
import { simulateRace, type RaceParams } from "../src/sim/race.ts";
import { Rng } from "../src/sim/rng.ts";
import type { Attrs, Participant, Strategy } from "../src/sim/types.ts";

const P: RaceParams = JSON.parse(readFileSync(new URL("../config/balance/carrera.json", import.meta.url), "utf8"));
const STR: Strategy[] = ["agresiva", "equilibrada", "conservadora"];
const N = Number(process.argv[2] ?? 2500);

function resolver(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

const fila = (a: number[]) => [1, ...a.map((x) => x / 100), ...a.map((x) => (x / 100) ** 2)];
const salida: Record<string, number[]> = {};
const calidad: Record<string, { r2: number; error: number }> = {};
for (const dist of [500, 1500] as const) {
  const rng = new Rng(dist * 31 + 7);
  const X: number[][] = [], y: number[] = [];
  for (let k = 0; k < N; k++) {
    const participants: Participant[] = Array.from({ length: 8 }, (_, i) => ({
      id: `c${i}`, strategy: STR[rng.int(3)],
      attrs: Array.from({ length: 5 }, () => 40 + rng.int(56)) as unknown as Attrs,
    }));
    const r = simulateRace({ simVersion: P._version, seed: rng.nextU32(), distance: dist, surface: "cesped", participants }, P);
    participants.forEach((q, i) => { if (Number.isFinite(r.finishTimes[i])) { X.push(fila([...q.attrs])); y.push(r.finishTimes[i]); } });
  }
  const m = X[0].length;
  const A = Array.from({ length: m }, () => new Array(m).fill(0)), b = new Array(m).fill(0);
  X.forEach((x, k) => { for (let i = 0; i < m; i++) { b[i] += x[i] * y[k]; for (let j = 0; j < m; j++) A[i][j] += x[i] * x[j]; } });
  const coef = resolver(A, b);
  const pred = X.map((x) => x.reduce((s, v, i) => s + v * coef[i], 0));
  const media = y.reduce((s, v) => s + v, 0) / y.length;
  const ssr = y.reduce((s, v, k) => s + (v - pred[k]) ** 2, 0), sst = y.reduce((s, v) => s + (v - media) ** 2, 0);
  salida[String(dist)] = coef.map((c) => Math.round(c * 10000) / 10000);
  calidad[String(dist)] = { r2: Math.round((1 - ssr / sst) * 1000) / 1000, error: Math.round(Math.sqrt(ssr / y.length) * 100) / 100 };
  console.log(dist, "R²", calidad[String(dist)].r2, "error medio", calidad[String(dist)].error, "s");
}
const out = new URL("../config/balance/regresion.json", import.meta.url);
writeFileSync(out, JSON.stringify({
  _doc: "Generado por tools/regresion.ts: tiempo esperado (s) = b0 + Σ b_i·(a_i/100) + Σ c_i·(a_i/100)², atributos [Vel, Res, Pot, Tem, Int]. Volver a generar si cambia el simulador.",
  simVersion: P._version, carreras: N, calidad, coef: salida,
}, null, 2) + "\n");
