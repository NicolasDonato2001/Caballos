// Mercado entre jugadores y subastas (Fase 8, GDD §12.3 y §12.4): las reglas sobre la partida de cada jugador.
// El servidor (server/mercado.ts) las usa dentro de una transacción que toca las dos partidas y la publicación juntas,
// así no hay doble venta ni doble gasto. Puro: no sabe de base de datos ni de red.
import cfg from "../../config/balance/mercadoJugadores.json" with { type: "json" };
import type { Caballo } from "./caballo.ts";
import { hayLugar, type Partida } from "./partida.ts";
import { precioSugerido, quitarMontura } from "./economia.ts";

export const MERCADO_JUGADORES = cfg;
export type TipoPublicacion = "venta" | "subasta";
type Resultado = { ok: true } | { ok: false; motivo: string };
const no = (motivo: string): Resultado => ({ ok: false, motivo });
const si: Resultado = { ok: true };
const SEMANA = 7 * 86_400_000;

const redondear = (x: number, hacia: "arriba" | "abajo") => (hacia === "arriba" ? Math.ceil : Math.floor)(x / cfg.redondeo) * cfg.redondeo;
/** Precio permitido para un caballo: del 50 % al 300 % del sugerido (§12.3). */
export function rangoPrecio(c: Caballo): [number, number] {
  const s = precioSugerido(c);
  return [redondear(s * cfg.precioMinimo, "arriba"), redondear(s * cfg.precioMaximo, "abajo")];
}

/** Compras de los últimos 7 días (y limpia las viejas). */
export function comprasSemana(p: Partida, ahora: number): number {
  p.comprasMercado = (p.comprasMercado ?? []).filter((t) => ahora - t < SEMANA);
  return p.comprasMercado.length;
}
/** Compras que le quedan esta semana: las subastas que va ganando ya cuentan. */
export function cuposCompra(p: Partida, ahora: number): number {
  return Math.max(0, cfg.comprasPorSemana - comprasSemana(p, ahora) - (p.pujasMercado?.length ?? 0));
}
/** Cuándo se libera la próxima compra (si no le quedan). */
export function proximoCupo(p: Partida, ahora: number): number | null {
  comprasSemana(p, ahora);
  const l = [...(p.comprasMercado ?? [])].sort((a, b) => a - b);
  return l.length ? l[0] + SEMANA : null;
}

export function validarPublicacion(p: Partida, caballoId: string, tipo: string, precio: number, duracionMin: number): Resultado {
  const c = p.caballos.find((x) => x.id === caballoId);
  if (!c) return no("No se encontró el caballo.");
  if (tipo !== "venta" && tipo !== "subasta") return no("Tipo de publicación desconocido.");
  if (c.estado !== "disponible") return no("Solo se puede publicar un caballo disponible (detené antes lo que esté haciendo).");
  if (p.caballos.filter((x) => x.id !== c.id && x.estado !== "publicado").length < 1) return no("No podés publicar tu último caballo.");
  if (p.caballos.filter((x) => x.estado === "publicado").length >= cfg.maxPublicaciones) return no(`Podés tener hasta ${cfg.maxPublicaciones} publicaciones a la vez.`);
  const [min, max] = rangoPrecio(c);
  if (!Number.isInteger(precio) || precio < min || precio > max)
    return no(`El precio tiene que estar entre ${min.toLocaleString("es-AR")} y ${max.toLocaleString("es-AR")} Oro (del 50 % al 300 % del sugerido).`);
  if (tipo === "subasta" && !cfg.duracionesSubastaMin.includes(duracionMin)) return no("Duración de subasta no válida.");
  return si;
}

/** Bloquea el caballo mientras está publicado. La montura vuelve al inventario del vendedor. */
export function bloquear(p: Partida, caballoId: string, pubId: string): Caballo {
  const c = p.caballos.find((x) => x.id === caballoId)!;
  quitarMontura(c);
  c.estado = "publicado"; c.finEstado = null; c.publicacion = pubId;
  delete c.inicioEstado;
  return c;
}
/** Vuelve a estar disponible (se canceló o venció sin venderse). */
export function desbloquear(p: Partida, pubId: string, ahora: number): boolean {
  const c = p.caballos.find((x) => x.publicacion === pubId);
  if (!c) return false;
  c.estado = "disponible"; c.finEstado = null; c.disponibleDesde = ahora;
  delete c.publicacion;
  return true;
}
/** Saca el caballo publicado de la partida del vendedor. */
export function sacarPublicado(p: Partida, pubId: string): Caballo | null {
  const c = p.caballos.find((x) => x.publicacion === pubId && x.estado === "publicado");
  if (!c) return null;
  p.caballos = p.caballos.filter((x) => x !== c);
  return c;
}
/** El comprador recibe el caballo: sin la montura ni el aspecto del vendedor (eran suyos), con su genética, historial y herraduras. */
export function recibirCaballo(p: Partida, c: Caballo, ahora: number): Caballo {
  const h: Caballo = structuredClone(c);
  h.estado = "disponible"; h.finEstado = null; h.disponibleDesde = ahora;
  delete h.publicacion; delete h.inicioEstado; delete h.descansoHasta; delete h.cola; delete h.aspecto;
  quitarMontura(h);
  if (p.caballos.some((x) => x.id === h.id)) h.id = `${h.id}-${ahora.toString(36)}`;
  p.caballos.push(h);
  return h;
}

/** Lo mínimo para la próxima puja. */
export function pujaMinima(precioInicial: number, mejor: number | null): number {
  if (mejor === null) return precioInicial;
  return redondear(mejor + Math.max(cfg.incrementoMinimoOro, mejor * cfg.incrementoMinimo), "arriba");
}
/** Lo que cobra el vendedor (el precio menos la comisión) y la comisión. */
export function neto(precio: number): { vendedor: number; comision: number } {
  const comision = Math.round(precio * cfg.comision);
  return { vendedor: precio - comision, comision };
}

/** ¿Puede comprar (o pujar) este jugador? Oro, lugar en el establo y cupo semanal. */
export function puedeComprar(p: Partida, monto: number, ahora: number): Resultado {
  if (p.oro < monto) return no("No te alcanza el Oro.");
  if (!hayLugar(p)) return no("No tenés lugar libre en el establo.");
  if (cuposCompra(p, ahora) <= 0) return no(`Ya usaste tus ${cfg.comprasPorSemana} compras de esta semana (contando las subastas que vas ganando).`);
  return si;
}
