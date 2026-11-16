// Genética de pelaje simplificada (GDD v0.2 §10.4). Inspirada en loci reales documentados
// (UC Davis VGL: MC1R/Extension, ASIP/Agouti, Cream, Dun, Grey, Roan, Tobiano, Leopard),
// sin simular el genoma completo. Cada locus tiene dos alelos; el potrillo recibe uno de cada padre (Fase 5).
import type { Rng } from "../sim/rng.ts";

export type Locus = "E" | "A" | "Cr" | "D" | "G" | "Rn" | "To" | "Lp";
/** Alelo dominante/variante = true (E, A, Cr, D, G, Rn, To, Lp); recesivo/silvestre = false (e, a, n…). */
export type Genotipo = Record<Locus, [boolean, boolean]>;

/** Marcas blancas: poligénicas, se modelan como niveles 0–3. */
export interface Marcas { cara: 0 | 1 | 2 | 3; patas: [number, number, number, number]; } // MI, MD, PI, PD (0–3)

export interface Pelaje { genotipo: Genotipo; marcas: Marcas; semillaManchas: number; }

export const LOCI: Locus[] = ["E", "A", "Cr", "D", "G", "Rn", "To", "Lp"];

/** Frecuencia del alelo variante por raza (probabilidad de cada alelo). Valores de juego. */
export const FRECUENCIAS: Record<string, Partial<Record<Locus, number>>> = {
  "Pura Sangre Inglés": { E: 0.55, A: 0.75, Cr: 0.0, D: 0.0, G: 0.04, Rn: 0.01, To: 0.0, Lp: 0.0 },
  "Árabe":              { E: 0.55, A: 0.70, Cr: 0.0, D: 0.0, G: 0.30, Rn: 0.0, To: 0.0, Lp: 0.0 },
  "Cuarto de Milla":    { E: 0.35, A: 0.55, Cr: 0.08, D: 0.06, G: 0.04, Rn: 0.06, To: 0.0, Lp: 0.0 },
  "Akhal-Teke":         { E: 0.55, A: 0.70, Cr: 0.22, D: 0.0, G: 0.06, Rn: 0.0, To: 0.0, Lp: 0.0 },
  "Appaloosa":          { E: 0.55, A: 0.60, Cr: 0.03, D: 0.03, G: 0.02, Rn: 0.04, To: 0.0, Lp: 0.60 },
  "Criollo":            { E: 0.55, A: 0.65, Cr: 0.06, D: 0.30, G: 0.06, Rn: 0.06, To: 0.08, Lp: 0.0 },
  "Andaluz":            { E: 0.55, A: 0.70, Cr: 0.02, D: 0.0, G: 0.45, Rn: 0.0, To: 0.0, Lp: 0.0 },
  "Frisón":             { E: 1.0, A: 0.0, Cr: 0.0, D: 0.0, G: 0.0, Rn: 0.0, To: 0.0, Lp: 0.0 },
};
/** Tendencia a marcas blancas por raza (0–1). */
export const MARCAS_RAZA: Record<string, number> = {
  "Pura Sangre Inglés": 0.45, "Árabe": 0.45, "Cuarto de Milla": 0.5, "Akhal-Teke": 0.3, "Appaloosa": 0.4,
  "Criollo": 0.35, "Andaluz": 0.15, "Frisón": 0.02,
};

const alelo = (rng: Rng, p: number) => rng.next() < p;

/** Pelaje de un ejemplar nacido de una raza (o mezcla) según las frecuencias. */
export function pelajeAleatorio(rng: Rng, composicion: Record<string, number>): Pelaje {
  const freq = (l: Locus) => Object.entries(composicion).reduce((s, [r, w]) => s + w * (FRECUENCIAS[r]?.[l] ?? 0), 0);
  const genotipo = {} as Genotipo;
  for (const l of LOCI) genotipo[l] = [alelo(rng, freq(l)), alelo(rng, freq(l))];
  // Locus con alelo letal en homocigosis real (no aplica a los elegidos); Roan homocigoto se trata como roan.
  const tm = Object.entries(composicion).reduce((s, [r, w]) => s + w * (MARCAS_RAZA[r] ?? 0.3), 0);
  const nivel = () => Math.min(3, Math.floor((rng.next() * rng.next() * 4.5) * (tm * 1.6)));
  return {
    genotipo,
    marcas: { cara: nivel() as 0 | 1 | 2 | 3, patas: [nivel(), nivel(), nivel(), nivel()] },
    semillaManchas: rng.nextU32(),
  };
}

export const tiene = (g: Genotipo, l: Locus) => g[l][0] || g[l][1];
export const doble = (g: Genotipo, l: Locus) => g[l][0] && g[l][1];

export type RGB = [number, number, number];
export interface Fenotipo {
  nombre: string;          // nombre del pelaje en español rioplatense
  cuerpo: RGB;             // color base del cuerpo (0–1)
  crin: RGB;               // crin y cola
  extremos: RGB | null;    // patas bajas (puntos negros del castaño, bayo, gateado)
  raya: boolean;           // raya de mula (dun)
  tordillo: boolean;       // canas que aclaran el pelaje
  rosillo: boolean;        // pelos blancos mezclados en el cuerpo
  tobiano: boolean;        // manchas blancas grandes que cruzan el lomo
  leopardo: boolean;       // manchas de Appaloosa
  marcas: Marcas;
}

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

/** Traduce el genotipo a lo que se ve. Orden de epistasis simplificado: E/A → Cr → D → Rn → G → patrones. */
export function fenotipo(p: Pelaje): Fenotipo {
  const g = p.genotipo;
  const rojo = !tiene(g, "E");               // ee: alazán
  const negro = !rojo && !tiene(g, "A");      // E_ aa: negro
  const nCr = (g.Cr[0] ? 1 : 0) + (g.Cr[1] ? 1 : 0);
  const dun = tiene(g, "D");
  let nombre: string, cuerpo: string, crin: string, extremos: string | null = null;
  if (rojo) { nombre = "Alazán"; cuerpo = "#9a4f24"; crin = "#7a3a19"; }
  else if (negro) { nombre = "Negro"; cuerpo = "#1c1716"; crin = "#0f0c0b"; }
  else { nombre = "Castaño"; cuerpo = "#6e3d20"; crin = "#151110"; extremos = "#1a1412"; }
  if (nCr === 1) {
    if (rojo) { nombre = "Palomino"; cuerpo = "#d2a85c"; crin = "#f0e6cc"; }
    else if (negro) { nombre = "Negro ahumado"; cuerpo = "#2e2622"; }
    else { nombre = "Bayo"; cuerpo = "#c99a58"; extremos = "#1e1814"; }
  } else if (nCr === 2) {
    nombre = rojo ? "Cremello" : negro ? "Crema ahumado" : "Perlino";
    cuerpo = "#efe2c4"; crin = rojo ? "#f3ead6" : "#d9c39c"; extremos = null;
  }
  if (dun) {
    if (rojo) { nombre = nCr ? nombre + " pardo" : "Colorado pardo"; cuerpo = nCr ? cuerpo : "#c08356"; }
    else if (negro) { nombre = "Lobuno"; cuerpo = "#7b6f62"; extremos = "#25201c"; }
    else if (!nCr) { nombre = "Gateado"; cuerpo = "#b08752"; }
  }
  const tordillo = tiene(g, "G");
  const rosillo = tiene(g, "Rn") && !tordillo;
  if (tordillo) nombre = "Tordillo";
  else if (rosillo) nombre = (rojo ? "Rosillo colorado" : negro ? "Rosillo moro" : "Rosillo");
  const tobiano = tiene(g, "To");
  const leopardo = tiene(g, "Lp");
  if (tobiano) nombre += " tobiano";
  if (leopardo) nombre += " manchado";
  return {
    nombre, cuerpo: hex(cuerpo), crin: hex(crin), extremos: extremos ? hex(extremos) : null,
    raya: dun, tordillo, rosillo, tobiano, leopardo, marcas: p.marcas,
  };
}
