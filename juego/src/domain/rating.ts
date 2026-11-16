// Rating de jugadores (Fase 7.3, GDD §13): TrueSkill para carreras de todos contra todos.
// Implementación del grafo de factores de Herbrich, Minka y Graepel (2006) con propagación de expectativas,
// para jugadores individuales ordenados por puesto y sin empates (los tiempos del simulador no empatan).
// Puro: sin servidor ni base de datos; lo usa server/online.ts al terminar una carrera Ranked.
import cfg from "../../config/balance/rating.json" with { type: "json" };

export interface Rating { mu: number; sigma: number; }
export interface Division { id: string; nombre: string; desde: number; color: string; }
export const RATING = cfg;
export const DIVISIONES = cfg.divisiones as Division[];
export const ratingInicial = (): Rating => ({ mu: cfg.mu, sigma: cfg.sigma });

/** Rating que ve el jugador: arranca en 0 y sube a medida que el sistema se convence (baja σ). */
export const ratingVisible = (r: Rating): number => Math.max(0, Math.round(50 * (r.mu - 3 * r.sigma)));
export function divisionDe(visible: number): Division {
  let d = DIVISIONES[0];
  for (const x of DIVISIONES) if (visible >= x.desde) d = x;
  return d;
}

// ---- Normal estándar
const pdf = (x: number) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
/** Función de distribución acumulada (erfc de Numerical Recipes, error < 1,2e-7). */
function cdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + z / 2);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807
    + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? 1 - r / 2 : r / 2;
}
/** Corrección de la media y la varianza al truncar en d > 0 (victoria sin margen de empate). */
const vGana = (x: number) => { const c = cdf(x); return c > 1e-300 ? pdf(x) / c : -x; };
const wGana = (x: number) => { const v = vGana(x), w = v * (v + x); return Math.min(Math.max(w, 1e-12), 1 - 1e-12); };

// ---- Gaussianas en parámetros naturales (pi = 1/σ², tau = μ/σ²)
interface G { pi: number; tau: number; }
const g = (pi = 0, tau = 0): G => ({ pi, tau });
const mul = (a: G, b: G): G => g(a.pi + b.pi, a.tau + b.tau);
const div = (a: G, b: G): G => g(a.pi - b.pi, a.tau - b.tau);
const media = (a: G) => (a.pi ? a.tau / a.pi : 0);
const deMedia = (mu: number, sigma: number): G => g(1 / (sigma * sigma), mu / (sigma * sigma));

/** Variable del grafo: guarda su marginal y el último mensaje de cada factor. */
class Var {
  v = g();
  msg = new Map<object, G>();
  m(f: object): G { return this.msg.get(f) ?? g(); }
  private poner(x: G): number {
    const dPi = Math.abs(this.v.pi - x.pi);
    const d = dPi === Infinity ? 0 : Math.max(Math.abs(this.v.tau - x.tau), Math.sqrt(dPi));
    this.v = x;
    return d;
  }
  /** Reemplaza el mensaje del factor f. */
  mensaje(f: object, nuevo: G): number {
    const viejo = this.m(f);
    this.msg.set(f, nuevo);
    return this.poner(mul(div(this.v, viejo), nuevo));
  }
  /** Fija la marginal (y deduce el mensaje del factor f). */
  valor(f: object, nuevo: G): number {
    this.msg.set(f, div(mul(nuevo, this.m(f)), this.v));
    return this.poner(nuevo);
  }
}

/** Factor suma: s = Σ cᵢ·xᵢ. Manda el mensaje hacia `destino` a partir de los otros. */
function suma(f: object, destino: Var, otros: Var[], coef: number[]): number {
  let piInv = 0, mu = 0;
  for (let k = 0; k < otros.length; k++) {
    const d = div(otros[k].v, otros[k].m(f));
    mu += coef[k] * media(d);
    piInv = piInv === Infinity || d.pi === 0 ? Infinity : piInv + coef[k] * coef[k] / d.pi;
  }
  const pi = piInv === Infinity ? 0 : 1 / piInv;
  return destino.mensaje(f, g(pi, pi * mu));
}

/**
 * Actualiza los ratings después de una carrera. `orden`: los ratings en el orden de llegada (el 1.º primero).
 * Devuelve los nuevos ratings en el mismo orden. Con menos de 2 jugadores no cambia nada.
 */
export function actualizarRatings(orden: readonly Rating[], c: { beta?: number; tau?: number } = {}): Rating[] {
  const n = orden.length;
  if (n < 2) return orden.map((r) => ({ ...r }));
  const beta = c.beta ?? cfg.beta, tau = c.tau ?? cfg.tau;
  const hab = orden.map(() => new Var()), ren = orden.map(() => new Var()), dif = Array.from({ length: n - 1 }, () => new Var());
  const fPrior = orden.map(() => ({})), fLik = orden.map(() => ({})), fDif = dif.map(() => ({})), fTrunc = dif.map(() => ({}));

  // Habilidad a priori (con la deriva tau) → rendimiento en la carrera (ruido beta)
  orden.forEach((r, i) => hab[i].valor(fPrior[i], deMedia(r.mu, Math.sqrt(r.sigma * r.sigma + tau * tau))));
  const likBajar = (i: number) => {
    const m = div(hab[i].v, hab[i].m(fLik[i])), a = 1 / (1 + beta * beta * m.pi);
    return ren[i].mensaje(fLik[i], g(a * m.pi, a * m.tau));
  };
  const likSubir = (i: number) => {
    const m = div(ren[i].v, ren[i].m(fLik[i])), a = 1 / (1 + beta * beta * m.pi);
    return hab[i].mensaje(fLik[i], g(a * m.pi, a * m.tau));
  };
  orden.forEach((_, i) => likBajar(i));

  // Diferencias entre puestos consecutivos (dₖ = rₖ − rₖ₊₁) truncadas a dₖ > 0
  const difBajar = (k: number) => suma(fDif[k], dif[k], [ren[k], ren[k + 1]], [1, -1]);
  const difSubir = (k: number, lado: 0 | 1) => lado === 0
    ? suma(fDif[k], ren[k], [dif[k], ren[k + 1]], [1, 1])       // rₖ = dₖ + rₖ₊₁
    : suma(fDif[k], ren[k + 1], [ren[k], dif[k]], [1, -1]);     // rₖ₊₁ = rₖ − dₖ
  const truncar = (k: number) => {
    const d = div(dif[k].v, dif[k].m(fTrunc[k])), raiz = Math.sqrt(d.pi);
    const x = d.tau / raiz, v = vGana(x), w = wGana(x);
    return dif[k].valor(fTrunc[k], g(d.pi / (1 - w), (d.tau + raiz * v) / (1 - w)));
  };
  for (let it = 0; it < 30; it++) {
    let delta = 0;
    if (n === 2) { difBajar(0); delta = truncar(0); }
    else {
      for (let k = 0; k < n - 2; k++) { difBajar(k); delta = Math.max(delta, truncar(k)); difSubir(k, 1); }
      for (let k = n - 2; k > 0; k--) { difBajar(k); delta = Math.max(delta, truncar(k)); difSubir(k, 0); }
    }
    if (delta <= 1e-4) break;
  }
  difSubir(0, 0); difSubir(n - 2, 1);
  orden.forEach((_, i) => likSubir(i));
  return hab.map((h) => ({ mu: media(h.v), sigma: Math.sqrt(1 / h.v.pi) }));
}

/** Probabilidad de que a termine delante de b (para mostrar y para las pruebas). */
export function probGana(a: Rating, b: Rating, beta = cfg.beta): number {
  return cdf((a.mu - b.mu) / Math.sqrt(2 * beta * beta + a.sigma * a.sigma + b.sigma * b.sigma));
}

/** Lo que ve el jugador de su rating: número, división y colocación. */
export function resumenRating(r: Rating, carreras: number) {
  const visible = ratingVisible(r);
  const colocacion = carreras < cfg.carrerasColocacion;
  return { visible, carreras, colocacion, colocadas: Math.min(carreras, cfg.carrerasColocacion), totalColocacion: cfg.carrerasColocacion,
    division: colocacion ? null : divisionDe(visible) };
}
