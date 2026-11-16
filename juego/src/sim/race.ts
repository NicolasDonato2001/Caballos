// Simulador de carreras v0.2 — módulo TypeScript puro, sin dependencias del motor 3D.
// Port de herramientas/balance/sim_v02.py (referencia de diseño). GDD v0.2 §9.3.
// Determinismo: solo + − × ÷ y sqrt, PRNG entero propio y tabla de potencias precalculada.

import { Rng } from "./rng.ts";
import { POW_N, POW_TABLE } from "./powtable.ts";
import type { Frame, Participant, RaceEvent, RaceInput, RaceResult, Strategy } from "./types.ts";

export interface RaceParams {
  _version: string;
  dt: number; frameEvery: number; laneWidth: number;
  vmaxBase: number; vmaxK: number; vsBase: number; vsRes: number; vsVel: number;
  amaxBase: number; amaxK: number; decBase: number; decK: number;
  kickK: number; kickMinF500: number; kickMinF1500: number; kickForceF: number; kickMargin: number;
  judgeBias: number; judgeSd: number;
  pace500: number[][]; pace1500: number[][];
  agrUntil: number; agrAdd500: number; agrAdd1500: number; agrRail: number;
  conUntil: number; conSub500: number; conSub1500: number; conLateAdd: number; conMinRes: number;
  accK: number; d0: number; d1: number; resCoefA: number; resCoefB: number;
  penStart: number; penMax: number; temK: number;
  noiseSd: number; noiseTem: number; noiseTau: number;
  draftMin: number; draftMax: number; draftK: number; draftIntBase: number;
  seekP: number; anticBase: number; anticInt: number;
  checkK: number; checkTem: number; blockGap: number; lookAhead: number; lookBehind: number;
  decideEvery: number; gapPBase: number; gapPInt: number; railPBase: number; railPInt: number;
  driftP: number; latSpeed: number; curveK: number; wasteK: number;
  curves500: number[][]; curves1500: number[][];
  /** sim-0.4.0: largo de un caballo (m), separación lateral mínima (carriles) y abrirse en la recta final. */
  bodyLen: number; sideGap: number; stretchWideP: number;
  /** sim-0.5.0: lesión en carrera (Fase 6.5). */
  lesionV: number; lesionDec: number; lesionDesde: number; lesionHasta: number;
}

/** E^1.7 por interpolación lineal en tabla (E en [0,1]). */
function powE(e: number): number {
  if (e <= 0) return 0;
  if (e >= 1) return POW_TABLE[POW_N];
  const x = e * POW_N;
  const i = Math.floor(x);
  const f = x - i;
  return POW_TABLE[i] + (POW_TABLE[i + 1] - POW_TABLE[i]) * f;
}

function paceAt(table: number[][], f: number): number {
  for (const [lim, val] of table) if (f < lim) return val;
  return table[table.length - 1][1];
}

const STRAT_CODE: Record<Strategy, number> = { agresiva: 0, equilibrada: 1, conservadora: 2 };

/**
 * Carrera paso a paso: `step()` avanza un tick (para reproducirla en vivo).
 * `simulateRace(input)` la calcula completa (servidor, repeticiones, runner).
 */
export class RaceSim {
  readonly n: number;
  readonly dist: number;
  readonly p: RaceParams;
  tick = 0;
  finishedAll = false;
  readonly frames: Frame[] = [];
  readonly events: RaceEvent[] = [];

  private rng: Rng;
  // atributos derivados
  private V: Float64Array; private R: Float64Array; private Po: Float64Array; private T: Float64Array; private I: Float64Array;
  private vmax: Float64Array; private vs: Float64Array; private amax: Float64Array; private dec: Float64Array;
  private rescoef: Float64Array; private vtopKick: Float64Array; private noiseAmp: Float64Array;
  private draftEff: Float64Array; private gapP: Float64Array; private railP: Float64Array; private driftP: Float64Array;
  private judgeErr: Float64Array; private strat: Int8Array;
  // estado
  s: Float64Array; lat: Float64Array; tgtLane: Float64Array; v: Float64Array; res: Float64Array;
  private noise: Float64Array;
  kicking: Uint8Array; blocked: Uint8Array; drafting: Uint8Array; finished: Uint8Array;
  /** Lesionado: frena, se abre y se retira. Para los demás deja de existir (como uno que ya llegó). */
  injured: Uint8Array;
  /** Fracción del recorrido en la que se lesiona (Infinity si no le toca). */
  private injuryAt: Float64Array;
  tFin: Float64Array;

  private readonly kickMinF: number;
  private readonly paceTab: number[][];
  private readonly curves: number[][];
  private readonly agrAdd: number;
  private readonly conSub: number;
  private readonly maxSteps: number;

  constructor(input: RaceInput, params: RaceParams) {
    if (input.simVersion !== params._version) {
      throw new Error(`Versión de simulador distinta: carrera ${input.simVersion}, parámetros ${params._version}`);
    }
    const p = (this.p = params);
    const n = (this.n = input.participants.length);
    const d = (this.dist = input.distance);
    this.rng = new Rng(input.seed);
    const short = d <= 600;
    this.kickMinF = short ? p.kickMinF500 : p.kickMinF1500;
    this.paceTab = short ? p.pace500 : p.pace1500;
    this.curves = short ? p.curves500 : p.curves1500;
    this.agrAdd = short ? p.agrAdd500 : p.agrAdd1500;
    this.conSub = short ? p.conSub500 : p.conSub1500;
    this.maxSteps = Math.floor(d / 8 / p.dt);

    const F = () => new Float64Array(n);
    this.V = F(); this.R = F(); this.Po = F(); this.T = F(); this.I = F();
    this.vmax = F(); this.vs = F(); this.amax = F(); this.dec = F(); this.rescoef = F(); this.vtopKick = F();
    this.noiseAmp = F(); this.draftEff = F(); this.gapP = F(); this.railP = F(); this.driftP = F();
    this.judgeErr = F(); this.strat = new Int8Array(n);
    this.s = F(); this.lat = F(); this.tgtLane = F(); this.v = F(); this.res = F(); this.noise = F();
    this.kicking = new Uint8Array(n); this.blocked = new Uint8Array(n); this.drafting = new Uint8Array(n);
    this.finished = new Uint8Array(n); this.tFin = F();
    this.injured = new Uint8Array(n); this.injuryAt = F();

    input.participants.forEach((q: Participant, i: number) => {
      const [V, R, Po, T, I] = q.attrs;
      this.V[i] = V; this.R[i] = R; this.Po[i] = Po; this.T[i] = T; this.I[i] = I;
      const vmax = p.vmaxBase + p.vmaxK * V;
      this.vmax[i] = vmax;
      this.vs[i] = Math.min(vmax - 0.5, p.vsBase + p.vsRes * R + p.vsVel * (V - 50));
      this.amax[i] = p.amaxBase + p.amaxK * Po;
      this.dec[i] = p.decBase + p.decK * Po;
      this.rescoef[i] = p.resCoefA - p.resCoefB * R;
      this.vtopKick[i] = vmax * (1 + (p.kickK * Po) / 100);
      this.noiseAmp[i] = p.noiseSd * (1 - (p.noiseTem * T) / 100);
      this.draftEff[i] = p.draftK * (p.draftIntBase + ((1 - p.draftIntBase) * I) / 100);
      this.gapP[i] = p.gapPBase + (p.gapPInt * I) / 100;
      this.railP[i] = p.railPBase + (p.railPInt * I) / 100;
      this.driftP[i] = p.driftP * (1 - I / 100);
      this.strat[i] = STRAT_CODE[q.strategy];
      this.res[i] = 100;
      this.tFin[i] = NaN;
    });
    // Error de cálculo del remate (Inteligencia lo reduce). Se sortea antes de los partidores.
    for (let i = 0; i < n; i++) {
      const q = 1 - this.I[i] / 100;
      this.judgeErr[i] = -p.judgeBias * q + p.judgeSd * q * this.rng.normal();
    }
    // Sorteo de partidores (permutación de 0..n-1).
    const gates = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [gates[i], gates[j]] = [gates[j], gates[i]];
    }
    for (let i = 0; i < n; i++) { this.lat[i] = gates[i]; this.tgtLane[i] = gates[i]; }
    // Lesiones (sim-0.5.0): generador aparte derivado de la semilla, así sin lesiones la carrera no cambia.
    const rl = new Rng((input.seed ^ 0x2545f491) >>> 0);
    input.participants.forEach((q, i) => {
      const u = rl.next(), w = rl.next();
      this.injuryAt[i] = (q.riesgo ?? 0) > 0 && u < q.riesgo! ? p.lesionDesde + (p.lesionHasta - p.lesionDesde) * w : Infinity;
    });

    this.recordFrame();
  }

  private inCurve(f: number): boolean {
    for (const [a, b] of this.curves) if (f >= a && f < b) return true;
    return false;
  }

  /** Avanza un tick (0,05 s). Devuelve true si la carrera terminó. */
  step(): boolean {
    if (this.finishedAll) return true;
    const p = this.p, n = this.n, dist = this.dist, dt = p.dt;
    this.tick++;
    const t = this.tick * dt;
    const s = this.s, v = this.v, lat = this.lat, res = this.res, fin = this.finished, inj = this.injured;
    // Para el tráfico, el lesionado ya no cuenta: se aparta hacia afuera.
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (!inj[i] && !fin[i] && s[i] / dist >= this.injuryAt[i]) {
        inj[i] = 1; this.kicking[i] = 0;
        this.tgtLane[i] = n + 1;
        this.events.push({ t, type: "lesion", horse: i, data: s[i] / dist });
      }
      out[i] = fin[i] | inj[i];
    }

    const tgt = new Float64Array(n), pen = new Float64Array(n), f = new Float64Array(n);
    const gap = new Float64Array(n), vAhead = new Float64Array(n);
    // ---- 1. velocidad objetivo
    for (let i = 0; i < n; i++) {
      const fi = Math.min(Math.max(s[i] / dist, 0), 1);
      f[i] = fi;
      const vm = this.vmax[i], vsi = this.vs[i];
      let tg = dist <= 600 ? vm * paceAt(this.paceTab, fi) : vsi + paceAt(this.paceTab, fi) * (vm - vsi);
      const st = this.strat[i];
      if (st === 0 && fi < p.agrUntil) tg += this.agrAdd;
      if (st === 2 && fi < p.conUntil) tg -= this.conSub;
      if (st === 2 && fi >= p.conUntil && res[i] > p.conMinRes) tg += p.conLateAdd;
      // Remate calculado
      if (!this.kicking[i] && !inj[i]) {
        const Dk = (p.d0 + p.d1 * powE(1)) * this.rescoef[i];
        const range = (Math.max(res[i] - p.kickMargin, 0) / Dk) * this.vtopKick[i];
        if ((fi >= this.kickMinF && dist - s[i] <= range * (1 + this.judgeErr[i])) || fi >= p.kickForceF) {
          this.kicking[i] = 1;
          if (!fin[i]) this.events.push({ t, type: "inicioRemate", horse: i, data: fi });
        }
      }
      const cap = this.kicking[i] ? this.vtopKick[i] : vm;
      if (this.kicking[i]) tg = cap;
      tg = Math.min(tg, cap);
      // Ruido de ritmo AR(1)
      const alpha = dt / p.noiseTau;
      this.noise[i] = (1 - alpha) * this.noise[i] + Math.sqrt(2 * alpha) * this.rng.normal();
      tg = tg * (1 + this.noiseAmp[i] * this.noise[i]);
      // Cansancio
      const pi = (Math.max(0, p.penStart - res[i]) / p.penStart) * p.penMax * (1 - (p.temK * this.T[i]) / 100);
      pen[i] = pi;
      tgt[i] = inj[i] ? p.lesionV : tg * (1 - pi);
    }
    // ---- 2. tráfico (sobre el estado del tick anterior; decisiones simultáneas)
    for (let i = 0; i < n; i++) {
      let g = Infinity, va = 0;
      for (let j = 0; j < n; j++) {
        if (j === i || out[j]) continue;
        const ds = s[j] - s[i];
        if (ds > 0 && Math.abs(lat[j] - lat[i]) < 0.6 && ds < g) { g = ds; va = v[j]; }
      }
      gap[i] = g; vAhead[i] = va;
      const bl = !inj[i] && g < p.blockGap && tgt[i] > va;
      if (bl && !this.blocked[i] && !fin[i]) this.events.push({ t, type: "encierro", horse: i });
      this.blocked[i] = bl ? 1 : 0;
      if (bl) tgt[i] = Math.min(tgt[i], va * (1 - p.checkK * (1 - (p.checkTem * this.T[i]) / 100)));
      this.drafting[i] = g >= p.draftMin && g <= p.draftMax ? 1 : 0;
    }
    // Un carril está libre si nadie lo ocupa ni lo eligió como destino cerca (adelante o atrás), contando el largo del cuerpo.
    const newTgtLane = Float64Array.from(this.tgtLane);
    const laneFree = (i: number, cand: number): boolean => {
      for (let j = 0; j < n; j++) {
        if (j === i || out[j]) continue;
        const ds = s[j] - s[i];
        if (ds <= -p.lookBehind || ds >= p.lookAhead) continue;
        if (Math.abs(lat[j] - cand) < 0.9 || Math.abs(newTgtLane[j] - cand) < 0.9) return false;
      }
      return true;
    };
    const aheadIn = (i: number, cand: number): boolean => {
      for (let j = 0; j < n; j++) {
        if (j === i || out[j]) continue;
        const ds = s[j] - s[i];
        if (Math.abs(lat[j] - cand) < 0.6 && ds > 1.5 && ds < 5.0) return true;
      }
      return false;
    };
    const aDecide = dt / p.decideEvery;
    const lastCurveEnd = this.curves[this.curves.length - 1][1];
    for (let i = 0; i < n; i++) {
      const decide = this.rng.next() < aDecide;
      const r = this.rng.next();
      const r2 = this.rng.next();
      if (out[i] || !decide) continue;
      const tl = this.tgtLane[i];
      const inner = Math.max(tl - 1, 0), outer = Math.min(tl + 1, n + 1);
      const innerFree = tl > 0 && laneFree(i, inner);
      const outerFree = laneFree(i, outer);
      const antic = p.anticBase + (p.anticInt * this.I[i]) / 100;
      // En la recta final el que viene atrás con remate busca afuera: la cuerda queda para el que se apaga.
      const stretch = f[i] >= lastCurveEnd;
      const wantPass = !!this.blocked[i] || (gap[i] < antic && vAhead[i] < tgt[i] - 0.1) ||
        (f[i] > 0.85 && gap[i] < 6 && vAhead[i] < tgt[i]) ||
        (stretch && this.kicking[i] === 1 && gap[i] < 12 && vAhead[i] < tgt[i]);
      let goIn = false, goOut = false;
      if (wantPass) {
        if (stretch && outerFree && r < this.gapP[i] + p.stretchWideP) goOut = true;
        else if (innerFree && r < this.gapP[i]) goIn = true;
        else if (outerFree && r < this.gapP[i]) goOut = true;
      } else if (stretch && this.kicking[i] === 1) {
        // recta final sin nadie adelante: mantiene su línea
      } else {
        const rail = innerFree && r < this.railP[i] * (this.strat[i] === 0 ? p.agrRail : 1);
        if (rail) goIn = true;
        else {
          const seekOk = !this.drafting[i] && f[i] < 0.85 && r2 < (p.seekP * this.I[i]) / 100;
          if (seekOk && innerFree && aheadIn(i, inner)) goIn = true;
          else if (seekOk && outerFree && aheadIn(i, outer)) goOut = true;
          else if (this.inCurve(f[i]) && outerFree && r < this.driftP[i]) goOut = true;
        }
      }
      if (goIn) newTgtLane[i] = inner;
      else if (goOut) newTgtLane[i] = outer;
    }
    this.tgtLane = newTgtLane;
    // ---- 3. dinámica longitudinal y lateral
    let allDone = true;
    const ns = new Float64Array(n), advA = new Float64Array(n), prevLat = Float64Array.from(lat);
    for (let i = 0; i < n; i++) {
      if (fin[i]) continue;
      const dl = this.tgtLane[i] - lat[i];
      const mx = p.latSpeed * dt;
      lat[i] += dl > mx ? mx : dl < -mx ? -mx : dl;
    }
    // Movimiento lateral seguro: si al cambiar de carril quedaría encimado a otro, se queda en su línea.
    for (let i = 0; i < n; i++) {
      if (out[i] || lat[i] === prevLat[i]) continue;
      for (let j = 0; j < n; j++) {
        if (j === i || out[j]) continue;
        if (Math.abs(lat[j] - lat[i]) < p.sideGap && Math.abs(s[j] - s[i]) < p.bodyLen) {
          lat[i] = prevLat[i];
          this.tgtLane[i] = Math.round(prevLat[i]);
          break;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (fin[i]) continue;
      const target = tgt[i];
      const v0 = v[i];
      const v1 = v0 < target ? Math.min(target, v0 + this.amax[i] * dt) : Math.max(target, v0 - (inj[i] ? p.lesionDec : this.dec[i]) * dt);
      const vbar = 0.5 * (v0 + v1);
      v[i] = v1;
      const e = Math.min(Math.max((vbar / (1 - pen[i]) - this.vs[i]) / (this.vmax[i] - this.vs[i]), 0), 1);
      let D = (p.d0 + p.d1 * powE(e)) * this.rescoef[i];
      if (this.drafting[i]) D *= 1 - this.draftEff[i];
      const acc = Math.max(2 * (v1 - vbar), 0) / dt;
      D += p.accK * acc * (1.2 - this.Po[i] / 100);
      res[i] = Math.max(0, res[i] - D * dt);
      const fi = f[i];
      const pathMult = (this.inCurve(fi) ? 1 + p.curveK * lat[i] : 1) * (1 + p.wasteK * (1 - this.I[i] / 100));
      advA[i] = (vbar * dt) / pathMult;
      ns[i] = s[i] + advA[i];
    }
    // Ningún caballo atraviesa a otro: el de atrás queda a un cuerpo del de adelante y no lo supera en velocidad.
    // Se resuelve de adelante hacia atrás (orden por posición, desempate por índice: determinista).
    const ord = Array.from({ length: n }, (_, i) => i).filter((i) => !out[i]).sort((a, b) => ns[b] - ns[a] || a - b);
    for (let a = 0; a < ord.length; a++) {
      const i = ord[a];
      for (let b = 0; b < a; b++) {
        const j = ord[b];
        if (Math.abs(lat[j] - lat[i]) < p.sideGap && ns[j] - ns[i] < p.bodyLen && ns[j] >= ns[i]) {
          const lim = ns[j] - p.bodyLen;
          if (lim < ns[i]) { ns[i] = Math.max(s[i], lim); advA[i] = ns[i] - s[i]; if (v[i] > v[j]) v[i] = v[j]; }
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (fin[i]) continue;
      const adv = advA[i];
      if (inj[i]) { s[i] = Math.min(ns[i], dist - 1); continue; }   // el lesionado no llega: se retira
      if (ns[i] >= dist) {
        const frac = (dist - s[i]) / Math.max(adv, 1e-9);
        this.tFin[i] = (this.tick - 1 + frac) * dt;
        fin[i] = 1;
        this.events.push({ t: this.tFin[i], type: "llegada", horse: i });
      } else allDone = false;
      s[i] = ns[i];
    }
    if (this.tick % p.frameEvery === 0 || allDone) this.recordFrame();
    if (allDone || this.tick >= this.maxSteps) {
      this.finishedAll = true;
      return true;
    }
    return false;
  }

  private recordFrame(): void {
    const horses = [];
    for (let i = 0; i < this.n; i++) {
      horses.push({
        s: Math.min(this.s[i], this.dist), lat: this.lat[i], v: this.v[i], res: this.res[i],
        kick: !!this.kicking[i], blocked: !!this.blocked[i], draft: !!this.drafting[i], done: !!this.finished[i],
        ...(this.injured[i] ? { lesion: true } : {}),
      });
    }
    this.frames.push({ t: this.tick * this.p.dt, horses });
  }

  /** Posiciones actuales (índices ordenados del 1.º al último). */
  standings(): number[] {
    const idx = Array.from({ length: this.n }, (_, i) => i);
    return idx.sort((a, b) => {
      const fa = this.finished[a], fb = this.finished[b];
      if (fa && fb) return this.tFin[a] - this.tFin[b];
      if (fa !== fb) return fb - fa;
      const ia = this.injured[a], ib = this.injured[b];
      if (ia !== ib) return ia - ib;                     // los lesionados, últimos
      return this.s[b] - this.s[a];
    });
  }

  result(): RaceResult {
    const times = Array.from(this.tFin);
    const order = this.standings();
    const photo = order.length > 1 && Math.abs(times[order[1]] - times[order[0]]) < 0.05;
    const injured: number[] = [];
    for (let i = 0; i < this.n; i++) if (this.injured[i]) injured.push(i);
    const events = [...this.events];
    if (photo) events.push({ t: times[order[0]], type: "fotoFinal", horse: order[0] });
    return {
      simVersion: this.p._version, finishTimes: times, order, photoFinish: photo, injured,
      frames: this.frames, events,
    };
  }
}

/** Simulación completa (servidor, repeticiones, runner). */
export function simulateRace(input: RaceInput, params: RaceParams): RaceResult {
  const sim = new RaceSim(input, params);
  while (!sim.step()) { /* avanzar */ }
  return sim.result();
}
