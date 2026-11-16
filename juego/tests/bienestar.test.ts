// Pruebas de la Fase 6.5: carga, riesgo de lesión, herraduras y lesión en el registro de la carrera.
import { test } from "node:test";
import assert from "node:assert/strict";
import { partidaNueva } from "../src/domain/partida.ts";
import { caballoInicial } from "../src/domain/caballo.ts";
import { Rng } from "../src/sim/rng.ts";
import { BIENESTAR, cargaDe, comprarHerraduras, despuesDeCorrer, herrar, riesgoDe } from "../src/domain/bienestar.ts";
import { registrarCarrera, type DatosCarrera } from "../src/domain/carreras.ts";

const T0 = 1_800_000_000_000, HORA = 3_600_000, MIN = 60_000;

test("Carga: sube al correr y baja con el tiempo; el riesgo va del mínimo al máximo", () => {
  const c = caballoInicial(new Rng(1), "Tero", "macho");
  assert.equal(cargaDe(c, T0), 0);
  const sin = riesgoDe(c, T0);
  assert.ok(Math.abs(sin - BIENESTAR.riesgo.base * BIENESTAR.riesgo.sinHerraduras) < 1e-12);
  despuesDeCorrer(c, 1500, T0);
  assert.equal(cargaDe(c, T0), BIENESTAR.carga.porCarrera1500);
  assert.ok(Math.abs(cargaDe(c, T0 + HORA) - (BIENESTAR.carga.porCarrera1500 - BIENESTAR.carga.bajaPorHora)) < 1e-9);
  assert.equal(cargaDe(c, T0 + 10 * HORA), 0);
  for (let i = 0; i < 20; i++) despuesDeCorrer(c, 1500, T0);
  assert.equal(cargaDe(c, T0), BIENESTAR.carga.maximo);
  assert.ok(Math.abs(riesgoDe(c, T0) - BIENESTAR.riesgo.maximo * BIENESTAR.riesgo.sinHerraduras) < 1e-12);
});

test("Ritmo de juego: rotando caballos el riesgo queda bajo; corriendo siempre el mismo, sube", () => {
  // Un caballo que corre 500 m cada 20 min (lo justo para salir de la recuperación) toda la tarde
  const abuso = caballoInicial(new Rng(2), "Abuso", "macho");
  let t = T0;
  for (let i = 0; i < 12; i++) { despuesDeCorrer(abuso, 500, t); t += 20 * MIN; }
  assert.ok(riesgoDe(abuso, t) > 0.025, `riesgo con abuso ${riesgoDe(abuso, t)}`);
  // Cinco caballos que se turnan: cada uno corre cada 100 min
  const turno = caballoInicial(new Rng(3), "Turno", "macho");
  t = T0;
  for (let i = 0; i < 12; i++) { despuesDeCorrer(turno, 500, t); t += 100 * MIN; }
  assert.ok(riesgoDe(turno, t) < 0.004, `riesgo rotando ${riesgoDe(turno, t)}`);
});

test("Herraduras: se compran, se ponen, bajan el riesgo y se gastan carrera a carrera", () => {
  const p = partidaNueva(T0);
  p.oro = 1000; p.gemas = 0;
  const c = p.caballos[0] ?? caballoInicial(new Rng(4), "Pampa", "hembra");
  if (!p.caballos.length) p.caballos.push(c);
  assert.equal(herrar(p, c.id, "aluminio").ok, false);
  assert.ok(comprarHerraduras(p, "aluminio", T0).ok);
  assert.equal(p.oro, 1000 - 300);
  assert.equal(comprarHerraduras(p, "competicion", T0).ok, false);       // sin Gemas
  const antes = riesgoDe(c, T0);
  assert.ok(herrar(p, c.id, "aluminio").ok);
  assert.equal(p.herraduras?.aluminio, undefined);
  assert.ok(riesgoDe(c, T0) < antes);
  for (let i = 0; i < 19; i++) despuesDeCorrer(c, 500, T0);
  assert.equal(c.herraduras?.carreras, 1);
  despuesDeCorrer(c, 500, T0);
  assert.equal(c.herraduras, undefined);
  assert.equal(p.ledger?.[0].motivo, "herraduras");
});

test("Lesión en carrera: no cobra premio de puesto, suma una lesión y la recuperación es más larga", () => {
  const p = partidaNueva(T0);
  const c = p.caballos[0] ?? caballoInicial(new Rng(5), "Bayo", "macho");
  if (!p.caballos.length) p.caballos.push(c);
  p.tutorial = { paso: 8, terminado: true };
  const oro = p.oro;
  const d: DatosCarrera = {
    modo: "casual", distancia: 500, superficie: "cesped", caballoId: c.id, caballoNombre: c.nombre, estrategia: "equilibrada",
    posicion: 8, participantes: 8, tiempo: 0, diferencia: 0, fotoFinal: false, seed: 1, simVersion: "sim-0.5.0", lesion: true,
  };
  const r = registrarCarrera(p, d, T0);
  assert.equal(r.oro, 0);
  assert.equal(p.oro, oro);
  assert.equal(c.lesiones, 1);
  assert.equal(c.estado, "recuperacion");
  assert.equal(c.finEstado, T0 + (15 + BIENESTAR.lesion.recuperacionExtraMin) * MIN);
  assert.ok(cargaDe(c, T0) > 0);
});
