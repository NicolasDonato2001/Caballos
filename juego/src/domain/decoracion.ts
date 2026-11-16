// Decoración del establecimiento (GDD v0.2 §3, §11.5): objetos cosméticos que se compran y se ubican libremente sobre
// una cuadrícula del campo; los edificios tienen lugares fijos. Se pueden rotar, mover o guardar en el depósito
// (lo guardado se vuelve a poner gratis). No dan ninguna ventaja.
// El campo 3D dice qué celdas están ocupadas por lo fijo (edificios, caminos, potrero…); acá se valida el resto.
import cfg from "../../config/balance/decoracion.json" with { type: "json" };
import type { Partida } from "./partida.ts";
import { mover } from "./economia.ts";

type Resultado = { ok: true } | { ok: false; motivo: string };
const no = (motivo: string): Resultado => ({ ok: false, motivo });
const si: Resultado = { ok: true };

export interface ObjetoDeco { id: string; nombre: string; oro?: number; gemas?: number; w: number; h: number; sobreCamino?: boolean; }
/** Lo fijo del campo por celda: "camino" (un portal o una tranquera pueden ir encima) o "fijo" (edificio, potrero…). */
export type Ocupacion = Map<string, "camino" | "fijo">;
export const CATALOGO = cfg.objetos as ObjetoDeco[];
export const CELDA = cfg.celda;
export const LIMITES = cfg.limites;
export const objeto = (id: string) => CATALOGO.find((o) => o.id === id);

/** Un objeto puesto: celda de la esquina (cx, cz) y rotación en cuartos de vuelta. */
export interface Puesto { uid: string; id: string; cx: number; cz: number; rot: 0 | 1 | 2 | 3; }
export interface Decoracion { puestos: Puesto[]; deposito: Record<string, number>; }

export function decoracionDe(p: Partida): Decoracion {
  return (p.decoracion ??= { puestos: [], deposito: {} });
}

/** Rango de celdas válidas (índices enteros). */
export const CELDAS = {
  x0: Math.ceil(LIMITES.x[0] / CELDA), x1: Math.floor(LIMITES.x[1] / CELDA) - 1,
  z0: Math.ceil(LIMITES.z[0] / CELDA), z1: Math.floor(LIMITES.z[1] / CELDA) - 1,
};

/** Celdas que ocupa un objeto en una posición y rotación. */
export function celdasDe(id: string, cx: number, cz: number, rot: number): [number, number][] {
  const o = objeto(id);
  if (!o) return [];
  const [w, h] = rot % 2 ? [o.h, o.w] : [o.w, o.h];
  const r: [number, number][] = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) r.push([cx + i, cz + j]);
  return r;
}
const clave = (x: number, z: number) => `${x},${z}`;

/**
 * ¿Se puede poner ahí? `fijo`: lo que ocupa el campo (edificios, caminos, potrero…). `ignorar`: el objeto que se mueve.
 * Los objetos de entrada (portal, tranquera, faroles) pueden ir sobre los caminos; los tramos de camino puestos por
 * el jugador cuentan como camino.
 */
export function puedePoner(p: Partida, id: string, cx: number, cz: number, rot: number, fijo: Ocupacion, ignorar?: string): Resultado {
  const o = objeto(id);
  if (!o) return no("Objeto desconocido.");
  const ocupadas: Ocupacion = new Map();
  for (const q of decoracionDe(p).puestos) if (q.uid !== ignorar) for (const [x, z] of celdasDe(q.id, q.cx, q.cz, q.rot)) ocupadas.set(clave(x, z), q.id === "camino" ? "camino" : "fijo");
  for (const [x, z] of celdasDe(id, cx, cz, rot)) {
    if (x < CELDAS.x0 || x > CELDAS.x1 || z < CELDAS.z0 || z > CELDAS.z1) return no("Tiene que quedar dentro del alambrado.");
    const f = fijo.get(clave(x, z));
    if (f === "fijo" || (f === "camino" && !o.sobreCamino)) return no(f === "camino" ? "Eso no va sobre el camino." : "Ahí hay un edificio, el potrero, un árbol o el agua.");
    const d = ocupadas.get(clave(x, z));
    if (d === "fijo" || (d === "camino" && !o.sobreCamino)) return no("Ahí ya hay otro objeto.");
  }
  return si;
}

let n = 0;
const nuevoUid = (ahora: number) => `d-${ahora.toString(36)}-${(n = (n + 1) % 1e6)}`;

/** Compra y pone (o pone desde el depósito, gratis, si hay uno guardado). */
export function ponerObjeto(p: Partida, id: string, cx: number, cz: number, rot: 0 | 1 | 2 | 3, fijo: Ocupacion, ahora: number): Resultado {
  const o = objeto(id);
  if (!o) return no("Objeto desconocido.");
  const r = puedePoner(p, id, cx, cz, rot, fijo);
  if (!r.ok) return r;
  const d = decoracionDe(p);
  if ((d.deposito[id] ?? 0) > 0) {
    d.deposito[id] -= 1;
    if (d.deposito[id] === 0) delete d.deposito[id];
  } else if (o.gemas !== undefined) {
    if (p.gemas < o.gemas) return no(`Hacen falta ${o.gemas} Gemas.`);
    mover(p, "gemas", -o.gemas, "decoracion", ahora, id);
  } else {
    if (p.oro < (o.oro ?? 0)) return no("No te alcanza el Oro.");
    mover(p, "oro", -(o.oro ?? 0), "decoracion", ahora, id);
  }
  d.puestos.push({ uid: nuevoUid(ahora), id, cx, cz, rot });
  return si;
}

export function moverObjeto(p: Partida, uid: string, cx: number, cz: number, rot: 0 | 1 | 2 | 3, fijo: Ocupacion): Resultado {
  const q = decoracionDe(p).puestos.find((x) => x.uid === uid);
  if (!q) return no("No se encontró el objeto.");
  const r = puedePoner(p, q.id, cx, cz, rot, fijo, uid);
  if (!r.ok) return r;
  q.cx = cx; q.cz = cz; q.rot = rot;
  return si;
}

/** Lo saca del campo y lo guarda en el depósito (se vuelve a poner gratis). */
export function guardarObjeto(p: Partida, uid: string): Resultado {
  const d = decoracionDe(p);
  const q = d.puestos.find((x) => x.uid === uid);
  if (!q) return no("No se encontró el objeto.");
  d.puestos = d.puestos.filter((x) => x.uid !== uid);
  d.deposito[q.id] = (d.deposito[q.id] ?? 0) + 1;
  return si;
}
