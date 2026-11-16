// Generador pseudoaleatorio determinista (xoshiro128**), solo con operaciones enteras de 32 bits.
// Da exactamente la misma secuencia en cualquier navegador o en Node.

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let z = a;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export class Rng {
  private s0: number; private s1: number; private s2: number; private s3: number;

  constructor(seed: number) {
    const sm = splitmix32(seed);
    this.s0 = sm(); this.s1 = sm(); this.s2 = sm(); this.s3 = sm();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** Entero sin signo de 32 bits. */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 ^= this.s0; this.s3 ^= this.s1; this.s1 ^= this.s2; this.s0 ^= this.s3;
    this.s2 ^= t; this.s3 = rotl(this.s3, 11);
    this.s0 >>>= 0; this.s1 >>>= 0; this.s2 >>>= 0; this.s3 >>>= 0;
    return result;
  }

  /** Uniforme en [0, 1). La división por 2^32 es exacta en IEEE-754. */
  next(): number { return this.nextU32() / 4294967296; }

  /** Aproximación normal N(0,1) por suma de 12 uniformes (Irwin-Hall): sin log/cos, totalmente determinista. */
  normal(): number {
    let s = 0;
    for (let i = 0; i < 12; i++) s += this.next();
    return s - 6;
  }

  /** Generador nuevo derivado de este (consume un número): para sorteos aparte que no muevan la secuencia siguiente. */
  fork(): Rng { return new Rng(this.nextU32() ^ 0x6d2b79f5); }

  /** Entero uniforme en [0, n). */
  int(n: number): number { return Math.floor(this.next() * n); }
}

function rotl(x: number, k: number): number { return ((x << k) | (x >>> (32 - k))) >>> 0; }
