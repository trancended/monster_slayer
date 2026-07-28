/**
 * Deterministyczny RNG — xorshift128+ z jawnym ziarnem (GDD §11.3).
 * Osobne strumienie dla loot / crit / AI, żeby zmiana jednego systemu
 * nie przesuwała sekwencji w pozostałych. To jedyny sposób na powtarzalne bugi.
 */
export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number) {
    // splitmix32 do rozsiania ziarna na cztery słowa stanu
    let x = seed >>> 0;
    const next = () => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** xoshiro128** — 32-bitowy, szybki, bez alokacji. */
  nextUint32(): number {
    const mul5 = Math.imul(this.s1, 5) >>> 0;
    const rotated = ((mul5 << 7) | (mul5 >>> 25)) >>> 0;
    const out = Math.imul(rotated, 9) >>> 0;

    const t = (this.s1 << 9) >>> 0;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = ((this.s3 << 11) | (this.s3 >>> 21)) >>> 0;
    return out;
  }

  /** [0, 1) */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(minInclusive: number, maxInclusive: number): number {
    return minInclusive + Math.floor(this.next() * (maxInclusive - minInclusive + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick: pusta tablica");
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Losowanie ważone — używane przez tabele rzadkości. */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
    let total = 0;
    for (const it of items) total += weightOf(it);
    let roll = this.next() * total;
    for (const it of items) {
      roll -= weightOf(it);
      if (roll <= 0) return it;
    }
    return items[items.length - 1] as T;
  }

  serialize(): [number, number, number, number] {
    return [this.s0, this.s1, this.s2, this.s3];
  }

  restore(state: readonly [number, number, number, number]): void {
    this.s0 = state[0] >>> 0;
    this.s1 = state[1] >>> 0;
    this.s2 = state[2] >>> 0;
    this.s3 = state[3] >>> 0;
  }
}

/** Nazwane strumienie — GDD §11.3: loot, crit i AI nigdy nie dzielą sekwencji. */
export class RngStreams {
  readonly loot: Rng;
  readonly crit: Rng;
  readonly ai: Rng;
  readonly vfx: Rng;
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.loot = new Rng(this.seed ^ 0x1a2b3c4d);
    this.crit = new Rng(this.seed ^ 0x5e6f7a8b);
    this.ai = new Rng(this.seed ^ 0x9c0d1e2f);
    this.vfx = new Rng(this.seed ^ 0x3f4a5b6c);
  }
}
