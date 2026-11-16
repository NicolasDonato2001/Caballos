// Fase 7 (GDD §2, §18): todas las acciones del jugador con nombre y argumentos simples (JSON).
// La misma tabla corre en el navegador (modo local) y en el servidor (modo online, autoritativo): el servidor pone la hora
// y el azar, así el cliente no puede elegir el resultado de un entrenamiento, una cruza o una carrera.
import type { Rng } from "../sim/rng.ts";
import type { Partida, TipoEdificio } from "./partida.ts";
import { caballoInicial, type Sexo } from "./caballo.ts";
import type { Pelaje } from "./pelaje.ts";
import {
  actualizar, comprarEspacio, detenerEntrenamiento, iniciarEntrenamiento, iniciarMejora, liberarCaballo, sacarDeRecuperacion, type Suceso,
} from "./edificios.ts";
import {
  acelerarCaballo, acelerarCruza, acelerarMejora, cobrarEntrada, cobrarObjetivo, comprarMontura, convertirGemas, equiparMontura, venderAlJuego,
  type TipoMontura,
} from "./economia.ts";
import { comprarOferta } from "./mercado.ts";
import { iniciarCruza } from "./crianza.ts";
import { comprarHerraduras, herrar, type TipoHerradura } from "./bienestar.ts";
import { moverPieza, renombrarCampo, type Pieza, type Ubicacion } from "./campo.ts";
import { guardarObjeto, moverObjeto, ponerObjeto, type Ocupacion } from "./decoracion.ts";
import { comprarAspecto, pintarMontura, vestirCaballo } from "./aspecto.ts";
import { inscribirCampeonato, sorteoPendiente } from "./carreras.ts";

export interface Contexto { ahora: number; rng: Rng; }
export type ResultadoAccion = { ok: true; [k: string]: unknown } | { ok: false; motivo: string };
type Args = Record<string, unknown>;
type Accion = (p: Partida, a: Args, c: Contexto) => ResultadoAccion;

const s = (v: unknown) => String(v ?? "");
const n = (v: unknown) => Number(v ?? NaN);
/** La ocupación del campo viaja como lista de [clave, tipo] (la calcula la vista del campo). */
const ocup = (v: unknown): Ocupacion => new Map(Array.isArray(v) ? (v as [string, "camino" | "fijo"][]) : []);
const rot = (v: unknown) => ((n(v) % 4 + 4) % 4) as 0 | 1 | 2 | 3;
const no = (motivo: string): ResultadoAccion => ({ ok: false, motivo });

export const ACCIONES: Record<string, Accion> = {
  /** El reloj: aplica lo que terminó (también con el juego cerrado). */
  reloj: (p, _a, c) => { const sucesos: Suceso[] = actualizar(p, c.ahora); return { ok: true, sucesos }; },
  /** Primer caballo (tutorial §16): el Criollo de §5.4; del cliente solo se toman nombre, sexo y pelaje (estética). */
  primerCaballo: (p, a, c) => {
    if (p.caballos.length) return no("Ya tenés tu primer caballo.");
    const nombre = s(a.nombre).trim().replace(/\s+/g, " ");
    if (nombre.length < 2 || nombre.length > 20) return no("El nombre debe tener entre 2 y 20 letras.");
    const h = caballoInicial(c.rng, nombre, a.sexo === "hembra" ? "hembra" : "macho" as Sexo);
    const pel = a.pelaje as Pelaje | undefined;
    if (pel && pel.genotipo && pel.marcas && typeof pel.semillaManchas === "number") h.pelaje = pel;
    h.creado = c.ahora;
    p.caballos.push(h);
    p.tutorial = { paso: 1, terminado: false };
    return { ok: true };
  },
  entrenar: (p, a, c) => iniciarEntrenamiento(p, s(a.id), c.ahora, c.rng),
  detenerEntrenamiento: (p, a) => detenerEntrenamiento(p, s(a.id)),
  sacarDeRecuperacion: (p, a, c) => sacarDeRecuperacion(p, s(a.id), c.ahora),
  liberar: (p, a) => liberarCaballo(p, s(a.id)),
  mejorar: (p, a, c) => iniciarMejora(p, s(a.tipo) as TipoEdificio, c.ahora),
  comprarEspacio: (p, a) => comprarEspacio(p, a.moneda === "gemas" ? "gemas" : "oro"),
  acelerarMejora: (p, a, c) => acelerarMejora(p, s(a.tipo) as TipoEdificio, c.ahora),
  acelerarCaballo: (p, a, c) => acelerarCaballo(p, s(a.id), c.ahora),
  acelerarCruza: (p, _a, c) => acelerarCruza(p, c.ahora),
  cruzar: (p, a, c) => iniciarCruza(p, s(a.padreId), s(a.madreId), s(a.nombre), c.ahora, c.rng),
  comprarOferta: (p, a, c) => comprarOferta(p, n(a.indice), c.ahora),
  venderAlJuego: (p, a, c) => venderAlJuego(p, s(a.id), c.ahora),
  comprarMontura: (p, a, c) => comprarMontura(p, s(a.tipo) as TipoMontura, a.moneda === "gemas" ? "gemas" : "oro", c.ahora),
  equiparMontura: (p, a) => equiparMontura(p, s(a.id), a.monturaId == null ? null : s(a.monturaId)),
  comprarHerraduras: (p, a, c) => comprarHerraduras(p, s(a.tipo) as TipoHerradura, c.ahora),
  herrar: (p, a) => herrar(p, s(a.id), s(a.tipo) as TipoHerradura),
  /** Comprar y poner en un caballo, en una sola acción (Mercado → Herraduras). */
  comprarYHerrar: (p, a, c) => { const r = comprarHerraduras(p, s(a.tipo) as TipoHerradura, c.ahora); return r.ok && a.id ? herrar(p, s(a.id), s(a.tipo) as TipoHerradura) : r; },
  comprarAspecto: (p, a, c) => comprarAspecto(p, s(a.id), c.ahora),
  vestir: (p, a) => vestirCaballo(p, s(a.id), s(a.tipo) as "crin" | "cascos" | "manta", a.aspecto == null ? null : s(a.aspecto)),
  pintarMontura: (p, a) => pintarMontura(p, s(a.monturaId), a.aspecto == null ? null : s(a.aspecto)),
  convertirGemas: (p, a, c) => convertirGemas(p, n(a.cantidad), c.ahora),
  cobrarObjetivo: (p, a, c) => cobrarObjetivo(p, s(a.id) as never, c.ahora),
  cobrarEntrada: (p, _a, c) => cobrarEntrada(p, c.ahora),
  renombrarCampo: (p, a, c) => renombrarCampo(p, s(a.nombre), c.ahora),
  moverPieza: (p, a) => moverPieza(p, s(a.pieza) as Pieza, { x: n(a.x), z: n(a.z), rot: rot(a.rot) } as Ubicacion),
  ponerObjeto: (p, a, c) => ponerObjeto(p, s(a.id), n(a.cx), n(a.cz), rot(a.rot), ocup(a.ocupacion), c.ahora),
  moverObjeto: (p, a) => moverObjeto(p, s(a.uid), n(a.cx), n(a.cz), rot(a.rot), ocup(a.ocupacion)),
  guardarObjeto: (p, a) => guardarObjeto(p, s(a.uid)),
  sortearCarrera: (p, _a, c) => { sorteoPendiente(p, c.rng); return { ok: true }; },
  inscribirCampeonato: (p, _a, c) => inscribirCampeonato(p, c.ahora, c.rng),
};

/** Ejecuta una acción sobre la partida (la modifica). El reloj corre antes, para partir del estado al día. */
export function ejecutar(p: Partida, nombre: string, args: Args, c: Contexto): ResultadoAccion {
  const f = ACCIONES[nombre];
  if (!f) return no(`Acción desconocida: ${nombre}`);
  const sucesos = nombre === "reloj" ? [] : actualizar(p, c.ahora);
  const r = f(p, args ?? {}, c);
  return r.ok && sucesos.length ? { ...r, sucesos: [...sucesos, ...((r.sucesos as Suceso[] | undefined) ?? [])] } : r;
}
