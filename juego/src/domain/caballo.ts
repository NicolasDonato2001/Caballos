// Entidad Caballo y su generación por raza (GDD v0.2 §5, §6, §19).
import razas from "../../config/balance/razas.json" with { type: "json" };
import { Rng } from "../sim/rng.ts";
import type { Attrs } from "../sim/types.ts";
import { pelajeAleatorio, type Pelaje } from "./pelaje.ts";
import { bonoMontura, type TipoMontura } from "./economia.ts";

export type Sexo = "macho" | "hembra";
export type EstadoCaballo = "disponible" | "recuperacion" | "colaRecuperacion" | "entrenando" | "cruza" | "creciendo" | "publicado";

export const RAZAS: string[] = Object.keys(razas.razas);
type DatosRaza = { perfil: number[]; techo: number[] };
const R = razas.razas as Record<string, DatosRaza>;

export interface Caballo {
  id: string;
  nombre: string;
  sexo: Sexo;
  /** Proporción de cada raza en su sangre (suma 1). */
  composicion: Record<string, number>;
  natural: number[];        // [Vel, Res, Pot, Tem, Int] heredables
  entreno: number[];        // puntos de entrenamiento por atributo
  predisposicion: number[]; // pesos de sorteo al entrenar (suma 1)
  techo: number[];          // techo genético según la composición
  pelaje: Pelaje;
  /** Variación individual de forma (−1…1) por eje morfológico; el render la traduce a morphs. */
  forma: number[];
  padreId: string | null;
  madreId: string | null;
  estado: EstadoCaballo;
  finEstado: number | null; // marca de tiempo (ms) en que termina el estado actual
  monturaId: string | null;
  /** Tipo de la montura puesta (copia de la del inventario, para calcular los atributos sin buscarla). */
  montura?: TipoMontura;
  /** Aspecto comprado con Gemas (crin, cascos, manta): solo visual, no se hereda. */
  aspecto?: { crin?: string; cascos?: string; manta?: string };
  /** Color del cuero de la montura puesta (copia del inventario, para dibujarla sin buscarla). */
  monturaColor?: string;
  victorias: number;
  carreras: number;
  creado: number;
  /** Cuándo empezó el estado actual (para dibujar el progreso). */
  inicioEstado?: number;
  /** Puntos que suma el entrenamiento en curso (se sortean al empezar y se aplican al terminar). */
  entrenoPendiente?: number[];
  /** Si salió antes de la recuperación: hasta cuándo no puede correr (sí puede entrenar). */
  descansoHasta?: number;
  /** 7.5: desde cuándo está disponible (fin de la última recuperación, entrenamiento o crecimiento). Al sincronizar carreras
   *  offline, una carrera de antes de esa hora no cuadra: el caballo no podía correr. */
  disponibleDesde?: number;
  /** Fase 8: id de la publicación del mercado entre jugadores (mientras está publicado no se puede usar). */
  publicacion?: string;
  /** Si espera turno en el Centro de recuperación: desde cuándo y cuántos minutos le tocan. */
  cola?: { desde: number; minutos: number };
  /** Fase 6.5: carga de trabajo guardada en la última carrera (baja con el tiempo). */
  carga?: { valor: number; t: number };
  /** Herraduras puestas y cuántas carreras les quedan. */
  herraduras?: { id: "aluminio" | "competicion"; carreras: number };
  /** Lesiones que tuvo (para la ficha). */
  lesiones?: number;
  /** Fase 5.5: rasgos visibles de su cruza (solo aspecto) y linaje raro (sube el techo genético). */
  rasgos?: string[];
  linaje?: string;
}

/** Atributos efectivos para correr: natural + entrenamiento + montura, máximo 100 (§11.7). */
export function atributos(c: Caballo): Attrs {
  const b = bonoMontura(c.montura);
  return c.natural.map((v, i) => Math.min(100, v + c.entreno[i] + b[i])) as unknown as Attrs;
}

/** Techo de una composición: promedio ponderado de los techos de cada raza, redondeado (GDD §5.3). */
export function techoDe(composicion: Record<string, number>): number[] {
  const t = [0, 0, 0, 0, 0];
  for (const [r, w] of Object.entries(composicion)) R[r].techo.forEach((v, i) => (t[i] += v * w));
  return t.map((x) => Math.round(x));
}

/** Razas ordenadas por proporción; "Pura sangre de X" si una supera el 87,5 %. */
export function descripcionRaza(composicion: Record<string, number>): string {
  const orden = Object.entries(composicion).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]);
  if (orden.length === 1 || orden[0][1] >= 0.875) return orden[0][0];
  return orden.slice(0, 2).map(([r, w]) => `${r} ${Math.round(w * 100)} %`).join(" · ");
}

const NOMBRES = [
  "Alba", "Brisa", "Centella", "Cimarrón", "Pampero", "Lucero", "Tormenta", "Relámpago", "Pehuén", "Zorzal",
  "Malón", "Tero", "Sombra", "Trueno", "Aurora", "Calandria", "Quimera", "Rayo", "Tala", "Ombú",
  "Indio", "Chalten", "Fortín", "Huracán", "Juncal", "Lagunero", "Morena", "Nube", "Paloma", "Quebracho",
  "Ranchera", "Sauce", "Tropilla", "Urutaú", "Vidala", "Yaguareté", "Zamba", "Baqueano", "Cardón", "Estrella",
];

let contador = 0;
export function nuevoId(rng: Rng): string {
  contador = (contador + 1) % 1e6;
  return `c-${Date.now().toString(36)}-${rng.nextU32().toString(36)}-${contador}`;
}

/** Ajusta atributos a [mínimo, techo] y presupuesto máximo con redondeo determinista (mayor resto). */
export function ajustarNaturales(a: number[], techo: number[]): number[] {
  const min = razas.minimoNatural, pres = razas.presupuestoNatural;
  let v = a.map((x, i) => Math.min(techo[i], Math.max(min, Math.round(x))));
  const suma = v.reduce((s, x) => s + x, 0);
  if (suma > pres) {
    const exacto = v.map((x) => (x * pres) / suma);
    v = exacto.map(Math.floor);
    let resto = pres - v.reduce((s, x) => s + x, 0);
    const orden = exacto.map((x, i) => [x - Math.floor(x), i] as const).sort((p, q) => q[0] - p[0] || p[1] - q[1]);
    for (const [, i] of orden) { if (resto <= 0) break; v[i]++; resto--; }
  }
  return v;
}

export interface OpcionesNuevo { raza: string; sexo?: Sexo; nombre?: string; natural?: number[]; }

/** Ejemplar común de una raza pura: perfil ±6, techo racial, predisposición y pelaje aleatorios. */
export function caballoDeRaza(rng: Rng, o: OpcionesNuevo): Caballo {
  const datos = R[o.raza];
  if (!datos) throw new Error(`Raza desconocida: ${o.raza}`);
  const composicion = { [o.raza]: 1 };
  const techo = techoDe(composicion);
  const v = razas.variacionIndividual;
  const natural = o.natural ?? ajustarNaturales(datos.perfil.map((x) => x + rng.int(2 * v + 1) - v), techo);
  // Predisposición: pesos alrededor de 1, ligeramente sesgados hacia los atributos fuertes de la raza.
  const pr = datos.perfil.map((x) => 0.6 + rng.next() * 0.8 + (x - 65) / 60);
  const sp = pr.reduce((s, x) => s + x, 0);
  return {
    id: nuevoId(rng),
    nombre: o.nombre ?? NOMBRES[rng.int(NOMBRES.length)],
    sexo: o.sexo ?? (rng.next() < 0.5 ? "macho" : "hembra"),
    composicion, natural, entreno: [0, 0, 0, 0, 0],
    predisposicion: pr.map((x) => x / sp), techo,
    pelaje: pelajeAleatorio(rng, composicion),
    forma: Array.from({ length: 4 }, () => rng.next() * 2 - 1),
    padreId: null, madreId: null, estado: "disponible", finEstado: null, monturaId: null,
    victorias: 0, carreras: 0, creado: Date.now(),
  };
}

/** El caballo inicial del tutorial: Criollo con atributos fijos (GDD §5.4); el jugador elige nombre y sexo. */
export function caballoInicial(rng: Rng, nombre: string, sexo: Sexo): Caballo {
  return caballoDeRaza(rng, { raza: razas.caballoInicial.raza, nombre, sexo, natural: [...razas.caballoInicial.attrs] });
}
