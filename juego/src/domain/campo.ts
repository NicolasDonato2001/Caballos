// Campo 2.0 (GDD §24.4): la parcela y dónde está cada pieza del establecimiento. El jugador puede mover y girar los
// edificios, el potrero y el molino; los caminos se rehacen solos desde el patio. Reglas puras y testeables.
import cfg from "../../config/balance/campo.json" with { type: "json" };
import type { Partida } from "./partida.ts";
import { celdasDe, CELDA, decoracionDe } from "./decoracion.ts";
import { mover } from "./economia.ts";

type Resultado = { ok: true; guardados: number } | { ok: false; motivo: string };
const no = (motivo: string): Resultado => ({ ok: false, motivo });

export type Pieza = "establo" | "entrenamiento" | "recuperacion" | "potrero" | "molino";
export const PIEZAS: Pieza[] = ["establo", "entrenamiento", "recuperacion", "potrero", "molino"];
export const NOMBRE_PIEZA: Record<Pieza, string> = {
  establo: "Establo", entrenamiento: "Centro de entrenamiento", recuperacion: "Centro de recuperación", potrero: "Potrero", molino: "Molino y tanque",
};
export interface Ubicacion { x: number; z: number; rot: 0 | 1 | 2 | 3; }
export type Disposicion = Record<Pieza, Ubicacion>;
export interface Rect { x: number; z: number; w: number; h: number; }

export const ANCHO = cfg.ancho, ALTO = cfg.alto;
export const PATIO = cfg.patio;
export const NATURALES = cfg.naturales;
export const DISPOSICION_INICIAL = cfg.disposicionInicial as Disposicion;

export function disposicionDe(p: Partida): Disposicion {
  return { ...DISPOSICION_INICIAL, ...(p.disposicion ?? {}) } as Disposicion;
}

/** Gira un punto local (x, z) como lo hace Babylon con rotation.y = rot·90°. */
export function girar(x: number, z: number, rot: number): [number, number] {
  const a = rot * Math.PI / 2, c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a));
  return [x * c + z * s, -x * s + z * c];
}

/** Rectángulo (alineado a los ejes) que ocupa una pieza en una ubicación. */
export function rectDe(pieza: Pieza, u: Ubicacion): Rect {
  const h = cfg.huellas[pieza];
  const [dx, dz] = girar(h.dx, h.dz, u.rot);
  const [w, hh] = u.rot % 2 ? [h.h, h.w] : [h.w, h.h];
  return { x: u.x + dx, z: u.z + dz, w, h: hh };
}

const cruzan = (a: Rect, b: Rect, margen = 0) =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 + margen && Math.abs(a.z - b.z) < (a.h + b.h) / 2 + margen;
const tocaCirculo = (r: Rect, x: number, z: number, radio: number) => {
  const cx = Math.max(r.x - r.w / 2, Math.min(x, r.x + r.w / 2)), cz = Math.max(r.z - r.h / 2, Math.min(z, r.z + r.h / 2));
  return Math.hypot(cx - x, cz - z) < radio;
};

/** ¿Puede ir esa pieza ahí? No sale del alambrado, no pisa otra pieza, el patio, la entrada ni la laguna o el ombú. */
export function puedeUbicar(d: Disposicion, pieza: Pieza, u: Ubicacion): { ok: true } | { ok: false; motivo: string } {
  const r = rectDe(pieza, u);
  if (Math.abs(r.x) + r.w / 2 > ANCHO / 2 - 1.5 || Math.abs(r.z) + r.h / 2 > ALTO / 2 - 1.5) return { ok: false, motivo: "Tiene que quedar dentro del alambrado." };
  if (tocaCirculo(r, PATIO.x, PATIO.z, PATIO.r)) return { ok: false, motivo: "Ahí está el patio de la entrada." };
  if (cruzan(r, { x: 0, z: -ALTO / 2 + (PATIO.z + ALTO / 2) / 2, w: 4, h: PATIO.z + ALTO / 2 })) return { ok: false, motivo: "Taparía el camino de la entrada." };
  for (const n of NATURALES) if (tocaCirculo(r, n.x, n.z, n.r)) return { ok: false, motivo: `Ahí está ${n.nombre === "laguna" ? "la laguna" : "el ombú"}.` };
  for (const otra of PIEZAS) if (otra !== pieza && cruzan(r, rectDe(otra, d[otra]), 1)) return { ok: false, motivo: `Se pisa con ${NOMBRE_PIEZA[otra].toLowerCase()}.` };
  return { ok: true };
}

/** Mueve o gira una pieza. Los adornos que queden debajo pasan al depósito (se vuelven a poner gratis). */
export function moverPieza(p: Partida, pieza: Pieza, u: Ubicacion): Resultado {
  const d = disposicionDe(p);
  const r = puedeUbicar(d, pieza, u);
  if (!r.ok) return no(r.motivo);
  const rect = rectDe(pieza, u);
  const deco = decoracionDe(p);
  let guardados = 0;
  deco.puestos = deco.puestos.filter((q) => {
    const debajo = celdasDe(q.id, q.cx, q.cz, q.rot).some(([x, z]) =>
      cruzan(rect, { x: (x + 0.5) * CELDA, z: (z + 0.5) * CELDA, w: CELDA, h: CELDA }));
    if (debajo) { deco.deposito[q.id] = (deco.deposito[q.id] ?? 0) + 1; guardados++; }
    return !debajo;
  });
  p.disposicion = { ...d, [pieza]: { x: u.x, z: u.z, rot: u.rot } };
  return { ok: true, guardados };
}

/** Caminos de tierra (x1, z1, x2, z2, ancho): la entrada hasta el patio y del patio a la puerta de cada pieza. */
export function caminosDe(d: Disposicion): [number, number, number, number, number][] {
  const r: [number, number, number, number, number][] = [[0, -ALTO / 2 - 2, PATIO.x, PATIO.z, 3.2]];
  for (const [pz, pt] of Object.entries(cfg.puertas) as [Pieza, { puerta: number[]; frente: number[] }][]) {
    const u = d[pz];
    const [fx, fz] = girar(pt.frente[0], pt.frente[1], u.rot), [px, pzz] = girar(pt.puerta[0], pt.puerta[1], u.rot);
    r.push([PATIO.x, PATIO.z, u.x + fx, u.z + fz, 2.6], [u.x + fx, u.z + fz, u.x + px, u.z + pzz, 2.6]);
  }
  return r;
}

// ---- Nombre del establecimiento: el primer cambio es gratis, después cuesta Gemas
export const NOMBRE_CAMPO = cfg.nombre;
export const nombreCampo = (p: Partida) => p.nombreCampo ?? cfg.nombre.porDefecto;
/** Lo que cuesta el próximo cambio de nombre (0 si todavía no se usó el cambio gratis). */
export const costoNombre = (p: Partida) => (p.cambiosNombre ?? 0) === 0 ? 0 : cfg.nombre.gemasCambio;

export function renombrarCampo(p: Partida, nombre: string, ahora: number): Resultado {
  const n = nombre.replace(/\s+/g, " ").trim();
  if (n.length < 2) return no("El nombre tiene que tener al menos 2 letras.");
  if (n.length > cfg.nombre.largoMaximo) return no(`Hasta ${cfg.nombre.largoMaximo} letras.`);
  if (n === nombreCampo(p)) return no("Es el mismo nombre.");
  const costo = costoNombre(p);
  if (p.gemas < costo) return no(`Faltan Gemas: cuesta ${costo}.`);
  if (costo) mover(p, "gemas", -costo, "nombre", ahora);
  p.nombreCampo = n;
  p.cambiosNombre = (p.cambiosNombre ?? 0) + 1;
  return { ok: true, guardados: 0 };
}
