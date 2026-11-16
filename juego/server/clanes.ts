// Clanes y guerras del lado del servidor (Fase 9, GDD §14).
// Guerra: 3 carreras de 8 caballos; cada clan anota hasta 4 representantes y cada uno un caballo por carrera. Las carreras
// cierran a las 16, 32 y 48 h (corren antes si ya se anotaron todos). Puntos por puesto 8-6-5-4-3-2-1-0; los bots completan
// los lugares vacíos y no suman. Gana el clan con más puntos; Elo K = 32; premios a los que corrieron.
// Cada carrera guarda su entrada completa (semilla incluida): cualquiera puede repetirla y verificar el resultado.
import { randomInt } from "node:crypto";
import type { Base } from "./db.ts";
import { Abortar, transaccionPartidas, type AccesoPartidas, type Resultado } from "./transaccion.ts";
import { PARAMS } from "./carrera.ts";
import { simulateRace } from "../src/sim/race.ts";
import { newRaceSetupOnline, type RaceSetup } from "../src/game/field.ts";
import type { Strategy } from "../src/sim/types.ts";
import type { Caballo } from "../src/domain/caballo.ts";
import { atributos } from "../src/domain/caballo.ts";
import { puedeCorrer } from "../src/domain/edificios.ts";
import { registrarCarrera } from "../src/domain/carreras.ts";
import { mover } from "../src/domain/economia.ts";
import { indiceDe } from "../src/domain/tiers.ts";
import { CLANES as C, nuevoElo, puntosDePuesto, validarNombreClan, ventanaElo, type Rol } from "../src/domain/clanes.ts";

const HORA = 3_600_000;
const ESTRATEGIAS: Strategy[] = ["agresiva", "equilibrada", "conservadora"];

interface FilaClan { id: number; nombre: string; elo: number; creado: number; guerras: number; victorias: number; }
interface FilaMiembro { usuario: number; clan: number; rol: Rol; desde: number; }
interface FilaGuerra {
  id: number; clanA: number; clanB: number; inicio: number; fin: number; estado: "activa" | "terminada"; carreras: string;
  puntosA: number; puntosB: number; ganador: number | null; eloA0: number; eloB0: number; eloA1: number | null; eloB1: number | null; terminada: number | null;
}
/** Un caballo en el resultado de una carrera de guerra. */
export interface PuestoGuerra { puesto: number; caballo: string; dueno: string | null; usuario: number | null; clan: number | null; puntos: number; tiempo: number | null; lesion: boolean; }
export interface CarreraGuerra {
  n: number; distancia: 500 | 1500; superficie: "cesped" | "tierra"; cierra: number; corrida: number | null;
  setup?: RaceSetup; resultado?: PuestoGuerra[];
}

export class Clanes {
  private db: Base; private acceso: AccesoPartidas; private reloj: () => number;
  constructor(db: Base, acceso: AccesoPartidas, reloj: () => number) { this.db = db; this.acceso = acceso; this.reloj = reloj; }

  // ---------------------------------------------------------------- consultas
  private miembro(u: number) { return this.db.uno<FilaMiembro>("SELECT * FROM miembros WHERE usuario = ?", u); }
  private clan(id: number) { return this.db.uno<FilaClan>("SELECT * FROM clanes WHERE id = ?", id); }
  private miembros(clan: number) { return this.db.sql<FilaMiembro>("SELECT * FROM miembros WHERE clan = ? ORDER BY desde", clan); }
  private nombre(u: number) { return this.db.usuario(u)?.nombre ?? "?"; }
  private guerraActiva(clan: number) {
    return this.db.uno<FilaGuerra>("SELECT * FROM guerras WHERE estado = 'activa' AND (clanA = ? OR clanB = ?)", clan, clan);
  }
  private reps(guerra: number, clan?: number) {
    return clan === undefined ? this.db.sql<{ usuario: number; clan: number }>("SELECT usuario, clan FROM guerra_reps WHERE guerra = ?", guerra)
      : this.db.sql<{ usuario: number; clan: number }>("SELECT usuario, clan FROM guerra_reps WHERE guerra = ? AND clan = ?", guerra, clan);
  }
  private entradas(guerra: number, carrera: number) {
    return this.db.sql<{ usuario: number; caballoId: string; estrategia: Strategy }>("SELECT usuario, caballoId, estrategia FROM guerra_entradas WHERE guerra = ? AND carrera = ?", guerra, carrera);
  }
  private carrerasDe(g: FilaGuerra): CarreraGuerra[] { return JSON.parse(g.carreras) as CarreraGuerra[]; }
  /** ¿Es representante de una guerra en curso? (no puede irse ni ser expulsado hasta que termine) */
  private esRepActivo(u: number, clan: number): boolean {
    const g = this.guerraActiva(clan);
    return !!g && this.reps(g.id).some((r) => r.usuario === u);
  }

  // ---------------------------------------------------------------- clan
  crear(u: number, nombre: string): Resultado<{ id: number }> {
    const v = validarNombreClan(nombre);
    if (!v.ok) return v;
    if (this.miembro(u)) return { ok: false, motivo: "Ya estás en un clan: salí primero." };
    if (this.db.uno("SELECT id FROM clanes WHERE nombre = ?", nombre.trim())) return { ok: false, motivo: "Ya existe un clan con ese nombre." };
    const ahora = this.reloj();
    const id = this.db.transaccion(() => {
      const r = this.db.hacer("INSERT INTO clanes (nombre, elo, creado) VALUES (?, ?, ?)", nombre.trim(), C.elo.inicial, ahora);
      this.db.hacer("INSERT INTO miembros (usuario, clan, rol, desde) VALUES (?, ?, 'lider', ?)", u, r.id, ahora);
      return r.id;
    });
    return { ok: true, id };
  }

  unirse(u: number, clanId: number): Resultado {
    if (this.miembro(u)) return { ok: false, motivo: "Ya estás en un clan: un clan por jugador." };
    const c = this.clan(clanId);
    if (!c) return { ok: false, motivo: "Ese clan no existe." };
    if (this.miembros(clanId).length >= C.maxMiembros) return { ok: false, motivo: `El clan está lleno (${C.maxMiembros} miembros).` };
    this.db.hacer("INSERT INTO miembros (usuario, clan, rol, desde) VALUES (?, ?, 'miembro', ?)", u, clanId, this.reloj());
    return { ok: true };
  }

  salir(u: number): Resultado {
    const m = this.miembro(u);
    if (!m) return { ok: false, motivo: "No estás en un clan." };
    if (this.esRepActivo(u, m.clan)) return { ok: false, motivo: "Sos representante en la guerra en curso: podés irte cuando termine." };
    this.db.transaccion(() => {
      this.db.hacer("DELETE FROM miembros WHERE usuario = ?", u);
      const quedan = this.miembros(m.clan);
      if (!quedan.length) {
        // Sin miembros el clan se disuelve (si estaba en guerra, la guerra sigue y se cierra a su hora)
        this.db.hacer("DELETE FROM cola_guerras WHERE clan = ?", m.clan);
        if (!this.guerraActiva(m.clan)) this.db.hacer("DELETE FROM clanes WHERE id = ?", m.clan);
      } else if (m.rol === "lider") {
        // El liderazgo pasa al oficial más antiguo; si no hay, al miembro más antiguo
        const nuevo = quedan.find((x) => x.rol === "oficial") ?? quedan[0];
        this.db.hacer("UPDATE miembros SET rol = 'lider' WHERE usuario = ?", nuevo.usuario);
      }
    });
    return { ok: true };
  }

  /** El líder cambia roles: oficial (hasta 3), miembro, o le pasa el liderazgo a otro (él queda como oficial). */
  cambiarRol(u: number, nombre: string, rol: Rol): Resultado {
    const yo = this.miembro(u);
    if (!yo || yo.rol !== "lider") return { ok: false, motivo: "Solo el líder cambia los roles." };
    const otro = this.db.usuarioPorNombre(nombre);
    const m = otro ? this.miembro(otro.id) : undefined;
    if (!otro || !m || m.clan !== yo.clan || otro.id === u) return { ok: false, motivo: "Ese jugador no está en tu clan." };
    if (rol === "oficial" && m.rol !== "oficial" && this.miembros(yo.clan).filter((x) => x.rol === "oficial").length >= C.maxOficiales)
      return { ok: false, motivo: `Puede haber hasta ${C.maxOficiales} oficiales.` };
    if (rol === "lider") {
      this.db.transaccion(() => {
        this.db.hacer("UPDATE miembros SET rol = 'lider' WHERE usuario = ?", otro.id);
        this.db.hacer("UPDATE miembros SET rol = 'oficial' WHERE usuario = ?", u);
        // Si ya había 3 oficiales, el más nuevo vuelve a miembro para respetar el tope
        const of = this.miembros(yo.clan).filter((x) => x.rol === "oficial");
        if (of.length > C.maxOficiales) this.db.hacer("UPDATE miembros SET rol = 'miembro' WHERE usuario = ?", of[of.length - 1].usuario === u ? of[of.length - 2].usuario : of[of.length - 1].usuario);
      });
      return { ok: true };
    }
    if (rol !== "oficial" && rol !== "miembro") return { ok: false, motivo: "Rol desconocido." };
    this.db.hacer("UPDATE miembros SET rol = ? WHERE usuario = ?", rol, otro.id);
    return { ok: true };
  }

  /** El líder expulsa a cualquiera; un oficial, solo a miembros. */
  expulsar(u: number, nombre: string): Resultado {
    const yo = this.miembro(u);
    const otro = this.db.usuarioPorNombre(nombre);
    const m = otro ? this.miembro(otro.id) : undefined;
    if (!yo || !otro || !m || m.clan !== yo.clan || otro.id === u) return { ok: false, motivo: "Ese jugador no está en tu clan." };
    if (!(yo.rol === "lider" || (yo.rol === "oficial" && m.rol === "miembro"))) return { ok: false, motivo: "No podés expulsar a ese jugador." };
    if (this.esRepActivo(otro.id, m.clan)) return { ok: false, motivo: "Es representante en la guerra en curso: se puede expulsar cuando termine." };
    this.db.hacer("DELETE FROM miembros WHERE usuario = ?", otro.id);
    return { ok: true };
  }

  // ---------------------------------------------------------------- guerra: búsqueda y emparejamiento
  buscarGuerra(u: number): Resultado {
    const m = this.miembro(u);
    if (!m || m.rol === "miembro") return { ok: false, motivo: "Solo el líder o un oficial buscan guerra." };
    if (this.guerraActiva(m.clan)) return { ok: false, motivo: "El clan ya está en guerra." };
    if (this.miembros(m.clan).length < C.minMiembrosGuerra) return { ok: false, motivo: `Hacen falta al menos ${C.minMiembrosGuerra} miembros.` };
    this.db.hacer("INSERT OR IGNORE INTO cola_guerras (clan, desde) VALUES (?, ?)", m.clan, this.reloj());
    this.emparejar();
    return { ok: true };
  }
  cancelarBusqueda(u: number): Resultado {
    const m = this.miembro(u);
    if (!m || m.rol === "miembro") return { ok: false, motivo: "Solo el líder o un oficial." };
    this.db.hacer("DELETE FROM cola_guerras WHERE clan = ?", m.clan);
    return { ok: true };
  }

  /** Empareja clanes de Elo parecido: ±150, que se abre hasta ±400 a los 30 min de espera (§14). */
  emparejar(): void {
    const ahora = this.reloj();
    const cola = this.db.sql<{ clan: number; desde: number; elo: number }>("SELECT q.clan, q.desde, c.elo FROM cola_guerras q JOIN clanes c ON c.id = q.clan ORDER BY q.desde");
    const usados = new Set<number>();
    for (const a of cola) {
      if (usados.has(a.clan)) continue;
      const v = ventanaElo(ahora - a.desde);
      const b = cola.filter((x) => x.clan !== a.clan && !usados.has(x.clan) && Math.abs(x.elo - a.elo) <= v)
        .sort((x, y) => Math.abs(x.elo - a.elo) - Math.abs(y.elo - a.elo))[0];
      if (!b) continue;
      usados.add(a.clan); usados.add(b.clan);
      this.declararGuerra(a.clan, b.clan, a.elo, b.elo, ahora);
    }
  }

  private declararGuerra(a: number, b: number, eloA: number, eloB: number, ahora: number): void {
    const carreras: CarreraGuerra[] = C.cierreCarrerasHoras.map((h, i) => ({
      n: i + 1, distancia: randomInt(2) ? 500 : 1500, superficie: randomInt(2) ? "cesped" : "tierra", cierra: ahora + h * HORA, corrida: null,
    }));
    this.db.transaccion(() => {
      this.db.hacer(`INSERT INTO guerras (clanA, clanB, inicio, fin, estado, carreras, eloA0, eloB0) VALUES (?, ?, ?, ?, 'activa', ?, ?, ?)`,
        a, b, ahora, ahora + C.duracionHoras * HORA, JSON.stringify(carreras), eloA, eloB);
      this.db.hacer("DELETE FROM cola_guerras WHERE clan IN (?, ?)", a, b);
    });
  }

  // ---------------------------------------------------------------- guerra: representantes y caballos
  /** Anotarse (o borrarse) como representante del clan en la guerra en curso: hasta 4 por clan. */
  representante(u: number, anotar: boolean): Resultado {
    const m = this.miembro(u);
    const g = m ? this.guerraActiva(m.clan) : undefined;
    if (!m || !g) return { ok: false, motivo: "Tu clan no está en guerra." };
    const reps = this.reps(g.id, m.clan);
    if (anotar) {
      if (reps.some((r) => r.usuario === u)) return { ok: true };
      if (reps.length >= C.representantes) return { ok: false, motivo: `Tu clan ya tiene ${C.representantes} representantes.` };
      this.db.hacer("INSERT INTO guerra_reps (guerra, clan, usuario) VALUES (?, ?, ?)", g.id, m.clan, u);
      return { ok: true };
    }
    return this.quitarRep(g, u);
  }
  /** El líder o un oficial saca a un representante (sus caballos anotados en carreras que no corrieron se borran). */
  quitarRepresentante(u: number, nombre: string): Resultado {
    const m = this.miembro(u);
    const g = m ? this.guerraActiva(m.clan) : undefined;
    if (!m || !g || m.rol === "miembro") return { ok: false, motivo: "Solo el líder o un oficial." };
    const otro = this.db.usuarioPorNombre(nombre);
    if (!otro || !this.reps(g.id, m.clan).some((r) => r.usuario === otro.id)) return { ok: false, motivo: "No es representante de tu clan." };
    return this.quitarRep(g, otro.id);
  }
  private quitarRep(g: FilaGuerra, u: number): Resultado {
    const corridas = this.carrerasDe(g).filter((c) => c.corrida !== null).map((c) => c.n);
    this.db.transaccion(() => {
      this.db.hacer("DELETE FROM guerra_reps WHERE guerra = ? AND usuario = ?", g.id, u);
      this.db.hacer(`DELETE FROM guerra_entradas WHERE guerra = ? AND usuario = ?${corridas.length ? ` AND carrera NOT IN (${corridas.join(",")})` : ""}`, g.id, u);
    });
    return { ok: true };
  }

  /** El representante anota su caballo y estrategia para una carrera (se puede cambiar hasta que corre). */
  anotarCaballo(u: number, carrera: number, caballoId: string, estrategia: Strategy): Resultado {
    const m = this.miembro(u);
    const g = m ? this.guerraActiva(m.clan) : undefined;
    if (!m || !g) return { ok: false, motivo: "Tu clan no está en guerra." };
    if (!this.reps(g.id, m.clan).some((r) => r.usuario === u)) return { ok: false, motivo: "Primero anotate como representante." };
    const c = this.carrerasDe(g).find((x) => x.n === carrera);
    const ahora = this.reloj();
    if (!c || c.corrida !== null || ahora >= c.cierra) return { ok: false, motivo: "Esa carrera ya corrió." };
    if (!ESTRATEGIAS.includes(estrategia)) return { ok: false, motivo: "Estrategia desconocida." };
    const caballo = this.acceso.leer(u).partida.caballos.find((x) => x.id === caballoId);
    if (!caballo) return { ok: false, motivo: "No se encontró el caballo." };
    const listo = puedeCorrer(caballo, ahora);
    if (!listo.ok) return listo;
    // Un caballo, una carrera pendiente a la vez (después de correr pasa a recuperación)
    const pendientes = this.carrerasDe(g).filter((x) => x.corrida === null && x.n !== carrera).map((x) => x.n);
    if (pendientes.some((n) => this.entradas(g.id, n).some((e) => e.usuario === u && e.caballoId === caballoId)))
      return { ok: false, motivo: "Ese caballo ya está anotado en otra carrera de la guerra." };
    this.db.hacer("INSERT OR REPLACE INTO guerra_entradas (guerra, carrera, usuario, caballoId, estrategia) VALUES (?, ?, ?, ?, ?)", g.id, carrera, u, caballoId, estrategia);
    // Si ya se anotaron todos los representantes de los dos clanes, la carrera corre ahora
    const reps = this.reps(g.id);
    const anotados = new Set(this.entradas(g.id, carrera).map((e) => e.usuario));
    const ambos = [g.clanA, g.clanB].every((cl) => reps.some((r) => r.clan === cl));
    if (ambos && reps.every((r) => anotados.has(r.usuario))) this.correrCarrera(g.id, carrera);
    return { ok: true };
  }

  // ---------------------------------------------------------------- guerra: carreras y final
  /** Corre una carrera de la guerra: una sola transacción para la guerra y todas las partidas que corren. */
  private correrCarrera(guerraId: number, n: number): void {
    const g = this.db.uno<FilaGuerra>("SELECT * FROM guerras WHERE id = ?", guerraId);
    if (!g || g.estado !== "activa") return;
    const carreras = this.carrerasDe(g);
    const c = carreras.find((x) => x.n === n)!;
    if (c.corrida !== null) return;
    const ahora = this.reloj();
    const reps = this.reps(g.id), entradas = this.entradas(g.id, n);
    const pendientesOtras = carreras.filter((x) => x.corrida === null && x.n !== n).flatMap((x) => this.entradas(g.id, x.n));
    // Cada representante corre con lo que anotó; si no anotó (o ya no está listo), con su mejor caballo listo
    const humanos: { usuario: number; clan: number; caballo: Caballo; estrategia: Strategy; dueno: string }[] = [];
    for (const r of reps) {
      const p = this.acceso.leer(r.usuario).partida;
      const e = entradas.find((x) => x.usuario === r.usuario);
      let caballo = e ? p.caballos.find((x) => x.id === e.caballoId && puedeCorrer(x, ahora).ok) : undefined;
      if (!caballo) caballo = p.caballos.filter((x) => puedeCorrer(x, ahora).ok && !pendientesOtras.some((o) => o.usuario === r.usuario && o.caballoId === x.id))
        .sort((a, b) => indiceDe(atributos(b)) - indiceDe(atributos(a)))[0];
      if (caballo) humanos.push({ usuario: r.usuario, clan: r.clan, caballo, estrategia: e?.estrategia ?? "equilibrada", dueno: this.nombre(r.usuario) });
    }
    const r = transaccionPartidas(this.db, this.acceso, humanos.map((h) => h.usuario), (ps) => {
      let resultado: PuestoGuerra[] = [];
      let setup: RaceSetup | undefined;
      if (humanos.length) {
        setup = newRaceSetupOnline(PARAMS._version, humanos.map((h) => ({ caballo: h.caballo, estrategia: h.estrategia, dueno: h.dueno })),
          { distance: c.distancia, surface: c.superficie, n: C.participantesPorCarrera, ahora });
        const res = simulateRace(setup.input, PARAMS);
        const best = res.finishTimes[res.order[0]];
        resultado = res.order.map((i, k) => {
          const ent = setup!.entrants[i];
          const h = humanos.find((x) => x.dueno === ent.dueno && x.caballo.id === ent.caballo.id);
          const lesion = res.injured.includes(i);
          return { puesto: k + 1, caballo: ent.caballo.nombre, dueno: h?.dueno ?? null, usuario: h?.usuario ?? null, clan: h?.clan ?? null,
            puntos: h ? puntosDePuesto(k + 1) : 0, tiempo: lesion ? null : res.finishTimes[i], lesion };
        });
        for (const h of humanos) {
          const i = setup.entrants.findIndex((x) => x.dueno === h.dueno && x.caballo.id === h.caballo.id);
          const lesion = res.injured.includes(i), tiempo = lesion ? 0 : res.finishTimes[i];
          registrarCarrera(ps.get(h.usuario)!, {
            modo: "guerra", distancia: c.distancia, superficie: c.superficie, caballoId: h.caballo.id, caballoNombre: h.caballo.nombre, estrategia: h.estrategia,
            posicion: res.order.indexOf(i) + 1, participantes: setup.entrants.length, tiempo, diferencia: lesion ? 0 : tiempo - best,
            fotoFinal: res.photoFinish, seed: setup.input.seed, simVersion: setup.input.simVersion, ...(lesion ? { lesion: true } : {}),
          }, ahora);
        }
      }
      c.corrida = ahora; c.resultado = resultado; c.setup = setup;
      const suma = (cl: number) => resultado.filter((x) => x.clan === cl).reduce((t, x) => t + x.puntos, 0);
      const cambios = this.db.hacer("UPDATE guerras SET carreras = ?, puntosA = puntosA + ?, puntosB = puntosB + ? WHERE id = ? AND estado = 'activa' AND carreras = ?",
        JSON.stringify(carreras), suma(g.clanA), suma(g.clanB), g.id, g.carreras).cambios;
      if (cambios !== 1) throw new Abortar("La guerra cambió mientras tanto.");
      return {};
    });
    if (!r.ok) return;
    if (carreras.every((x) => x.corrida !== null)) this.terminar(g.id);
  }

  /** Cierra la guerra: Elo de los dos clanes (K = 32) y premios a los que corrieron (§14). */
  private terminar(guerraId: number): void {
    const g = this.db.uno<FilaGuerra>("SELECT * FROM guerras WHERE id = ?", guerraId);
    if (!g || g.estado !== "activa") return;
    const ahora = this.reloj();
    const ganador = g.puntosA === g.puntosB ? null : g.puntosA > g.puntosB ? g.clanA : g.clanB;
    const sA: 0 | 0.5 | 1 = ganador === null ? 0.5 : ganador === g.clanA ? 1 : 0;
    const a = this.clan(g.clanA), b = this.clan(g.clanB);
    const eloA = a?.elo ?? g.eloA0, eloB = b?.elo ?? g.eloB0;
    const eloA1 = nuevoElo(eloA, eloB, sA), eloB1 = nuevoElo(eloB, eloA, (1 - sA) as 0 | 0.5 | 1);
    // Participantes: los que corrieron al menos una carrera, con el clan con el que corrieron
    const participantes = new Map<number, number>();
    for (const c of this.carrerasDe(g)) for (const x of c.resultado ?? []) if (x.usuario !== null && x.clan !== null) participantes.set(x.usuario, x.clan);
    const r = transaccionPartidas(this.db, this.acceso, [...participantes.keys()], (ps) => {
      if (this.db.hacer("UPDATE guerras SET estado = 'terminada', ganador = ?, eloA1 = ?, eloB1 = ?, terminada = ? WHERE id = ? AND estado = 'activa'",
        ganador, eloA1, eloB1, ahora, g.id).cambios !== 1) throw new Abortar("ya terminada");
      if (a) this.db.hacer("UPDATE clanes SET elo = ?, guerras = guerras + 1, victorias = victorias + ? WHERE id = ?", eloA1, ganador === a.id ? 1 : 0, a.id);
      if (b) this.db.hacer("UPDATE clanes SET elo = ?, guerras = guerras + 1, victorias = victorias + ? WHERE id = ?", eloB1, ganador === b.id ? 1 : 0, b.id);
      for (const [u, clan] of participantes) {
        const p = ps.get(u)!;
        mover(p, "oro", C.premios.participacion, "guerra:participacion", ahora, `g${g.id}`);
        if (clan === ganador) mover(p, "oro", C.premios.victoria, "guerra:victoria", ahora, `g${g.id}`);
      }
      // Si un clan quedó sin miembros durante la guerra, ahora se disuelve
      for (const cl of [g.clanA, g.clanB]) if (!this.miembros(cl).length) this.db.hacer("DELETE FROM clanes WHERE id = ?", cl);
      return {};
    });
    void r;
  }

  /** Cada pocos segundos: emparejar, correr las carreras que cerraron y terminar las guerras vencidas. */
  paso(): void {
    this.emparejar();
    const ahora = this.reloj();
    for (const g of this.db.sql<FilaGuerra>("SELECT * FROM guerras WHERE estado = 'activa'")) {
      for (const c of this.carrerasDe(g)) if (c.corrida === null && (c.cierra <= ahora || g.fin <= ahora)) this.correrCarrera(g.id, c.n);
      const al = this.db.uno<FilaGuerra>("SELECT * FROM guerras WHERE id = ?", g.id);
      if (al && al.estado === "activa" && (al.fin <= ahora || this.carrerasDe(al).every((c) => c.corrida !== null))) this.terminar(g.id);
    }
  }

  // ---------------------------------------------------------------- lo que ve el jugador
  estado(u: number) {
    const ahora = this.reloj();
    const m = this.miembro(u);
    if (!m) {
      const clanes = this.db.sql<FilaClan & { miembros: number }>(
        "SELECT c.*, (SELECT COUNT(*) FROM miembros x WHERE x.clan = c.id) AS miembros FROM clanes c ORDER BY c.elo DESC, c.id LIMIT 40");
      return { clan: null, clanes: clanes.map((c) => ({ id: c.id, nombre: c.nombre, elo: Math.round(c.elo), miembros: Number(c.miembros), lleno: Number(c.miembros) >= C.maxMiembros })), hora: ahora };
    }
    const c = this.clan(m.clan)!;
    const miembros = this.miembros(c.id).map((x) => ({ nombre: this.nombre(x.usuario), rol: x.rol, desde: x.desde, yo: x.usuario === u }));
    const cola = this.db.uno<{ desde: number }>("SELECT desde FROM cola_guerras WHERE clan = ?", c.id);
    const g = this.guerraActiva(c.id);
    const historial = this.db.sql<FilaGuerra>("SELECT * FROM guerras WHERE estado = 'terminada' AND (clanA = ? OR clanB = ?) ORDER BY terminada DESC LIMIT 10", c.id, c.id)
      .map((x) => this.vistaGuerra(x, c.id, u, ahora));
    return {
      clan: { id: c.id, nombre: c.nombre, elo: Math.round(c.elo), guerras: c.guerras, victorias: c.victorias, miRol: m.rol, miembros },
      buscando: cola ? { desde: cola.desde, ventana: Math.round(ventanaElo(ahora - cola.desde)) } : null,
      guerra: g ? this.vistaGuerra(g, c.id, u, ahora) : null,
      historial, hora: ahora,
    };
  }

  private vistaGuerra(g: FilaGuerra, nuestro: number, u: number, ahora: number) {
    const somosA = g.clanA === nuestro, rival = somosA ? g.clanB : g.clanA;
    const reps = this.reps(g.id);
    const nombreClan = (id: number) => this.clan(id)?.nombre ?? "(clan disuelto)";
    const misCaballos = new Map(this.acceso.leer(u).partida.caballos.map((x) => [x.id, x.nombre]));
    return {
      id: g.id, estado: g.estado, inicio: g.inicio, fin: g.fin, rival: nombreClan(rival),
      puntos: { nuestros: somosA ? g.puntosA : g.puntosB, rival: somosA ? g.puntosB : g.puntosA },
      resultado: g.estado === "terminada" ? (g.ganador === null ? "empate" : g.ganador === nuestro ? "victoria" : "derrota") : null,
      elo: g.estado === "terminada" ? { antes: Math.round(somosA ? g.eloA0 : g.eloB0), despues: Math.round((somosA ? g.eloA1 : g.eloB1) ?? 0) } : null,
      representantes: {
        nuestros: reps.filter((r) => r.clan === nuestro).map((r) => ({ nombre: this.nombre(r.usuario), yo: r.usuario === u })),
        rival: reps.filter((r) => r.clan === rival).map((r) => this.nombre(r.usuario)),
      },
      carreras: this.carrerasDe(g).map((c) => {
        const ent = this.entradas(g.id, c.n);
        return {
          n: c.n, distancia: c.distancia, superficie: c.superficie, cierra: c.cierra, corrida: c.corrida,
          anotados: {
            nuestros: ent.filter((e) => reps.some((r) => r.usuario === e.usuario && r.clan === nuestro)).map((e) => this.nombre(e.usuario)),
            rival: ent.filter((e) => reps.some((r) => r.usuario === e.usuario && r.clan === rival)).length,
          },
          mia: (() => { const e = ent.find((x) => x.usuario === u); return e ? { caballoId: e.caballoId, caballo: misCaballos.get(e.caballoId) ?? "?", estrategia: e.estrategia } : null; })(),
          resultado: c.resultado?.map((x) => ({ ...x, usuario: undefined, nuestro: x.clan === nuestro, rival: x.clan === rival })) ?? null,
          setup: c.setup ?? null,
        };
      }),
    };
  }
}
