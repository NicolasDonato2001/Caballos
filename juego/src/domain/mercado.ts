// Mercado del juego (GDD v0.2 §12.1, §12.2). Cuatro ofertas por día: dos básicas, una especializada y una de genética
// destacada; siempre hay al menos un macho y una hembra. Las ofertas de un día son fijas (semilla = partida + día).
import cfg from "../../config/balance/mercado.json" with { type: "json" };
import razas from "../../config/balance/razas.json" with { type: "json" };
import { Rng } from "../sim/rng.ts";
import { ajustarNaturales, caballoDeRaza, RAZAS, techoDe, type Caballo, type Sexo } from "./caballo.ts";
import { hayLugar, type Partida } from "./partida.ts";
import { diaDe, mover, precioSugerido } from "./economia.ts";

export type TipoOferta = "basica" | "especializada" | "destacada";
export const NOMBRE_OFERTA: Record<TipoOferta, string> = { basica: "Básico", especializada: "Especializado", destacada: "Genética destacada" };
export interface Oferta { tipo: TipoOferta; caballo: Caballo; precio: number; vendida: boolean; }
export interface Mercado { dia: number; ofertas: Oferta[]; }

type Resultado = { ok: true } | { ok: false; motivo: string };
const no = (motivo: string): Resultado => ({ ok: false, motivo });
const R = razas.razas as Record<string, { perfil: number[]; techo: number[] }>;

export { diaDe, finDelDia, precioSugerido } from "./economia.ts";

/**
 * Naturales de una raza con una suma buscada. Básica y destacada reparten parejo; la especializada sube sus dos
 * atributos más fuertes y compensa con los demás.
 */
export function naturalesConSuma(rng: Rng, raza: string, suma: number, tipo: TipoOferta): number[] {
  const perfil = R[raza].perfil, techo = techoDe({ [raza]: 1 });
  const fuertes = perfil.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 2).map(([, i]) => i);
  let v = perfil.map((x) => x + rng.int(7) - 3);
  // La especializada arranca con sus dos atributos fuertes bien arriba; la suma se ajusta con los demás.
  if (tipo === "especializada") v = v.map((x, i) => (fuertes.includes(i) ? Math.min(techo[i], x + 8) : x));
  for (let paso = 0; paso < 8; paso++) {
    const delta = suma - v.reduce((s, x) => s + x, 0);
    if (Math.abs(delta) < 1) break;
    const libres = v.map((x, i) => (delta > 0 ? x < techo[i] : x > razas.minimoNatural));
    const peso: number[] = v.map((_, i) => !libres[i] ? 0 : tipo !== "especializada" ? 1 : fuertes.includes(i) ? (delta > 0 ? 1 : 0) : 1);
    const sp = peso.reduce((s, x) => s + x, 0);
    if (sp === 0) break;
    v = ajustarNaturales(v.map((x, i) => x + (delta * peso[i]) / sp), techo);
  }
  return v;
}

/** Ofertas del día: deterministas para una partida y un día. */
export function generarOfertas(semillaPartida: number, dia: number): Oferta[] {
  const rng = new Rng(((semillaPartida >>> 0) ^ Math.imul(dia, 2654435761)) >>> 0);
  const sexos: Sexo[] = cfg.ofertas.map((_, i) => (i === 0 ? "macho" : i === 1 ? "hembra" : rng.next() < 0.5 ? "macho" : "hembra"));
  return cfg.ofertas.map((o, i) => {
    const raza = RAZAS[rng.int(RAZAS.length)];
    const tipo = o.tipo as TipoOferta;
    const suma = o.suma + rng.int(2 * cfg.variacionSuma + 1) - cfg.variacionSuma;
    const caballo = caballoDeRaza(rng, { raza, sexo: sexos[i], natural: naturalesConSuma(rng, raza, suma, tipo) });
    caballo.id = `m-${dia}-${i}-${caballo.id}`;
    return { tipo, caballo, precio: precioSugerido(caballo), vendida: false };
  });
}

/** Devuelve el mercado del día, renovándolo si cambió el día. */
export function mercadoDelDia(p: Partida, ahora: number): Mercado {
  const dia = diaDe(ahora);
  if (!p.mercado || p.mercado.dia !== dia) p.mercado = { dia, ofertas: generarOfertas(p.creada % 4294967296, dia) };
  return p.mercado;
}

export function comprarOferta(p: Partida, indice: number, ahora: number): Resultado {
  const m = mercadoDelDia(p, ahora);
  const o = m.ofertas[indice];
  if (!o) return no("La oferta ya no existe.");
  if (o.vendida) return no("Ese caballo ya se vendió.");
  if (p.oro < o.precio) return no("No te alcanza el Oro.");
  if (!hayLugar(p)) return no("No hay espacio libre en el establo.");
  mover(p, "oro", -o.precio, "mercado:compra", ahora, o.caballo.id);
  o.vendida = true;
  const c: Caballo = JSON.parse(JSON.stringify(o.caballo));
  c.id = c.id.replace(/^m-/, "c-");
  c.creado = ahora;
  p.caballos.push(c);
  return { ok: true };
}
