// Apuestas de pozo común (Fase 7.4, GDD §24.5). Todo lo apostado en una carrera va a un pozo; el juego se queda la
// comisión y el resto se reparte entre los que acertaron, en proporción a lo que apostó cada uno. El Oro no se crea:
// solo pasa de unos jugadores a otros (menos la comisión). Reglas puras: el servidor las usa en server/online.ts.
import cfg from "../../config/balance/apuestas.json" with { type: "json" };
import type { Partida } from "./partida.ts";
import { diarioDe, mover } from "./economia.ts";

export const APUESTAS = cfg;
/** Una apuesta: quién (u), a qué jugador (en) y cuánto. */
export interface Apuesta { u: number; en: number; monto: number; }

/** Lo que le queda por apostar hoy a un jugador. */
export function disponibleHoy(p: Partida, ahora: number): number {
  return Math.max(0, cfg.maximaPorDia - (diarioDe(p, ahora).apostado ?? 0));
}

export function validarApuesta(p: Partida, monto: number, ahora: number): { ok: true } | { ok: false; motivo: string } {
  if (!Number.isInteger(monto) || monto < cfg.minima) return { ok: false, motivo: `La apuesta mínima es ${cfg.minima} Oro.` };
  if (monto > cfg.maximaPorCarrera) return { ok: false, motivo: `Se pueden apostar hasta ${cfg.maximaPorCarrera} Oro por carrera.` };
  const resta = disponibleHoy(p, ahora);
  if (monto > resta) return { ok: false, motivo: resta ? `Hoy podés apostar ${resta} Oro más.` : "Ya llegaste al tope de apuestas de hoy." };
  if (p.oro < monto) return { ok: false, motivo: "No te alcanza el Oro." };
  return { ok: true };
}

/** Descuenta la apuesta (queda en el pozo hasta que se liquida). */
export function cobrarApuesta(p: Partida, monto: number, ahora: number, ref: string): { ok: true } | { ok: false; motivo: string } {
  const v = validarApuesta(p, monto, ahora);
  if (!v.ok) return v;
  const d = diarioDe(p, ahora);
  d.apostado = (d.apostado ?? 0) + monto;
  mover(p, "oro", -monto, "apuesta", ahora, ref);
  return v;
}

export function pagarApuesta(p: Partida, pago: number, ahora: number, ref: string, motivo = "apuesta ganada"): void {
  if (pago > 0) mover(p, "oro", pago, motivo, ahora, ref);
}

/** Dividendo por cada 1 de Oro apostado a cada jugador si ganara (lo que muestra la pizarra antes de largar). */
export function cuotas(apuestas: readonly Apuesta[]): Map<number, number> {
  const total = apuestas.reduce((s, a) => s + a.monto, 0);
  const por = new Map<number, number>();
  for (const a of apuestas) por.set(a.en, (por.get(a.en) ?? 0) + a.monto);
  return new Map([...por].map(([en, w]) => [en, dividendo(total, w)]));
}
const dividendo = (total: number, aGanador: number) => Math.max(1, total * (1 - cfg.comision) / aGanador);

export interface Liquidacion {
  /** Lo que cobra cada apostador (0 si perdió). */ pagos: Map<number, number>;
  /** Dividendo pagado por cada 1 de Oro (null si se devolvió todo). */ dividendo: number | null;
  /** Lo que se queda el juego. */ comision: number;
  devuelto: boolean;
}

/**
 * Reparte el pozo. `ganador`: el jugador que llegó primero entre los jugadores (null si ninguno terminó).
 * `retirados`: los que no largaron; las apuestas a ellos se devuelven y no entran al pozo.
 */
export function liquidar(apuestas: readonly Apuesta[], ganador: number | null, retirados: ReadonlySet<number> = new Set()): Liquidacion {
  const pagos = new Map<number, number>();
  const validas: Apuesta[] = [];
  for (const a of apuestas) {
    if (retirados.has(a.en)) pagos.set(a.u, (pagos.get(a.u) ?? 0) + a.monto);
    else validas.push(a);
  }
  const total = validas.reduce((s, a) => s + a.monto, 0);
  const aGanador = ganador === null ? 0 : validas.filter((a) => a.en === ganador).reduce((s, a) => s + a.monto, 0);
  if (!aGanador) {            // nadie acertó (o no hubo ganador): se devuelve todo, sin comisión
    for (const a of validas) pagos.set(a.u, (pagos.get(a.u) ?? 0) + a.monto);
    return { pagos, dividendo: null, comision: 0, devuelto: validas.length > 0 };
  }
  const div = dividendo(total, aGanador);
  let pagado = 0;
  for (const a of validas) {
    const pago = a.en === ganador ? Math.floor(a.monto * div) : 0;
    pagado += pago;
    pagos.set(a.u, (pagos.get(a.u) ?? 0) + pago);
  }
  return { pagos, dividendo: div, comision: total - pagado, devuelto: false };
}
