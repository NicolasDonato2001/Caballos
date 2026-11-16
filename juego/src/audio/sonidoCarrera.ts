// Sonido de las carreras (Fase 10, GDD §24.7): campana y gateras en la largada, galope que sube y baja con la velocidad y
// con cuántos caballos hay cerca de la cámara, y público que crece en la recta final.
// Todo se sintetiza en el navegador con Web Audio: no hay archivos ni licencias. Si más adelante se ponen grabaciones en
// public/sonidos/ (campana.mp3, gateras.mp3, casco1..4.mp3, publico.mp3), se usan esas en lugar de las sintetizadas.
// Solo suena; no toca la carrera (el simulador es el único que decide).

// ------------------------------------------------------------------ cuentas puras (se prueban sin audio)

/** Trancos por segundo del galope según la velocidad (m/s): al paso ~0,9, a fondo (16-17 m/s) ~2,5. */
export function ritmoGalope(v: number): number {
  if (v <= 0.3) return 0;
  return Math.min(2.7, 0.8 + 0.105 * v);
}
/** Galope de cuatro tiempos (transverso): las cuatro patas golpean en estas fracciones del tranco y después hay un vuelo. */
export const GOLPES_TRANCO = [0, 0.11, 0.3, 0.41];
/** Cuánto se oye un caballo a d metros de la cámara (1 al lado, 0,5 a 9 m, casi nada a 60 m). */
export function gananciaDistancia(d: number): number { return 1 / (1 + (d / 9) ** 2); }
/** Fuerza del golpe según la velocidad: al paso suave, a fondo fuerte. */
export function fuerzaGolpe(v: number): number { return 0.35 + 0.65 * Math.min(1, v / 16); }
/**
 * Intensidad del público (0 a 1): murmullo antes de largar, sube en el último tramo (último 30 % o últimos 400 m),
 * explota cuando llega el primero y se calma después.
 */
export function intensidadPublico(o: { fase: "previa" | "carrera" | "final"; restanLider: number; distancia: number; segDesdeLlegada: number | null }): number {
  if (o.fase === "previa") return 0.16;
  if (o.segDesdeLlegada !== null) return Math.max(0.28, 0.95 - 0.12 * o.segDesdeLlegada);
  const tramo = Math.min(400, o.distancia * 0.3);
  const f = Math.max(0, Math.min(1, 1 - o.restanLider / tramo));
  return 0.2 + 0.55 * f * f;
}

export interface CaballoAudio { x: number; y: number; z: number; v: number; }
export interface EstadoAudio {
  fase: "previa" | "carrera" | "final";
  /** Segundos de carrera por segundo real (velocidad ×1/×2/×4 y cámara lenta). */ escala: number;
  camara: { x: number; y: number; z: number }; derecha: { x: number; z: number };
  caballos: CaballoAudio[]; restanLider: number; distancia: number; alguienLlego: boolean;
}

// ------------------------------------------------------------------ síntesis de los sonidos

const CLAVE_VOL = "caballos.volumen";
/** Generador simple con semilla (las variaciones de los cascos salen siempre iguales). */
function azar(semilla: number) { let s = semilla >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

type Superficie = "cesped" | "tierra";

export class SonidoCarrera {
  private ctx: AudioContext | null = null;
  private master!: GainNode; private bus!: GainNode; private cascosBus!: GainNode;
  private publicoGain: GainNode | null = null; private publicoAgudos: GainNode | null = null; private publicoFuente: AudioBufferSourceNode | null = null;
  private cascos: Record<Superficie, AudioBuffer[]> | null = null;
  private campana: AudioBuffer | null = null; private gatera: AudioBuffer | null = null; private ruido: AudioBuffer | null = null;
  private grabados: Partial<Record<string, AudioBuffer>> = {};
  private fases: number[] = [];
  private superficie: Superficie = "tierra";
  private activo = false;
  private llegada: number | null = null;
  private proximoMurmullo = 0;
  private azar = azar(12345);
  /** Volumen general 0 a 1 (0 = silencio). Se recuerda en este navegador. */
  volumen = 0.8;

  constructor() {
    try { const v = Number(localStorage.getItem(CLAVE_VOL)); if (localStorage.getItem(CLAVE_VOL) !== null && Number.isFinite(v)) this.volumen = Math.min(1, Math.max(0, v)); } catch { /* sin almacenamiento */ }
  }

  setVolumen(v: number): void {
    this.volumen = Math.min(1, Math.max(0, v));
    try { localStorage.setItem(CLAVE_VOL, String(this.volumen)); } catch { /* sin almacenamiento */ }
    if (this.ctx) this.master.gain.setTargetAtTime(this.volumen, this.ctx.currentTime, 0.05);
  }

  /** Crea el audio la primera vez (los navegadores lo permiten después de un toque del jugador). */
  private asegurar(): AudioContext | null {
    if (this.ctx) { if (this.ctx.state === "suspended") void this.ctx.resume(); return this.ctx; }
    const AC = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master = ctx.createGain(); this.master.gain.value = this.volumen;
    this.bus = ctx.createGain(); this.bus.gain.value = 0;
    this.cascosBus = ctx.createGain(); this.cascosBus.gain.value = 0.9;
    this.cascosBus.connect(this.bus); this.bus.connect(comp); comp.connect(this.master); this.master.connect(ctx.destination);
    this.sintetizar(ctx);
    void this.cargarGrabados(ctx);
    return ctx;
  }

  /** Arranca el sonido de una carrera (antes de la cuenta regresiva): murmullo del público. */
  iniciar(superficie: Superficie, caballos: number): void {
    const ctx = this.asegurar();
    if (!ctx) return;
    this.superficie = superficie;
    this.fases = Array.from({ length: caballos }, () => this.azar());
    this.llegada = null; this.activo = true;
    this.bus.gain.cancelScheduledValues(ctx.currentTime);
    this.bus.gain.setTargetAtTime(1, ctx.currentTime, 0.15);
    this.arrancarPublico(ctx);
  }

  /** Largada: la campana y las puertas de las gateras (una por caballo, apenas desfasadas). */
  largada(caballos: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.activo) return;
    const t = ctx.currentTime + 0.02;
    this.disparar(this.grabados.campana ?? this.campana!, t, 0.55, 0, 1);
    const g = this.grabados.gateras ?? this.gatera!;
    for (let i = 0; i < caballos; i++) this.disparar(g, t + 0.05 + i * 0.012 + this.azar() * 0.01, 0.32, (i / Math.max(1, caballos - 1)) * 1.2 - 0.6, 0.94 + this.azar() * 0.12);
  }

  /** Cada cuadro: programa los golpes de los cascos que caen en este cuadro y ajusta el público. */
  actualizar(e: EstadoAudio, dt: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.activo) return;
    const ahora = ctx.currentTime, lat = 0.04;
    if (e.alguienLlego && this.llegada === null) this.llegada = ahora;
    const buffers = this.grabadosCascos() ?? this.cascos![this.superficie];
    if (e.fase !== "previa") {
      for (let i = 0; i < e.caballos.length; i++) {
        const c = e.caballos[i];
        const dx = c.x - e.camara.x, dy = c.y - e.camara.y, dz = c.z - e.camara.z;
        const d = Math.hypot(dx, dy, dz);
        const ritmo = ritmoGalope(c.v) * e.escala;
        if (ritmo <= 0) continue;
        const antes = this.fases[i] ?? 0, despues = antes + ritmo * dt;
        this.fases[i] = despues % 1;
        const g = gananciaDistancia(d);
        if (g < 0.012) continue;                   // muy lejos: no se oye
        const pan = Math.max(-1, Math.min(1, (dx * e.derecha.x + dz * e.derecha.z) / Math.max(4, d)));
        const fuerza = fuerzaGolpe(c.v) * g;
        for (const o of GOLPES_TRANCO) {
          // ¿Este golpe cae entre la fase anterior y la nueva? (puede dar la vuelta al tranco)
          let x = o - antes; if (x < 0) x += 1;
          if (x <= despues - antes) {
            const enCuadro = (x / Math.max(1e-6, despues - antes)) * dt;
            this.disparar(buffers[Math.floor(this.azar() * buffers.length)], ahora + lat + enCuadro, 0.5 * fuerza, pan, 0.9 + this.azar() * 0.2 + Math.min(0.1, c.v / 160));
          }
        }
      }
    }
    this.ajustarPublico(ctx, e);
  }

  /** Sale de la carrera: todo se apaga suave. */
  detener(): void {
    const ctx = this.ctx;
    this.activo = false;
    if (!ctx) return;
    this.bus.gain.cancelScheduledValues(ctx.currentTime);
    this.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
    const f = this.publicoFuente;
    this.publicoFuente = null;
    if (f) setTimeout(() => { try { f.stop(); } catch { /* ya parado */ } }, 800);
  }

  // ---------------------------------------------------------------- interno

  private disparar(b: AudioBuffer, t: number, ganancia: number, pan: number, velocidad: number): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = velocidad;
    const g = ctx.createGain(); g.gain.value = ganancia;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    s.connect(g); g.connect(p); p.connect(b === this.campana || b === this.gatera || b === this.grabados.campana || b === this.grabados.gateras ? this.bus : this.cascosBus);
    s.start(Math.max(ctx.currentTime, t));
  }

  private arrancarPublico(ctx: AudioContext): void {
    if (this.publicoFuente) return;
    const fuente = ctx.createBufferSource();
    fuente.buffer = this.grabados.publico ?? this.ruido!; fuente.loop = true;
    // El rugido: el ruido pasa por bandas de voz (formantes); los agudos son los gritos que suben en la llegada
    const gain = ctx.createGain(); gain.gain.value = 0;
    const agudos = ctx.createGain(); agudos.gain.value = 0;
    if (this.grabados.publico) { fuente.connect(gain); }
    else {
      for (const [f, q, nivel] of [[320, 1.2, 0.9], [760, 1.6, 0.75], [1400, 2.2, 0.45]] as const) {
        const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = q;
        const n = ctx.createGain(); n.gain.value = nivel;
        fuente.connect(bp); bp.connect(n); n.connect(gain);
      }
      const alto = ctx.createBiquadFilter(); alto.type = "bandpass"; alto.frequency.value = 2600; alto.Q.value = 1.4;
      fuente.connect(alto); alto.connect(agudos); agudos.connect(gain);
    }
    gain.connect(this.bus);
    fuente.start();
    this.publicoFuente = fuente; this.publicoGain = gain; this.publicoAgudos = agudos;
  }

  private ajustarPublico(ctx: AudioContext, e: EstadoAudio): void {
    if (!this.publicoGain) return;
    const ahora = ctx.currentTime;
    const i = intensidadPublico({ fase: e.fase, restanLider: e.restanLider, distancia: e.distancia, segDesdeLlegada: this.llegada === null ? null : ahora - this.llegada });
    // El murmullo «respira»: pequeñas variaciones al azar cada fracción de segundo, como una multitud de verdad
    if (ahora >= this.proximoMurmullo) {
      this.proximoMurmullo = ahora + 0.18 + this.azar() * 0.25;
      const vaiven = 1 + (this.azar() - 0.5) * (0.25 + 0.35 * i);
      this.publicoGain.gain.setTargetAtTime(0.42 * i * vaiven, ahora, 0.12);
      this.publicoAgudos?.gain.setTargetAtTime(Math.max(0, i - 0.35) * 1.4 * (0.8 + this.azar() * 0.4), ahora, 0.1);
    }
  }

  /** Genera los sonidos una vez: cascos (6 variaciones por superficie), campana, gateras y ruido para el público. */
  private sintetizar(ctx: AudioContext): void {
    const sr = ctx.sampleRate, r = azar(777);
    const buffer = (seg: number, f: (t: number, k: number) => number) => {
      const b = ctx.createBuffer(1, Math.ceil(seg * sr), sr), d = b.getChannelData(0);
      for (let k = 0; k < d.length; k++) d[k] = f(k / sr, k);
      return b;
    };
    // Casco: golpe grave (la pata contra el suelo, con caída de tono) + tierra que salta (ruido filtrado)
    const casco = (sup: Superficie, variante: number) => {
      const tono = 95 + variante * 9, caidaRuido = sup === "tierra" ? 38 : 22, brillo = sup === "tierra" ? 0.55 : 0.18;
      let lp = 0, hp = 0, prev = 0, fase = 0;
      return buffer(0.16, (t) => {
        const f = tono * (1 + 1.6 * Math.exp(-t * 60));
        fase += (2 * Math.PI * f) / sr;
        const golpe = Math.sin(fase) * Math.exp(-t * 34) * 0.9;
        const n = r() * 2 - 1;
        lp += (n - lp) * (sup === "tierra" ? 0.45 : 0.16);          // tierra: más seco y crujiente; césped: apagado
        hp = lp - prev; prev = lp;
        const tierra = (hp * brillo + lp * 0.5) * Math.exp(-t * caidaRuido);
        const ataque = Math.min(1, t * 900);
        return (golpe + tierra) * ataque * 0.9;
      });
    };
    this.cascos = { tierra: [0, 1, 2, 3, 4, 5].map((v) => casco("tierra", v)), cesped: [0, 1, 2, 3, 4, 5].map((v) => casco("cesped", v)) };
    // Campana de largada: timbre eléctrico (martillo que golpea rápido) con parciales inarmónicos de campana
    const parciales = [[1, 1], [2.0, 0.5], [2.76, 0.45], [4.07, 0.25], [5.4, 0.18]];
    this.campana = buffer(2.6, (t) => {
      let s = 0;
      for (let golpe = 0; golpe < 14; golpe++) {
        const t0 = golpe * 0.075;
        if (t < t0) break;
        const u = t - t0, env = Math.exp(-u * 5) * (golpe < 13 ? 1 : 1.3);
        for (const [m, a] of parciales) s += Math.sin(2 * Math.PI * 1180 * m * u) * a * env * Math.exp(-u * m * 0.6);
      }
      return s * 0.12;
    });
    // Puerta de la gatera: golpe metálico (resonancias de chapa) + chasquido del pestillo
    const modos = [[310, 0.9, 9], [745, 0.6, 12], [1390, 0.45, 15], [2260, 0.3, 20], [3570, 0.2, 26]];
    this.gatera = buffer(0.9, (t) => {
      let s = 0;
      for (const [f, a, c] of modos) s += Math.sin(2 * Math.PI * f * t) * a * Math.exp(-t * c);
      const clic = (r() * 2 - 1) * Math.exp(-t * 180) * 0.9;
      return (s * 0.5 + clic) * Math.min(1, t * 2000) * 0.55;
    });
    // Ruido rosa (4 s, en bucle) para el público
    let b0 = 0, b1 = 0, b2 = 0;
    this.ruido = buffer(4, () => {
      const w = r() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527;
      return (b0 + b1 + b2 + w * 0.1848) * 0.11;
    });
  }

  /** Si hay grabaciones en public/sonidos/, se usan en lugar de las sintetizadas (las que falten siguen sintetizadas). */
  private async cargarGrabados(ctx: AudioContext): Promise<void> {
    const nombres = ["campana", "gateras", "publico", "casco1", "casco2", "casco3", "casco4"];
    await Promise.all(nombres.map(async (n) => {
      try {
        const r = await fetch(`/sonidos/${n}.mp3`);
        if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("audio")) return;
        this.grabados[n] = await ctx.decodeAudioData(await r.arrayBuffer());
      } catch { /* no hay grabación: queda la sintetizada */ }
    }));
  }
  private grabadosCascos(): AudioBuffer[] | null {
    const l = ["casco1", "casco2", "casco3", "casco4"].map((n) => this.grabados[n]).filter((b): b is AudioBuffer => !!b);
    return l.length ? l : null;
  }
}
