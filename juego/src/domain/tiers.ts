// Tiers de caballos y emparejamiento por tier contra la IA (GDD §24.3, §13).
// El índice sale de la tabla de regresión del simulador (tools/regresion.ts → config/balance/regresion.json).
import reg from "../../config/balance/regresion.json" with { type: "json" };
import cfg from "../../config/balance/tiers.json" with { type: "json" };
import type { Rng } from "../sim/rng.ts";
import { atributos, caballoDeRaza, type Caballo } from "./caballo.ts";

export type TipoTier = "bronce" | "plata" | "oro" | "platino" | "diamante";
export interface Tier { id: TipoTier; nombre: string; desde: number; color: string; }
export const TIERS = cfg.tiers as Tier[];

/** Tiempo esperado (s) en una distancia según los atributos efectivos. */
export function tiempoEsperado(attrs: readonly number[], distancia: 500 | 1500): number {
  const c = reg.coef[String(distancia) as "500" | "1500"];
  const x = [1, ...attrs.map((v) => v / 100), ...attrs.map((v) => (v / 100) ** 2)];
  return x.reduce((s, v, i) => s + v * c[i], 0);
}

/** Índice de fuerza: % más rápido que un caballo de 60 en todo, promedio de las dos distancias. */
export function indiceDe(attrs: readonly number[]): number {
  let s = 0;
  for (const d of [500, 1500] as const) { const r = tiempoEsperado(cfg.referencia, d); s += ((r - tiempoEsperado(attrs, d)) / r) * 100; }
  return s / 2;
}

export function tierDeIndice(i: number): Tier {
  let t = TIERS[0];
  for (const x of TIERS) if (i >= x.desde) t = x;
  return t;
}
export const tierDe = (c: Caballo) => tierDeIndice(indiceDe(atributos(c)));

/** Rango de índices de un tier (para armar rivales). */
export function rangoTier(t: Tier): [number, number] {
  const k = TIERS.indexOf(t);
  return [k === 0 ? cfg.rivales.minimoBronce : t.desde, TIERS[k + 1]?.desde ?? cfg.rivales.maximoDiamante];
}

/** Hacia dónde apuntan los rivales de un caballo: dentro de su tier y cerca de su índice. */
export function objetivoRivales(c: Caballo, campeonato = false): [number, number] {
  const i = indiceDe(atributos(c));
  const [lo, hi] = rangoTier(tierDeIndice(i));
  const m = cfg.rivales.margen;
  let a = Math.max(lo, i - m), b = Math.min(hi, i + m);
  if (campeonato) { a = Math.min(b, a + cfg.rivales.campeonatoArriba); b = Math.min(hi + cfg.rivales.campeonatoArriba, b + cfg.rivales.campeonatoArriba); }
  return [a, Math.max(a, b)];
}

/** Ajusta un caballo de la IA para que su índice quede cerca del objetivo: entrena (si le falta) o baja sus naturales. */
export function ajustarAIndice(c: Caballo, objetivo: number): void {
  const base = { natural: [...c.natural], entreno: [...c.entreno] };
  const aplicar = (k: number) => {
    c.natural = base.natural.map((v) => (k < 0 ? Math.max(30, v + k) : v));
    c.entreno = base.entreno.map((v, i) => (k > 0 ? Math.min(100 - c.natural[i], v + k) : v));
  };
  let lo = -30, hi = 40;
  for (let it = 0; it < 22; it++) {
    const k = (lo + hi) / 2;
    aplicar(Math.round(k));
    if (indiceDe(atributos(c)) < objetivo) lo = k; else hi = k;
  }
  aplicar(Math.round((lo + hi) / 2));
}

/** Un rival de la IA del tier del jugador. */
export function rivalDeTier(rng: Rng, raza: string, rango: [number, number]): Caballo {
  const c = caballoDeRaza(rng, { raza });
  ajustarAIndice(c, rango[0] + rng.next() * (rango[1] - rango[0]));
  return c;
}
