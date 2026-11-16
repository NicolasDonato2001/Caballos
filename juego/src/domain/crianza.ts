// Crianza (GDD v0.2 §10). Un macho y una hembra disponibles, 500 Oro y un espacio libre que queda reservado.
// La cruza dura 8 h con los padres ocupados; después nace el potrillo, que crece 24 h sin entrenar ni correr.
// El potrillo se genera al empezar la cruza (con la semilla de ese momento) y se revela al nacer.
import cfg from "../../config/balance/crianza.json" with { type: "json" };
import type { Rng } from "../sim/rng.ts";
import { ajustarNaturales, nuevoId, techoDe, type Caballo, type Sexo } from "./caballo.ts";
import { LOCI, type Genotipo, type Pelaje } from "./pelaje.ts";
import { hayLugar, type Partida } from "./partida.ts";
import { mover } from "./economia.ts";
import { linajeHijo, marcarPelaje, rasgosHijo, rasgosVisibles, techoConLinaje } from "./rasgos.ts";

type Resultado = { ok: true } | { ok: false; motivo: string };
const no = (motivo: string): Resultado => ({ ok: false, motivo });
const HORA = 3_600_000;

export interface Cruza { padreId: string; madreId: string; inicio: number; fin: number; potrillo: Caballo; }

export const COSTO_CRUZA = cfg.costoOro;
export const HORAS_CRUZA = cfg.horasCruza;
export const HORAS_CRECIMIENTO = cfg.horasCrecimiento;

/** Composición del potrillo: promedio de la de los padres (redondeada a 1/1024 para que no se acumulen decimales). */
export function composicionHija(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const r: Record<string, number> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const w = Math.round((((a[k] ?? 0) + (b[k] ?? 0)) / 2) * 1024) / 1024;
    if (w > 0) r[k] = w;
  }
  const s = Object.values(r).reduce((x, y) => x + y, 0);
  for (const k of Object.keys(r)) r[k] /= s;
  return r;
}

/** Herencia deportiva (§10.2): por atributo, 55 % el mayor y 45 % el menor, ±2, límite [30; techo] y suma ≤ 360. */
export function naturalesHijo(rng: Rng, padre: number[], madre: number[], techo: number[]): number[] {
  const v = padre.map((p, i) => {
    const base = rng.next() < cfg.probabilidadMayor ? Math.max(p, madre[i]) : Math.min(p, madre[i]);
    return base + rng.int(2 * cfg.variacion + 1) - cfg.variacion;
  });
  return ajustarNaturales(v, techo);
}

/** Predisposición (§10.3): promedio de los padres ±10 %, normalizado. */
export function predisposicionHija(rng: Rng, a: number[], b: number[]): number[] {
  const v = a.map((x, i) => ((x + b[i]) / 2) * (1 + (rng.next() * 2 - 1) * cfg.variacionPredisposicion));
  const s = v.reduce((x, y) => x + y, 0);
  return v.map((x) => x / s);
}

/** Pelaje (§10.4): un alelo de cada padre por locus; marcas blancas parecidas a las de los padres. */
export function pelajeHijo(rng: Rng, a: Pelaje, b: Pelaje): Pelaje {
  const genotipo = {} as Genotipo;
  for (const l of LOCI) genotipo[l] = [a.genotipo[l][rng.int(2)], b.genotipo[l][rng.int(2)]];
  const marca = (x: number, y: number) => Math.max(0, Math.min(3, Math.round((x + y) / 2 + (rng.next() * 2 - 1) * 0.9)));
  return {
    genotipo,
    marcas: {
      cara: marca(a.marcas.cara, b.marcas.cara) as 0 | 1 | 2 | 3,
      patas: a.marcas.patas.map((x, i) => marca(x, b.marcas.patas[i])) as [number, number, number, number],
    },
    semillaManchas: rng.nextU32(),
  };
}

/** El potrillo de dos caballos (macho y hembra). */
export function potrillo(rng: Rng, padre: Caballo, madre: Caballo, nombre: string, ahora: number): Caballo {
  const composicion = composicionHija(padre.composicion, madre.composicion);
  const techo = techoDe(composicion);
  const sexo: Sexo = rng.next() < 0.5 ? "macho" : "hembra";
  const h: Caballo = {
    id: nuevoId(rng), nombre, sexo, composicion,
    natural: naturalesHijo(rng, padre.natural, madre.natural, techo),
    entreno: [0, 0, 0, 0, 0],
    predisposicion: predisposicionHija(rng, padre.predisposicion, madre.predisposicion),
    techo,
    pelaje: pelajeHijo(rng, padre.pelaje, madre.pelaje),
    forma: padre.forma.map((x, i) => Math.max(-1, Math.min(1, (x + madre.forma[i]) / 2 + (rng.next() * 2 - 1) * cfg.variacionForma))),
    padreId: padre.id, madreId: madre.id,
    estado: "creciendo", finEstado: null, monturaId: null, victorias: 0, carreras: 0, creado: ahora,
  };
  // Fase 5.5: linaje raro y rasgos de la cruza, con un generador derivado al final (el resto del sorteo no cambia).
  const rl = rng.fork();
  const lin = linajeHijo(rl, padre, madre, composicion);
  if (lin) {
    h.techo = techoConLinaje(techo, lin);
    h.natural = naturalesHijo(rl, padre.natural, madre.natural, h.techo);   // con el techo más alto
  }
  const rasgos = rasgosHijo(rl, padre, madre, composicion);
  if (rasgos.length) h.rasgos = rasgos;
  if (lin) h.linaje = lin;
  marcarPelaje(h.pelaje, rasgosVisibles(h));
  return h;
}

export function puedeCruzar(p: Partida, padreId: string, madreId: string): Resultado {
  const padre = p.caballos.find((c) => c.id === padreId), madre = p.caballos.find((c) => c.id === madreId);
  if (p.cruza) return no("Ya hay una cruza en curso: solo se permite una por establo.");
  if (!padre || !madre) return no("Elegí un macho y una hembra.");
  if (padre.sexo !== "macho" || madre.sexo !== "hembra") return no("Hace falta un macho y una hembra.");
  if (padre.estado !== "disponible" || madre.estado !== "disponible") return no("Los dos tienen que estar disponibles.");
  if (!hayLugar(p)) return no("Hace falta un espacio libre en el establo para el potrillo.");
  if (p.oro < cfg.costoOro) return no(`La cruza cuesta ${cfg.costoOro} Oro.`);
  return { ok: true };
}

export function iniciarCruza(p: Partida, padreId: string, madreId: string, nombre: string, ahora: number, rng: Rng): Resultado {
  const r = puedeCruzar(p, padreId, madreId);
  if (!r.ok) return r;
  const padre = p.caballos.find((c) => c.id === padreId)!, madre = p.caballos.find((c) => c.id === madreId)!;
  const fin = ahora + cfg.horasCruza * HORA;
  mover(p, "oro", -cfg.costoOro, "cruza", ahora, padreId);
  for (const c of [padre, madre]) { c.estado = "cruza"; c.inicioEstado = ahora; c.finEstado = fin; }
  p.cruza = { padreId, madreId, inicio: ahora, fin, potrillo: potrillo(rng, padre, madre, nombre.trim() || "Potrillo", ahora) };
  return { ok: true };
}

/** Nace el potrillo: los padres quedan disponibles y el potrillo empieza a crecer (lo llama el reloj). */
export function nacer(p: Partida, t: number): Caballo | null {
  const z = p.cruza;
  if (!z) return null;
  for (const c of p.caballos) if (c.id === z.padreId || c.id === z.madreId) { c.estado = "disponible"; c.finEstado = null; c.disponibleDesde = t; delete c.inicioEstado; }
  const h = z.potrillo;
  h.estado = "creciendo"; h.inicioEstado = t; h.finEstado = t + cfg.horasCrecimiento * HORA; h.creado = t;
  p.caballos.push(h);
  delete p.cruza;
  return h;
}
