// Carreras offline del lado del servidor (Fase 7.5, GDD §15): entrega tokens firmados y, al sincronizar, repite cada
// carrera con la semilla del token, la valida y la acredita. Las reglas de la carrera están en src/domain/offline.ts.
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Base, FilaToken } from "./db.ts";
import type { Partida } from "../src/domain/partida.ts";
import type { Strategy } from "../src/sim/types.ts";
import { actualizar } from "../src/domain/edificios.ts";
import { diaDe } from "../src/domain/economia.ts";
import { correrConToken, OFFLINE, type TokenCarrera } from "../src/domain/offline.ts";
import { PARAMS } from "./carrera.ts";

const HORA = 3_600_000;

/** Clave secreta para firmar tokens: se crea una vez y queda en server/datos (no se sube a ningún lado). */
export function claveSecreta(ruta?: string): Buffer {
  if (!ruta) return randomBytes(32);                 // pruebas: una clave en memoria
  if (existsSync(ruta)) return Buffer.from(readFileSync(ruta, "utf8").trim(), "hex");
  const k = randomBytes(32);
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, k.toString("hex"), { mode: 0o600 });
  return k;
}

const firmar = (clave: Buffer, t: FilaToken) =>
  createHmac("sha256", clave).update(`${t.id}.${t.usuario}.${t.dia}.${t.seed}.${t.vence}`).digest("base64url");
const firmaValida = (clave: Buffer, t: FilaToken, firma: string) => {
  const a = Buffer.from(firmar(clave, t)), b = Buffer.from(String(firma));
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Entrega tokens hasta completar porDia en hoy y los días siguientes, y devuelve todos los que el jugador tiene libres. */
export function emitirTokens(db: Base, clave: Buffer, usuario: number, ahora: number): TokenCarrera[] {
  const hoy = diaDe(ahora);
  for (let d = hoy; d < hoy + OFFLINE.dias; d++) {
    for (let k = db.tokensDelDia(usuario, d); k < OFFLINE.porDia; k++) {
      db.crearToken({ id: randomBytes(12).toString("base64url"), usuario, dia: d, seed: randomInt(0, 2 ** 32 - 1), emitido: ahora, vence: ahora + OFFLINE.venceHoras * HORA });
    }
  }
  return db.tokensLibres(usuario, ahora).map((t) => ({ id: t.id, dia: t.dia, seed: t.seed, vence: t.vence, firma: firmar(clave, t) }));
}

export interface PedidoOffline { token: { id: string; firma: string }; caballoId: string; estrategia: Strategy; jugadoEn: number; }
export interface ResultadoOffline { tokenId: string; ok: boolean; motivo?: string; posicion?: number; oro?: number; reducido?: boolean; }

/**
 * Sincroniza carreras offline. Primero toma cada token (una sola vez, aunque llegue repetido o en dos pedidos a la vez);
 * después repite las carreras en orden, cada una a su hora, y las registra en la partida.
 * Una carrera que no cuadra (token ajeno, vencido, firma mala, caballo que no podía correr) no cobra y su token se pierde.
 */
export async function sincronizar(db: Base, clave: Buffer, usuario: number, pedidos: PedidoOffline[], ahora: number,
  modificar: <T extends { ok: boolean }>(u: number, f: (p: Partida) => T) => Promise<{ r: T; partida: Partida }>) {
  const resultados: ResultadoOffline[] = [];
  const validos: { fila: FilaToken; pedido: PedidoOffline }[] = [];
  const margen = OFFLINE.margenRelojSeg * 1000;
  const lista = (Array.isArray(pedidos) ? pedidos : []).slice(0, OFFLINE.porDia * (OFFLINE.dias + 2));
  for (const pedido of lista) {
    const id = String(pedido?.token?.id ?? "");
    const fila = db.token(id);
    const jugado = Number(pedido?.jugadoEn);
    const no = (motivo: string) => resultados.push({ tokenId: id, ok: false, motivo });
    if (!fila || fila.usuario !== usuario) { no("Token desconocido."); continue; }
    if (!firmaValida(clave, fila, String(pedido.token.firma ?? ""))) { no("Firma inválida."); continue; }
    if (!Number.isFinite(jugado) || jugado < fila.emitido - margen || jugado > fila.vence || jugado > ahora + margen) { no("La hora de la carrera no cuadra con el token."); continue; }
    if (diaDe(jugado) !== fila.dia) { no("El token era para otro día."); continue; }
    if (ahora > fila.vence + OFFLINE.graciaHoras * HORA) { no("El token venció antes de sincronizar."); continue; }
    if (!db.usarToken(id, usuario)) { no("Ese token ya se usó."); continue; }
    validos.push({ fila, pedido: { ...pedido, jugadoEn: Math.min(jugado, ahora) } });
  }
  validos.sort((a, b) => a.pedido.jugadoEn - b.pedido.jugadoEn);
  const { partida } = await modificar(usuario, (p) => {
    const parciales: ResultadoOffline[] = [];
    for (const { fila, pedido } of validos) {
      actualizar(p, pedido.jugadoEn);
      const r = correrConToken(p, fila, String(pedido.caballoId), pedido.estrategia, pedido.jugadoEn, PARAMS);
      parciales.push(r.ok ? { tokenId: fila.id, ok: true, posicion: r.posicion, oro: r.cobro.oro + r.cobro.bonoTutorial, reducido: r.cobro.reducido }
        : { tokenId: fila.id, ok: false, motivo: r.motivo });
    }
    actualizar(p, ahora);
    resultados.push(...parciales);
    return { ok: true as const };
  });
  return { resultados, partida };
}
