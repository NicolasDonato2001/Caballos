// Pruebas de la Fase 9: clanes y guerras (GDD §14). Criterio de la fase: resultados verificables.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { crearServidor } from "../server/servidor.ts";
import { PARAMS } from "../server/carrera.ts";
import { simulateRace } from "../src/sim/race.ts";
import { caballoDeRaza } from "../src/domain/caballo.ts";
import { Rng } from "../src/sim/rng.ts";
import { CLANES as C, esperado, nuevoElo, puntosDePuesto, ventanaElo } from "../src/domain/clanes.ts";

const MIN = 60_000, HORA = 3_600_000;

async function conClanes(f: (h: any) => Promise<void>) {
  const tiempo = { t: 1_800_000_000_000 };
  const { servidor, db, online, clanes } = crearServidor({ base: ":memory:", reloj: () => tiempo.t });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const puerto = (servidor.address() as AddressInfo).port;
  const pedir = async (ruta: string, cuerpo?: unknown, token?: string) => {
    const [metodo, camino] = ruta.split(" ");
    const r = await fetch(`http://127.0.0.1:${puerto}${camino}`, { method: metodo,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    return { estado: r.status, datos: await r.json() };
  };
  const rng = new Rng(11);
  const tok: Record<string, string> = {};
  const nuevo = async (nombre: string) => {
    const { datos } = await pedir("POST /api/registro", { nombre, clave: "caballos123" });
    await pedir("POST /api/accion", { nombre: "primerCaballo", args: { nombre: `Primero de ${nombre}`, sexo: "macho" } }, datos.token);
    const id = db.usuarioPorNombre(nombre)!.id, r = db.partida(id)!;
    for (let k = 1; k <= 3; k++) r.partida.caballos.push({ ...caballoDeRaza(rng, { raza: "Criollo" }), id: `c-${nombre}-${k}`, nombre: `${nombre} ${k}` });
    r.partida.oro = 1000;
    r.partida.tutorial = { paso: 8, terminado: true };     // sin el bono de bienvenida de la primera carrera
    db.guardarPartida(id, r.partida, r.version, tiempo.t);
    tok[nombre] = datos.token;
  };
  const partida = (n: string) => db.partida(db.usuarioPorNombre(n)!.id)!.partida;
  try { await f({ pedir, tiempo, nuevo, tok, partida, db, clanes }); } finally { online.parar(); servidor.close(); db.cerrar(); }
}

test("Elo y ventana de emparejamiento (§14)", () => {
  assert.equal(esperado(1000, 1000), 0.5);
  assert.equal(nuevoElo(1000, 1000, 1), 1016);
  assert.equal(nuevoElo(1000, 1000, 0.5), 1000);
  const a = nuevoElo(1200, 1000, 0), b = nuevoElo(1000, 1200, 1);
  assert.ok(Math.abs((a + b) - 2200) < 1e-9, "lo que gana uno lo pierde el otro");
  assert.ok(1200 - a > 16, "perder siendo favorito cuesta más");
  assert.equal(ventanaElo(0), 150); assert.equal(ventanaElo(15 * MIN), 275); assert.equal(ventanaElo(60 * MIN), 400);
  assert.deepEqual(C.puntos.map((_, i) => puntosDePuesto(i + 1)), [8, 6, 5, 4, 3, 2, 1, 0]);
});

test("Clanes: crear, unirse, roles, expulsar y salir", async () => {
  await conClanes(async ({ pedir, nuevo, tok }: any) => {
    for (const n of ["Lider", "Ofi", "Memo", "Otro"]) await nuevo(n);
    assert.equal((await pedir("POST /api/clan/crear", { nombre: "ab" }, tok.Lider)).estado, 400);
    const c = await pedir("POST /api/clan/crear", { nombre: "Los Pampas" }, tok.Lider);
    assert.equal(c.estado, 200);
    assert.equal((await pedir("POST /api/clan/crear", { nombre: "los pampas" }, tok.Otro)).estado, 400, "nombre repetido");
    const id = c.datos.clan.id;
    for (const n of ["Ofi", "Memo"]) assert.equal((await pedir("POST /api/clan/unirse", { id }, tok[n])).estado, 200);
    assert.equal((await pedir("POST /api/clan/unirse", { id }, tok.Ofi)).estado, 400, "un clan por jugador");
    assert.equal((await pedir("POST /api/clan/rol", { nombre: "Ofi", rol: "oficial" }, tok.Memo)).estado, 400, "solo el líder");
    assert.equal((await pedir("POST /api/clan/rol", { nombre: "Ofi", rol: "oficial" }, tok.Lider)).estado, 200);
    assert.equal((await pedir("POST /api/clan/expulsar", { nombre: "Lider" }, tok.Ofi)).estado, 400, "un oficial no expulsa al líder");
    assert.equal((await pedir("POST /api/clan/buscarGuerra", {}, tok.Memo)).estado, 400, "un miembro no busca guerra");
    // El líder se va: el oficial queda como líder
    assert.equal((await pedir("POST /api/clan/salir", {}, tok.Lider)).estado, 200);
    const e = (await pedir("GET /api/clan", undefined, tok.Ofi)).datos;
    assert.deepEqual(e.clan.miembros.map((x: any) => `${x.nombre}:${x.rol}`), ["Ofi:lider", "Memo:miembro"]);
    assert.equal((await pedir("POST /api/clan/expulsar", { nombre: "Memo" }, tok.Ofi)).estado, 200);
    assert.equal((await pedir("POST /api/clan/salir", {}, tok.Ofi)).estado, 200);
    const sin = (await pedir("GET /api/clan", undefined, tok.Otro)).datos;
    assert.equal(sin.clan, null);
    assert.equal(sin.clanes.length, 0, "sin miembros, el clan se disuelve");
  });
});

test("Guerra completa: emparejamiento por Elo, carreras verificables, puntos, Elo y premios", async () => {
  await conClanes(async ({ pedir, nuevo, tok, partida, db, tiempo, clanes }: any) => {
    for (const n of ["Alfa1", "Alfa2", "Beta1", "Beta2", "Gama1"]) await nuevo(n);
    const ia = (await pedir("POST /api/clan/crear", { nombre: "Clan A" }, tok.Alfa1)).datos.clan.id;
    const ib = (await pedir("POST /api/clan/crear", { nombre: "Clan B" }, tok.Beta1)).datos.clan.id;
    const ic = (await pedir("POST /api/clan/crear", { nombre: "Clan C" }, tok.Gama1)).datos.clan.id;
    await pedir("POST /api/clan/unirse", { id: ia }, tok.Alfa2); await pedir("POST /api/clan/unirse", { id: ib }, tok.Beta2);
    // C tiene mucho más Elo: no se empareja con A al principio
    db.hacer("UPDATE clanes SET elo = 1300 WHERE id = ?", ic);
    assert.equal((await pedir("POST /api/clan/buscarGuerra", {}, tok.Alfa1)).estado, 200);
    assert.equal((await pedir("POST /api/clan/buscarGuerra", {}, tok.Gama1)).estado, 200);
    assert.equal((await pedir("GET /api/clan", undefined, tok.Alfa1)).datos.guerra, null, "1000 contra 1300: no todavía");
    // Llega B (mismo Elo que A): guerra A contra B
    assert.equal((await pedir("POST /api/clan/buscarGuerra", {}, tok.Beta1)).estado, 200);
    const g0 = (await pedir("GET /api/clan", undefined, tok.Alfa1)).datos.guerra;
    assert.equal(g0.rival, "Clan B");
    assert.equal(g0.carreras.length, 3);
    assert.equal((await pedir("POST /api/clan/buscarGuerra", {}, tok.Alfa1)).estado, 400, "una guerra a la vez");
    // Representantes
    for (const n of ["Alfa1", "Alfa2", "Beta1", "Beta2"]) assert.equal((await pedir("POST /api/clan/representante", { anotar: true }, tok[n])).estado, 200);
    assert.equal((await pedir("POST /api/clan/salir", {}, tok.Alfa2)).estado, 400, "un representante no se va en plena guerra");
    const oroAntes = Object.fromEntries(["Alfa1", "Alfa2", "Beta1", "Beta2"].map((n) => [n, partida(n).oro]));
    const diarioAntes = partida("Alfa1").diario?.carrerasPagadas ?? 0;
    // Carrera 1: se anotan los cuatro → corre en el momento
    for (const n of ["Alfa1", "Alfa2", "Beta1", "Beta2"]) {
      const cab = partida(n).caballos[1];
      const r = await pedir("POST /api/clan/anotarCaballo", { carrera: 1, caballoId: cab.id, estrategia: "equilibrada" }, tok[n]);
      assert.equal(r.estado, 200, JSON.stringify(r.datos));
    }
    let g = (await pedir("GET /api/clan", undefined, tok.Alfa1)).datos.guerra;
    const c1 = g.carreras[0];
    assert.ok(c1.corrida, "con todos anotados corre enseguida");
    assert.equal(c1.resultado.length, 8, "8 caballos: los bots completan");
    assert.equal(c1.resultado.filter((x: any) => x.nuestro).length, 2);
    // Verificable: repetir la carrera con su entrada da el mismo orden
    const res = simulateRace(c1.setup.input, PARAMS);
    assert.deepEqual(res.order.map((i: number) => c1.setup.entrants[i].caballo.nombre), c1.resultado.map((x: any) => x.caballo));
    const pts = (l: any[], f: (x: any) => boolean) => l.filter(f).reduce((t, x) => t + puntosDePuesto(x.puesto), 0);
    assert.equal(g.puntos.nuestros, pts(c1.resultado, (x) => x.nuestro));
    assert.equal(g.puntos.rival, pts(c1.resultado, (x) => x.rival));
    assert.equal(c1.resultado.filter((x: any) => !x.nuestro && !x.rival).every((x: any) => x.puntos === 0), true, "los bots no suman");
    assert.equal(partida("Alfa1").historial[0].modo, "guerra");
    assert.equal(partida("Alfa1").caballos[1].estado, "recuperacion");
    assert.equal(partida("Alfa1").diario?.carrerasPagadas ?? 0, diarioAntes, "no cuenta para el límite diario");
    // Un caballo no se anota en dos carreras pendientes
    const otro = partida("Alfa1").caballos[2];
    assert.equal((await pedir("POST /api/clan/anotarCaballo", { carrera: 2, caballoId: otro.id, estrategia: "agresiva" }, tok.Alfa1)).estado, 200);
    assert.equal((await pedir("POST /api/clan/anotarCaballo", { carrera: 3, caballoId: otro.id, estrategia: "agresiva" }, tok.Alfa1)).estado, 400);
    // Pasan las 48 h: corren las carreras 2 y 3 (los que no anotaron corren con su mejor caballo listo) y termina
    tiempo.t += C.duracionHoras * HORA + MIN;
    clanes.paso();
    const e = (await pedir("GET /api/clan", undefined, tok.Alfa1)).datos;
    assert.equal(e.guerra, null);
    const h = e.historial[0];
    assert.equal(h.estado, "terminada");
    assert.ok(h.carreras.every((c: any) => c.corrida && c.resultado.length === 8));
    for (const c of h.carreras) {
      const r2 = simulateRace(c.setup.input, PARAMS);
      assert.deepEqual(r2.order.map((i: number) => c.setup.entrants[i].caballo.nombre), c.resultado.map((x: any) => x.caballo), `carrera ${c.n} verificable`);
    }
    const total = (f: (x: any) => boolean) => h.carreras.reduce((t: number, c: any) => t + pts(c.resultado, f), 0);
    assert.equal(h.puntos.nuestros, total((x) => x.nuestro)); assert.equal(h.puntos.rival, total((x) => x.rival));
    const gano = h.puntos.nuestros > h.puntos.rival ? "Alfa" : h.puntos.nuestros < h.puntos.rival ? "Beta" : null;
    assert.equal(h.resultado, gano === "Alfa" ? "victoria" : gano === "Beta" ? "derrota" : "empate");
    const eloA = h.elo.despues, eloB = (await pedir("GET /api/clan", undefined, tok.Beta1)).datos.clan.elo;
    assert.ok(Math.abs(eloA + eloB - 2000) <= 1, "Elo: lo que gana uno lo pierde el otro");
    for (const n of ["Alfa1", "Alfa2", "Beta1", "Beta2"]) {
      const premio = C.premios.participacion + (gano && n.startsWith(gano) ? C.premios.victoria : 0);
      assert.equal(partida(n).oro, oroAntes[n] + premio, `premio de ${n}`);
    }
    // C sigue buscando; después de 30 min la ventana llega a ±400 y C, con 1300, puede emparejarse con A (≈1000)
    assert.ok((await pedir("GET /api/clan", undefined, tok.Gama1)).datos.buscando);
  });
});
