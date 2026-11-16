// Conexión con el servidor del juego (Fase 7). La sesión (token) se guarda en este navegador.
// El servidor es la autoridad: el cliente pide acciones y recibe la partida actualizada.
import type { Partida } from "../domain/partida.ts";
import type { ResultadoAccion } from "../domain/acciones.ts";
import type { RaceSetup } from "../game/field.ts";
import type { CarreraPendiente, TokenCarrera } from "../domain/offline.ts";

export interface Sesion { token: string; nombre: string; }
// Con ?partida=nombre (partidas de prueba) la sesión también es aparte
const CLAVE = `caballos.sesion${new URLSearchParams(location.search).get("partida") ? ":" + new URLSearchParams(location.search).get("partida") : ""}`;

export function sesionGuardada(): Sesion | null {
  try { const v = JSON.parse(localStorage.getItem(CLAVE) ?? "null"); return v?.token ? v as Sesion : null; } catch { return null; }
}
function recordar(s: Sesion | null): void {
  try { if (s) localStorage.setItem(CLAVE, JSON.stringify(s)); else localStorage.removeItem(CLAVE); } catch { /* sin almacenamiento */ }
}

type Respuesta<T> = ({ ok: true } & T) | { ok: false; motivo: string; sinSesion?: boolean; sinServidor?: boolean };

async function pedir<T>(metodo: string, ruta: string, cuerpo?: unknown, token?: string): Promise<Respuesta<T>> {
  try {
    const r = await fetch(`/api${ruta}`, {
      method: metodo,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    // 502/503/504: Vite no encuentra el servidor del juego (no está prendido)
    if (r.status >= 502 && r.status <= 504) return { ok: false, motivo: "No hay conexión con el servidor del juego.", sinServidor: true };
    const datos = await r.json().catch(() => ({ ok: false, motivo: "Respuesta inválida del servidor." }));
    if (r.status === 401 && token) return { ok: false, motivo: datos.motivo ?? "La sesión venció.", sinSesion: true };
    return datos;
  } catch {
    return { ok: false, motivo: "No hay conexión con el servidor del juego.", sinServidor: true };
  }
}

export async function crearCuenta(nombre: string, clave: string, partidaLocal?: Partida) {
  const r = await pedir<{ token: string; nombre: string; partida: Partida }>("POST", "/registro", { nombre, clave, partida: partidaLocal });
  if (r.ok) recordar({ token: r.token, nombre: r.nombre });
  return r;
}
export async function entrarCuenta(nombre: string, clave: string) {
  const r = await pedir<{ token: string; nombre: string; partida: Partida }>("POST", "/entrar", { nombre, clave });
  if (r.ok) recordar({ token: r.token, nombre: r.nombre });
  return r;
}
export async function salir(s: Sesion): Promise<void> { await pedir("POST", "/salir", {}, s.token); recordar(null); }
export function olvidarSesion(): void { recordar(null); }

export const leerPartida = (s: Sesion) => pedir<{ partida: Partida; sucesos?: unknown[] }>("GET", "/partida", undefined, s.token);
export const accion = (s: Sesion, nombre: string, args: Record<string, unknown>) =>
  pedir<{ partida: Partida }>("POST", "/accion", { nombre, args }, s.token) as Promise<ResultadoAccion & { partida?: Partida; sinSesion?: boolean }>;
export const correrEnServidor = (s: Sesion, caballoId: string, modo: string, estrategia: string) =>
  pedir<{ setup: RaceSetup; cobro: { oro: number; bonoTutorial: number; reducido: boolean }; partida: Partida }>("POST", "/correr", { caballoId, modo, estrategia }, s.token);
export const servidorDisponible = async () => (await pedir<{ hora: number }>("GET", "/salud")).ok;

// ---- Fase 7.2: carreras contra otros jugadores
export type TipoOnline = "casual" | "ranked";
export interface SalaOnline {
  id: string; tipo: TipoOnline; distancia: 500 | 1500; superficie: "cesped" | "tierra"; fase: string; venceEleccion: number;
  /** pozo y cuota: la pizarra de apuestas (7.4); cuota = cuánto paga cada 1 de Oro si gana ese jugador (null: nadie le apostó). */
  jugadores: { nombre: string; listo: boolean; pozo: number; cuota: number | null }[];
  pozo: number; miApuesta: { en: string; monto: number } | null;
}
export interface EstadoOnline {
  donde: "nada" | "cola" | "sala"; enCola: number; colas: Record<TipoOnline, number>; tipo?: TipoOnline; minJugadores?: number; avisoSinRivalesSeg?: number;
  /** Nombres de los que esperan en la misma cola y, en la casual, cuándo se arma la carrera (hora del servidor). */ enEspera?: string[]; armaEn?: number;
  desde?: number; sala?: SalaOnline; hora: number;
}
/** 7.3: cambio de rating al terminar una Ranked. */
export interface CambioRating { antes: number; despues: number; carreras: number; colocacion: boolean; division: { nombre: string; color: string } | null; }
/** 7.4: cómo le fue a la apuesta (pago 0 = perdió; devuelta = nadie acertó o el jugador no largó). */
export interface ResultadoApuesta { en: string; monto: number; pago: number; dividendo: number | null; devuelta: boolean; }
export interface Cobro { oro: number; bonoTutorial: number; reducido: boolean; rating?: CambioRating; apuesta?: ResultadoApuesta;
  /** 7.5: carrera offline: el Oro se acredita al reconectar. */ pendiente?: boolean; }
export interface CarreraOnline { setup: RaceSetup; cobro: Cobro; partida: Partida; inicio: number; hora: number; /** id de la sala: para no reproducir dos veces la misma carrera. */ sala?: string; }
export const entrarCola = (s: Sesion, tipo: TipoOnline) => pedir<object>("POST", "/online/cola", { tipo }, s.token);

// ---- Fase 7.3: rating y ranking
export interface DivisionVista { id: string; nombre: string; desde: number; color: string; }
export interface MiRating { visible: number; carreras: number; colocacion: boolean; colocadas: number; totalColocacion: number; division: DivisionVista | null; puesto: number | null; nombre: string; }
export interface FilaRanking { puesto: number; nombre: string; rating: number; carreras: number; division: DivisionVista | null; yo: boolean; }
export const leerRanking = (s: Sesion) => pedir<{ top: FilaRanking[]; yo: MiRating }>("GET", "/ranking", undefined, s.token);
export const salirCola = (s: Sesion) => pedir<object>("POST", "/online/salir", {}, s.token);
/** Estado online pedido directamente (respaldo de los avisos en vivo); trae la carrera si hay una por ver. */
export const leerEstadoOnline = (s: Sesion) => pedir<EstadoOnline & { carrera?: CarreraOnline & { sala?: string } }>("GET", "/online/estado", undefined, s.token);
export const apostar = (s: Sesion, en: string, monto: number) => pedir<{ partida: Partida }>("POST", "/online/apostar", { en, monto }, s.token);
export const elegirOnline = (s: Sesion, caballoId: string, estrategia: string) => pedir<object>("POST", "/online/elegir", { caballoId, estrategia }, s.token);

/** Escucha los avisos del servidor (Server-Sent Events). Devuelve la función para dejar de escuchar. */
export function escucharOnline(s: Sesion, h: {
  estado: (e: EstadoOnline) => void; sala: (sala: SalaOnline, hora: number) => void; carrera: (c: CarreraOnline) => void; afuera: (motivo: string, rating?: CambioRating, apuesta?: ResultadoApuesta) => void; error: () => void;
}): () => void {
  const es = new EventSource(`/api/online/eventos?token=${encodeURIComponent(s.token)}`);
  es.addEventListener("estado", (e) => h.estado(JSON.parse((e as MessageEvent).data)));
  es.addEventListener("sala", (e) => { const d = JSON.parse((e as MessageEvent).data); h.sala(d.sala, d.hora); });
  es.addEventListener("carrera", (e) => h.carrera(JSON.parse((e as MessageEvent).data)));
  es.addEventListener("afuera", (e) => { const d = JSON.parse((e as MessageEvent).data); h.afuera(d.motivo, d.rating, d.apuesta); });
  es.onerror = () => h.error();
  return () => es.close();
}

// ---- Fase 7.5: carreras offline con tokens (GDD §15)
/** Lo que se guarda en este navegador para jugar sin conexión: tokens, carreras por sincronizar y la última partida. */
export interface DatosOffline { tokens: TokenCarrera[]; pendientes: CarreraPendiente[]; partida: Partida | null; }
const claveOffline = (s: Sesion) => `caballos.offline:${s.nombre.toLowerCase()}${CLAVE.includes(":") ? CLAVE.slice(CLAVE.indexOf(":")) : ""}`;
export function datosOffline(s: Sesion): DatosOffline {
  try {
    const v = JSON.parse(localStorage.getItem(claveOffline(s)) ?? "null");
    if (v && Array.isArray(v.tokens) && Array.isArray(v.pendientes)) return { tokens: v.tokens, pendientes: v.pendientes, partida: v.partida ?? null };
  } catch { /* sin almacenamiento o dañado */ }
  return { tokens: [], pendientes: [], partida: null };
}
export function guardarOffline(s: Sesion, d: DatosOffline): boolean {
  try { localStorage.setItem(claveOffline(s), JSON.stringify(d)); return true; } catch { return false; }
}
export const pedirTokens = (s: Sesion) => pedir<{ tokens: TokenCarrera[] }>("GET", "/offline/tokens", undefined, s.token);
export interface ResultadoSincronizacion { tokenId: string; ok: boolean; motivo?: string; posicion?: number; oro?: number; reducido?: boolean; }
export const sincronizarOffline = (s: Sesion, carreras: CarreraPendiente[]) =>
  pedir<{ resultados: ResultadoSincronizacion[]; partida: Partida; tokens: TokenCarrera[] }>("POST", "/offline/sincronizar",
    { carreras: carreras.map((c) => ({ token: { id: c.token.id, firma: c.token.firma }, caballoId: c.caballoId, estrategia: c.estrategia, jugadoEn: c.jugadoEn })) }, s.token);

// ---- Fase 8: mercado entre jugadores y subastas
export interface PublicacionVista {
  id: string; tipo: "venta" | "subasta"; estado: "activa" | "vendida" | "cancelada" | "vencida" | "sin_ofertas" | "fallida";
  vendedor: string; caballo: import("../domain/caballo.ts").Caballo; precio: number; fin: number; creada: number;
  mejorPuja: number | null; pujas: number; sugerido: number; minimaPuja: number | null; maximo: number;
  mia: boolean; liderando: boolean; comprador: string | null; precioFinal: number | null; compradaPorMi: boolean;
}
export interface DatosMercado {
  activas: PublicacionVista[]; mias: PublicacionVista[]; hora: number;
  compras: { usadas: number; ganando: number; maximo: number; quedan: number; proxima: number | null };
}
export const leerMercado = (s: Sesion) => pedir<DatosMercado>("GET", "/mercado", undefined, s.token);
export const accionMercado = (s: Sesion, accion: "publicar" | "cancelar" | "comprar" | "pujar", datos: Record<string, unknown>) =>
  pedir<DatosMercado & { partida: Partida; id?: string }>("POST", `/mercado/${accion}`, datos, s.token);

// ---- Fase 9: clanes y guerras
export type RolClan = "lider" | "oficial" | "miembro";
export interface PuestoGuerraVista { puesto: number; caballo: string; dueno: string | null; clan: number | null; puntos: number; tiempo: number | null; lesion: boolean; nuestro: boolean; rival: boolean; }
export interface CarreraGuerraVista {
  n: number; distancia: 500 | 1500; superficie: "cesped" | "tierra"; cierra: number; corrida: number | null;
  anotados: { nuestros: string[]; rival: number }; mia: { caballoId: string; caballo: string; estrategia: string } | null;
  resultado: PuestoGuerraVista[] | null; setup: RaceSetup | null;
}
export interface GuerraVista {
  id: number; estado: "activa" | "terminada"; inicio: number; fin: number; rival: string;
  puntos: { nuestros: number; rival: number }; resultado: "victoria" | "derrota" | "empate" | null; elo: { antes: number; despues: number } | null;
  representantes: { nuestros: { nombre: string; yo: boolean }[]; rival: string[] }; carreras: CarreraGuerraVista[];
}
export interface EstadoClan {
  clan: null | { id: number; nombre: string; elo: number; guerras: number; victorias: number; miRol: RolClan; miembros: { nombre: string; rol: RolClan; desde: number; yo: boolean }[] };
  clanes?: { id: number; nombre: string; elo: number; miembros: number; lleno: boolean }[];
  buscando?: { desde: number; ventana: number } | null; guerra?: GuerraVista | null; historial?: GuerraVista[]; hora: number;
}
export const leerClan = (s: Sesion) => pedir<EstadoClan>("GET", "/clan", undefined, s.token);
export const accionClan = (s: Sesion, accion: string, datos: Record<string, unknown> = {}) =>
  pedir<EstadoClan & { partida: Partida }>("POST", `/clan/${accion}`, datos, s.token);
