// Pruebas del simulador. Ejecutar: npm test  (node --test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RaceSim, simulateRace, type RaceParams } from "../src/sim/race.ts";
import { Rng } from "../src/sim/rng.ts";
import type { Attrs, Participant, RaceInput, Strategy } from "../src/sim/types.ts";

const P: RaceParams = JSON.parse(readFileSync(new URL("../config/balance/carrera.json", import.meta.url), "utf8"));
const STR: Strategy[] = ["agresiva", "equilibrada", "conservadora"];

function input(seed: number, dist: 500 | 1500): RaceInput {
  const rng = new Rng(seed * 7 + 1);
  const participants: Participant[] = Array.from({ length: 8 }, (_, i) => ({
    id: `c${i}`,
    attrs: Array.from({ length: 5 }, () => 50 + rng.int(40)) as unknown as Attrs,
    strategy: STR[rng.int(3)],
  }));
  return { simVersion: P._version, seed, distance: dist, surface: "cesped", participants };
}

test("PRNG: misma semilla, misma secuencia; semillas distintas, secuencias distintas", () => {
  const a = new Rng(42), b = new Rng(42), c = new Rng(43);
  const sa = Array.from({ length: 1000 }, () => a.nextU32());
  const sb = Array.from({ length: 1000 }, () => b.nextU32());
  const sc = Array.from({ length: 1000 }, () => c.nextU32());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  const u = new Rng(7); let m = 0;
  for (let i = 0; i < 100000; i++) m += u.next();
  assert.ok(Math.abs(m / 100000 - 0.5) < 0.01, "uniforme centrada en 0,5");
});

test("Determinismo: la misma entrada produce exactamente el mismo resultado", () => {
  for (const dist of [500, 1500] as const) {
    for (let seed = 1; seed <= 20; seed++) {
      const r1 = simulateRace(input(seed, dist), P);
      const r2 = simulateRace(input(seed, dist), P);
      assert.deepEqual(r1.finishTimes, r2.finishTimes);
      assert.deepEqual(r1.order, r2.order);
      assert.equal(JSON.stringify(r1.frames), JSON.stringify(r2.frames));
    }
  }
});

test("Todos llegan, con tiempos plausibles y orden coherente", () => {
  for (const dist of [500, 1500] as const) {
    for (let seed = 1; seed <= 30; seed++) {
      const r = simulateRace(input(seed, dist), P);
      for (const t of r.finishTimes) {
        assert.ok(Number.isFinite(t), "terminó");
        const v = dist / t;
        assert.ok(v > 11 && v < 19.5, `velocidad media plausible: ${v.toFixed(2)} m/s`);
      }
      for (let k = 1; k < r.order.length; k++) assert.ok(r.finishTimes[r.order[k - 1]] <= r.finishTimes[r.order[k]]);
    }
  }
});

test("Paso a paso y cálculo completo dan exactamente el mismo resultado", () => {
  for (const dist of [500, 1500] as const) {
    for (let seed = 1; seed <= 10; seed++) {
      const live = new RaceSim(input(seed, dist), P);
      while (!live.step()) { /* en vivo, tick a tick */ }
      assert.deepEqual(live.result().finishTimes, simulateRace(input(seed, dist), P).finishTimes);
    }
  }
});

test("Versión de simulación: se rechazan entradas de otra versión", () => {
  const inp = { ...input(1, 500), simVersion: "sim-0.2.0" };
  assert.throws(() => simulateRace(inp, P));
});

test("Cada atributo mejora el tiempo propio (+15 en todo es más rápido)", () => {
  for (const dist of [500, 1500] as const) {
    let gain = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const a = input(seed, dist);
      const b = { ...a, participants: a.participants.map((q, i) => (i === 0 ? { ...q, attrs: q.attrs.map((x) => x + 15) as unknown as Attrs } : q)) };
      gain += simulateRace(a, P).finishTimes[0] - simulateRace(b, P).finishTimes[0];
    }
    assert.ok(gain / 40 > (dist === 500 ? 0.8 : 2.5), `ganancia media ${(gain / 40).toFixed(2)} s`);
  }
});

test("sim-0.4.0: ningún caballo atraviesa a otro (8 y 12 caballos, ambas distancias)", async () => {
  const { medir } = await import("../tools/trafico.ts");
  for (const n of [8, 12]) for (const d of [500, 1500] as const) {
    const r = medir(15, n, d);
    assert.equal(r.paresPorCuadro, 0, `${n} caballos, ${d} m: ${JSON.stringify(r)}`);
  }
});

test("sim-0.5.0: sin riesgo, la carrera no cambia; con lesión, el caballo frena, se aparta, no termina y queda último", () => {
  for (const dist of [500, 1500] as const) {
    for (let seed = 1; seed <= 15; seed++) {
      const base = simulateRace(input(seed, dist), P);
      const cero = input(seed, dist);
      cero.participants.forEach((q) => { q.riesgo = 0; });
      assert.deepEqual(simulateRace(cero, P).finishTimes, base.finishTimes, "riesgo 0 = sim-0.4.0");
      assert.deepEqual(base.injured, []);
      // El caballo 3 se lesiona seguro
      const con = input(seed, dist);
      con.participants[3].riesgo = 1;
      const r = simulateRace(con, P);
      const r2 = simulateRace(con, P);
      assert.deepEqual(r.finishTimes, r2.finishTimes, "determinista con lesión");
      assert.deepEqual(r.injured, [3]);
      assert.ok(Number.isNaN(r.finishTimes[3]));
      assert.equal(r.order[r.order.length - 1], 3);
      for (const i of r.order.slice(0, -1)) assert.ok(Number.isFinite(r.finishTimes[i]));
      const ev = r.events.find((e) => e.type === "lesion")!;
      assert.ok(ev.data! >= P.lesionDesde - 0.01 && ev.data! <= P.lesionHasta + 0.01);
      // Después de lesionarse frena hasta el paso
      const ult = r.frames[r.frames.length - 1].horses[3];
      const alLesionarse = r.frames.find((f) => f.t >= ev.t)!.horses[3];
      assert.ok(ult.lesion && !ult.done);
      assert.ok(ult.v <= P.lesionV + 0.01 || ult.v < alLesionarse.v - 2, `frena: ${alLesionarse.v} → ${ult.v}`);
    }
  }
});

test("sim-0.5.0: la frecuencia de lesiones respeta el riesgo pedido", () => {
  let n = 0;
  const N = 400;
  for (let seed = 1; seed <= N; seed++) {
    const inp = input(seed, 500);
    inp.participants.forEach((q) => { q.riesgo = 0.05; });
    n += simulateRace(inp, P).injured.length;
  }
  const frec = n / (N * 8);
  assert.ok(frec > 0.035 && frec < 0.065, `frecuencia ${frec}`);
});
