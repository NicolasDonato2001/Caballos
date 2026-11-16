// Mercado entre jugadores y subastas del lado del servidor (Fase 8, GDD §12.3 y §12.4).
// Cada operación cambia, dentro de UNA transacción de la base, la publicación y las partidas de los jugadores que toca
// (vendedor, comprador, el que pujó antes). Si algo no cuadra, no cambia nada: sin doble venta ni doble gasto.
// Las reglas sobre cada partida están en src/domain/mercadoJugadores.ts.
import { randomBytes } from "node:crypto";
import type { Base, FilaPublicacion } from "./db.ts";
import type { Partida } from "../src/domain/partida.ts";
import type { Caballo } from "../src/domain/caballo.ts";
import { mover, precioSugerido } from "../src/domain/economia.ts";
import {
  bloquear, comprasSemana, cuposCompra, desbloquear, MERCADO_JUGADORES as C, neto, proximoCupo, pujaMinima, puedeComprar,
  rangoPrecio, recibirCaballo, sacarPublicado, validarPublicacion, type TipoPublicacion,
} from "../src/domain/mercadoJugadores.ts";

import { Abortar, transaccionPartidas, type AccesoPartidas, type Resultado } from "./transaccion.ts";
export type { AccesoPartidas } from "./transaccion.ts";

const MIN = 60_000, HORA = 3_600_000;

export class MercadoJugadores {
  private db: Base;
  private acceso: AccesoPartidas;
  private reloj: () => number;
  constructor(db: Base, acceso: AccesoPartidas, reloj: () => number) { this.db = db; this.acceso = acceso; this.reloj = reloj; }

  private tx<T extends object>(usuarios: number[], f: (ps: Map<number, Partida>) => T): Resultado<T> {
    return transaccionPartidas(this.db, this.acceso, usuarios, f);
  }

  // ---------------------------------------------------------------- publicar y cancelar

  publicar(u: number, caballoId: string, tipo: TipoPublicacion, precio: number, duracionMin: number): Resultado<{ id: string }> {
    const ahora = this.reloj();
    return this.tx([u], (ps) => {
      const p = ps.get(u)!;
      const v = validarPublicacion(p, caballoId, tipo, precio, duracionMin);
      if (!v.ok) throw new Abortar(v.motivo);
      const id = `p${randomBytes(9).toString("base64url")}`;
      const c = bloquear(p, caballoId, id);
      const vista: Caballo = { ...structuredClone(c), estado: "disponible" };
      delete vista.publicacion;
      this.db.crearPublicacion({ id, vendedor: u, caballoId, caballo: JSON.stringify(vista), tipo, precio, creada: ahora,
        fin: ahora + (tipo === "venta" ? C.duracionVentaHoras * HORA : duracionMin * MIN), estado: "activa" });
      return { id };
    });
  }

  /** El vendedor la saca: una venta, siempre; una subasta, solo si nadie pujó. */
  cancelar(u: number, id: string): Resultado {
    const pub = this.db.publicacion(id);
    if (!pub || pub.vendedor !== u) return { ok: false, motivo: "No es una publicación tuya." };
    if (pub.estado !== "activa") return { ok: false, motivo: "La publicación ya terminó." };
    if (pub.mejorPostor !== null) return { ok: false, motivo: "Ya tiene ofertas: la subasta sigue hasta el final." };
    const ahora = this.reloj();
    return this.tx([u], (ps) => {
      if (!this.db.actualizarPublicacion(id, "activa", { estado: "cancelada", cerrada: ahora })) throw new Abortar("La publicación ya terminó.");
      desbloquear(ps.get(u)!, id, ahora);
      return {};
    });
  }

  // ---------------------------------------------------------------- comprar y pujar

  comprar(u: number, id: string): Resultado {
    const ahora = this.reloj();
    const pub = this.db.publicacion(id);
    if (!pub || pub.estado !== "activa" || pub.fin <= ahora) return { ok: false, motivo: "Esa publicación ya no está." };
    if (pub.tipo !== "venta") return { ok: false, motivo: "Es una subasta: hay que pujar." };
    if (pub.vendedor === u) return { ok: false, motivo: "No podés comprar tu propio caballo." };
    return this.tx([u, pub.vendedor], (ps) => {
      const comprador = ps.get(u)!, vendedor = ps.get(pub.vendedor)!;
      const v = puedeComprar(comprador, pub.precio, ahora);
      if (!v.ok) throw new Abortar(v.motivo);
      const c = sacarPublicado(vendedor, id);
      if (!c) throw new Abortar("Ese caballo ya no está a la venta.");
      if (!this.db.actualizarPublicacion(id, "activa", { estado: "vendida", comprador: u, precioFinal: pub.precio, cerrada: ahora }))
        throw new Abortar("Ese caballo ya se vendió.");
      this.entregar(comprador, vendedor, c, pub.precio, id, ahora, true);
      return {};
    });
  }

  /** Puja: reserva el Oro y un lugar en el establo; al que iba ganando se le devuelve lo suyo. */
  pujar(u: number, id: string, monto: number): Resultado {
    const ahora = this.reloj();
    const pub = this.db.publicacion(id);
    if (!pub || pub.estado !== "activa" || pub.fin <= ahora) return { ok: false, motivo: "Esa subasta ya terminó." };
    if (pub.tipo !== "subasta") return { ok: false, motivo: "Es una venta a precio fijo: se compra directo." };
    if (pub.vendedor === u) return { ok: false, motivo: "No podés pujar por tu propio caballo." };
    if (pub.mejorPostor === u) return { ok: false, motivo: "Ya vas ganando esta subasta." };
    const minimo = pujaMinima(pub.precio, pub.mejorPuja);
    const maximo = rangoPrecio(JSON.parse(pub.caballo) as Caballo)[1];
    if (!Number.isInteger(monto) || monto < minimo) return { ok: false, motivo: `La puja mínima es ${minimo.toLocaleString("es-AR")} Oro.` };
    if (monto > maximo) return { ok: false, motivo: `El máximo para este caballo es ${maximo.toLocaleString("es-AR")} Oro (300 % del sugerido).` };
    const previo = pub.mejorPostor;
    return this.tx(previo === null ? [u] : [u, previo], (ps) => {
      const postor = ps.get(u)!;
      const v = puedeComprar(postor, monto, ahora);
      if (!v.ok) throw new Abortar(v.motivo);
      // Una puja en los últimos minutos estira la subasta (que no se gane en el último segundo sin respuesta)
      const fin = Math.max(pub.fin, ahora + C.extensionSeg * 1000);
      if (!this.db.actualizarPublicacion(id, "activa", { mejorPuja: monto, mejorPostor: u, fin })) throw new Abortar("Esa subasta ya terminó.");
      mover(postor, "oro", -monto, "mercado:puja", ahora, id);
      (postor.pujasMercado ??= []).push({ pub: id, monto });
      if (previo !== null) this.devolverPuja(ps.get(previo)!, id, ahora);
      this.db.anotarPuja(id, u, monto, ahora);
      return {};
    });
  }

  private devolverPuja(p: Partida, id: string, ahora: number): void {
    const r = (p.pujasMercado ?? []).find((x) => x.pub === id);
    if (!r) return;
    p.pujasMercado = p.pujasMercado!.filter((x) => x !== r);
    mover(p, "oro", r.monto, "mercado:puja devuelta", ahora, id);
  }

  /** El caballo pasa al comprador; el vendedor cobra el precio menos la comisión (§12.3). */
  private entregar(comprador: Partida, vendedor: Partida, c: Caballo, precio: number, id: string, ahora: number, cobrarAlComprador: boolean): void {
    if (cobrarAlComprador) mover(comprador, "oro", -precio, "mercado:compra", ahora, id);
    recibirCaballo(comprador, c, ahora);
    comprasSemana(comprador, ahora);
    comprador.comprasMercado!.push(ahora);
    mover(vendedor, "oro", neto(precio).vendedor, "mercado:venta", ahora, id);
  }

  // ---------------------------------------------------------------- vencimientos

  /** Cierra lo que venció: las ventas sin comprador vuelven; las subastas se adjudican al que va ganando. */
  cerrarVencidas(): number {
    const ahora = this.reloj();
    let n = 0;
    for (const pub of this.db.publicacionesVencidas(ahora)) { this.cerrar(pub, ahora); n++; }
    return n;
  }
  private cerrar(pub: FilaPublicacion, ahora: number): void {
    if (pub.mejorPostor === null) {
      this.tx([pub.vendedor], (ps) => {
        if (!this.db.actualizarPublicacion(pub.id, "activa", { estado: pub.tipo === "venta" ? "vencida" : "sin_ofertas", cerrada: ahora })) throw new Abortar("ya cerrada");
        desbloquear(ps.get(pub.vendedor)!, pub.id, ahora);
        return {};
      });
      return;
    }
    const ganador = pub.mejorPostor, monto = pub.mejorPuja!;
    this.tx([pub.vendedor, ganador], (ps) => {
      const comprador = ps.get(ganador)!, vendedor = ps.get(pub.vendedor)!;
      // Su reserva (Oro y lugar) se convierte en la compra
      comprador.pujasMercado = (comprador.pujasMercado ?? []).filter((x) => x.pub !== pub.id);
      const c = sacarPublicado(vendedor, pub.id);
      if (!c) {
        // No debería pasar (el caballo estaba bloqueado): se devuelve la puja y se cierra sin venta
        if (!this.db.actualizarPublicacion(pub.id, "activa", { estado: "fallida", cerrada: ahora })) throw new Abortar("ya cerrada");
        mover(comprador, "oro", monto, "mercado:puja devuelta", ahora, pub.id);
        return {};
      }
      if (!this.db.actualizarPublicacion(pub.id, "activa", { estado: "vendida", comprador: ganador, precioFinal: monto, cerrada: ahora })) throw new Abortar("ya cerrada");
      this.entregar(comprador, vendedor, c, monto, pub.id, ahora, false);
      return {};
    });
  }

  // ---------------------------------------------------------------- lo que ve el jugador

  listar(u: number) {
    this.cerrarVencidas();
    const ahora = this.reloj();
    const nombre = (id: number | null) => (id === null ? null : this.db.usuario(id)?.nombre ?? "?");
    const vista = (x: FilaPublicacion) => {
      const caballo = JSON.parse(x.caballo) as Caballo;
      return {
        id: x.id, tipo: x.tipo, estado: x.estado, vendedor: nombre(x.vendedor), caballo, precio: x.precio, fin: x.fin, creada: x.creada,
        mejorPuja: x.mejorPuja, pujas: x.tipo === "subasta" ? this.db.cantidadPujas(x.id) : 0, sugerido: precioSugerido(caballo),
        minimaPuja: x.tipo === "subasta" ? pujaMinima(x.precio, x.mejorPuja) : null, maximo: rangoPrecio(caballo)[1],
        mia: x.vendedor === u, liderando: x.mejorPostor === u, comprador: nombre(x.comprador), precioFinal: x.precioFinal,
        compradaPorMi: x.comprador === u,
      };
    };
    const { partida } = this.acceso.leer(u);
    return {
      activas: this.db.publicacionesActivas().filter((x) => x.vendedor !== u).map(vista),
      mias: this.db.publicacionesDe(u, 30).map(vista),
      compras: { usadas: comprasSemana(partida, ahora), ganando: partida.pujasMercado?.length ?? 0, maximo: C.comprasPorSemana,
        quedan: cuposCompra(partida, ahora), proxima: proximoCupo(partida, ahora) },
      hora: ahora,
    };
  }
}
