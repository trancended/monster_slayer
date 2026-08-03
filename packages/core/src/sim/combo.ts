/**
 * Combo zabójstw — mnożnik nagród za utrzymanie tempa rzezi.
 *
 * Po co to jest: bez combo każde zabójstwo jest warte tyle samo, więc gracz
 * nie ma powodu ryzykować. Combo zamienia „zabij bezpiecznie" w decyzję
 * „zdążę zabić następnego, zanim zegar zejdzie do zera?" — i to jest jedyny
 * moment w tej grze, w którym agresja opłaca się wymiernie.
 *
 * Trzy reguły, które trzymają to w ryzach:
 *  1. **Okno kurczy się z tierem.** Inaczej wysokie combo byłoby darmowe dla
 *     każdego, kto po prostu długo gra — a ma być nagrodą za tempo.
 *  2. **Mnożnik dotyczy złota i XP, nie obrażeń.** Combo nie może zastąpić
 *     buildu; ma nagradzać, a nie rozwiązywać problem mocy.
 *  3. **Szansa na łup rośnie osobno i wolniej.** Gdyby combo skalowało łup tak
 *     samo jak złoto, znajdźka przestałaby cokolwiek znaczyć.
 *
 * Klasa jest czysto obliczeniowa: zegar dostaje `dt` z zewnątrz, nie czyta
 * `Date.now()`. Dzięki temu ten sam kod liczy się w grze i w symulatorze.
 */
import type { KillComboData, KillComboTier } from "../data/schema.ts";

export interface ComboSnapshot {
  /** Liczba zabójstw w bieżącej serii. */
  count: number;
  /** Indeks tieru; −1 gdy seria jeszcze nie osiągnęła pierwszego progu. */
  tier: number;
  name: string;
  color: string;
  multiplier: number;
  /** Sekundy do zerwania serii. */
  remaining: number;
  /** 0–1, gotowe pod pasek w HUD. */
  fraction: number;
  /** Ile zabójstw do kolejnego tieru; `null` na szczycie. */
  toNextTier: number | null;
  /** Najdłuższa seria w tej sesji — licznik do pochwalenia się. */
  best: number;
}

const IDLE: ComboSnapshot = {
  count: 0,
  tier: -1,
  name: "",
  color: "#9aa3b2",
  multiplier: 1,
  remaining: 0,
  fraction: 0,
  toNextTier: null,
  best: 0,
};

export class KillCombo {
  private data: KillComboData;
  private count = 0;
  private timer = 0;
  private bestRun = 0;

  constructor(data: KillComboData) {
    this.data = data;
  }

  /** Podmiana danych przy hot reloadzie balansu — seria leci dalej. */
  setData(data: KillComboData): void {
    this.data = data;
  }

  get kills(): number {
    return this.count;
  }

  get best(): number {
    return this.bestRun;
  }

  get active(): boolean {
    return this.count > 0;
  }

  /** Indeks najwyższego osiągniętego tieru; −1 poniżej pierwszego progu. */
  get tierIndex(): number {
    let idx = -1;
    for (let i = 0; i < this.data.tiers.length; i++) {
      if (this.count >= this.data.tiers[i]!.at) idx = i;
    }
    return idx;
  }

  get tier(): KillComboTier | null {
    const idx = this.tierIndex;
    return idx >= 0 ? (this.data.tiers[idx] ?? null) : null;
  }

  /** Mnożnik nagród. Zawsze ≥ 1 — combo nigdy nie zabiera. */
  get multiplier(): number {
    return this.tier?.mult ?? 1;
  }

  /** Dodatek do szansy na łup, rosnący liniowo z tierem. */
  get dropChanceBonus(): number {
    const idx = this.tierIndex;
    return idx < 0 ? 0 : (idx + 1) * this.data.dropChanceBonusPerTier;
  }

  /** Okno na kolejne zabójstwo przy bieżącym tierze. */
  get window(): number {
    const idx = this.tierIndex;
    const raw = this.data.window + (idx + 1) * this.data.windowPerTier;
    return Math.max(this.data.windowMin, raw);
  }

  /**
   * Zabójstwo. Zwraca `true`, gdy seria właśnie awansowała o tier —
   * to jedyny moment, w którym warto zagrać dźwięk i podbić HUD.
   */
  add(): boolean {
    const before = this.tierIndex;
    this.count += 1;
    if (this.count > this.bestRun) this.bestRun = this.count;
    // Okno liczymy PO inkrementacji, żeby wejście w wyższy tier od razu
    // obowiązywało krótszym oknem — inaczej gracz dostawałby jedno darmowe
    // zabójstwo na starym, łagodniejszym zegarze.
    this.timer = this.window;
    return this.tierIndex > before;
  }

  /**
   * Upływ czasu. Zwraca liczbę zabójstw zerwanej serii, gdy okno się zamknęło,
   * albo 0. Zerwanie jest zdarzeniem — gracz musi je zobaczyć i usłyszeć.
   */
  tick(dt: number): number {
    if (this.count === 0) return 0;
    this.timer -= dt;
    if (this.timer > 0) return 0;
    const broken = this.count;
    this.count = 0;
    this.timer = 0;
    return broken;
  }

  /** Twarde zerwanie — śmierć gracza kończy serię niezależnie od zegara. */
  reset(): number {
    const broken = this.count;
    this.count = 0;
    this.timer = 0;
    return broken;
  }

  /** Rekord sesji zerujemy tylko przy nowej postaci. */
  resetBest(): void {
    this.bestRun = 0;
  }

  snapshot(): ComboSnapshot {
    if (this.count === 0) return { ...IDLE, best: this.bestRun };

    const idx = this.tierIndex;
    const tier = idx >= 0 ? this.data.tiers[idx] : undefined;
    const next = this.data.tiers[idx + 1];
    const win = this.window;

    return {
      count: this.count,
      tier: idx,
      name: tier?.name ?? "",
      color: tier?.color ?? IDLE.color,
      multiplier: tier?.mult ?? 1,
      remaining: Math.max(0, this.timer),
      fraction: win > 0 ? Math.max(0, Math.min(1, this.timer / win)) : 0,
      toNextTier: next ? next.at - this.count : null,
      best: this.bestRun,
    };
  }
}

/**
 * Mnożnik dla konkretnej liczby zabójstw — używane przez podgląd tabeli
 * w interfejsie i przez symulator, które nie mają instancji `KillCombo`.
 */
export function multiplierFor(count: number, data: KillComboData): number {
  let mult = 1;
  for (const tier of data.tiers) if (count >= tier.at) mult = tier.mult;
  return mult;
}
