// Economía (GDD v0.2 §11, §12.2): ledger, día y semana, límite diario de premios, objetivos semanales, aceleraciones
// con Gemas, conversión de Gemas a Oro, monturas y venta al juego. Reglas puras: reciben `ahora` y no tocan la pantalla.
// Este módulo solo importa tipos de la partida para no crear ciclos (lo usan edificios, carreras, crianza y mercado).
import cfg from "../../config/balance/economia.json" with { type: "json" };
import type { Caballo } from "./caballo.ts";
import type { Partida, TipoEdificio } from "./partida.ts";

type Resultado = { ok: true } | { ok: false; motivo: string };
const no = (motivo: string): Resultado => ({ ok: false, motivo });
const si: Resultado = { ok: true };
const DIA = 86_400_000;
const MIN = 60_000;

// ------------------------------------------------------------------ calendario

/** Día local (cambia a las 00:00 de la zona del jugador). */
export function diaDe(ahora: number): number {
  return Math.floor((ahora - new Date(ahora).getTimezoneOffset() * MIN) / DIA);
}
/** Cuándo empieza el día siguiente. */
export function finDelDia(ahora: number): number {
  return (diaDe(ahora) + 1) * DIA + new Date(ahora).getTimezoneOffset() * MIN;
}
/** Semana que empieza el lunes a las 00:00 (el 1/1/1970 fue jueves: se corre 3 días). */
export function semanaDe(ahora: number): number { return Math.floor((diaDe(ahora) + 3) / 7); }
export function finDeLaSemana(ahora: number): number {
  const lunes = (semanaDe(ahora) + 1) * 7 - 3;
  return lunes * DIA + new Date(lunes * DIA).getTimezoneOffset() * MIN;
}

// ------------------------------------------------------------------ ledger (§11.9)

export type Moneda = "oro" | "gemas";
export interface Movimiento { t: number; moneda: Moneda; cantidad: number; motivo: string; ref?: string; }

/** Suma o resta una moneda y lo anota en el ledger. No valida saldo: eso lo hace quien llama. */
export function mover(p: Partida, moneda: Moneda, cantidad: number, motivo: string, t = Date.now(), ref?: string): void {
  if (cantidad === 0) return;
  p[moneda] += cantidad;
  const l = p.ledger ?? (p.ledger = []);
  l.unshift(ref ? { t, moneda, cantidad, motivo, ref } : { t, moneda, cantidad, motivo });
  if (l.length > cfg.ledgerMaximo) l.length = cfg.ledgerMaximo;
}

// ------------------------------------------------------------------ límite diario (§11.2)

export interface Diario { dia: number; carrerasPagadas: number; gemasConvertidas: number; /** Oro apostado hoy (7.4). */ apostado?: number; }

export function diarioDe(p: Partida, ahora: number): Diario {
  const dia = diaDe(ahora);
  if (!p.diario) p.diario = { dia, carrerasPagadas: 0, gemasConvertidas: 0 };
  if (p.diario.dia === dia) return p.diario;
  if (dia > p.diario.dia) {
    // Día nuevo: el anterior se guarda unos días (7.5: las carreras offline de esos días se cobran al sincronizar)
    p.diariosPasados = [p.diario, ...(p.diariosPasados ?? []).filter((d) => d.dia !== p.diario!.dia)].slice(0, cfg.limiteDiario.diasGuardados ?? 5);
    p.diario = p.diariosPasados.find((d) => d.dia === dia) ?? { dia, carrerasPagadas: 0, gemasConvertidas: 0 };
    p.diariosPasados = p.diariosPasados.filter((d) => d.dia !== dia);
    return p.diario;
  }
  // Un día que ya pasó (una carrera offline que se sincroniza después): su propio contador
  const l = p.diariosPasados ?? (p.diariosPasados = []);
  let d = l.find((x) => x.dia === dia);
  if (!d) { d = { dia, carrerasPagadas: 0, gemasConvertidas: 0 }; l.push(d); l.sort((a, b) => b.dia - a.dia); l.length = Math.min(l.length, cfg.limiteDiario.diasGuardados ?? 5); }
  return d;
}
export const CARRERAS_COMPLETAS = cfg.limiteDiario.carrerasCompletas;

/** Aplica el límite diario a un premio: las primeras 15 carreras del día pagan el 100 %, las siguientes el 25 %. */
export function premioConLimite(p: Partida, premio: number, ahora: number): { oro: number; reducido: boolean } {
  const d = diarioDe(p, ahora);
  const reducido = d.carrerasPagadas >= cfg.limiteDiario.carrerasCompletas;
  d.carrerasPagadas += 1;
  return { oro: reducido ? Math.round(premio * cfg.limiteDiario.fraccionReducida) : premio, reducido };
}

// ------------------------------------------------------------------ objetivos semanales (§11.4)

export type IdObjetivo = "carreras" | "podios" | "entrenamientos";
export interface Objetivo { id: IdObjetivo; texto: string; meta: number; oro: number; gemas: number; }
export const OBJETIVOS = cfg.objetivos as Objetivo[];
export interface Semanal { semana: number; carreras: number; podios: number; entrenamientos: number; cobrados: IdObjetivo[]; }

export function semanalDe(p: Partida, ahora: number): Semanal {
  const semana = semanaDe(ahora);
  if (!p.semanal || p.semanal.semana !== semana) p.semanal = { semana, carreras: 0, podios: 0, entrenamientos: 0, cobrados: [] };
  return p.semanal;
}
export function contar(p: Partida, id: IdObjetivo, t: number): void { semanalDe(p, t)[id] += 1; }

export function cobrarObjetivo(p: Partida, id: IdObjetivo, ahora: number): Resultado {
  const s = semanalDe(p, ahora);
  const o = OBJETIVOS.find((x) => x.id === id);
  if (!o) return no("Objetivo desconocido.");
  if (s.cobrados.includes(id)) return no("Ya cobraste este objetivo esta semana.");
  if (s[id] < o.meta) return no("Todavía no completaste el objetivo.");
  s.cobrados.push(id);
  mover(p, "oro", o.oro, `objetivo:${id}`, ahora);
  mover(p, "gemas", o.gemas, `objetivo:${id}`, ahora);
  return si;
}

// ------------------------------------------------------------------ aceleración (§11.6)

/** 1 Gema por cada 30 minutos restantes, redondeando hacia arriba, mínimo 1. */
export function costoAcelerar(msRestantes: number): number {
  return Math.max(1, Math.ceil(msRestantes / (cfg.aceleracion.minutosPorGema * MIN)));
}

function pagarAceleracion(p: Partida, fin: number, ahora: number, motivo: string, ref: string): Resultado {
  if (fin <= ahora) return no("Ya terminó.");
  const g = costoAcelerar(fin - ahora);
  if (p.gemas < g) return no(`Hacen falta ${g} Gemas.`);
  mover(p, "gemas", -g, motivo, ahora, ref);
  return si;
}

/** Termina ya la mejora de un edificio. El reloj (actualizar) aplica el resultado. */
export function acelerarMejora(p: Partida, tipo: TipoEdificio, ahora: number): Resultado {
  const e = p.edificios[tipo];
  if (e.mejoraFin === null) return no("No se está mejorando.");
  const r = pagarAceleracion(p, e.mejoraFin, ahora, "acelerar:mejora", tipo);
  if (r.ok) e.mejoraFin = ahora;
  return r;
}

/** Termina ya el entrenamiento, el crecimiento o la recuperación de un caballo. La recuperación se acelera desde el
 *  15/11/2026 (pedido del usuario; antes §11.6 la excluía): no baja la carga, así que correrlo seguido sigue subiendo el riesgo. */
export function acelerarCaballo(p: Partida, id: string, ahora: number): Resultado {
  const c = p.caballos.find((x) => x.id === id);
  if (!c) return no("No se encontró el caballo.");
  if ((c.estado === "entrenando" || c.estado === "creciendo" || c.estado === "recuperacion") && c.finEstado !== null) {
    const r = pagarAceleracion(p, c.finEstado, ahora, `acelerar:${c.estado}`, c.id);
    if (r.ok) c.finEstado = ahora;           // el reloj (actualizar) lo deja disponible y libera el lugar
    return r;
  }
  if (c.estado === "colaRecuperacion" && c.cola) {
    // Esperaba lugar: se paga su descanso completo y queda disponible sin pasar por el Centro de recuperación
    const r = pagarAceleracion(p, ahora + c.cola.minutos * MIN, ahora, "acelerar:recuperacion", c.id);
    if (r.ok) { c.estado = "disponible"; c.finEstado = null; c.disponibleDesde = ahora; delete c.cola; delete c.inicioEstado; }
    return r;
  }
  if (c.estado === "disponible" && c.descansoHasta !== undefined && c.descansoHasta > ahora) {
    // Lo sacaron antes de la recuperación: se paga el descanso que le falta para poder correr
    const r = pagarAceleracion(p, c.descansoHasta, ahora, "acelerar:descanso", c.id);
    if (r.ok) c.descansoHasta = ahora;
    return r;
  }
  return no("Eso no se puede acelerar.");
}

export function acelerarCruza(p: Partida, ahora: number): Resultado {
  const z = p.cruza;
  if (!z) return no("No hay una cruza en curso.");
  const r = pagarAceleracion(p, z.fin, ahora, "acelerar:cruza", z.potrillo.id);
  if (r.ok) {
    z.fin = ahora;
    for (const c of p.caballos) if (c.id === z.padreId || c.id === z.madreId) c.finEstado = ahora;
  }
  return r;
}

// ------------------------------------------------------------------ conversión (§11.6)

export const ORO_POR_GEMA = cfg.conversion.oroPorGema;
export function gemasConvertiblesHoy(p: Partida, ahora: number): number {
  return Math.max(0, cfg.conversion.gemasMaximasPorDia - diarioDe(p, ahora).gemasConvertidas);
}
export function convertirGemas(p: Partida, gemas: number, ahora: number): Resultado {
  if (!Number.isInteger(gemas) || gemas < 1) return no("Elegí cuántas Gemas convertir.");
  if (gemas > p.gemas) return no("No tenés tantas Gemas.");
  if (gemas > gemasConvertiblesHoy(p, ahora)) return no(`Hoy podés convertir ${gemasConvertiblesHoy(p, ahora)} Gemas más.`);
  diarioDe(p, ahora).gemasConvertidas += gemas;
  mover(p, "gemas", -gemas, "conversion", ahora);
  mover(p, "oro", gemas * cfg.conversion.oroPorGema, "conversion", ahora);
  return si;
}

// ------------------------------------------------------------------ monturas (§11.7)

export type TipoMontura = "sprint" | "resistencia" | "tactica";
export const TIPOS_MONTURA = Object.keys(cfg.monturas.tipos) as TipoMontura[];
export const MONTURAS = cfg.monturas.tipos as Record<TipoMontura, { nombre: string; bono: number[] }>;
export const PRECIO_MONTURA = { oro: cfg.monturas.precioOro, gemas: cfg.monturas.precioGemas };
export interface Montura { id: string; tipo: TipoMontura; /** Color del cuero (aspecto comprado). */ color?: string; }

export function bonoMontura(tipo: TipoMontura | undefined): number[] {
  return tipo ? MONTURAS[tipo].bono : [0, 0, 0, 0, 0];
}

export function comprarMontura(p: Partida, tipo: TipoMontura, moneda: Moneda, ahora: number): Resultado {
  if (!MONTURAS[tipo]) return no("Montura desconocida.");
  const precio = moneda === "oro" ? cfg.monturas.precioOro : cfg.monturas.precioGemas;
  if (p[moneda] < precio) return no(moneda === "oro" ? "No te alcanza el Oro." : "No te alcanzan las Gemas.");
  const id = `s-${ahora.toString(36)}-${(p.monturas?.length ?? 0)}`;
  mover(p, moneda, -precio, "montura", ahora, id);
  (p.monturas ??= []).push({ id, tipo });
  return si;
}

/** Quién lleva puesta una montura (o undefined si está libre). */
export function portador(p: Partida, monturaId: string): Caballo | undefined {
  return p.caballos.find((c) => c.monturaId === monturaId);
}

export function quitarMontura(c: Caballo): void { c.monturaId = null; delete c.montura; delete c.monturaColor; }

/** Pone una montura del inventario a un caballo; si la tenía otro, pasa a este (se cambian fuera de carrera). */
export function equiparMontura(p: Partida, caballoId: string, monturaId: string | null): Resultado {
  const c = p.caballos.find((x) => x.id === caballoId);
  if (!c) return no("No se encontró el caballo.");
  if (monturaId === null) { quitarMontura(c); return si; }
  const m = p.monturas?.find((x) => x.id === monturaId);
  if (!m) return no("No tenés esa montura.");
  const otro = portador(p, monturaId);
  if (otro) quitarMontura(otro);
  c.monturaId = m.id; c.montura = m.tipo;
  if (m.color) c.monturaColor = m.color; else delete c.monturaColor;
  return si;
}

// ------------------------------------------------------------------ precio y venta al juego (§12.2, §23.1)

/** Precio sugerido (§12.2): 2.500 · 1,035^(G − 300) + 60·PE + 150·min(V; 30), redondeado. */
export function precioSugerido(c: Caballo): number {
  const p = cfg.precio;
  const g = c.natural.reduce((s, x) => s + x, 0);
  const pe = c.entreno.reduce((s, x) => s + x, 0);
  const v = p.base * Math.pow(p.factor, g - p.sumaReferencia) + p.porPuntoEntreno * pe + p.porVictoria * Math.min(c.victorias, p.victoriasMaximas);
  return Math.round(v / p.redondeo) * p.redondeo;
}

/** Lo que paga el juego por un caballo: un precio mínimo para deshacerse de él al instante (pedido del usuario). */
export function precioVentaAlJuego(c: Caballo): number {
  const v = cfg.ventaAlJuego;
  return Math.max(v.minimo, Math.round((precioSugerido(c) * v.fraccion) / v.redondeo) * v.redondeo);
}

export function venderAlJuego(p: Partida, id: string, ahora: number): Resultado {
  const c = p.caballos.find((x) => x.id === id);
  if (!c) return no("No se encontró el caballo.");
  if (p.caballos.length <= 1) return no("No podés vender tu único caballo.");
  if (c.estado !== "disponible") return no("Solo se puede vender un caballo disponible.");
  const precio = precioVentaAlJuego(c);
  quitarMontura(c);
  p.caballos = p.caballos.filter((x) => x.id !== id);
  mover(p, "oro", precio, "venta:juego", ahora, id);
  return si;
}

// ------------------------------------------------------------------ recompensa por entrar (§24.1)

export interface Entrada { ultimoDia: number; racha: number; }
export const PAQUETES_GEMAS = cfg.paquetesGemas.lista as [number, string][];

/** Qué toca cobrar hoy: día de la racha (1 a 7) y premio. `disponible` es falso si ya se cobró hoy. */
export function estadoEntrada(p: Partida, ahora: number): { disponible: boolean; dia: number; oro: number; gemas: number } {
  const hoy = diaDe(ahora), e = p.entrada;
  const cobrado = !!e && e.ultimoDia === hoy;
  const dia = cobrado ? e!.racha : e && e.ultimoDia === hoy - 1 ? (e.racha % 7) + 1 : 1;
  return { disponible: !cobrado, dia, oro: cfg.entrada.oro[dia - 1], gemas: cfg.entrada.gemas[dia - 1] };
}

export function cobrarEntrada(p: Partida, ahora: number): Resultado {
  const r = estadoEntrada(p, ahora);
  if (!r.disponible) return no("Ya cobraste la recompensa de hoy.");
  p.entrada = { ultimoDia: diaDe(ahora), racha: r.dia };
  mover(p, "oro", r.oro, "entrada", ahora, `dia${r.dia}`);
  mover(p, "gemas", r.gemas, "entrada", ahora, `dia${r.dia}`);
  return si;
}
