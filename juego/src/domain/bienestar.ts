// Fase 6.5 (GDD §24.2): bienestar del caballo. Carga de trabajo, riesgo de lesión y herraduras.
// La lesión la sortea el simulador con la semilla (sim-0.5.0); acá se calcula la probabilidad y lo que pasa después.
import cfg from "../../config/balance/bienestar.json" with { type: "json" };
import type { Caballo } from "./caballo.ts";
import type { Partida } from "./partida.ts";
import { mover } from "./economia.ts";

type Resultado = { ok: true } | { ok: false; motivo: string };
const no = (motivo: string): Resultado => ({ ok: false, motivo });
const HORA = 3_600_000;

export const BIENESTAR = cfg;
export type TipoHerradura = "aluminio" | "competicion";
export interface Herradura { id: TipoHerradura; nombre: string; descripcion: string; oro?: number; gemas?: number; carreras: number; factor: number; }
export const HERRADURAS = cfg.herraduras as Herradura[];
export const herradura = (id: string) => HERRADURAS.find((h) => h.id === id);

/** Carga actual (0–100): la guardada menos lo que bajó desde la última carrera. */
export function cargaDe(c: Caballo, ahora: number): number {
  if (!c.carga) return 0;
  const horas = Math.max(0, ahora - c.carga.t) / HORA;
  return Math.max(0, c.carga.valor - horas * cfg.carga.bajaPorHora);
}

/** Factor de las herraduras puestas (sin herraduras el riesgo sube). */
export function factorHerraduras(c: Caballo): number {
  return c.herraduras && c.herraduras.carreras > 0 ? (herradura(c.herraduras.id)?.factor ?? 1) : cfg.riesgo.sinHerraduras;
}

/** Probabilidad de lesionarse en la próxima carrera (0–1). */
export function riesgoDe(c: Caballo, ahora: number): number {
  const k = cargaDe(c, ahora) / cfg.carga.maximo;
  return (cfg.riesgo.base + (cfg.riesgo.maximo - cfg.riesgo.base) * k * k) * factorHerraduras(c);
}

/** Cómo se ve el riesgo en la interfaz. */
export function nivelRiesgo(r: number): "bajo" | "medio" | "alto" {
  return r < 0.006 ? "bajo" : r < 0.02 ? "medio" : "alto";
}

/** Después de correr: suma carga y gasta una carrera de las herraduras. */
export function despuesDeCorrer(c: Caballo, distancia: number, ahora: number): void {
  const suma = distancia >= 1500 ? cfg.carga.porCarrera1500 : cfg.carga.porCarrera500;
  c.carga = { valor: Math.min(cfg.carga.maximo, cargaDe(c, ahora) + suma), t: ahora };
  if (c.herraduras) {
    c.herraduras.carreras -= 1;
    if (c.herraduras.carreras <= 0) delete c.herraduras;
  }
}

// ---- herraduras: se compran en el Mercado (quedan en el inventario) y se ponen desde la ficha

export function comprarHerraduras(p: Partida, id: TipoHerradura, ahora: number): Resultado {
  const h = herradura(id);
  if (!h) return no("No existe ese juego de herraduras.");
  if (h.gemas !== undefined) {
    if (p.gemas < h.gemas) return no(`Faltan Gemas: cuesta ${h.gemas}.`);
    mover(p, "gemas", -h.gemas, "herraduras", ahora, id);
  } else {
    if (p.oro < (h.oro ?? 0)) return no(`Falta Oro: cuesta ${h.oro}.`);
    mover(p, "oro", -(h.oro ?? 0), "herraduras", ahora, id);
  }
  const inv = p.herraduras ?? (p.herraduras = {});
  inv[id] = (inv[id] ?? 0) + 1;
  return { ok: true };
}

/** Herrar: pone un juego del inventario. Si ya tenía, el juego viejo se descarta (se avisa en la interfaz). */
export function herrar(p: Partida, caballoId: string, id: TipoHerradura): Resultado {
  const c = p.caballos.find((x) => x.id === caballoId);
  if (!c) return no("No se encontró el caballo.");
  const inv = p.herraduras ?? {};
  if (!inv[id]) return no("No tenés ese juego de herraduras: se compra en el Mercado.");
  inv[id] -= 1;
  if (!inv[id]) delete inv[id];
  c.herraduras = { id, carreras: herradura(id)!.carreras };
  return { ok: true };
}
