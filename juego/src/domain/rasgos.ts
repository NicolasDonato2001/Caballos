// Fase 5.5 (GDD §24.3): rasgos visibles de cada cruza y linajes raros.
// Los rasgos son solo aspecto (forma y color). Los linajes además suben el techo genético; la suma natural sigue ≤ 360.
import cfg from "../../config/balance/rasgos.json" with { type: "json" };
import type { Rng } from "../sim/rng.ts";
import type { Caballo } from "./caballo.ts";
import type { Pelaje } from "./pelaje.ts";

export interface Rasgo {
  nombre: string; descripcion: string;
  cuello?: number; patas?: number; cuerpo?: number; morph?: Record<string, number>;
  crin?: string; brillo?: boolean; marcasPatas?: number; marcaCara?: number;
}
export interface Linaje {
  nombre: string; razas: string[]; descripcion: string; techo: number[];
  cuerpo?: string; crin?: string; leopardo?: boolean; rasgos: string[];
}
export const RASGOS = cfg.rasgos as Record<string, Rasgo>;
export const LINAJES = cfg.linajes.lista as Record<string, Linaje>;
export const rasgo = (id: string): Rasgo | undefined => RASGOS[id];
export const linaje = (id?: string): Linaje | undefined => (id ? LINAJES[id] : undefined);

const clavePar = (a: string, b: string) => [a, b].sort().join("|");
/** Rasgo propio de la cruza de dos razas. */
export const rasgoDePar = (a: string, b: string): string | undefined => (cfg.pares as Record<string, string>)[clavePar(a, b)];

/** Pares de razas con sangre suficiente en una composición. */
function pares(comp: Record<string, number>, minimo: number): [string, string][] {
  const r = Object.keys(comp).filter((k) => comp[k] >= minimo).sort();
  const out: [string, string][] = [];
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) out.push([r[i], r[j]]);
  return out;
}

/** Rasgos del potrillo: los de las cruzas que lleva en la sangre (70 %) y algunos de los padres (40 % cada uno). */
export function rasgosHijo(rng: Rng, padre: Caballo, madre: Caballo, comp: Record<string, number>): string[] {
  const r: string[] = [];
  for (const [a, b] of pares(comp, cfg.minimoSangreParaRasgo)) {
    const id = rasgoDePar(a, b);
    if (rng.next() < cfg.probabilidadRasgoDeCruza && id && !r.includes(id)) r.push(id);
  }
  for (const id of [...(padre.rasgos ?? []), ...(madre.rasgos ?? [])]) {
    if (rng.next() < cfg.probabilidadHeredarRasgo && !r.includes(id) && RASGOS[id]) r.push(id);
  }
  // Si sobran, se queda con los primeros (las cruzas propias pesan más que lo heredado)
  return r.slice(0, cfg.maximoRasgos);
}

/** Linaje raro del potrillo (o ninguno). */
export function linajeHijo(rng: Rng, padre: Caballo, madre: Caballo, comp: Record<string, number>): string | undefined {
  const L = cfg.linajes;
  let elegido: string | undefined;
  for (const [id, l] of Object.entries(LINAJES)) {
    const u = rng.next();
    if (!l.razas.every((r) => (comp[r] ?? 0) >= L.minimoSangre)) continue;
    const n = (padre.linaje === id ? 1 : 0) + (madre.linaje === id ? 1 : 0);
    const p = n === 2 ? L.probabilidadDosPadres : n === 1 ? L.probabilidadUnPadre : L.probabilidad;
    if (!elegido && u < p) elegido = id;
  }
  return elegido;
}

/** Techo con el plus del linaje (tope techoMaximo). */
export function techoConLinaje(techo: number[], id?: string): number[] {
  const l = linaje(id);
  return l ? techo.map((t, i) => Math.min(cfg.linajes.techoMaximo, t + (l.techo[i] ?? 0))) : techo;
}

/** Los rasgos y el linaje que tocan marcas blancas (calzado, malacara) se escriben en el pelaje al nacer. */
export function marcarPelaje(pelaje: Pelaje, rasgos: string[]): void {
  for (const id of rasgos) {
    const x = RASGOS[id];
    if (x?.marcasPatas) pelaje.marcas.patas = pelaje.marcas.patas.map((v) => Math.max(v, x.marcasPatas!)) as [number, number, number, number];
    if (x?.marcaCara) pelaje.marcas.cara = Math.max(pelaje.marcas.cara, x.marcaCara) as 0 | 1 | 2 | 3;
  }
}

/** Todos los rasgos que se ven en un caballo (los suyos más los de su linaje). */
export function rasgosVisibles(c: { rasgos?: string[]; linaje?: string }): string[] {
  return [...new Set([...(c.rasgos ?? []), ...(linaje(c.linaje)?.rasgos ?? [])])];
}

/** Lo que el render necesita para dibujar la forma: multiplicadores del esqueleto, refuerzos de raza y colores. */
export interface FormaVisible { escala: number; cuello: number; patas: number; cuerpo: number; morph: Record<string, number>; crin?: string; cuerpoColor?: string; brillo: boolean; leopardo: boolean; }
export function formaVisible(c: { forma?: number[]; rasgos?: string[]; linaje?: string }): FormaVisible {
  const f = c.forma ?? [0, 0, 0, 0];
  // Variación individual (forma, −1…1): alzada ±2,5 %, cuello ±7 %, remos ±3,5 %, largo de cuerpo ±3,5 %
  const v: FormaVisible = { escala: 1 + 0.025 * (f[0] ?? 0), cuello: 1 + 0.07 * (f[1] ?? 0), patas: 1 + 0.035 * (f[2] ?? 0), cuerpo: 1 + 0.035 * (f[3] ?? 0), morph: {}, brillo: false, leopardo: false };
  for (const id of rasgosVisibles(c)) {
    const x = RASGOS[id];
    if (!x) continue;
    v.cuello += x.cuello ?? 0; v.patas += x.patas ?? 0; v.cuerpo += x.cuerpo ?? 0;
    for (const [r, d] of Object.entries(x.morph ?? {})) v.morph[r] = (v.morph[r] ?? 0) + d;
    if (x.crin) v.crin = x.crin;
    if (x.brillo) v.brillo = true;
  }
  // Los refuerzos de raza suman como mucho 0,9: con varios rasgos juntos la forma no se deforma
  const extra = Object.values(v.morph).reduce((x, y) => x + y, 0);
  if (extra > 0.9) for (const r of Object.keys(v.morph)) v.morph[r] *= 0.9 / extra;
  const l = linaje(c.linaje);
  if (l) { if (l.crin) v.crin = l.crin; if (l.cuerpo) v.cuerpoColor = l.cuerpo; if (l.leopardo) v.leopardo = true; }
  return v;
}

/** Para la interfaz de la cruza: rasgos que puede mostrar el potrillo y linajes raros posibles con su probabilidad. */
export function pronosticoCruza(padre: Caballo, madre: Caballo, comp: Record<string, number>): { rasgos: string[]; heredables: string[]; linajes: { id: string; prob: number }[] } {
  const rasgos = [...new Set(pares(comp, cfg.minimoSangreParaRasgo).map(([a, b]) => rasgoDePar(a, b)!).filter(Boolean))];
  const heredables = [...new Set([...(padre.rasgos ?? []), ...(madre.rasgos ?? [])])].filter((r) => !rasgos.includes(r));
  const L = cfg.linajes;
  const linajes = Object.entries(LINAJES).filter(([, l]) => l.razas.every((r) => (comp[r] ?? 0) >= L.minimoSangre)).map(([id]) => {
    const n = (padre.linaje === id ? 1 : 0) + (madre.linaje === id ? 1 : 0);
    return { id, prob: n === 2 ? L.probabilidadDosPadres : n === 1 ? L.probabilidadUnPadre : L.probabilidad };
  });
  return { rasgos, heredables, linajes };
}
