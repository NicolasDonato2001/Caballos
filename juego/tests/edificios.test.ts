// Pruebas de la Fase 3 (parte 1): reglas de edificios, entrenamiento, recuperación y temporizadores (GDD §7, §8).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/sim/rng.ts";
import { caballoDeRaza, caballoInicial } from "../src/domain/caballo.ts";
import { agregarCaballo, capacidad, migrar, partidaNueva } from "../src/domain/partida.ts";
import {
  actualizar, comprarEspacio, costoMejora, enviarARecuperacion, iniciarEntrenamiento, iniciarMejora,
  lugaresEntrenamiento, precioEspacio, proximoFin, puedeEntrenar, sortearEntrenamiento, topeEntrenamiento,
} from "../src/domain/edificios.ts";

const MIN = 60_000;
const T0 = 1_800_000_000_000;

function conCaballos(n: number, seed = 1) {
  const p = partidaNueva(T0);
  const rng = new Rng(seed);
  for (let i = 0; i < n; i++) agregarCaballo(p, i === 0 ? caballoInicial(rng, "Pampero", "macho") : caballoDeRaza(rng, { raza: "Criollo" }));
  return { p, rng };
}

test("Mejoras: costos y tiempos del GDD, una a la vez por edificio, nivel máximo 5", () => {
  assert.deepEqual(costoMejora(1), { oro: 1000, minutos: 15 });
  assert.deepEqual(costoMejora(4), { oro: 9600, minutos: 360 });
  assert.equal(costoMejora(5), null);
  const p = partidaNueva(T0);
  p.oro = 100_000;
  assert.ok(iniciarMejora(p, "establo", T0).ok);
  assert.equal(p.oro, 99_000);
  assert.equal(iniciarMejora(p, "establo", T0).ok, false, "no se duplica una mejora en curso");
  assert.ok(iniciarMejora(p, "entrenamiento", T0).ok, "otro edificio sí puede mejorarse a la vez");
  actualizar(p, T0 + 14 * MIN);
  assert.equal(p.edificios.establo.nivel, 1, "todavía no terminó");
  const s = actualizar(p, T0 + 15 * MIN);
  assert.equal(p.edificios.establo.nivel, 2);
  assert.equal(s.filter((x) => x.tipo === "mejora").length, 2);
  for (let k = 0; k < 3; k++) { iniciarMejora(p, "establo", T0); actualizar(p, T0 + 1e9 * (k + 1)); }
  assert.equal(p.edificios.establo.nivel, 5);
  assert.equal(iniciarMejora(p, "establo", T0).ok, false);
});

test("Mejora sin Oro suficiente no cobra nada", () => {
  const p = partidaNueva(T0);
  p.oro = 999;
  const r = iniciarMejora(p, "recuperacion", T0);
  assert.equal(r.ok, false);
  assert.equal(p.oro, 999);
  assert.equal(p.edificios.recuperacion.mejoraFin, null);
});

test("Espacios: 5 gratis, precios del GDD y techo por nivel del establo", () => {
  const p = partidaNueva(T0);
  p.oro = 1_000_000; p.gemas = 100;
  assert.equal(capacidad(p), 5);
  assert.equal(precioEspacio(p), null, "en nivel 1 el techo es 5");
  p.edificios.establo.nivel = 2;
  assert.equal(precioEspacio(p), 400);
  assert.ok(comprarEspacio(p, "oro").ok);
  assert.equal(precioEspacio(p), 480);
  assert.ok(comprarEspacio(p, "gemas").ok);
  assert.equal(p.gemas, 90);
  assert.ok(comprarEspacio(p, "oro").ok);
  assert.equal(capacidad(p), 8);
  assert.equal(comprarEspacio(p, "oro").ok, false, "techo del nivel 2 = 8");
  p.edificios.establo.nivel = 5;
  let total = 0;
  while (precioEspacio(p) !== null) { total += precioEspacio(p)!; comprarEspacio(p, "oro"); }
  assert.equal(capacidad(p), 20);
  assert.equal(total, 690 + 830 + 1000 + 1200 + 1440 + 1730 + 2075 + 2490 + 2990 + 3590 + 4300 + 5160);
});

test("Entrenamiento: dura 60 min, suma 2 o 3 atributos de +1/+2 y nunca supera el tope de puntos", () => {
  const rng = new Rng(7);
  const c = caballoDeRaza(rng, { raza: "Árabe" });
  let tres = 0, dos = 0, total = 0;
  for (let k = 0; k < 20_000; k++) {
    const d = sortearEntrenamiento(c, 15, rng);
    const n = d.filter((x) => x > 0).length;
    assert.ok(n === 2 || n === 3);
    if (n === 3) tres++;
    for (const x of d) { if (x === 2) dos++; if (x > 0) total++; }
  }
  assert.ok(Math.abs(tres / 20_000 - 0.35) < 0.02, `tercer atributo ${tres / 20_000}`);
  assert.ok(Math.abs(dos / total - 0.2) < 0.02, `+2 en ${dos / total}`);
});

test("Dos caballos entrenados al máximo terminan exactamente igual (tope en puntos)", () => {
  for (const nivel of [1, 3, 5]) {
    const finales: number[][] = [];
    for (const seed of [11, 99]) {
      const { p, rng } = conCaballos(1, seed);
      p.edificios.entrenamiento.nivel = nivel;
      const c = p.caballos[0];
      let t = T0, sesiones = 0;
      while (puedeEntrenar(p, c).ok) {
        assert.ok(iniciarEntrenamiento(p, c.id, t, rng).ok);
        t += 60 * MIN;
        actualizar(p, t);
        sesiones++;
        assert.ok(sesiones < 200);
      }
      const tope = topeEntrenamiento(p);
      c.entreno.forEach((v, i) => assert.equal(v, Math.min(tope, 100 - c.natural[i])));
      finales.push(c.entreno);
    }
    assert.deepEqual(finales[0], finales[1]);
  }
});

test("Entrenamiento: no se puede si no hay lugar, si no está disponible, y el resultado no cambia al recargar", () => {
  const { p, rng } = conCaballos(3);
  assert.equal(lugaresEntrenamiento(p), 1);
  const [a, b] = p.caballos;
  assert.ok(iniciarEntrenamiento(p, a.id, T0, rng).ok);
  assert.equal(iniciarEntrenamiento(p, a.id, T0, rng).ok, false, "ya está entrenando");
  assert.equal(iniciarEntrenamiento(p, b.id, T0, rng).ok, false, "nivel 1: un solo lugar");
  const pendiente = a.entrenoPendiente!.slice();
  const guardada = migrar(JSON.parse(JSON.stringify(p)))!;          // simula cerrar y volver a abrir
  actualizar(guardada, T0 + 60 * MIN);
  assert.deepEqual(guardada.caballos[0].entreno, pendiente);
  assert.equal(guardada.caballos[0].estado, "disponible");
});

test("Recuperación: 15 min tras 500 m, 30 min tras 1.500 m, cola por orden de llegada", () => {
  const { p } = conCaballos(3);
  const [a, b, c] = p.caballos;
  enviarARecuperacion(p, a.id, 1500, T0);
  enviarARecuperacion(p, b.id, 500, T0 + 1 * MIN);
  enviarARecuperacion(p, c.id, 500, T0 + 2 * MIN);
  assert.equal(a.estado, "recuperacion");
  assert.equal(b.estado, "colaRecuperacion");
  assert.equal(c.estado, "colaRecuperacion");
  assert.equal(proximoFin(p), T0 + 30 * MIN);
  // Se abre el juego mucho después: todo se resuelve en orden, como si hubiera estado abierto
  const s = actualizar(p, T0 + 24 * 60 * MIN);
  assert.deepEqual(s.map((x) => x.t - T0), [30 * MIN, 45 * MIN, 60 * MIN]);
  assert.deepEqual(s.map((x) => (x as { caballoId: string }).caballoId), [a.id, b.id, c.id]);
  assert.ok(p.caballos.every((x) => x.estado === "disponible" && x.finEstado === null && !x.cola));
});

test("Al subir de nivel la recuperación atiende más caballos de la cola", () => {
  const { p } = conCaballos(3);
  p.oro = 10_000;
  const [a, b, c] = p.caballos;
  for (const x of [a, b, c]) enviarARecuperacion(p, x.id, 1500, T0);
  iniciarMejora(p, "recuperacion", T0);                               // 15 min → nivel 2
  actualizar(p, T0 + 15 * MIN);
  assert.equal(p.edificios.recuperacion.nivel, 2);
  assert.equal(b.estado, "recuperacion");
  assert.equal(b.finEstado, T0 + 45 * MIN, "empieza cuando se libera el lugar");
  assert.equal(c.estado, "colaRecuperacion");
});

test("Las partidas de la Fase 2 (v1) se convierten sin perder caballos", () => {
  const rng = new Rng(3);
  const v1 = { version: 1, creada: T0, oro: 1000, gemas: 0, nivelEstablo: 1, espacios: 5,
    caballos: [caballoInicial(rng, "Lucero", "hembra")], tutorial: { paso: 1, terminado: false } };
  const p = migrar(JSON.parse(JSON.stringify(v1)))!;
  assert.equal(p.version, 2);
  assert.equal(p.edificios.establo.nivel, 1);
  assert.equal(p.edificios.entrenamiento.nivel, 1);
  assert.equal(p.caballos[0].nombre, "Lucero");
  assert.equal(capacidad(p), 5);
});

import { detenerEntrenamiento, puedeCorrer, sacarDeRecuperacion } from "../src/domain/edificios.ts";

test("Detener el entrenamiento devuelve el caballo sin puntos y libera el lugar", () => {
  const { p, rng } = conCaballos(2);
  const [a, b] = p.caballos;
  iniciarEntrenamiento(p, a.id, T0, rng);
  assert.ok(detenerEntrenamiento(p, a.id).ok);
  assert.equal(a.estado, "disponible");
  assert.deepEqual(a.entreno, [0, 0, 0, 0, 0]);
  actualizar(p, T0 + 120 * MIN);
  assert.deepEqual(a.entreno, [0, 0, 0, 0, 0], "no se aplica la sesión cortada");
  assert.ok(iniciarEntrenamiento(p, b.id, T0, rng).ok, "el lugar quedó libre");
});

test("Sacar de recuperación (opción b): puede entrenar ya, pero correr solo al cumplir el descanso", () => {
  const { p, rng } = conCaballos(3);
  const [a, b, c] = p.caballos;
  enviarARecuperacion(p, a.id, 1500, T0);
  enviarARecuperacion(p, b.id, 500, T0);
  assert.equal(b.estado, "colaRecuperacion");
  assert.ok(sacarDeRecuperacion(p, a.id, T0 + 10 * MIN).ok);
  assert.equal(a.estado, "disponible");
  assert.equal(b.estado, "recuperacion", "el que esperaba en cola entra al lugar libre");
  assert.equal(puedeCorrer(a, T0 + 10 * MIN).ok, false);
  assert.ok(iniciarEntrenamiento(p, a.id, T0 + 10 * MIN, rng).ok, "sí puede entrenar");
  actualizar(p, T0 + 30 * MIN);
  assert.ok(puedeCorrer(a, T0 + 70 * MIN).ok === false || a.estado === "entrenando");
  actualizar(p, T0 + 70 * MIN);
  assert.equal(a.estado, "disponible");
  assert.ok(puedeCorrer(a, T0 + 70 * MIN).ok, "descanso cumplido (terminaba a los 30 min)");
  assert.equal(a.descansoHasta, undefined);
  // el que está en cola también puede salir: le falta todo su descanso
  enviarARecuperacion(p, c.id, 500, T0 + 70 * MIN);
  enviarARecuperacion(p, a.id, 500, T0 + 70 * MIN);
  assert.equal(a.estado, "colaRecuperacion");
  sacarDeRecuperacion(p, a.id, T0 + 71 * MIN);
  assert.equal(a.descansoHasta, T0 + 86 * MIN);
});

import { liberarCaballo } from "../src/domain/edificios.ts";

test("Liberar: solo disponibles y nunca el último caballo", () => {
  const { p, rng } = conCaballos(2);
  const [a, b] = p.caballos;
  iniciarEntrenamiento(p, a.id, T0, rng);
  assert.equal(liberarCaballo(p, a.id).ok, false, "está entrenando");
  assert.ok(liberarCaballo(p, b.id).ok);
  assert.equal(p.caballos.length, 1);
  detenerEntrenamiento(p, a.id);
  assert.equal(liberarCaballo(p, a.id).ok, false, "es el último");
});
