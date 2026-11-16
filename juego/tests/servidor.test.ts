// Pruebas del servidor (Fase 7): cuentas, partida en el servidor, acciones autoritativas y carreras reproducibles.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { crearServidor } from "../server/servidor.ts";
import { PARAMS } from "../server/carrera.ts";
import { simulateRace } from "../src/sim/race.ts";
import { caballoInicial } from "../src/domain/caballo.ts";
import { Rng } from "../src/sim/rng.ts";

async function conServidor(f: (pedir: (ruta: string, cuerpo?: unknown, token?: string) => Promise<{ estado: number; datos: any }>, tiempo: { t: number }) => Promise<void>) {
  const tiempo = { t: 1_800_000_000_000 };
  const { servidor, db } = crearServidor({ base: ":memory:", reloj: () => tiempo.t });
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
  try { await f(pedir, tiempo); } finally { servidor.close(); db.cerrar(); }
}

test("Servidor: cuentas (crear, entrar, contraseña incorrecta, sin sesión)", async () => {
  await conServidor(async (pedir) => {
    assert.equal((await pedir("POST /api/registro", { nombre: "ab", clave: "12345678" })).estado, 400);
    assert.equal((await pedir("POST /api/registro", { nombre: "Nico", clave: "corta" })).estado, 400);
    const r = await pedir("POST /api/registro", { nombre: "Nico", clave: "caballos123" });
    assert.equal(r.estado, 200);
    assert.ok(r.datos.token && r.datos.partida.caballos.length === 0);
    assert.equal((await pedir("POST /api/registro", { nombre: "nico", clave: "otraclave1" })).estado, 400, "nombre repetido (sin importar mayúsculas)");
    assert.equal((await pedir("POST /api/entrar", { nombre: "Nico", clave: "mal123456" })).estado, 401);
    const e = await pedir("POST /api/entrar", { nombre: "Nico", clave: "caballos123" });
    assert.equal(e.estado, 200);
    assert.equal((await pedir("GET /api/partida")).estado, 401);
    assert.equal((await pedir("GET /api/partida", undefined, e.datos.token)).estado, 200);
    await pedir("POST /api/salir", {}, e.datos.token);
    assert.equal((await pedir("GET /api/partida", undefined, e.datos.token)).estado, 401);
  });
});

test("Servidor: las acciones las decide el servidor (hora y azar) y quedan guardadas", async () => {
  await conServidor(async (pedir, tiempo) => {
    const { datos } = await pedir("POST /api/registro", { nombre: "Jugadora", clave: "caballos123" });
    const t = datos.token;
    const c = caballoInicial(new Rng(1), "", "hembra");
    let r = await pedir("POST /api/accion", { nombre: "primerCaballo", args: { nombre: "Pampa", sexo: "hembra", pelaje: c.pelaje } }, t);
    assert.equal(r.estado, 200);
    const caballo = r.datos.partida.caballos[0];
    assert.equal(caballo.nombre, "Pampa");
    assert.deepEqual(caballo.natural, [60, 70, 60, 70, 65], "los atributos los pone el servidor");
    assert.equal((await pedir("POST /api/accion", { nombre: "primerCaballo", args: { nombre: "Otra" } }, t)).estado, 400);
    r = await pedir("POST /api/accion", { nombre: "entrenar", args: { id: caballo.id } }, t);
    assert.equal(r.datos.partida.caballos[0].estado, "entrenando");
    assert.equal((await pedir("POST /api/accion", { nombre: "inventada", args: {} }, t)).estado, 400);
    // Pasa una hora: el reloj del servidor termina el entrenamiento
    tiempo.t += 61 * 60_000;
    r = await pedir("GET /api/partida", undefined, t);
    assert.equal(r.datos.partida.caballos[0].estado, "disponible");
    assert.ok(r.datos.sucesos.length >= 1);
    assert.ok(r.datos.partida.caballos[0].entreno.some((x: number) => x > 0));
  });
});

test("Servidor: la carrera la simula el servidor y el cliente la reproduce igual (mismo resultado)", async () => {
  await conServidor(async (pedir) => {
    const { datos } = await pedir("POST /api/registro", { nombre: "Corredor", clave: "caballos123" });
    const t = datos.token;
    await pedir("POST /api/accion", { nombre: "primerCaballo", args: { nombre: "Tero", sexo: "macho" } }, t);
    const id = (await pedir("GET /api/partida", undefined, t)).datos.partida.caballos[0].id;
    assert.equal((await pedir("POST /api/correr", { caballoId: id, modo: "casual", estrategia: "equilibrada" }, t)).estado, 400, "sin sorteo");
    await pedir("POST /api/accion", { nombre: "sortearCarrera", args: {} }, t);
    const r = await pedir("POST /api/correr", { caballoId: id, modo: "casual", estrategia: "equilibrada" }, t);
    assert.equal(r.estado, 200);
    const { setup, cobro, partida } = r.datos;
    // Reproducción en el "cliente": misma entrada → mismo resultado que el servidor
    const local = simulateRace(setup.input, PARAMS);
    const pos = local.order.indexOf(setup.playerIndex) + 1;
    assert.equal(partida.historial[0].posicion, pos);
    assert.equal(partida.historial[0].seed, setup.input.seed);
    assert.ok(cobro.oro >= 0 && partida.oro >= 1000);
    assert.equal(partida.caballos[0].estado, "recuperacion");
    assert.equal((await pedir("POST /api/correr", { caballoId: id, modo: "casual", estrategia: "equilibrada" }, t)).estado, 400, "está en recuperación");
  });
});

test("Servidor: al crear la cuenta se puede subir la partida local", async () => {
  await conServidor(async (pedir) => {
    const local = { version: 2, creada: 1, oro: 4321, gemas: 7, caballos: [caballoInicial(new Rng(3), "Local", "macho")], espacios: 5,
      edificios: { establo: { nivel: 1, mejoraFin: null }, entrenamiento: { nivel: 1, mejoraFin: null }, recuperacion: { nivel: 1, mejoraFin: null } },
      tutorial: { paso: 8, terminado: true } };
    const r = await pedir("POST /api/registro", { nombre: "ConPartida", clave: "caballos123", partida: local });
    assert.equal(r.estado, 200);
    assert.equal(r.datos.partida.oro, 4321);
    assert.equal(r.datos.partida.caballos[0].nombre, "Local");
  });
});
