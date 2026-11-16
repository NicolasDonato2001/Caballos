// Pruebas de la Fase 7.2: dos jugadores se emparejan, eligen caballo, el servidor corre una sola carrera y los dos
// reciben exactamente la misma entrada (y por lo tanto el mismo resultado), con su propio caballo marcado y cobrado.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { crearServidor } from "../server/servidor.ts";
import { PARAMS } from "../server/carrera.ts";
import { simulateRace } from "../src/sim/race.ts";

test("Online: cola → sala → elección → misma carrera para los dos", async () => {
  const { servidor, db, online } = crearServidor({ base: ":memory:", online: { esperaSeg: 0, eleccionSeg: 2, cuentaRegresivaSeg: 1 } });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  const pedir = async (ruta: string, cuerpo?: unknown, token?: string) => {
    const [metodo, camino] = ruta.split(" ");
    const r = await fetch(base + camino, { method: metodo, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    return { estado: r.status, datos: await r.json() };
  };
  // Escucha los eventos de un jugador y devuelve los que llegan
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
    for (const nombre of ["Ana", "Beto"]) {
      const { datos } = await pedir("POST /api/registro", { nombre, clave: "caballos123" });
      await pedir("POST /api/accion", { nombre: "primerCaballo", args: { nombre: `Caballo de ${nombre}`, sexo: "macho" } }, datos.token);
      const p = (await pedir("GET /api/partida", undefined, datos.token)).datos.partida;
      jugadores.push({ nombre, token: datos.token, caballo: p.caballos[0].id, oro: p.oro, oyente: escuchar(datos.token) });
    }
    await esperar(() => jugadores.every((j) => j.oyente.eventos.some((e) => e.evento === "estado")));
    assert.equal((await pedir("POST /api/online/elegir", { caballoId: jugadores[0].caballo, estrategia: "equilibrada" }, jugadores[0].token)).estado, 400, "sin sala todavía");
    for (const j of jugadores) assert.equal((await pedir("POST /api/online/cola", {}, j.token)).estado, 200);
    await esperar(() => jugadores.every((j) => j.oyente.eventos.some((e) => e.evento === "sala")));
    const sala = jugadores[0].oyente.eventos.find((e) => e.evento === "sala")!.datos.sala;
    assert.deepEqual(sala.jugadores.map((x: any) => x.nombre).sort(), ["Ana", "Beto"]);
    assert.ok(sala.distancia === 500 || sala.distancia === 1500);
    // Ana elige; Beto no elige nada (corre con su mejor caballo cuando vence el tiempo)
    assert.equal((await pedir("POST /api/online/elegir", { caballoId: jugadores[0].caballo, estrategia: "agresiva" }, jugadores[0].token)).estado, 200);
    await esperar(() => jugadores.every((j) => j.oyente.eventos.some((e) => e.evento === "carrera")));
    const c0 = jugadores[0].oyente.eventos.find((e) => e.evento === "carrera")!.datos;
    const c1 = jugadores[1].oyente.eventos.find((e) => e.evento === "carrera")!.datos;
    assert.deepEqual(c0.setup.input, c1.setup.input, "los dos reciben la misma carrera");
    assert.equal(c0.inicio, c1.inicio, "y la misma hora de largada");
    assert.notEqual(c0.setup.playerIndex, c1.setup.playerIndex, "cada uno con su caballo");
    assert.equal(c0.setup.entrants[c0.setup.playerIndex].dueno, "Ana");
    assert.equal(c0.setup.input.participants[c0.setup.playerIndex].strategy, "agresiva");
    assert.equal(c0.setup.entrants.length, 8, "bots completan hasta 8");
    // El resultado que cada uno reproduce coincide con lo que el servidor cobró
    const res = simulateRace(c0.setup.input, PARAMS);
    for (const [j, c] of [[jugadores[0], c0], [jugadores[1], c1]] as const) {
      const pos = res.order.indexOf(c.setup.playerIndex) + 1;
      assert.equal(c.partida.historial[0].posicion, pos);
      assert.equal(c.partida.historial[0].modo, "online");
      assert.equal(c.partida.oro, j.oro + c.cobro.oro + c.cobro.bonoTutorial);
      assert.equal(c.partida.caballos[0].estado, "recuperacion");
    }
    // En recuperación no puede volver a la cola
    assert.equal((await pedir("POST /api/online/cola", {}, jugadores[0].token)).estado, 400);
    for (const j of jugadores) j.oyente.cerrar();
  } finally {
    online.parar(); servidor.closeAllConnections?.(); servidor.close(); db.cerrar();
  }
});
