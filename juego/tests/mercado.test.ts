// Pruebas de la Fase 8: mercado entre jugadores y subastas (GDD §12.3 y §12.4).
// Criterio de la fase: sin doble venta ni doble gasto. Además, el Oro cierra exacto: lo que sale es lo que entra más la comisión.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { crearServidor } from "../server/servidor.ts";
import { caballoDeRaza } from "../src/domain/caballo.ts";
import { Rng } from "../src/sim/rng.ts";
import { precioSugerido } from "../src/domain/economia.ts";
import { MERCADO_JUGADORES as C, rangoPrecio } from "../src/domain/mercadoJugadores.ts";

const MIN = 60_000, HORA = 3_600_000, DIA = 86_400_000;

async function conMercado(f: (h: Ayuda) => Promise<void>) {
  const tiempo = { t: 1_800_000_000_000 };
  const { servidor, db, online } = crearServidor({ base: ":memory:", reloj: () => tiempo.t });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const puerto = (servidor.address() as AddressInfo).port;
  const pedir = async (ruta: string, cuerpo?: unknown, token?: string) => {
    const [metodo, camino] = ruta.split(" ");
    const r = await fetch(`http://127.0.0.1:${puerto}${camino}`, { method: metodo,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    return { estado: r.status, datos: await r.json() };
  };
  const rng = new Rng(7);
  const jugadores: Record<string, { token: string; id: number }> = {};
  const nuevo = async (nombre: string, caballos: number, oro: number) => {
    const { datos } = await pedir("POST /api/registro", { nombre, clave: "caballos123" });
    await pedir("POST /api/accion", { nombre: "primerCaballo", args: { nombre: `Primero de ${nombre}`, sexo: "macho" } }, datos.token);
    const id = db.usuarioPorNombre(nombre)!.id;
    const r = db.partida(id)!;
    for (let k = 1; k < caballos; k++) r.partida.caballos.push({ ...caballoDeRaza(rng, { raza: "Árabe" }), id: `c-${nombre}-${k}`, nombre: `${nombre} ${k}` });
    r.partida.oro = oro;
    r.partida.espacios = 20; r.partida.edificios.establo.nivel = 5;
    db.guardarPartida(id, r.partida, r.version, tiempo.t);
    jugadores[nombre] = { token: datos.token, id };
  };
  const partida = (n: string) => db.partida(jugadores[n].id)!.partida;
  const oroTotal = () => Object.keys(jugadores).reduce((s, n) => s + partida(n).oro, 0);
  const h = { pedir, tiempo, nuevo, partida, oroTotal, tok: (n: string) => jugadores[n].token,
    ajustar: (n: string, f: (p: any) => void) => { const r = db.partida(jugadores[n].id)!; f(r.partida); db.guardarPartida(jugadores[n].id, r.partida, r.version, tiempo.t); } };
  try { await f(h); } finally { online.parar(); servidor.close(); db.cerrar(); }
}
type Ayuda = Parameters<Parameters<typeof conMercado>[0]>[0];

test("Venta: rango de precio, caballo bloqueado, compra con comisión y sin doble venta", async () => {
  await conMercado(async ({ pedir, nuevo, partida, oroTotal, tok }) => {
    await nuevo("Ana", 3, 1000); await nuevo("Beto", 1, 100_000); await nuevo("Caro", 1, 100_000);
    const c = partida("Ana").caballos[1];
    const [min, max] = rangoPrecio(c);
    assert.equal(min, Math.ceil(precioSugerido(c) * 0.5 / 10) * 10);
    assert.equal((await pedir("POST /api/mercado/publicar", { caballoId: c.id, tipo: "venta", precio: min - 10 }, tok("Ana"))).estado, 400);
    assert.equal((await pedir("POST /api/mercado/publicar", { caballoId: c.id, tipo: "venta", precio: max + 10 }, tok("Ana"))).estado, 400);
    const pub = await pedir("POST /api/mercado/publicar", { caballoId: c.id, tipo: "venta", precio: min }, tok("Ana"));
    assert.equal(pub.estado, 200, JSON.stringify(pub.datos));
    const id = pub.datos.id;
    assert.equal(partida("Ana").caballos[1].estado, "publicado");
    // Bloqueado: no corre ni se vende al juego
    assert.equal((await pedir("POST /api/accion", { nombre: "venderAlJuego", args: { id: c.id } }, tok("Ana"))).estado, 400);
    // No se puede publicar el último caballo que queda disponible
    const otro = partida("Ana").caballos[2];
    assert.equal((await pedir("POST /api/mercado/publicar", { caballoId: otro.id, tipo: "venta", precio: rangoPrecio(otro)[0] }, tok("Ana"))).estado, 200);
    const ultimo = partida("Ana").caballos[0];
    assert.equal((await pedir("POST /api/mercado/publicar", { caballoId: ultimo.id, tipo: "venta", precio: rangoPrecio(ultimo)[0] }, tok("Ana"))).estado, 400, "el último no");
    // Beto lo ve en el mercado y lo compra; Caro llega tarde
    const lista = (await pedir("GET /api/mercado", undefined, tok("Beto"))).datos;
    assert.ok(lista.activas.some((x: any) => x.id === id && x.vendedor === "Ana"));
    const antes = oroTotal();
    const [r1, r2] = await Promise.all([pedir("POST /api/mercado/comprar", { id }, tok("Beto")), pedir("POST /api/mercado/comprar", { id }, tok("Caro"))]);
    assert.deepEqual([r1.estado, r2.estado].sort(), [200, 400], "uno solo lo compra");
    const ganador = r1.estado === 200 ? "Beto" : "Caro", perdedor = ganador === "Beto" ? "Caro" : "Beto";
    assert.equal(partida(perdedor).oro, 100_000, "al que no lo compró no se le cobra nada");
    assert.equal(partida(ganador).oro, 100_000 - min);
    assert.equal(partida("Ana").oro, 1000 + min - Math.round(min * C.comision));
    assert.equal(oroTotal(), antes - Math.round(min * C.comision), "el Oro solo baja en la comisión");
    const recibido = partida(ganador).caballos.find((x) => x.nombre === c.nombre)!;
    assert.equal(recibido.estado, "disponible");
    assert.equal(recibido.monturaId ?? null, null); assert.equal(recibido.aspecto, undefined);
    assert.equal(partida("Ana").caballos.some((x) => x.id === c.id), false);
    assert.equal(partida(ganador).comprasMercado!.length, 1);
    assert.equal((await pedir("POST /api/mercado/comprar", { id }, tok(perdedor))).estado, 400);
    assert.equal((await pedir("POST /api/mercado/comprar", { id: (await pedir("GET /api/mercado", undefined, tok("Ana"))).datos.mias.find((x: any) => x.estado === "activa").id }, tok("Ana"))).estado, 400, "no a sí mismo");
  });
});

test("Subasta: pujas que reservan Oro y lugar, devoluciones, extensión al final y adjudicación", async () => {
  await conMercado(async ({ pedir, nuevo, partida, oroTotal, tok, tiempo }) => {
    await nuevo("Ana", 2, 0); await nuevo("Beto", 1, 50_000); await nuevo("Caro", 1, 50_000);
    const c = partida("Ana").caballos[1];
    const [min, max] = rangoPrecio(c);
    assert.equal((await pedir("POST /api/mercado/publicar", { caballoId: c.id, tipo: "subasta", precio: min, duracionMin: 45 }, tok("Ana"))).estado, 400, "duración no válida");
    const { datos } = await pedir("POST /api/mercado/publicar", { caballoId: c.id, tipo: "subasta", precio: min, duracionMin: 30 }, tok("Ana"));
    const id = datos.id;
    const total = oroTotal();
    assert.equal((await pedir("POST /api/mercado/comprar", { id }, tok("Beto"))).estado, 400, "una subasta no se compra directo");
    assert.equal((await pedir("POST /api/mercado/pujar", { id, monto: min - 10 }, tok("Beto"))).estado, 400);
    assert.equal((await pedir("POST /api/mercado/pujar", { id, monto: min }, tok("Beto"))).estado, 200);
    assert.equal(partida("Beto").oro, 50_000 - min);
    assert.deepEqual(partida("Beto").pujasMercado, [{ pub: id, monto: min }]);
    assert.equal((await pedir("POST /api/mercado/pujar", { id, monto: min + 1000 }, tok("Beto"))).estado, 400, "ya va ganando");
    const sig = (await pedir("GET /api/mercado", undefined, tok("Caro"))).datos.activas.find((x: any) => x.id === id).minimaPuja;
    assert.equal(sig, Math.ceil((min + Math.max(50, min * 0.05)) / 10) * 10);
    assert.equal((await pedir("POST /api/mercado/pujar", { id, monto: sig - 10 }, tok("Caro"))).estado, 400);
    assert.equal((await pedir("POST /api/mercado/pujar", { id, monto: max + 10 }, tok("Caro"))).estado, 400, "no más del 300 %");
    assert.equal((await pedir("POST /api/mercado/pujar", { id, monto: sig }, tok("Caro"))).estado, 200);
    assert.equal(partida("Beto").oro, 50_000, "a Beto se le devolvió todo");
    assert.equal(partida("Beto").pujasMercado!.length, 0);
    assert.equal(partida("Caro").oro, 50_000 - sig);
    const reservado = () => ["Beto", "Caro"].reduce((t, n) => t + (partida(n).pujasMercado ?? []).reduce((q, x) => q + x.monto, 0), 0);
    assert.equal(oroTotal() + reservado(), total, "mientras dura, el Oro solo está reservado (saldos + reservas = lo que había)");
    assert.equal((await pedir("POST /api/mercado/cancelar", { id }, tok("Ana"))).estado, 400, "con ofertas no se cancela");
    // Beto puja a 30 s del final: la subasta se estira 2 minutos desde esa puja
    tiempo.t += 30 * MIN - 30_000;
    const sig2 = (await pedir("GET /api/mercado", undefined, tok("Beto"))).datos.activas.find((x: any) => x.id === id).minimaPuja;
    assert.equal((await pedir("POST /api/mercado/pujar", { id, monto: sig2 }, tok("Beto"))).estado, 200);
    tiempo.t += 60_000;
    assert.ok((await pedir("GET /api/mercado", undefined, tok("Caro"))).datos.activas.some((x: any) => x.id === id), "sigue abierta por la extensión");
    assert.equal(partida("Caro").oro, 50_000);
    tiempo.t += 2 * MIN;
    const fin = (await pedir("GET /api/mercado", undefined, tok("Ana"))).datos;
    assert.equal(fin.activas.some((x: any) => x.id === id), false);
    assert.equal(fin.mias.find((x: any) => x.id === id).estado, "vendida");
    assert.equal(fin.mias.find((x: any) => x.id === id).comprador, "Beto");
    assert.ok(partida("Beto").caballos.some((x) => x.nombre === c.nombre));
    assert.equal(partida("Beto").pujasMercado!.length, 0);
    assert.equal(partida("Ana").oro, sig2 - Math.round(sig2 * C.comision));
    assert.equal(oroTotal(), total - Math.round(sig2 * C.comision));
  });
});

test("Sin ofertas o sin comprador, el caballo vuelve; una venta se puede cancelar", async () => {
  await conMercado(async ({ pedir, nuevo, partida, tok, tiempo }) => {
    await nuevo("Ana", 4, 0);
    const [a, b, c] = partida("Ana").caballos.slice(1);
    const ids: string[] = [];
    for (const [x, tipo] of [[a, "venta"], [b, "subasta"], [c, "venta"]] as const)
      ids.push((await pedir("POST /api/mercado/publicar", { caballoId: x.id, tipo, precio: rangoPrecio(x)[0], duracionMin: 30 }, tok("Ana"))).datos.id);
    assert.equal(partida("Ana").caballos.filter((x) => x.estado === "publicado").length, 3);
    assert.equal((await pedir("POST /api/mercado/cancelar", { id: ids[2] }, tok("Ana"))).estado, 200);
    assert.equal(partida("Ana").caballos.find((x) => x.id === c.id)!.estado, "disponible");
    tiempo.t += 31 * MIN;
    await pedir("GET /api/mercado", undefined, tok("Ana"));
    assert.equal(partida("Ana").caballos.find((x) => x.id === b.id)!.estado, "disponible", "subasta sin ofertas");
    assert.equal(partida("Ana").caballos.find((x) => x.id === a.id)!.estado, "publicado", "la venta dura 24 h");
    tiempo.t += C.duracionVentaHoras * HORA;
    const l = (await pedir("GET /api/mercado", undefined, tok("Ana"))).datos;
    assert.equal(partida("Ana").caballos.find((x) => x.id === a.id)!.estado, "disponible");
    assert.deepEqual(l.mias.map((x: any) => x.estado).sort(), ["cancelada", "sin_ofertas", "vencida"]);
    assert.equal(partida("Ana").oro, 0, "nada cuesta si no se vende");
  });
});

test("Límites: 3 compras cada 7 días (las subastas que vas ganando cuentan) y lugar en el establo", async () => {
  await conMercado(async ({ pedir, nuevo, partida, tok, tiempo, ajustar }) => {
    await nuevo("Ana", 6, 0); await nuevo("Beto", 1, 1_000_000);
    const venta = async (_k: number, tipo = "venta") => {
      const x = partida("Ana").caballos.find((y, i) => i > 0 && y.estado === "disponible")!;
      return (await pedir("POST /api/mercado/publicar", { caballoId: x.id, tipo, precio: rangoPrecio(x)[0], duracionMin: 30 }, tok("Ana"))).datos.id as string;
    };
    const p1 = await venta(1), p2 = await venta(2), s3 = await venta(3, "subasta");
    assert.equal((await pedir("POST /api/mercado/comprar", { id: p1 }, tok("Beto"))).estado, 200);
    assert.equal((await pedir("POST /api/mercado/comprar", { id: p2 }, tok("Beto"))).estado, 200);
    const min3 = (await pedir("GET /api/mercado", undefined, tok("Beto"))).datos.activas.find((x: any) => x.id === s3).minimaPuja;
    assert.equal((await pedir("POST /api/mercado/pujar", { id: s3, monto: min3 }, tok("Beto"))).estado, 200, "tercera: va ganando una subasta");
    const p4 = await venta(1);
    const r = await pedir("POST /api/mercado/comprar", { id: p4 }, tok("Beto"));
    assert.equal(r.estado, 400); assert.match(r.datos.motivo, /3 compras/);
    // A los 7 días se libera
    tiempo.t += 7 * DIA + MIN;
    await pedir("GET /api/mercado", undefined, tok("Beto"));          // cierra la subasta (Beto la gana: 3.ª compra, hoy)
    assert.equal(partida("Beto").comprasMercado!.length, 1, "las de hace más de 7 días ya no cuentan");
    const p5 = await venta(2);
    // Sin lugar en el establo no compra
    ajustar("Beto", (p) => { p.espacios = p.caballos.length; p.edificios.establo.nivel = 5; });
    const sinLugar = await pedir("POST /api/mercado/comprar", { id: p5 }, tok("Beto"));
    assert.equal(sinLugar.estado, 400); assert.match(sinLugar.datos.motivo, /lugar/);
  });
});
