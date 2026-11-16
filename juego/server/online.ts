// Carreras online entre jugadores (Fases 7.2–7.4, GDD §13 y §24.5). Flujo: cola → emparejamiento → se revela la
// distancia → tiempo para elegir caballo y estrategia (y apostar) → el servidor simula una vez y manda la misma carrera
// a todos, con la hora de largada. Dos modos: Online casual (2 a 8, no toca el rating) y Ranked (al menos 4, TrueSkill).
// Los avisos al cliente van por Server-Sent Events (HTTP común, sin dependencias).
import type { ServerResponse } from "node:http";
import cfg from "../config/balance/online.json" with { type: "json" };
import { simulateRace } from "../src/sim/race.ts";
import { newRaceSetupOnline, type RaceSetup } from "../src/game/field.ts";
import type { Partida } from "../src/domain/partida.ts";
import type { Strategy } from "../src/sim/types.ts";
import { atributos } from "../src/domain/caballo.ts";
import { puedeCorrer } from "../src/domain/edificios.ts";
import { registrarCarrera, participantes } from "../src/domain/carreras.ts";
import { indiceDe, tiempoEsperado } from "../src/domain/tiers.ts";
import { cobrarApuesta, cuotas, liquidar, pagarApuesta, validarApuesta, type Apuesta } from "../src/domain/apuestas.ts";
import { PARAMS } from "./carrera.ts";

type Distancia = 500 | 1500;
/** casual: 2 a 8 jugadores, no toca el rating. ranked: al menos 4 jugadores, TrueSkill con el orden entre jugadores. */
export type TipoOnline = "casual" | "ranked";
export const TIPOS_ONLINE: TipoOnline[] = ["casual", "ranked"];
/** Fuerza del establo: el mejor tiempo esperado de sus caballos listos en cada distancia (§13). */
interface Fuerza { 500: number; 1500: number; }
interface EnCola { u: number; nombre: string; desde: number; tipo: TipoOnline; indice: number; rating: number; fuerza: Fuerza; }
/** Cambio de rating que ve cada jugador al terminar una Ranked. */
export interface CambioRating { antes: number; despues: number; carreras: number; colocacion: boolean; division: { nombre: string; color: string } | null; }
/** Cómo le fue a la apuesta de un jugador. */
export interface ResultadoApuesta { en: string; monto: number; pago: number; dividendo: number | null; devuelta: boolean; }
interface Jugador { u: number; nombre: string; caballoId?: string; estrategia?: Strategy; listo: boolean; }
export interface Sala {
  id: string; jugadores: Jugador[]; distancia: Distancia; superficie: "cesped" | "tierra";
  fase: "eligiendo" | "corriendo" | "terminada"; venceEleccion: number; inicio?: number; tipo: TipoOnline;
  apuestas: Apuesta[];
  /** Cobros de apuestas en curso: la carrera los espera antes de liquidar. */ cobrando: Promise<unknown>[];
}

/** Lo que el servidor de carreras necesita del resto: leer y modificar partidas (con la cola por usuario). */
export interface Puente {
  leer: (u: number) => Partida;
  modificar: <T extends { ok: boolean }>(u: number, f: (p: Partida) => T) => Promise<{ r: T; partida: Partida }>;
  reloj: () => number;
  /** Rating visible del jugador (para emparejar). */
  rating?: (u: number) => number;
  /** Al terminar una Ranked, actualiza el rating con el orden de llegada de los jugadores (el 1.º primero). */
  alTerminar?: (orden: number[]) => Map<number, CambioRating>;
}

export type Config = typeof cfg;
const ESTRATEGIAS: Strategy[] = ["agresiva", "equilibrada", "conservadora"];

export class CarrerasOnline {
  private cola = new Map<number, EnCola>();
  private salas = new Map<string, Sala>();
  private salaDe = new Map<number, string>();
  private oyentes = new Map<number, Set<ServerResponse>>();
  /** La última carrera de cada jugador: se le vuelve a mandar si se reconecta justo antes o durante la largada. */
  private ultimaCarrera = new Map<number, { datos: object; inicio: number }>();
  private reloj: () => number;
  private intervalo: ReturnType<typeof setInterval> | null = null;
  private k = 0;
  private puente: Puente;
  private c: Config;
  constructor(puente: Puente, c: Config = cfg) { this.puente = puente; this.c = c; this.reloj = puente.reloj; }

  arrancar(cadaMs = 500): void {
    this.intervalo ??= setInterval(() => void this.paso(), cadaMs);
    this.intervalo.unref?.();
  }
  parar(): void { if (this.intervalo) clearInterval(this.intervalo); this.intervalo = null; for (const s of this.oyentes.values()) for (const r of s) r.end(); }

  // ---- avisos (Server-Sent Events)
  escuchar(u: number, res: ServerResponse): void {
    // X-Accel-Buffering: que ningún intermediario (el túnel de Cloudflare) junte los avisos antes de mandarlos
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write(": hola\n\n");
    let s = this.oyentes.get(u);
    if (!s) this.oyentes.set(u, (s = new Set()));
    s.add(res);
    // Latido cada 20 s: los túneles cortan las conexiones que pasan mucho tiempo calladas
    const latido = setInterval(() => res.write(": latido\n\n"), 20_000);
    latido.unref?.();
    res.on("close", () => { clearInterval(latido); s!.delete(res); });
    this.enviar(u, "estado", this.estado(u));
    const c = this.carreraReciente(u);
    if (c) this.enviar(u, "carrera", c);
  }
  /** La carrera del jugador si todavía no terminó de verse (el cliente ignora la que ya reprodujo). */
  carreraReciente(u: number): object | null {
    const c = this.ultimaCarrera.get(u);
    if (!c) return null;
    if (this.reloj() > c.inicio + 90_000) { this.ultimaCarrera.delete(u); return null; }
    return c.datos;
  }
  private enviar(u: number, evento: string, datos: unknown): void {
    for (const r of this.oyentes.get(u) ?? []) r.write(`event: ${evento}\ndata: ${JSON.stringify({ ...(datos as object), hora: this.reloj() })}\n\n`);
  }

  /** Lo que ve un jugador: si está en la cola, en una sala o en nada. */
  estado(u: number) {
    const enCola = (t: TipoOnline) => [...this.cola.values()].filter((e) => e.tipo === t).length;
    const colas = { casual: enCola("casual"), ranked: enCola("ranked") };
    const sid = this.salaDe.get(u);
    const sala = sid ? this.salas.get(sid) : undefined;
    if (sala && sala.fase !== "terminada") return { donde: "sala", sala: this.vistaSala(sala, u), tipo: sala.tipo, enCola: colas[sala.tipo], colas };
    const e = this.cola.get(u);
    if (e) return { donde: "cola", desde: e.desde, tipo: e.tipo, enCola: colas[e.tipo], colas,
      // Quiénes esperan en la misma cola (para saber si falta un amigo) y cuándo se arma la carrera casual
      enEspera: [...this.cola.values()].filter((x) => x.tipo === e.tipo).sort((a, b) => a.desde - b.desde).map((x) => x.nombre),
      ...(e.tipo === "casual" ? { armaEn: Math.min(...[...this.cola.values()].filter((x) => x.tipo === "casual").map((x) => x.desde)) + this.c.esperaSeg * 1000 } : {}),
      minJugadores: e.tipo === "ranked" ? this.c.ranked.minHumanos : this.c.minJugadores,
      ...(e.tipo === "ranked" ? { avisoSinRivalesSeg: this.c.ranked.avisoSinRivalesSeg } : {}) };
    return { donde: "nada", enCola: colas.casual + colas.ranked, colas };
  }
  /** La sala como la ve el jugador u: con la pizarra de apuestas (pública) y su propia apuesta. */
  private vistaSala(s: Sala, u: number) {
    const q = cuotas(s.apuestas);
    const mia = s.apuestas.find((a) => a.u === u);
    return { id: s.id, tipo: s.tipo, distancia: s.distancia, superficie: s.superficie, fase: s.fase, venceEleccion: s.venceEleccion,
      jugadores: s.jugadores.map((j) => ({ nombre: j.nombre, listo: j.listo,
        pozo: s.apuestas.filter((a) => a.en === j.u).reduce((t, a) => t + a.monto, 0), cuota: q.get(j.u) ?? null })),
      pozo: s.apuestas.reduce((t, a) => t + a.monto, 0),
      miApuesta: mia ? { en: s.jugadores.find((j) => j.u === mia.en)!.nombre, monto: mia.monto } : null };
  }
  private avisarSala(s: Sala): void { for (const j of s.jugadores) this.enviar(j.u, "sala", { sala: this.vistaSala(s, j.u) }); }

  // ---- cola
  entrarCola(u: number, nombre: string, tipo: TipoOnline = "casual"): { ok: true } | { ok: false; motivo: string } {
    if (!TIPOS_ONLINE.includes(tipo)) return { ok: false, motivo: "Tipo de carrera desconocido." };
    // Pedir de nuevo no es un error (doble toque, pantalla atrasada por la conexión): se le recuerda dónde está
    const sid = this.salaDe.get(u), sala = sid ? this.salas.get(sid) : undefined;
    if (sala && sala.fase !== "terminada") { this.enviar(u, "sala", { sala: this.vistaSala(sala, u) }); this.enviar(u, "estado", this.estado(u)); return { ok: true }; }
    const ya = this.cola.get(u);
    if (ya && ya.tipo === tipo) { this.enviar(u, "estado", this.estado(u)); return { ok: true }; }
    this.ultimaCarrera.delete(u);          // busca otra: la anterior ya no se reenvía
    const p = this.puente.leer(u);
    const listos = p.caballos.filter((c) => puedeCorrer(c, this.reloj()).ok);
    if (!listos.length) return { ok: false, motivo: "No tenés caballos listos para correr." };
    const fuerza = { 500: Math.min(...listos.map((c) => tiempoEsperado(atributos(c), 500))), 1500: Math.min(...listos.map((c) => tiempoEsperado(atributos(c), 1500))) };
    const indice = Math.max(...listos.map((c) => indiceDe(atributos(c))));
    this.cola.set(u, { u, nombre, desde: this.reloj(), tipo, indice, fuerza, rating: this.puente.rating?.(u) ?? 0 });
    this.avisarCola();
    return { ok: true };
  }
  salirCola(u: number): void { if (this.cola.delete(u)) this.avisarCola(); this.enviar(u, "estado", this.estado(u)); }
  private avisarCola(): void { for (const e of this.cola.values()) this.enviar(e.u, "estado", this.estado(e.u)); }

  /** Diferencia de fuerza del establo, en %, en la distancia donde más se separan. */
  static difFuerza(a: Fuerza, b: Fuerza): number {
    return Math.max(...([500, 1500] as const).map((d) => Math.abs(a[d] - b[d]) / Math.min(a[d], b[d]) * 100));
  }

  /** Emparejamiento, por separado para cada modo. */
  private emparejar(): void {
    this.emparejarCasual();
    this.emparejarRanked();
  }

  /**
   * Online casual: juntan a TODOS los que están en la cola (hasta 8), sin mirar la fuerza de los caballos: es para jugar
   * entre amigos. Se arma cuando hay 8 o cuando el primero lleva esperaSeg. (El filtro por fuerza queda para Ranked, §13.)
   */
  private emparejarCasual(): void {
    const ahora = this.reloj();
    const lista = [...this.cola.values()].filter((e) => e.tipo === "casual").sort((a, b) => a.desde - b.desde);
    while (lista.length >= this.c.minJugadores) {
      const espera = (ahora - lista[0].desde) / 1000;
      if (lista.length < this.c.maxJugadores && espera < this.c.esperaSeg) return;
      const grupo = lista.splice(0, this.c.maxJugadores);
      for (const e of grupo) this.cola.delete(e.u);
      this.abrirSala(grupo, ahora, "casual");
    }
  }

  /** Ranked (§13): rating visible ±100 → ±300 y fuerza del establo 3 % → 5 %, ambos se abren con la espera. */
  private emparejarRanked(): void {
    const r = this.c.ranked, ahora = this.reloj();
    const lista = [...this.cola.values()].filter((e) => e.tipo === "ranked").sort((a, b) => a.desde - b.desde);
    for (let k = 0; k < lista.length && lista.length - k >= r.minHumanos;) {
      const ancla = lista[k];
      const espera = (ahora - ancla.desde) / 1000;
      const ventana = Math.min(r.ventanaRatingMax, r.ventanaRating + r.ventanaPorSegundo * espera);
      const fuerza = Math.min(r.fuerzaPctMax, r.fuerzaPct + r.fuerzaPorSegundo * espera);
      const grupo = lista.filter((e) => Math.abs(e.rating - ancla.rating) <= ventana && CarrerasOnline.difFuerza(e.fuerza, ancla.fuerza) <= fuerza)
        .slice(0, r.maxJugadores);
      if (grupo.length < r.minHumanos || (grupo.length < r.maxJugadores && espera < r.esperaSeg)) { k++; continue; }
      for (const e of grupo) { this.cola.delete(e.u); lista.splice(lista.indexOf(e), 1); }
      this.abrirSala(grupo, ahora, "ranked");
    }
  }

  private abrirSala(grupo: EnCola[], ahora: number, tipo: TipoOnline): void {
    const s: Sala = {
      tipo,
      id: `s${ahora.toString(36)}${(this.k++).toString(36)}`, distancia: Math.random() < 0.5 ? 500 : 1500, superficie: Math.random() < 0.5 ? "cesped" : "tierra",
      fase: "eligiendo", venceEleccion: ahora + this.c.eleccionSeg * 1000, jugadores: grupo.map((e) => ({ u: e.u, nombre: e.nombre, listo: false })),
      apuestas: [], cobrando: [],
    };
    this.salas.set(s.id, s);
    for (const j of s.jugadores) this.salaDe.set(j.u, s.id);
    this.avisarSala(s);
    this.avisarCola();
  }

  /** Elegir caballo y estrategia (se puede cambiar hasta que todos estén listos o venza el tiempo). */
  elegir(u: number, caballoId: string, estrategia: Strategy): { ok: true } | { ok: false; motivo: string } {
    const s = this.salas.get(this.salaDe.get(u) ?? "");
    if (!s || s.fase !== "eligiendo") return { ok: false, motivo: "No hay una carrera esperando tu elección." };
    const c = this.puente.leer(u).caballos.find((x) => x.id === caballoId);
    if (!c) return { ok: false, motivo: "No se encontró el caballo." };
    const r = puedeCorrer(c, this.reloj());
    if (!r.ok) return r;
    if (!ESTRATEGIAS.includes(estrategia)) return { ok: false, motivo: "Estrategia desconocida." };
    const j = s.jugadores.find((x) => x.u === u)!;
    j.caballoId = caballoId; j.estrategia = estrategia; j.listo = true;
    this.avisarSala(s);
    if (s.jugadores.every((x) => x.listo)) void this.largar(s);
    return { ok: true };
  }

  /**
   * 7.4: apostar a qué jugador de la sala llega primero entre los jugadores. Una apuesta por carrera; el Oro se
   * descuenta enseguida y queda en el pozo. Cierra cuando larga la carrera.
   */
  async apostar(u: number, enNombre: string, monto: number): Promise<{ ok: true } | { ok: false; motivo: string }> {
    const s = this.salas.get(this.salaDe.get(u) ?? "");
    if (!s || s.fase !== "eligiendo") return { ok: false, motivo: "Las apuestas están cerradas." };
    if (s.apuestas.some((a) => a.u === u)) return { ok: false, motivo: "Ya apostaste en esta carrera." };
    const en = s.jugadores.find((j) => j.nombre === enNombre);
    if (!en) return { ok: false, motivo: "Ese jugador no corre en esta carrera." };
    const v = validarApuesta(this.puente.leer(u), monto, this.reloj());
    if (!v.ok) return v;
    // Se anota antes de cobrar para que nadie apueste dos veces; si el cobro falla, se borra
    const a: Apuesta = { u, en: en.u, monto };
    s.apuestas.push(a);
    const cobro = this.puente.modificar(u, (p) => cobrarApuesta(p, monto, this.reloj(), s.id));
    s.cobrando.push(cobro);
    const { r } = await cobro;
    if (!r.ok) { s.apuestas.splice(s.apuestas.indexOf(a), 1); return r; }
    this.avisarSala(s);
    return { ok: true };
  }

  /** Corre la carrera: la simula una vez, cobra a cada jugador en su partida y manda la misma entrada a todos. */
  private async largar(s: Sala): Promise<void> {
    if (s.fase !== "eligiendo") return;
    s.fase = "corriendo";
    await Promise.allSettled(s.cobrando);      // las apuestas que se estaban cobrando entran al pozo
    const ahora = this.reloj();
    // Quien no eligió corre con su mejor caballo listo y estrategia equilibrada; si no tiene ninguno listo, queda afuera
    const humanos: { j: Jugador; caballo: Partida["caballos"][number] }[] = [];
    const afuera: Jugador[] = [];
    for (const j of s.jugadores) {
      const p = this.puente.leer(j.u);
      let c = p.caballos.find((x) => x.id === j.caballoId && puedeCorrer(x, ahora).ok);
      if (!c) c = p.caballos.filter((x) => puedeCorrer(x, ahora).ok).sort((a, b) => indiceDe(atributos(b)) - indiceDe(atributos(a)))[0];
      if (!c) { afuera.push(j); continue; }
      j.caballoId = c.id; j.estrategia ??= "equilibrada";
      humanos.push({ j, caballo: c });
    }
    const nombreDe = (u: number) => s.jugadores.find((j) => j.u === u)!.nombre;
    // Pozo de apuestas: gana el jugador que llega primero entre los jugadores; a los que no largaron se les devuelve
    const apuestaDe = (u: number, liq: ReturnType<typeof liquidar>): ResultadoApuesta | undefined => {
      const a = s.apuestas.find((x) => x.u === u);
      if (!a) return undefined;
      const devuelta = liq.devuelto || afuera.some((j) => j.u === a.en);
      return { en: nombreDe(a.en), monto: a.monto, pago: liq.pagos.get(u) ?? 0, dividendo: devuelta ? null : liq.dividendo, devuelta };
    };
    const retirados = new Set(afuera.map((j) => j.u));
    if (!humanos.length) {
      s.fase = "terminada";
      const liq = liquidar(s.apuestas, null, retirados);
      await this.pagarApuestas(s, liq, new Set());
      this.avisarAfuera(afuera, new Map(), (u) => apuestaDe(u, liq));
      return;
    }
    const modo = s.tipo === "ranked" ? "ranked" : "online";
    const setup = newRaceSetupOnline(PARAMS._version, humanos.map((h) => ({ caballo: h.caballo, estrategia: h.j.estrategia!, dueno: h.j.nombre })),
      { distance: s.distancia, surface: s.superficie, n: participantes(modo), ahora });
    const res = simulateRace(setup.input, PARAMS);
    const best = res.finishTimes[res.order[0]];
    const indiceDeJugador = (j: Jugador) => setup.entrants.findIndex((e) => e.dueno === j.nombre && e.caballo.id === j.caballoId);
    // Orden de llegada entre jugadores (los bots no cuentan); el que no largó queda último
    const ordenCorrieron = humanos.map((h) => ({ u: h.j.u, puesto: res.order.indexOf(indiceDeJugador(h.j)) })).sort((a, b) => a.puesto - b.puesto).map((x) => x.u);
    const orden = [...ordenCorrieron, ...afuera.map((j) => j.u)];
    const cambios = s.tipo === "ranked" && orden.length >= 2 && this.puente.alTerminar ? this.puente.alTerminar(orden) : new Map<number, CambioRating>();
    // El ganador del pozo: el primero de los jugadores que terminó (un lesionado no termina)
    const primero = ordenCorrieron.find((u) => !res.injured.includes(indiceDeJugador(humanos.find((h) => h.j.u === u)!.j))) ?? null;
    const liq = liquidar(s.apuestas, primero, retirados);
    s.inicio = ahora + this.c.cuentaRegresivaSeg * 1000;
    for (const { j } of humanos) {
      const i = indiceDeJugador(j);
      const lesion = res.injured.includes(i);
      const tiempo = lesion ? 0 : res.finishTimes[i];
      const pago = liq.pagos.get(j.u) ?? 0;
      const { r, partida } = await this.puente.modificar(j.u, (p) => {
        const cobro = registrarCarrera(p, {
          modo, distancia: s.distancia, superficie: s.superficie, caballoId: j.caballoId!, caballoNombre: setup.entrants[i].caballo.nombre,
          estrategia: j.estrategia!, posicion: res.order.indexOf(i) + 1, participantes: setup.entrants.length, tiempo, diferencia: lesion ? 0 : tiempo - best,
          fotoFinal: res.photoFinish, seed: setup.input.seed, simVersion: setup.input.simVersion, ...(lesion ? { lesion: true } : {}),
        }, ahora);
        pagarApuesta(p, pago, ahora, s.id, liq.dividendo === null ? "apuesta devuelta" : "apuesta ganada");
        return { ok: true as const, cobro };
      });
      const rating = cambios.get(j.u), apuesta = apuestaDe(j.u, liq);
      const datos = { setup: { ...setup, playerIndex: i } as RaceSetup, partida, inicio: s.inicio, sala: s.id,
        cobro: { ...r.cobro, ...(rating ? { rating } : {}), ...(apuesta ? { apuesta } : {}) } };
      this.ultimaCarrera.set(j.u, { datos, inicio: s.inicio });
      this.enviar(j.u, "carrera", datos);
    }
    await this.pagarApuestas(s, liq, new Set(humanos.map((h) => h.j.u)));
    this.avisarAfuera(afuera, cambios, (u) => apuestaDe(u, liq));
    s.fase = "terminada";
    for (const { j } of humanos) this.salaDe.delete(j.u);
    setTimeout(() => this.salas.delete(s.id), 60_000).unref?.();
  }

  /** Paga las apuestas de quienes no corrieron (a los que corrieron se les paga junto con la carrera). */
  private async pagarApuestas(s: Sala, liq: ReturnType<typeof liquidar>, yaPagados: Set<number>): Promise<void> {
    for (const [u, pago] of liq.pagos) {
      if (yaPagados.has(u) || pago <= 0) continue;
      await this.puente.modificar(u, (p) => { pagarApuesta(p, pago, this.reloj(), s.id, liq.dividendo === null ? "apuesta devuelta" : "apuesta ganada"); return { ok: true as const }; });
    }
  }

  private avisarAfuera(afuera: Jugador[], cambios: Map<number, CambioRating>, apuesta: (u: number) => ResultadoApuesta | undefined): void {
    for (const j of afuera) {
      this.salaDe.delete(j.u);
      const a = apuesta(j.u);
      this.enviar(j.u, "afuera", { motivo: cambios.has(j.u) ? "No tenías un caballo listo cuando largó la carrera: en Ranked cuenta como último puesto." : "No tenías un caballo listo cuando largó la carrera.",
        ...(cambios.has(j.u) ? { rating: cambios.get(j.u) } : {}), ...(a ? { apuesta: a } : {}) });
    }
  }

  /** Cada medio segundo: emparejar y largar las salas cuyo tiempo de elección venció. */
  async paso(): Promise<void> {
    this.emparejar();
    const ahora = this.reloj();
    for (const s of this.salas.values()) if (s.fase === "eligiendo" && ahora >= s.venceEleccion) await this.largar(s);
  }
}
