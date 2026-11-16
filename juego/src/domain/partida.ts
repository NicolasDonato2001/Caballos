// Estado del jugador y guardado local (GDD v0.2 §8.1, §15, §16).
// En esta fase el guardado es solo local (IndexedDB). La sincronización con servidor llega en la Fase 7.
import cfg from "../../config/balance/edificios.json" with { type: "json" };
import type { Caballo } from "./caballo.ts";
import type { Campeonato, RegistroCarrera } from "./carreras.ts";
import type { Mercado } from "./mercado.ts";
import type { Cruza } from "./crianza.ts";
import type { Diario, Entrada, Montura, Movimiento, Semanal } from "./economia.ts";
import type { Decoracion } from "./decoracion.ts";
import type { Disposicion } from "./campo.ts";

export const VERSION_PARTIDA = 2;

export type TipoEdificio = "establo" | "entrenamiento" | "recuperacion";
export const EDIFICIOS: TipoEdificio[] = ["establo", "entrenamiento", "recuperacion"];

export interface Edificio {
  nivel: number;              // 1–5
  mejoraFin: number | null;   // marca de tiempo (ms) en que termina la mejora en curso
}

export interface Partida {
  version: number;
  creada: number;
  oro: number;
  gemas: number;
  edificios: Record<TipoEdificio, Edificio>;
  espacios: number;           // espacios desbloqueados (5 gratis, el resto comprados)
  caballos: Caballo[];
  tutorial: { paso: number; terminado: boolean };
  /** Distancia y superficie ya sorteadas para la próxima carrera: se revelan antes de elegir caballo y no se vuelven
   *  a sortear hasta correrla (§9.1). */
  sorteo?: { distancia: 500 | 1500; superficie: "cesped" | "tierra" };
  /** Últimas carreras del jugador, la más reciente primero (Fase 4). */
  historial?: RegistroCarrera[];
  /** Ofertas del Mercado del juego para el día en curso (Fase 5; §12.1). */
  mercado?: Mercado;
  /** Cruza en curso (una por establo, §10.1). Reserva un espacio para el potrillo. */
  cruza?: Cruza;
  /** Fase 6 (§11): movimientos de Oro y Gemas, contadores del día y de la semana, monturas del inventario. */
  ledger?: Movimiento[];
  diario?: Diario;
  /** 7.5: contadores de los últimos días (las carreras offline se cobran con el límite del día en que se corrieron). */
  diariosPasados?: Diario[];
  semanal?: Semanal;
  monturas?: Montura[];
  /** Inscripción al campeonato semanal (§11.3). */
  campeonato?: Campeonato;
  /** Decoración libre del campo (§11.5): objetos puestos y guardados en el depósito. */
  decoracion?: Decoracion;
  /** Recompensa por entrar: último día cobrado y racha (§24.1). */
  entrada?: Entrada;
  /** Aspectos comprados con Gemas (ids del catálogo). */
  aspectos?: string[];
  /** Campo 2.0: dónde puso el jugador cada edificio, el potrero y el molino (§24.4). */
  disposicion?: Partial<Disposicion>;
  /** Nombre del establecimiento y cuántas veces se cambió (el primero es gratis). */
  /** Fase 6.5: juegos de herraduras guardados (sin poner). */
  herraduras?: Partial<Record<"aluminio" | "competicion", number>>;
  nombreCampo?: string;
  cambiosNombre?: number;
  /** Fase 8: subastas que el jugador va ganando. Su Oro ya está reservado y cada una reserva un lugar en el establo. */
  pujasMercado?: { pub: string; monto: number }[];
  /** Fase 8: cuándo compró en el mercado entre jugadores (máximo 3 cada 7 días, §12.3). */
  comprasMercado?: number[];
}

/** Techo de capacidad por nivel del Establo (GDD §8.1); índice = nivel. */
export const TECHO_ESTABLO = [0, ...cfg.establo.techoPorNivel];

export function partidaNueva(ahora = Date.now()): Partida {
  const e = (): Edificio => ({ nivel: 1, mejoraFin: null });
  return {
    version: VERSION_PARTIDA, creada: ahora, oro: 1000, gemas: 0,
    edificios: { establo: e(), entrenamiento: e(), recuperacion: e() },
    espacios: cfg.establo.espaciosGratis, caballos: [], tutorial: { paso: 0, terminado: false },
  };
}

export function capacidad(p: Partida): number { return Math.min(p.espacios, TECHO_ESTABLO[p.edificios.establo.nivel]); }
/** Espacios ocupados: los caballos, el potrillo de una cruza en curso (§10.1) y las subastas que va ganando (Fase 8):
 *  todos tienen su lugar reservado. */
export function ocupados(p: Partida): number { return p.caballos.length + (p.cruza ? 1 : 0) + (p.pujasMercado?.length ?? 0); }
export function hayLugar(p: Partida): boolean { return ocupados(p) < capacidad(p); }

/** Agrega un caballo respetando la capacidad. Devuelve false si no hay lugar. */
export function agregarCaballo(p: Partida, c: Caballo): boolean {
  if (!hayLugar(p)) return false;
  p.caballos.push(c);
  return true;
}

/** Migra partidas guardadas con versiones anteriores (punto único de compatibilidad). */
export function migrar(datos: unknown): Partida | null {
  if (!datos || typeof datos !== "object") return null;
  const p = { ...(datos as Record<string, unknown>) };
  if (!Array.isArray(p.caballos)) return null;
  if (p.version === 1) {
    // v1 (Fase 2): solo tenía el nivel del establo
    const nivel = typeof p.nivelEstablo === "number" ? p.nivelEstablo : 1;
    p.edificios = { establo: { nivel, mejoraFin: null }, entrenamiento: { nivel: 1, mejoraFin: null }, recuperacion: { nivel: 1, mejoraFin: null } };
    delete p.nivelEstablo;
    p.version = 2;
  }
  if (p.version !== VERSION_PARTIDA) return null;
  return p as unknown as Partida;
}

// ---------------- Almacenamiento ----------------

export interface Almacen {
  cargar(): Promise<Partida | null>;
  guardar(p: Partida): Promise<void>;
  borrar(): Promise<void>;
}

/** Almacén en memoria (pruebas y respaldo si IndexedDB no está disponible). */
export class AlmacenMemoria implements Almacen {
  private dato: string | null = null;
  async cargar() { return this.dato ? migrar(JSON.parse(this.dato)) : null; }
  async guardar(p: Partida) { this.dato = JSON.stringify(p); }
  async borrar() { this.dato = null; }
}

/** Almacén IndexedDB del navegador. Una sola clave: la partida completa (escrituras atómicas por transacción). */
export class AlmacenIndexedDB implements Almacen {
  private db: Promise<IDBDatabase>;
  private readonly store = "partida";

  constructor(nombre = "caballos") {
    this.db = new Promise((ok, mal) => {
      const req = indexedDB.open(nombre, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(this.store);
      req.onsuccess = () => ok(req.result);
      req.onerror = () => mal(req.error);
    });
  }

  private async tx<T>(modo: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db;
    return new Promise((ok, mal) => {
      const t = db.transaction(this.store, modo);
      const r = f(t.objectStore(this.store));
      t.oncomplete = () => ok(r.result);
      t.onerror = () => mal(t.error);
      t.onabort = () => mal(t.error);
    });
  }

  async cargar() { return migrar(await this.tx("readonly", (s) => s.get("actual"))); }
  async guardar(p: Partida) { await this.tx("readwrite", (s) => s.put(JSON.parse(JSON.stringify(p)), "actual")); }
  async borrar() { await this.tx("readwrite", (s) => s.delete("actual")); }
}

export function almacenPorDefecto(): Almacen {
  try {
    // ?partida=nombre usa otra partida guardada (para probar sin tocar la propia).
    const extra = typeof location !== "undefined" ? new URLSearchParams(location.search).get("partida") : null;
    if (typeof indexedDB !== "undefined") return new AlmacenIndexedDB(extra ? `caballos-${extra.replace(/[^\w-]/g, "").slice(0, 30)}` : "caballos");
  } catch { /* modo privado o bloqueado */ }
  return new AlmacenMemoria();
}
