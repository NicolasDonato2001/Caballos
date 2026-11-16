// Pruebas de la Fase 4 (reglas): premios por modo y distancia, historial y bono del tutorial.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/sim/rng.ts";
import { caballoInicial } from "../src/domain/caballo.ts";
import { agregarCaballo, partidaNueva } from "../src/domain/partida.ts";
import { participantes, recompensa, registrarCarrera, sortearDistancia, type DatosCarrera } from "../src/domain/carreras.ts";

const T0 = 1_800_000_000_000;
const datos = (o: Partial<DatosCarrera>): DatosCarrera => ({
  modo: "practica", distancia: 500, superficie: "cesped", caballoId: "", caballoNombre: "Pampero", estrategia: "equilibrada",
  posicion: 1, participantes: 6, tiempo: 32.5, diferencia: 0, fotoFinal: false, seed: 1, simVersion: "sim-0.3.0", ...o,
});

test("Premios del GDD §11.2 por modo, distancia y posición", () => {
  assert.equal(participantes("practica"), 6);
  assert.equal(participantes("casual"), 8);
  assert.deepEqual([1, 2, 3, 4, 6].map((k) => recompensa("practica", 500, k)), [95, 70, 50, 25, 25]);
  assert.deepEqual([1, 2, 3, 5].map((k) => recompensa("practica", 1500, k)), [125, 90, 65, 30]);
  assert.deepEqual([1, 2, 3, 8].map((k) => recompensa("casual", 500, k)), [160, 115, 80, 40]);
  assert.deepEqual([1, 2, 3, 7].map((k) => recompensa("casual", 1500, k)), [210, 150, 105, 50]);
});

test("La distancia se sortea 50/50", () => {
  const rng = new Rng(5);
  let n500 = 0;
  for (let i = 0; i < 20_000; i++) if (sortearDistancia(rng) === 500) n500++;
  assert.ok(Math.abs(n500 / 20_000 - 0.5) < 0.015);
});

test("Registrar: cobra, suma historial, bono del tutorial una sola vez y manda a recuperación", () => {
  const p = partidaNueva(T0);
  const c = caballoInicial(new Rng(1), "Pampero", "macho");
  agregarCaballo(p, c);
  const r1 = registrarCarrera(p, datos({ caballoId: c.id, posicion: 2 }), T0);
  assert.equal(r1.oro, 70);
  assert.equal(r1.bonoTutorial, 1500);
  assert.equal(p.oro, 1000 + 70 + 1500);
  assert.ok(p.tutorial.terminado);
  assert.equal(c.carreras, 1);
  assert.equal(c.victorias, 0);
  assert.equal(c.estado, "recuperacion");
  assert.equal(c.finEstado, T0 + 15 * 60_000);
  const r2 = registrarCarrera(p, datos({ caballoId: c.id, modo: "casual", distancia: 1500, posicion: 1, participantes: 8 }), T0 + 1);
  assert.equal(r2.bonoTutorial, 0);
  assert.equal(p.oro, 2570 + 210);
  assert.equal(c.victorias, 1);
  assert.equal(p.historial!.length, 2);
  assert.equal(p.historial![0].modo, "casual", "la más reciente primero");
  assert.equal(p.historial![1].oro, 1570);
});

test("Campeonato §11.3: fin de semana, una inscripción de 500, premios por puesto y sin límite diario", async () => {
  const { campeonatoDeLaSemana, esFinDeSemana, inscribirCampeonato, proximoCambioCampeonato, recompensa: rec } = await import("../src/domain/carreras.ts");
  const HORA = 3_600_000;
  // Buscar un sábado al mediodía y un miércoles al mediodía (hora local de la máquina).
  let sab = T0; while (new Date(sab).getDay() !== 6 || new Date(sab).getHours() !== 12) sab += HORA;
  let mie = T0; while (new Date(mie).getDay() !== 3 || new Date(mie).getHours() !== 12) mie += HORA;
  assert.equal(esFinDeSemana(sab), true);
  assert.equal(esFinDeSemana(sab + 24 * HORA), true);
  assert.equal(esFinDeSemana(mie), false);
  assert.equal(new Date(proximoCambioCampeonato(mie)).getDay(), 6);
  assert.equal(new Date(proximoCambioCampeonato(sab)).getDay(), 1);
  assert.deepEqual([1, 2, 3, 4, 6, 7, 12].map((k) => rec("campeonato", 500, k)), [3000, 2000, 1400, 800, 800, 400, 400]);
  const rng = new Rng(4);
  const p = partidaNueva(T0);
  const c = caballoInicial(rng, "Pampero", "macho");
  agregarCaballo(p, c);
  p.tutorial = { paso: 8, terminado: true };
  assert.equal(inscribirCampeonato(p, mie, rng).ok, false);
  assert.ok(inscribirCampeonato(p, sab, rng).ok);
  assert.equal(p.oro, 500);
  assert.equal(inscribirCampeonato(p, sab + HORA, rng).ok, false);   // una por semana
  const camp = campeonatoDeLaSemana(p, sab)!;
  // 15 carreras comunes antes: el campeonato igual paga completo.
  for (let k = 0; k < 15; k++) { c.estado = "disponible"; registrarCarrera(p, datos({ modo: "casual", caballoId: c.id, posicion: 8, seed: k }), sab + k); }
  c.estado = "disponible";
  const r = registrarCarrera(p, datos({ modo: "campeonato", distancia: camp.distancia, caballoId: c.id, posicion: 1, participantes: 12, seed: 99 }), sab + 100);
  assert.equal(r.oro, 3000);
  assert.equal(r.reducido, false);
  assert.equal(campeonatoDeLaSemana(p, sab)!.corrido, true);
  // La semana siguiente se puede volver a inscribir.
  assert.ok(inscribirCampeonato(p, sab + 7 * 24 * HORA, rng).ok);
});
