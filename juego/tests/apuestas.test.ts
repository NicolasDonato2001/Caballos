// Pruebas de la Fase 7.4: apuestas de pozo común con Oro.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { APUESTAS, cuotas, liquidar, validarApuesta, cobrarApuesta, disponibleHoy } from "../src/domain/apuestas.ts";
import { partidaNueva } from "../src/domain/partida.ts";
import { crearServidor } from "../server/servidor.ts";
import { simulateRace } from "../src/sim/race.ts";
import { PARAMS } from "../server/carrera.ts";

const suma = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);

test("pozo común: los que aciertan se reparten el pozo menos la comisión, en proporción a lo apostado", () => {
  // 1 y 2 apuestan al jugador 10; 3 y 4 al 20. Gana el 10.
  const ap = [{ u: 1, en: 10, monto: 100 }, { u: 2, en: 10, monto: 300 }, { u: 3, en: 20, monto: 400 }, { u: 4, en: 20, monto: 200 }];
  const l = liquidar(ap, 10);
  assert.ok(Math.abs(l.dividendo! - 1000 * 0.9 / 400) < 1e-12);      // 2,25 por cada 1
  assert.equal(l.pagos.get(1), 225); assert.equal(l.pagos.get(2), 675);
  assert.equal(l.pagos.get(3), 0); assert.equal(l.pagos.get(4), 0);
  assert.equal(suma(l.pagos) + l.comision, 1000, "el Oro no se crea ni se pierde: pagos + comisión = pozo");
  assert.equal(l.comision, 100);
  assert.ok(Math.abs(cuotas(ap).get(20)! - 1.5) < 1e-12);
});

test("si todos aciertan, cada uno recupera lo suyo; si nadie acierta, se devuelve todo", () => {
  const todos = liquidar([{ u: 1, en: 10, monto: 100 }, { u: 2, en: 10, monto: 50 }], 10);
  assert.equal(todos.pagos.get(1), 100); assert.equal(todos.pagos.get(2), 50); assert.equal(todos.comision, 0);
  const nadie = liquidar([{ u: 1, en: 10, monto: 100 }, { u: 2, en: 20, monto: 50 }], 30);
  assert.equal(nadie.devuelto, true); assert.equal(nadie.dividendo, null);
  assert.equal(nadie.pagos.get(1), 100); assert.equal(nadie.pagos.get(2), 50);
  const sinGanador = liquidar([{ u: 1, en: 10, monto: 100 }], null);
  assert.equal(sinGanador.pagos.get(1), 100);
});

test("al que no larga se le devuelven las apuestas hechas a él, fuera del pozo", () => {
  const l = liquidar([{ u: 1, en: 10, monto: 100 }, { u: 2, en: 20, monto: 100 }, { u: 3, en: 30, monto: 200 }], 20, new Set([10]));
  assert.equal(l.pagos.get(1), 100, "devuelta");
  assert.equal(l.pagos.get(2), Math.floor(100 * 300 * 0.9 / 100), "pozo de 300 sin la apuesta devuelta");
  assert.equal(l.pagos.get(3), 0);
  assert.equal(suma(l.pagos) + l.comision, 400);
});

test("topes: mínima, por carrera, por día y saldo", () => {
  const p = partidaNueva(0);
  p.oro = 10_000;
  assert.equal(validarApuesta(p, APUESTAS.minima - 1, 0).ok, false);
  assert.equal(validarApuesta(p, APUESTAS.maximaPorCarrera + 1, 0).ok, false);
  assert.equal(validarApuesta(p, 12.5, 0).ok, false);
  for (let k = 0; k < APUESTAS.maximaPorDia / APUESTAS.maximaPorCarrera; k++) assert.equal(cobrarApuesta(p, APUESTAS.maximaPorCarrera, 0, "x").ok, true);
  assert.equal(disponibleHoy(p, 0), 0);
  assert.equal(validarApuesta(p, APUESTAS.minima, 0).ok, false, "tope diario");
  assert.equal(p.oro, 10_000 - APUESTAS.maximaPorDia);
  assert.equal(p.ledger![0].motivo, "apuesta");
  assert.equal(validarApuesta(p, APUESTAS.minima, 2 * 86_400_000).ok, true, "al otro día se puede de nuevo");
  p.oro = 5;
  assert.equal(validarApuesta(p, APUESTAS.minima, 2 * 86_400_000).ok, false, "sin saldo");
});

test("Online: dos jugadores apuestan durante la sala y el pozo se paga según la carrera", async () => {
  const { servidor, db, online } = crearServidor({ base: ":memory:", online: { esperaSeg: 0, eleccionSeg: 2, cuentaRegresivaSeg: 1 } });
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
    const js = [];
    for (const nombre of ["Ana", "Beto"]) {
      const { datos } = await pedir("POST /api/registro", { nombre, clave: "caballos123" });
      await pedir("POST /api/accion", { nombre: "primerCaballo", args: { nombre: `Caballo de ${nombre}`, sexo: "macho" } }, datos.token);
      const p = (await pedir("GET /api/partida", undefined, datos.token)).datos.partida;
      js.push({ nombre, token: datos.token, oro: p.oro, oyente: escuchar(datos.token) });
    }
    await esperar(() => js.every((j) => j.oyente.eventos.some((e) => e.evento === "estado")));
    assert.equal((await pedir("POST /api/online/apostar", { en: "Ana", monto: 100 }, js[0].token)).estado, 400, "sin sala no se apuesta");
    for (const j of js) assert.equal((await pedir("POST /api/online/cola", { tipo: "casual" }, j.token)).estado, 200);
    await esperar(() => js.every((j) => j.oyente.eventos.some((e) => e.evento === "sala")));
    // Ana apuesta 100 a sí misma; Beto 300 a sí mismo. Nadie elige caballo: larga cuando vence el tiempo.
    const a = await pedir("POST /api/online/apostar", { en: "Ana", monto: 100 }, js[0].token);
    assert.equal(a.estado, 200); assert.equal(a.datos.partida.oro, js[0].oro - 100);
    assert.equal((await pedir("POST /api/online/apostar", { en: "Beto", monto: 50 }, js[0].token)).estado, 400, "una apuesta por carrera");
    assert.equal((await pedir("POST /api/online/apostar", { en: "Nadie", monto: 50 }, js[1].token)).estado, 400);
    assert.equal((await pedir("POST /api/online/apostar", { en: "Beto", monto: 300 }, js[1].token)).estado, 200);
    await esperar(() => js[1].oyente.eventos.some((e) => e.evento === "sala" && e.datos.sala.pozo === 400));
    const vista = js[1].oyente.eventos.filter((e) => e.evento === "sala").at(-1)!.datos.sala;
    assert.deepEqual(vista.miApuesta, { en: "Beto", monto: 300 });
    assert.equal(vista.jugadores.find((x: any) => x.nombre === "Ana").pozo, 100);
    assert.ok(Math.abs(vista.jugadores.find((x: any) => x.nombre === "Ana").cuota - 3.6) < 1e-9, "400 · 0,9 / 100");
    await esperar(() => js.every((j) => j.oyente.eventos.some((e) => e.evento === "carrera")));
    const c = js.map((j) => j.oyente.eventos.find((e) => e.evento === "carrera")!.datos);
    const res = simulateRace(c[0].setup.input, PARAMS);
    const iA = c[0].setup.playerIndex, iB = c[1].setup.playerIndex;
    const termino = (i: number) => !res.injured.includes(i);
    const ganaAna = termino(iA) && res.order.indexOf(iA) < res.order.indexOf(iB);
    const ganaBeto = termino(iB) && !ganaAna;
    // Pozo 400, comisión 10 %: si gana Ana cobra 100 · 3,6 = 360; si gana Beto cobra 300 · 1,2 = 360; si no terminó ninguno, se devuelve
    const esperado = ganaAna ? [360, 0] : ganaBeto ? [0, 360] : [100, 300];
    assert.equal(c[0].cobro.apuesta.pago, esperado[0]); assert.equal(c[1].cobro.apuesta.pago, esperado[1]);
    for (const [k, j] of js.entries())
      assert.equal(c[k].partida.oro, j.oro - [100, 300][k] + esperado[k] + c[k].cobro.oro + c[k].cobro.bonoTutorial, "Oro final = inicial − apuesta + cobro + premio");
    assert.ok(!c[0].cobro.rating, "Online casual no toca el rating");
    for (const j of js) j.oyente.cerrar();
  } finally {
    online.parar(); servidor.closeAllConnections?.(); servidor.close(); db.cerrar();
  }
});
