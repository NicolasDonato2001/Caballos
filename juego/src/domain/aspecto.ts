// Aspecto (skins) con Gemas (GDD §24.1): crin y cola, cascos y manta del caballo, y color del cuero de cada montura.
// Solo es visual: no cambia atributos, no se hereda (el pelaje genético sigue igual debajo) y respeta «Pay to Fast,
// nunca Pay to Win». Una compra queda disponible para todos los caballos o monturas del establo.
import cfg from "../../config/balance/aspecto.json" with { type: "json" };
import type { Caballo } from "./caballo.ts";
import type { Partida } from "./partida.ts";
import { mover } from "./economia.ts";

type Resultado = { ok: true } | { ok: false; motivo: string };
const no = (motivo: string): Resultado => ({ ok: false, motivo });
const si: Resultado = { ok: true };

export type TipoAspecto = "crin" | "cascos" | "manta" | "montura";
export interface ObjetoAspecto { id: string; tipo: TipoAspecto; nombre: string; color: string; gemas: number; }
export const ASPECTOS = cfg.objetos as ObjetoAspecto[];
export const COLOR_MONTURA = cfg.monturaPorDefecto;
export const aspecto = (id?: string | null) => (id ? ASPECTOS.find((a) => a.id === id) : undefined);
export const NOMBRE_TIPO: Record<TipoAspecto, string> = { crin: "Crin y cola", cascos: "Cascos", manta: "Manta", montura: "Cuero de la montura" };

/** Lo que el caballo lleva puesto (ids del catálogo). */
export interface AspectoCaballo { crin?: string; cascos?: string; manta?: string; }

export const tiene = (p: Partida, id: string) => (p.aspectos ?? []).includes(id);

export function comprarAspecto(p: Partida, id: string, ahora: number): Resultado {
  const a = aspecto(id);
  if (!a) return no("No existe ese aspecto.");
  if (tiene(p, id)) return no("Ya lo tenés.");
  if (p.gemas < a.gemas) return no(`Hacen falta ${a.gemas} Gemas.`);
  mover(p, "gemas", -a.gemas, "aspecto", ahora, id);
  (p.aspectos ??= []).push(id);
  return si;
}

/** Pone o saca (id null) un aspecto de crin, cascos o manta a un caballo. */
export function vestirCaballo(p: Partida, caballoId: string, tipo: "crin" | "cascos" | "manta", id: string | null): Resultado {
  const c = p.caballos.find((x) => x.id === caballoId);
  if (!c) return no("No se encontró el caballo.");
  if (id !== null) {
    const a = aspecto(id);
    if (!a || a.tipo !== tipo) return no("Ese aspecto no va ahí.");
    if (!tiene(p, id)) return no("Primero compralo en el Mercado.");
  }
  const v = { ...(c.aspecto ?? {}) };
  if (id === null) delete v[tipo]; else v[tipo] = id;
  c.aspecto = v;
  return si;
}

/** Cambia el cuero de una montura del inventario; el caballo que la lleva se ve con ese color. */
export function pintarMontura(p: Partida, monturaId: string, id: string | null): Resultado {
  const m = p.monturas?.find((x) => x.id === monturaId);
  if (!m) return no("No tenés esa montura.");
  if (id !== null) {
    const a = aspecto(id);
    if (!a || a.tipo !== "montura") return no("Ese aspecto no va en una montura.");
    if (!tiene(p, id)) return no("Primero compralo en el Mercado.");
  }
  if (id === null) delete m.color; else m.color = id;
  for (const c of p.caballos) if (c.monturaId === m.id) { if (id) c.monturaColor = id; else delete c.monturaColor; }
  return si;
}

/** Colores (hex) con los que se dibuja el caballo; la montura solo si lleva una puesta. */
export type Colores = { crin?: string; cascos?: string; manta?: string; montura?: string };
export function coloresDe(c: Caballo, _p?: Partida): Colores {
  const r: Colores = {};
  for (const t of ["crin", "cascos", "manta"] as const) { const a = aspecto(c.aspecto?.[t]); if (a) r[t] = a.color; }
  if (c.monturaId) r.montura = aspecto(c.monturaColor)?.color ?? COLOR_MONTURA;
  return r;
}
