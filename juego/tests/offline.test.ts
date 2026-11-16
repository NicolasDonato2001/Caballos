// Pruebas de la Fase 7.5: carreras offline con tokens firmados (GDD §15).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { crearServidor } from "../server/servidor.ts";
import { PARAMS } from "../server/carrera.ts";
import { carreraDeToken, correrConToken, OFFLINE, proximoToken, quedanHoy, type TokenCarrera } from "../src/domain/offline.ts";
import { diaDe, diarioDe } from "../src/domain/economia.ts";
import { caballoInicial } from "../src/domain/caballo.ts";
import { partidaNueva } from "../src/domain/partida.ts";
import { Rng } from "../src/sim/rng.ts";

const clonar = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const MIN = 60_000;

async function conServidor(f: (pedir: (ruta: string, cuerpo?: unknown, token?: string) => Promise<{ estado: number; datos: any }>, tiempo: { t: number }) => Promise<void>) {
  const tiempo = { t: 1_800_000_000_000 };
  const { servidor, db, online } = crearServidor({ base: ":memory:", reloj: () => tiempo.t });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const puerto = (servidor.address() as AddressInfo).port;
  const pedir = async (ruta: string, cuerpo?: unknown, token?: string) => {
    const [metodo, camino] = ruta.split(" ");
    const r = await fetch(`http://127.0.0.1:${puerto}${camino}`, {
      method: metodo, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    return { estado: r.status, datos: await r.json() };
  };
  try { await f(pedir, tiempo); } finally { online.parar(); servidor.close(); db.cerrar(); }
}

test("el token fija la carrera: la misma semilla da la misma carrera y el mismo resultado", () => {
  const p = partidaNueva(0);
  p.caballos.push(caballoInicial(new Rng(1), "Pampero", "macho"));
  const id = p.caballos[0].id;
  const a = clonar(p), b = clonar(p);
  const ra = correrConToken(a, { seed: 123456789 }, id, "agresiva", 1000, PARAMS);
  const rb = correrConToken(b, { seed: 123456789 }, id, "agresiva", 1000, PARAMS);
  assert.ok(ra.ok && rb.ok);
  assert.deepEqual(ra.setup.input, rb.setup.input);
  assert.equal(ra.posicion, rb.posicion);
  assert.deepEqual(a, b, "la partida queda igual");
  assert.equal(a.historial![0].offline, true);
  const { distancia } = carreraDeToken(123456789);
  assert.equal(ra.setup.input.distance, distancia);
  // Otra semilla, otra carrera
  const rc = correrConToken(clonar(p), { seed: 987654321 }, id, "agresiva", 1000, PARAMS);
  assert.ok(rc.ok); assert.notEqual(rc.setup.input.seed, ra.setup.input.seed);
  // Mitad 500 m y mitad 1.500 m
  let cortas = 0; for (let s = 0; s < 2000; s++) if (carreraDeToken(s * 2654435761 >>> 0).distancia === 500) cortas++;
  assert.ok(cortas > 900 && cortas < 1100, `${cortas}`);
});

test("el contador del límite diario de un día pasado no pisa el de hoy", () => {
  const p = partidaNueva(0);
  const hoy = 20 * 86_400_000 + 12 * 3_600_000;
  diarioDe(p, hoy).carrerasPagadas = 7;
  const ayer = diarioDe(p, hoy - 86_400_000);
  ayer.carrerasPagadas = 3;
  assert.equal(diarioDe(p, hoy).carrerasPagadas, 7);
  assert.equal(diarioDe(p, hoy - 86_400_000).carrerasPagadas, 3);
  assert.equal(diarioDe(p, hoy + 86_400_000).carrerasPagadas, 0, "mañana arranca en 0");
  assert.equal(diarioDe(p, hoy).carrerasPagadas, 7, "y hoy sigue guardado entre los pasados");
});

test("Offline: tokens, carrera sin conexión, sincronización y trampas que no pasan", async () => {
  await conServidor(async (pedir, tiempo) => {
    const nueva = async (nombre: string) => {
      const { datos } = await pedir("POST /api/registro", { nombre, clave: "caballos123" });
      await pedir("POST /api/accion", { nombre: "primerCaballo", args: { nombre: `Caballo de ${nombre}`, sexo: "macho" } }, datos.token);
      return datos.token as string;
    };
    const t = await nueva("Nico");
    const otro = await nueva("Ajeno");
    // Con conexión: tokens para hoy y los dos días siguientes
    const { datos: dt } = await pedir("GET /api/offline/tokens", undefined, t);
    const tokens: TokenCarrera[] = dt.tokens;
    assert.equal(tokens.length, OFFLINE.porDia * OFFLINE.dias);
    assert.equal(quedanHoy(tokens, tiempo.t), OFFLINE.porDia, "solo los de hoy se pueden usar hoy");
    assert.equal((await pedir("GET /api/offline/tokens", undefined, t)).datos.tokens.length, tokens.length, "pedir de nuevo no da más");
    const p0 = (await pedir("GET /api/partida", undefined, t)).datos.partida;
    const id = p0.caballos[0].id;

    // Sin conexión: el cliente corre con su copia de la partida
    tiempo.t += 10 * MIN;
    const local = clonar(p0);
    const tk = proximoToken(tokens, tiempo.t)!;
    const r = correrConToken(local, tk, id, "conservadora", tiempo.t, PARAMS);
    assert.ok(r.ok);
    const pendiente = { token: tk, caballoId: id, estrategia: "conservadora", jugadoEn: tiempo.t };
    // Intentos de trampa
    const tk2 = tokens.find((x) => x.id !== tk.id && x.dia === tk.dia)!;
    const otroTk = (await pedir("GET /api/offline/tokens", undefined, otro)).datos.tokens[0];
    const trampas = [
      { ...pendiente, token: { ...tk2, firma: "falsa" } },                                     // firma inventada
      { ...pendiente, token: otroTk },                                                          // token de otra cuenta
      { ...pendiente, token: tokens.find((x) => x.dia === diaDe(tiempo.t) + 2)! },              // token de pasado mañana (reloj adelantado)
    ];
    tiempo.t += 30 * MIN;                         // vuelve la conexión
    const s = (await pedir("POST /api/offline/sincronizar", { carreras: [pendiente, pendiente, ...trampas] }, t)).datos;
    assert.equal(s.ok, true);
    const bien = s.resultados.filter((x: any) => x.ok);
    assert.equal(bien.length, 1, JSON.stringify(s.resultados));
    assert.equal(bien[0].posicion, r.posicion, "el servidor repite la misma carrera");
    assert.equal(bien[0].oro, r.cobro.oro + r.cobro.bonoTutorial);
    assert.equal(s.partida.oro, local.oro, "el Oro acreditado es el mismo que se vio sin conexión");
    assert.equal(s.partida.historial[0].offline, true);
    const motivos = s.resultados.filter((x: any) => !x.ok).map((x: any) => x.motivo);
    assert.deepEqual(motivos.sort(), ["El token era para otro día.", "Ese token ya se usó.", "Firma inválida.", "Token desconocido."].sort());
    // Volver a mandar lo mismo no cobra de nuevo
    const s2 = (await pedir("POST /api/offline/sincronizar", { carreras: [pendiente] }, t)).datos;
    assert.equal(s2.resultados[0].ok, false); assert.equal(s2.partida.oro, s.partida.oro);
    assert.equal(s2.tokens.some((x: TokenCarrera) => x.id === tk.id), false, "el token usado ya no aparece");

    // El caballo quedó en recuperación: una carrera que dice haberse corrido 1 minuto después no cuadra
    const tk3 = proximoToken(s2.tokens, tiempo.t)!;
    const s3 = (await pedir("POST /api/offline/sincronizar", { carreras: [{ token: tk3, caballoId: id, estrategia: "equilibrada", jugadoEn: pendiente.jugadoEn + MIN }] }, t)).datos;
    assert.equal(s3.resultados[0].ok, false);
    assert.match(s3.resultados[0].motivo, /recuperación/);
    assert.equal(s3.partida.oro, s.partida.oro);
  });
});

test("Offline: el límite diario cuenta juntas las carreras online y offline de cada día", () => {
  const DIA = 86_400_000, hoy = 20_000 * DIA + 15 * 3_600_000;
  const base = partidaNueva(0);
  base.caballos.push(caballoInicial(new Rng(2), "Lucero", "hembra"));
  base.tutorial = { paso: 8, terminado: true };
  const id = base.caballos[0].id;
  // Hoy ya corrió con conexión las 15 carreras con premio completo: la offline de hoy paga reducido
  const a = clonar(base);
  diarioDe(a, hoy).carrerasPagadas = 15;
  const ra = correrConToken(a, { seed: 42 }, id, "equilibrada", hoy, PARAMS);
  assert.ok(ra.ok); assert.equal(ra.cobro.reducido, true);
  assert.equal(diarioDe(a, hoy).carrerasPagadas, 16);
  // Una offline de ayer que se sincroniza hoy usa el contador de ayer (0): paga completo y no toca el de hoy
  const b = clonar(base);
  diarioDe(b, hoy).carrerasPagadas = 15;
  const rb = correrConToken(b, { seed: 42 }, id, "equilibrada", hoy - DIA, PARAMS);
  assert.ok(rb.ok); assert.equal(rb.cobro.reducido, false);
  assert.equal(diarioDe(b, hoy).carrerasPagadas, 15);
  assert.equal(diarioDe(b, hoy - DIA).carrerasPagadas, 1);
});
