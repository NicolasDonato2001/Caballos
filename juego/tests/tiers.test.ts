// Pruebas de tiers y emparejamiento por tier (Fase 5.5, GDD §24.3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/sim/rng.ts";
import { atributos, caballoDeRaza, caballoInicial } from "../src/domain/caballo.ts";
import { indiceDe, objetivoRivales, rivalDeTier, tierDe, tierDeIndice, tiempoEsperado, TIERS } from "../src/domain/tiers.ts";

test("La regresión ordena bien: más atributos, menos tiempo; el índice sube con la calidad", () => {
  for (const d of [500, 1500] as const) {
    assert.ok(tiempoEsperado([80, 80, 80, 80, 80], d) < tiempoEsperado([60, 60, 60, 60, 60], d));
    for (let i = 0; i < 5; i++) {
      const a = [60, 60, 60, 60, 60]; a[i] = 75;
      assert.ok(tiempoEsperado(a, d) < tiempoEsperado([60, 60, 60, 60, 60], d), `atributo ${i} en ${d} m`);
    }
  }
  assert.ok(Math.abs(indiceDe([60, 60, 60, 60, 60])) < 1e-9);
  assert.ok(indiceDe([90, 90, 90, 90, 90]) > indiceDe([75, 75, 75, 75, 75]));
});

test("Tiers: el Criollo inicial es Bronce; un caballo muy entrenado y de gran genética llega a Diamante", () => {
  const c = caballoInicial(new Rng(1), "Tero", "macho");
  assert.equal(tierDe(c).id, "bronce");
  assert.equal(tierDeIndice(indiceDe([92, 90, 90, 85, 80])).id, "diamante");
  assert.deepEqual(TIERS.map((t) => t.id), ["bronce", "plata", "oro", "platino", "diamante"]);
});

test("Rivales del mismo tier: su índice cae en el rango pedido", () => {
  const rng = new Rng(9);
  for (const attrsJugador of [[60, 70, 60, 70, 65], [78, 74, 74, 70, 70], [90, 85, 85, 80, 80]]) {
    const j = caballoDeRaza(rng, { raza: "Criollo" });
    j.natural = attrsJugador; j.entreno = [0, 0, 0, 0, 0];
    const rango = objetivoRivales(j);
    const t = tierDe(j);
    for (let k = 0; k < 30; k++) {
      const r = rivalDeTier(rng, "Árabe", rango);
      const i = indiceDe(atributos(r));
      assert.ok(i >= rango[0] - 0.45 && i <= rango[1] + 0.45, `índice ${i.toFixed(2)} fuera de ${rango}`);
      assert.ok(r.natural.every((v) => v >= 30) && atributos(r).every((v) => v <= 100));
    }
    assert.ok(rango[0] >= t.desde - 1e-9 || t.id === "bronce");
  }
});
