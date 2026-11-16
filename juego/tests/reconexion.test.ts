// El caso del 15/11/2026: un amigo, por el túnel, tocó «Buscar» estando ya en la sala y la pantalla se le cerró.
// Pedir de nuevo no es error, y quien se reconecta (o consulta el estado) recibe la carrera que todavía no vio.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { crearServidor } from "../server/servidor.ts";

test("Online: buscar dos veces no da error y la carrera llega aunque el panel se haya cerrado", async () => {
  const { servidor, db, online } = crearServidor({ base: ":memory:", online: { esperaSeg: 0, eleccionSeg: 1, cuentaRegresivaSeg: 2 } });
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
    const tok: string[] = [];
    for (const nombre of ["Nico", "Luciano"]) {
      const { datos } = await pedir("POST /api/registro", { nombre, clave: "caballos123" });
      await pedir("POST /api/accion", { nombre: "primerCaballo", args: { nombre: `Caballo de ${nombre}`, sexo: "macho" } }, datos.token);
      tok.push(datos.token);
    }
    const nico = escuchar(tok[0]);
    let luciano = escuchar(tok[1]);
    await esperar(() => nico.eventos.length > 0 && luciano.eventos.length > 0);
    for (const t of tok) assert.equal((await pedir("POST /api/online/cola", { tipo: "casual" }, t)).estado, 200);
    assert.equal((await pedir("POST /api/online/cola", { tipo: "casual" }, tok[1])).estado, 200, "tocar dos veces en la cola no es error");
    await esperar(() => luciano.eventos.some((e) => e.evento === "sala"));
    // Ya en la sala, la pantalla de Luciano vuelve a mostrar «Buscar» y lo toca: no hay error, se le recuerda la sala
    const n = luciano.eventos.filter((e) => e.evento === "sala").length;
    assert.equal((await pedir("POST /api/online/cola", { tipo: "casual" }, tok[1])).estado, 200);
    await esperar(() => luciano.eventos.filter((e) => e.evento === "sala").length > n);
    // Se le cierra el panel (se corta su aviso en vivo) y la carrera larga sin él mirando
    luciano.cerrar();
    await esperar(() => nico.eventos.some((e) => e.evento === "carrera"));
    const carreraNico = nico.eventos.find((e) => e.evento === "carrera")!.datos;
    // Al consultar el estado o reconectarse, recibe la misma carrera
    const est = (await pedir("GET /api/online/estado", undefined, tok[1])).datos;
    assert.ok(est.carrera, "la consulta de respaldo trae la carrera");
    assert.deepEqual(est.carrera.setup.input, carreraNico.setup.input);
    assert.equal(est.carrera.sala, carreraNico.sala);
    luciano = escuchar(tok[1]);
    await esperar(() => luciano.eventos.some((e) => e.evento === "carrera"));
    assert.deepEqual(luciano.eventos.find((e) => e.evento === "carrera")!.datos.setup.input, carreraNico.setup.input);
    nico.cerrar(); luciano.cerrar();
  } finally {
    online.parar(); servidor.closeAllConnections?.(); servidor.close(); db.cerrar();
  }
});
