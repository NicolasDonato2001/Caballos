// Clanes y guerras (Fase 9, GDD §14): reglas puras. El servidor (server/clanes.ts) guarda los clanes y corre las guerras.
import cfg from "../../config/balance/clanes.json" with { type: "json" };

export const CLANES = cfg;
export type Rol = "lider" | "oficial" | "miembro";
export const NOMBRE_ROL: Record<Rol, string> = { lider: "Líder", oficial: "Oficial", miembro: "Miembro" };

export function validarNombreClan(nombre: string): { ok: true } | { ok: false; motivo: string } {
  const n = nombre.trim();
  if (n.length < cfg.nombre.minimo || n.length > cfg.nombre.maximo) return { ok: false, motivo: `El nombre del clan tiene que tener entre ${cfg.nombre.minimo} y ${cfg.nombre.maximo} letras.` };
  if (!/^[\p{L}\p{N} '._-]+$/u.test(n)) return { ok: false, motivo: "El nombre solo puede tener letras, números, espacios y . _ - '" };
  return { ok: true };
}

/** Puntos de un puesto (1 = primero). */
export const puntosDePuesto = (puesto: number): number => cfg.puntos[puesto - 1] ?? 0;

/** Elo (§14): probabilidad esperada y cambio. resultado: 1 ganó, 0,5 empató, 0 perdió. */
export function esperado(a: number, b: number): number { return 1 / (1 + Math.pow(10, (b - a) / 400)); }
export function nuevoElo(a: number, b: number, resultado: 0 | 0.5 | 1): number { return a + cfg.elo.k * (resultado - esperado(a, b)); }

/** Ventana de Elo para emparejar: ±150 que se abre hasta ±400 a los 30 minutos. */
export function ventanaElo(esperaMs: number): number {
  const e = cfg.emparejamiento, f = Math.min(1, esperaMs / (e.abrirEnMin * 60_000));
  return e.ventana + (e.ventanaMax - e.ventana) * f;
}

/** Puntos de cada clan en una carrera: por el puesto de cada caballo de clan (los bots no suman). */
export function puntosCarrera(puestosPorClan: { clan: number; puesto: number }[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const x of puestosPorClan) m.set(x.clan, (m.get(x.clan) ?? 0) + puntosDePuesto(x.puesto));
  return m;
}
