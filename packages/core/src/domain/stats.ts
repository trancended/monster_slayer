/**
 * System statystyk (GDD §11.4):
 *   wartość_końcowa = (baza + Σ flat) × (1 + Σ increased_%) × Π (1 + more_%)
 *
 * Trzy typy modyfikatorów, jasno rozdzielone. `more` jest rzadkie i
 * multiplikatywne — dzięki temu legendy i kluczowe węzły drzewka są odczuwalne.
 */
export type StatKey =
  | "maxHp"
  | "maxStamina"
  | "armor"
  | "flatDamage"
  | "increasedDamage"
  | "flatElemental"
  | "attackSpeed"
  | "critChance"
  | "critDamage"
  | "lifesteal"
  | "moveSpeed"
  | "cooldownReduction"
  | "elementalResist"
  | "poise";

export interface StatBucket {
  flat: number;
  increased: number;
  more: number[];
}

const EMPTY: StatBucket = { flat: 0, increased: 0, more: [] };

export class StatSheet {
  private readonly buckets = new Map<StatKey, StatBucket>();
  /** Twarde capy z GDD §15 — chronią balans po dodaniu legend. */
  private readonly caps = new Map<StatKey, number>();

  setCap(key: StatKey, cap: number): void {
    this.caps.set(key, cap);
  }

  addFlat(key: StatKey, value: number): void {
    this.bucket(key).flat += value;
  }

  addIncreased(key: StatKey, pct: number): void {
    this.bucket(key).increased += pct;
  }

  addMore(key: StatKey, pct: number): void {
    this.bucket(key).more.push(pct);
  }

  private bucket(key: StatKey): StatBucket {
    let b = this.buckets.get(key);
    if (!b) {
      b = { flat: 0, increased: 0, more: [] };
      this.buckets.set(key, b);
    }
    return b;
  }

  get(key: StatKey, base = 0): number {
    const b = this.buckets.get(key) ?? EMPTY;
    let value = (base + b.flat) * (1 + b.increased);
    for (const m of b.more) value *= 1 + m;
    const cap = this.caps.get(key);
    return cap !== undefined ? Math.min(value, cap) : value;
  }

  clear(): void {
    this.buckets.clear();
  }
}
