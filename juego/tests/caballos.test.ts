// Pruebas de la Fase 2: generación de caballos, techos, pelaje y guardado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/sim/rng.ts";
import { RAZAS, ajustarNaturales, atributos, caballoDeRaza, caballoInicial, descripcionRaza, techoDe } from "../src/domain/caballo.ts";
import { FRECUENCIAS, fenotipo, pelajeAleatorio } from "../src/domain/pelaje.ts";
import { AlmacenMemoria, agregarCaballo, capacidad, partidaNueva } from "../src/domain/partida.ts";

test("Hay 8 razas y cada una tiene frecuencias de pelaje", () => {
  assert.equal(RAZAS.length, 8);
  for (const r of RAZAS) assert.ok(FRECUENCIAS[r], r);
});

test("Ejemplares generados respetan mínimo 30, techo racial y presupuesto 360", () => {
  const rng = new Rng(1);
  for (let k = 0; k < 4000; k++) {
    const raza = RAZAS[k % 8];
    const c = caballoDeRaza(rng, { raza });
    const t = techoDe({ [raza]: 1 });
    c.natural.forEach((v, i) => { assert.ok(v >= 30 && v <= t[i] && v <= 90, `${raza} ${i} ${v}`); });
    assert.ok(c.natural.reduce((s, x) => s + x, 0) <= 360);
    assert.ok(Math.abs(c.predisposicion.reduce((s, x) => s + x, 0) - 1) < 1e-9);
  }
});

test("Los perfiles medios coinciden con el GDD (±1 por redondeo y techos)", () => {
  const rng = new Rng(2);
  const medias: Record<string, number[]> = {};
  for (const r of RAZAS) {
    const acc = [0, 0, 0, 0, 0];
    for (let k = 0; k < 3000; k++) caballoDeRaza(rng, { raza: r }).natural.forEach((v, i) => (acc[i] += v / 3000));
    medias[r] = acc;
  }
  assert.ok(Math.abs(medias["Pura Sangre Inglés"][0] - 74) < 1, "PSI velocidad media ≈ 74");
  assert.ok(Math.abs(medias["Criollo"][3] - 74) < 1, "Criollo temple medio ≈ 74");
});

test("El ajuste respeta el presupuesto con redondeo determinista", () => {
  const v = ajustarNaturales([90, 90, 90, 90, 90], [90, 90, 90, 90, 90]);
  assert.equal(v.reduce((s, x) => s + x, 0), 360);
  assert.deepEqual(v, ajustarNaturales([90, 90, 90, 90, 90], [90, 90, 90, 90, 90]));
});

test("Techo de un cruce = promedio ponderado de techos", () => {
  const t = techoDe({ "Pura Sangre Inglés": 0.5, "Árabe": 0.5 });
  assert.deepEqual(t, [85, 86, 79, 81, 79]);
});

test("Caballo inicial: Criollo 60/70/60/70/65 con nombre y sexo elegidos", () => {
  const c = caballoInicial(new Rng(3), "Pampero", "hembra");
  assert.deepEqual(c.natural, [60, 70, 60, 70, 65]);
  assert.equal(c.nombre, "Pampero"); assert.equal(c.sexo, "hembra");
  assert.equal(descripcionRaza(c.composicion), "Criollo");
  assert.deepEqual(Array.from(atributos(c)), [60, 70, 60, 70, 65]);
});

test("Pelajes: el Frisón siempre es negro; aparecen variedad de pelajes en el Criollo", () => {
  const rng = new Rng(4);
  for (let k = 0; k < 500; k++) {
    const f = fenotipo(pelajeAleatorio(rng, { "Frisón": 1 }));
    assert.equal(f.nombre, "Negro");
  }
  const nombres = new Set<string>();
  for (let k = 0; k < 3000; k++) nombres.add(fenotipo(pelajeAleatorio(rng, { "Criollo": 1 })).nombre);
  assert.ok(nombres.has("Gateado") && nombres.has("Alazán") && nombres.has("Castaño"), [...nombres].join(", "));
  assert.ok(nombres.size >= 8, `variedad: ${nombres.size}`);
});

test("Partida: capacidad inicial 5 y no se supera", async () => {
  const p = partidaNueva();
  assert.equal(capacidad(p), 5);
  const rng = new Rng(5);
  for (let k = 0; k < 5; k++) assert.ok(agregarCaballo(p, caballoDeRaza(rng, { raza: "Árabe" })));
  assert.equal(agregarCaballo(p, caballoDeRaza(rng, { raza: "Árabe" })), false);
  const a = new AlmacenMemoria();
  await a.guardar(p);
  const q = await a.cargar();
  assert.equal(q?.caballos.length, 5);
  assert.deepEqual(q?.caballos[0].natural, p.caballos[0].natural);
});
