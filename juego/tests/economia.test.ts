// Pruebas de la Fase 6: ledger, límite diario, objetivos semanales, aceleraciones, conversión, monturas y venta al juego.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/sim/rng.ts";
import { atributos, caballoDeRaza, caballoInicial } from "../src/domain/caballo.ts";
import { agregarCaballo, partidaNueva, type Partida } from "../src/domain/partida.ts";
import { actualizar, iniciarEntrenamiento, iniciarMejora, liberarCaballo } from "../src/domain/edificios.ts";
import { registrarCarrera, type DatosCarrera } from "../src/domain/carreras.ts";
import { iniciarCruza } from "../src/domain/crianza.ts";
import {
  acelerarCaballo, acelerarCruza, acelerarMejora, cobrarObjetivo, comprarMontura, convertirGemas, costoAcelerar, diaDe,
  equiparMontura, finDeLaSemana, gemasConvertiblesHoy, portador, precioSugerido, precioVentaAlJuego, semanaDe, venderAlJuego,
} from "../src/domain/economia.ts";

const T0 = 1_800_000_000_000;            // un día cualquiera
const MIN = 60_000, HORA = 60 * MIN, DIA = 24 * HORA;
const datos = (o: Partial<DatosCarrera>): DatosCarrera => ({
  modo: "casual", distancia: 500, superficie: "cesped", caballoId: "", caballoNombre: "x", estrategia: "equilibrada",
  posicion: 1, participantes: 8, tiempo: 32, diferencia: 0, fotoFinal: false, seed: 1, simVersion: "sim-0.3.0", ...o,
});
function base(): { p: Partida; rng: Rng } {
  const rng = new Rng(77), p = partidaNueva(T0);
  agregarCaballo(p, caballoInicial(rng, "Pampero", "macho"));
  p.tutorial = { paso: 8, terminado: true };
  return { p, rng };
}
/** Medianoche local siguiente a T0, para no depender de la zona horaria de la máquina. */
const media = (t: number) => { let x = t; while (diaDe(x) === diaDe(t)) x += MIN; return x; };

test("Calendario: el día cambia a medianoche y la semana el lunes", () => {
  const m = media(T0);
  assert.equal(diaDe(m), diaDe(T0) + 1);
  assert.equal(diaDe(m - MIN), diaDe(T0));
  const fs = finDeLaSemana(T0);
  assert.equal(semanaDe(fs), semanaDe(T0) + 1);
  assert.equal(semanaDe(fs - MIN), semanaDe(T0));
  assert.equal(new Date(fs).getDay(), 1);   // lunes
});

test("Límite diario §11.2: 15 carreras al 100 %, después 25 %, y se reinicia al día siguiente", () => {
  const { p } = base();
  const c = p.caballos[0];
  const t = media(T0) + HORA;           // lejos de la medianoche
  const pagos: number[] = [];
  for (let k = 0; k < 17; k++) { c.estado = "disponible"; pagos.push(registrarCarrera(p, datos({ caballoId: c.id, seed: k }), t + k).oro); }
  assert.deepEqual(pagos.slice(0, 15), Array(15).fill(160));
  assert.deepEqual(pagos.slice(15), [40, 40]);
  c.estado = "disponible";
  assert.equal(registrarCarrera(p, datos({ caballoId: c.id, seed: 99 }), t + DIA).oro, 160);
  // Todo queda en el ledger y cuadra con el saldo.
  const suma = (p.ledger ?? []).filter((m) => m.moneda === "oro").reduce((s, m) => s + m.cantidad, 0);
  assert.equal(p.oro, 1000 + suma);
});

test("Objetivos semanales §11.4: cuentan carreras, podios y entrenamientos; se cobran una vez; se reinician el lunes", () => {
  const { p, rng } = base();
  const c = p.caballos[0];
  const t = finDeLaSemana(T0) + HORA;     // lunes a la 1: toda la prueba cae en la misma semana
  for (let k = 0; k < 25; k++) { c.estado = "disponible"; registrarCarrera(p, datos({ caballoId: c.id, seed: k, posicion: k < 8 ? 3 : 5 }), t + k); }
  assert.equal(cobrarObjetivo(p, "entrenamientos", t).ok, false);
  assert.ok(cobrarObjetivo(p, "carreras", t).ok);
  assert.ok(cobrarObjetivo(p, "podios", t).ok);
  assert.equal(cobrarObjetivo(p, "carreras", t).ok, false);
  assert.equal(p.gemas, 4);
  c.estado = "disponible"; delete c.descansoHasta;
  let u = t + HORA;
  for (let k = 0; k < 10; k++) {
    c.entreno = [0, 0, 0, 0, 0];
    assert.ok(iniciarEntrenamiento(p, c.id, u, rng).ok);
    u += 61 * MIN;
    actualizar(p, u);
  }
  assert.equal(p.semanal!.entrenamientos, 10);
  assert.ok(cobrarObjetivo(p, "entrenamientos", u).ok);
  assert.equal(p.gemas, 5);
  // En la semana siguiente, todo vuelve a cero.
  const prox = finDeLaSemana(t) + HORA;
  assert.equal(cobrarObjetivo(p, "carreras", prox).ok, false);
  assert.equal(p.semanal!.carreras, 0);
});

test("Aceleración §11.6: 1 Gema cada 30 min, mínimo 1; ejemplos del GDD", () => {
  assert.equal(costoAcelerar(60 * MIN), 2);       // sesión de entrenamiento
  assert.equal(costoAcelerar(6 * HORA), 12);      // mejora 4→5
  assert.equal(costoAcelerar(24 * HORA), 48);     // crecimiento completo
  assert.equal(costoAcelerar(1000), 1);
  assert.equal(costoAcelerar(31 * MIN), 2);
  const { p, rng } = base();
  p.oro = 100_000; p.gemas = 100;
  assert.ok(iniciarMejora(p, "establo", T0).ok);
  assert.ok(acelerarMejora(p, "establo", T0 + 5 * MIN).ok);     // quedaban 10 min: 1 Gema
  assert.equal(p.gemas, 99);
  actualizar(p, T0 + 5 * MIN);
  assert.equal(p.edificios.establo.nivel, 2);
  const c = p.caballos[0];
  assert.ok(iniciarEntrenamiento(p, c.id, T0, rng).ok);
  assert.ok(acelerarCaballo(p, c.id, T0).ok);
  assert.equal(p.gemas, 97);
  actualizar(p, T0);
  assert.equal(c.estado, "disponible");
  // Cruza y crecimiento.
  const h = caballoDeRaza(rng, { raza: "Árabe", sexo: "hembra" });
  agregarCaballo(p, h);
  assert.ok(iniciarCruza(p, c.id, h.id, "Potro", T0, rng).ok);
  assert.ok(acelerarCruza(p, T0).ok);            // 8 h: 16 Gemas
  assert.equal(p.gemas, 81);
  actualizar(p, T0);
  const hijo = p.caballos.find((x) => x.nombre === "Potro")!;
  assert.equal(hijo.estado, "creciendo");
  assert.ok(acelerarCaballo(p, hijo.id, T0).ok); // 24 h: 48 Gemas
  assert.equal(p.gemas, 33);
  actualizar(p, T0);
  assert.equal(hijo.estado, "disponible");
  // Recuperación (se acelera desde el 15/11/2026, pedido del usuario): 15 min → 1 Gema
  c.estado = "recuperacion"; c.inicioEstado = T0; c.finEstado = T0 + 15 * MIN;
  assert.ok(acelerarCaballo(p, c.id, T0).ok);
  assert.equal(p.gemas, 32);
  actualizar(p, T0);
  assert.equal(c.estado, "disponible");
  // En cola de recuperación: se paga su descanso completo (30 min → 1 Gema) y queda disponible
  c.estado = "colaRecuperacion"; c.finEstado = null; c.cola = { desde: T0, minutos: 30 };
  assert.ok(acelerarCaballo(p, c.id, T0).ok);
  assert.equal(p.gemas, 31); assert.equal(c.estado, "disponible"); assert.equal(c.cola, undefined);
  // Lo sacaron antes de tiempo: se paga el descanso que le falta para correr
  c.descansoHasta = T0 + 50 * MIN;
  assert.ok(acelerarCaballo(p, c.id, T0).ok);
  assert.equal(p.gemas, 29);                     // 50 min → 2 Gemas
  actualizar(p, T0);
  assert.equal(c.descansoHasta, undefined);
  // Sin Gemas no se puede; un caballo disponible y descansado no tiene nada que acelerar
  assert.equal(acelerarCaballo(p, c.id, T0).ok, false);
  p.gemas = 0; c.estado = "entrenando"; c.finEstado = T0 + 60 * MIN;
  assert.equal(acelerarCaballo(p, c.id, T0).ok, false);
});

test("Conversión §11.6: 1 Gema = 100 Oro, máximo 10 por día", () => {
  const { p } = base();
  p.gemas = 30;
  const t = media(T0) + HORA;
  assert.ok(convertirGemas(p, 7, t).ok);
  assert.equal(p.oro, 1700);
  assert.equal(gemasConvertiblesHoy(p, t), 3);
  assert.equal(convertirGemas(p, 4, t).ok, false);
  assert.ok(convertirGemas(p, 3, t).ok);
  assert.ok(convertirGemas(p, 10, t + DIA).ok);
  assert.equal(p.gemas, 10);
});

test("Monturas §11.7: se compran, suman al correr, se cambian entre caballos y vuelven al liberar", () => {
  const { p, rng } = base();
  const a = p.caballos[0], b = caballoDeRaza(rng, { raza: "Árabe" });
  agregarCaballo(p, b);
  p.oro = 3000;
  assert.ok(comprarMontura(p, "sprint", "oro", T0).ok);
  assert.equal(p.oro, 0);
  assert.equal(comprarMontura(p, "tactica", "oro", T0).ok, false);
  const m = p.monturas![0];
  const antes = atributos(a);
  assert.ok(equiparMontura(p, a.id, m.id).ok);
  assert.deepEqual(atributos(a), antes.map((v, i) => Math.min(100, v + [2, 0, 1, 0, 0][i])));
  assert.ok(equiparMontura(p, b.id, m.id).ok);   // pasa al otro caballo
  assert.equal(a.montura, undefined);
  assert.equal(portador(p, m.id)?.id, b.id);
  assert.ok(liberarCaballo(p, b.id).ok);
  assert.equal(portador(p, m.id), undefined);
  assert.equal(p.monturas!.length, 1);
  // Tope 100.
  a.natural = [99, 60, 60, 60, 60]; a.entreno = [0, 0, 0, 0, 0];
  equiparMontura(p, a.id, m.id);
  assert.equal(atributos(a)[0], 100);
});

test("Venta al juego: precio mínimo, no el último ni uno ocupado, y no rinde criar para vender", () => {
  const { p, rng } = base();
  const b = caballoDeRaza(rng, { raza: "Árabe", natural: [60, 60, 60, 60, 60] });
  agregarCaballo(p, b);
  assert.equal(precioSugerido(b), 2500);
  assert.equal(precioVentaAlJuego(b), 250);
  b.estado = "entrenando";
  assert.equal(venderAlJuego(p, b.id, T0).ok, false);
  b.estado = "disponible";
  assert.ok(venderAlJuego(p, b.id, T0).ok);
  assert.equal(p.oro, 1250);
  assert.equal(venderAlJuego(p, p.caballos[0].id, T0).ok, false);
  // Un potrillo de genética media (suma 330) vale 7.000 sugerido: el juego paga 700, cerca de la cruza (500).
  const c = caballoDeRaza(rng, { raza: "Criollo", natural: [66, 66, 66, 66, 66] });
  assert.ok(precioVentaAlJuego(c) < 800);
});

test("Recompensa por entrar: una por día, racha de 7 que se corta si se saltea un día", async () => {
  const { cobrarEntrada, estadoEntrada } = await import("../src/domain/economia.ts");
  const { p } = base();
  const t = media(T0) + HORA;
  assert.deepEqual(estadoEntrada(p, t), { disponible: true, dia: 1, oro: 100, gemas: 0 });
  assert.ok(cobrarEntrada(p, t).ok);
  assert.equal(cobrarEntrada(p, t + HORA).ok, false);
  const oros: number[] = [];
  for (let d = 1; d <= 7; d++) { const e = estadoEntrada(p, t + d * DIA); oros.push(e.oro); assert.ok(cobrarEntrada(p, t + d * DIA).ok); }
  assert.deepEqual(oros, [150, 200, 250, 300, 400, 500, 100]);   // el día 8 vuelve a empezar
  assert.equal(p.gemas, 2);
  // Saltearse un día corta la racha.
  assert.equal(estadoEntrada(p, t + 9 * DIA).dia, 1);
});
