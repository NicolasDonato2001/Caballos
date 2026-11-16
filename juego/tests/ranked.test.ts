// Pruebas de la Fase 7.3: Ranked con TrueSkill, rating visible, ranking y emparejamiento por rating y fuerza del establo.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { crearServidor } from "../server/servidor.ts";
import { CarrerasOnline } from "../server/online.ts";
import { PARAMS } from "../server/carrera.ts";
import { simulateRace } from "../src/sim/race.ts";
import cfg from "../config/balance/online.json" with { type: "json" };

test("Ranked: 4 jugadores, la misma carrera, el rating sigue el orden de llegada y aparece en el ranking", async () => {
  const { servidor, db, online } = crearServidor({ base: ":memory:",
    online: { eleccionSeg: 1, cuentaRegresivaSeg: 1, ranked: { esperaSeg: 0, fuerzaPct: 100, fuerzaPctMax: 100 } } });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  const pedir = async (ruta: string, cuerpo?: unknown, token?: string) => {
    const [metodo, camino] = ruta.split(" ");
    const r = await fetch(base + camino, { method: metodo, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    return { estado: r.status, datos: await r.json() };
  };
  const escuchar = (token: string) => {
    const eventos: { evento: string; datos: any }[] = [];
    const ctrl = new AbortController();
    void (async () => {
      try {
        const r = await fetch(`${base}/api/online/eventos?token=${token}`, { signal: ctrl.signal });
        const lector = r.body!.getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await lector.read();
          if (done) break;
          buf += new TextDecoder().decode(value);
          let k;
          while ((k = buf.indexOf("\n\n")) >= 0) {
            const bloque = buf.slice(0, k); buf = buf.slice(k + 2);
            const ev = /^event: (.*)$/m.exec(bloque)?.[1], data = /^data: (.*)$/m.exec(bloque)?.[1];
            if (ev && data) eventos.push({ evento: ev, datos: JSON.parse(data) });
          }
        }
      } catch { /* cerrado */ }
    })();
    return { eventos, cerrar: () => ctrl.abort() };
  };
  const esperar = async (f: () => boolean, ms = 8000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error("tiempo agotado"); await new Promise((r) => setTimeout(r, 50)); } };
  try {
    const jugadores = [];
    for (const nombre of ["Ana", "Beto", "Caro", "Dani"]) {
      const { datos } = await pedir("POST /api/registro", { nombre, clave: "caballos123" });
      await pedir("POST /api/accion", { nombre: "primerCaballo", args: { nombre: `Caballo de ${nombre}`, sexo: "macho" } }, datos.token);
      jugadores.push({ nombre, token: datos.token, oyente: escuchar(datos.token) });
    }
    await esperar(() => jugadores.every((j) => j.oyente.eventos.some((e) => e.evento === "estado")));
    // Ranking vacío al empezar: nadie terminó la colocación
    const r0 = (await pedir("GET /api/ranking", undefined, jugadores[0].token)).datos;
    assert.equal(r0.top.length, 0);
    assert.equal(r0.yo.visible, 0); assert.equal(r0.yo.colocacion, true); assert.equal(r0.yo.puesto, null);
    // Con 3 en la cola no alcanza (mínimo 4 humanos)
    for (const j of jugadores.slice(0, 3)) assert.equal((await pedir("POST /api/online/cola", { tipo: "ranked" }, j.token)).estado, 200);
    await new Promise((r) => setTimeout(r, 1200));
    assert.ok(!jugadores[0].oyente.eventos.some((e) => e.evento === "sala"), "con 3 no arranca");
    assert.equal(jugadores[0].oyente.eventos.filter((e) => e.evento === "estado").at(-1)!.datos.tipo, "ranked");
    assert.equal((await pedir("POST /api/online/cola", { tipo: "ranked" }, jugadores[3].token)).estado, 200);
    await esperar(() => jugadores.every((j) => j.oyente.eventos.some((e) => e.evento === "carrera")), 10000);
    const carreras = jugadores.map((j) => j.oyente.eventos.find((e) => e.evento === "carrera")!.datos);
    const sala = jugadores[0].oyente.eventos.find((e) => e.evento === "sala")!.datos.sala;
    assert.equal(sala.tipo, "ranked");
    for (const c of carreras) assert.deepEqual(c.setup.input, carreras[0].setup.input);
    assert.equal(carreras[0].setup.entrants.length, 8);
    // Orden de llegada entre humanos → el rating visible sube con el puesto
    const res = simulateRace(carreras[0].setup.input, PARAMS);
    const porPuesto = carreras.map((c, k) => ({ k, puesto: res.order.indexOf(c.setup.playerIndex), c })).sort((a, b) => a.puesto - b.puesto);
    for (const { c } of porPuesto) {
      assert.equal(c.partida.historial[0].modo, "ranked");
      assert.equal(c.cobro.rating.antes, 0);
      assert.equal(c.cobro.rating.carreras, 1);
      assert.equal(c.cobro.rating.colocacion, true);
    }
    for (let k = 1; k < porPuesto.length; k++) assert.ok(porPuesto[k - 1].c.cobro.rating.despues >= porPuesto[k].c.cobro.rating.despues);
    const mu = porPuesto.map(({ k }) => db.rating(db.usuarioPorNombre(jugadores[k].nombre)!.id).mu);
    for (let k = 1; k < mu.length; k++) assert.ok(mu[k - 1] > mu[k], "μ ordenado por puesto");
    assert.ok(Math.abs(mu.reduce((a, b) => a + b, 0) - 100) < 1e-6, "TrueSkill conserva la suma de μ en carreras parejas");
    // Ranking: solo después de 10 carreras (colocación)
    const ganador = db.usuarioPorNombre(jugadores[porPuesto[0].k].nombre)!.id;
    db.guardarRatings([{ usuario: ganador, r: db.rating(ganador), carreras: 10 }], 0);
    const r1 = (await pedir("GET /api/ranking", undefined, jugadores[porPuesto[0].k].token)).datos;
    assert.equal(r1.top.length, 1);
    assert.equal(r1.top[0].yo, true); assert.equal(r1.top[0].division.nombre, "Bronce");
    assert.equal(r1.yo.puesto, 1); assert.equal(r1.yo.colocacion, false);
    for (const j of jugadores) j.oyente.cerrar();
  } finally {
    online.parar(); servidor.closeAllConnections?.(); servidor.close(); db.cerrar();
  }
});

test("Emparejamiento Ranked: rating ±100 → ±300 y fuerza 3 % → 5 % con la espera", () => {
  let t = 0;
  const online = new CarrerasOnline({ leer: () => { throw new Error("no"); }, modificar: () => { throw new Error("no"); }, reloj: () => t }, cfg);
  const abiertas: number[][] = [];
  const o = online as unknown as { cola: Map<number, unknown>; abrirSala: (g: { u: number }[]) => void; emparejar: () => void };
  o.abrirSala = (g) => { abiertas.push(g.map((e) => e.u).sort()); };
  const meter = (u: number, rating: number, f500 = 30, f1500 = 95) =>
    o.cola.set(u, { u, nombre: `j${u}`, desde: 0, indice: 0, tipo: "ranked", rating, fuerza: { 500: f500, 1500: f1500 } });
  meter(1, 500); meter(2, 560); meter(3, 590); meter(4, 750); meter(5, 900, 33, 104);   // 5: 10 % más lento
  t = 1000; o.emparejar();
  assert.equal(abiertas.length, 0, "a los 0 s solo hay 3 dentro de ±100");
  t = 31_000; o.emparejar();     // espera 31 s: ventana 100 + 5·31 = 255 → entra el de 750
  assert.deepEqual(abiertas, [[1, 2, 3, 4]], "el de fuerza muy distinta nunca entra");
  assert.equal(o.cola.size, 1);
  assert.ok(Math.abs(CarrerasOnline.difFuerza({ 500: 30, 1500: 95 }, { 500: 30.9, 1500: 95 }) - 3) < 1e-9);
  // Una casual no se mezcla con la ranked
  o.cola.set(9, { u: 9, nombre: "c", desde: 0, indice: 0, tipo: "casual", rating: 900, fuerza: { 500: 33, 1500: 104 } });
  t = 200_000; o.emparejar();
  assert.equal(abiertas.length, 1, "el 9 es casual y el 5 ranked: no se juntan aunque esperen mucho");
});

test("Online casual: juntan a todos los de la cola aunque sus caballos sean muy distintos (caso de 3 amigos, 15/11/2026)", () => {
  let t = 0;
  const online = new CarrerasOnline({ leer: () => { throw new Error("no"); }, modificar: () => { throw new Error("no"); }, reloj: () => t }, cfg);
  const abiertas: number[][] = [];
  const o = online as unknown as { cola: Map<number, unknown>; abrirSala: (g: { u: number }[]) => void; emparejar: () => void };
  o.abrirSala = (g) => { abiertas.push(g.map((e) => e.u).sort()); };
  const meter = (u: number, desde: number, indice: number) =>
    o.cola.set(u, { u, nombre: `j${u}`, desde, indice, tipo: "casual", rating: 0, fuerza: { 500: 30, 1500: 95 } });
  meter(1, 0, 1.8); meter(2, 3000, 2.0);          // dos amigos con el Criollo inicial
  t = 8000; o.emparejar();
  assert.equal(abiertas.length, 0, "antes de los 15 s espera a que entren todos");
  meter(3, 9000, 9.5);                             // el tercero, con un caballo de linaje mucho más fuerte, entra después
  t = cfg.esperaSeg * 1000; o.emparejar();
  assert.deepEqual(abiertas, [[1, 2, 3]], "los tres en la misma carrera");
});
