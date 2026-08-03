/**
 * Bestiariusz / Kodeks (v4 §5.7) — kolekcjonerstwo jako mnożnik.
 *
 * To jest **najtańszy content w grze**: zero nowych assetów, zero nowych
 * systemów, a u części graczy bardzo silna retencja. Zabij N sztuk danego
 * wroga → trwały bonus obrażeń przeciw temu typowi. Nic więcej.
 *
 * Progi są wykładnicze (10 → 100 → 1 000 → 10 000 → 100 000), bo licznik
 * zabójstw w grze idle rośnie wykładniczo. Progi liniowe kończyłyby się
 * w pierwszej godzinie i zamieniały kolekcję w listę odhaczonych pól.
 */
import enemies from "../../../../data/enemies.json" with { type: "json" };
import { emptyBonuses, type IdleBonuses, type IdleState } from "./types.ts";

export interface BestiaryTier {
  kills: number;
  bonus: number;
  label: string;
}

/**
 * Progi i bonusy. Trzymane w kodzie, a nie w `data/`, bo to nie jest pokrętło
 * balansu — to kształt systemu. Zmiana wartości bonusu owszem, ale wtedy
 * i tak dotyka się tej jednej tablicy.
 */
export const BESTIARY_TIERS: readonly BestiaryTier[] = [
  { kills: 10, bonus: 0.02, label: "Poznany" },
  { kills: 100, bonus: 0.05, label: "Tropiony" },
  { kills: 1_000, bonus: 0.1, label: "Ścigany" },
  { kills: 10_000, bonus: 0.18, label: "Wytępiony" },
  { kills: 100_000, bonus: 0.3, label: "Legenda" },
];

export interface BestiaryEntry {
  enemyId: string;
  name: string;
  kills: number;
  /** Indeks osiągniętego tieru, −1 gdy jeszcze żadnego. */
  tier: number;
  tierLabel: string;
  /** Ile zabójstw do kolejnego tieru; `null` przy komplecie. */
  nextAt: number | null;
  bonus: number;
}

let roster: readonly { id: string; name: string }[] | null = null;

export function bundledBestiary(): readonly { id: string; name: string }[] {
  if (!roster) {
    roster = (enemies.roster as { id: string; name: string }[]).map((e) => ({
      id: e.id,
      name: e.name,
    }));
  }
  return roster;
}

/** Osiągnięty tier dla danej liczby zabójstw. `-1` = jeszcze żadnego. */
export function tierFor(kills: number): number {
  let tier = -1;
  for (let i = 0; i < BESTIARY_TIERS.length; i++) {
    if (kills >= BESTIARY_TIERS[i]!.kills) tier = i;
  }
  return tier;
}

export function bonusFor(kills: number): number {
  const tier = tierFor(kills);
  return tier >= 0 ? BESTIARY_TIERS[tier]!.bonus : 0;
}

/**
 * Zapisuje zabójstwa i mówi, czy właśnie przeskoczył próg — to jest jedyny
 * moment, w którym warto pokazać toast. Bez tego gracz nigdy nie zauważy,
 * że kolekcja cokolwiek daje.
 */
export function recordKill(
  state: IdleState,
  enemyId: string,
  count = 1,
): { tierUp: boolean; tier: number; kills: number } {
  const before = state.bestiary[enemyId] ?? 0;
  const after = before + Math.max(0, Math.floor(count));
  state.bestiary[enemyId] = after;

  const tierBefore = tierFor(before);
  const tierAfter = tierFor(after);
  return { tierUp: tierAfter > tierBefore, tier: tierAfter, kills: after };
}

export function bestiaryEntries(state: IdleState): BestiaryEntry[] {
  return bundledBestiary().map((enemy) => {
    const kills = state.bestiary[enemy.id] ?? 0;
    const tier = tierFor(kills);
    const next = BESTIARY_TIERS[tier + 1];
    return {
      enemyId: enemy.id,
      name: enemy.name,
      kills,
      tier,
      tierLabel: tier >= 0 ? BESTIARY_TIERS[tier]!.label : "Nieznany",
      nextAt: next ? next.kills : null,
      bonus: tier >= 0 ? BESTIARY_TIERS[tier]!.bonus : 0,
    };
  });
}

export function bestiaryBonuses(state: IdleState): IdleBonuses {
  const out = emptyBonuses();
  for (const [enemyId, kills] of Object.entries(state.bestiary)) {
    const bonus = bonusFor(kills);
    if (bonus > 0) out.perEnemy[enemyId] = bonus;
  }
  return out;
}

/**
 * Uśredniony bonus bestiariusza jako zwykłe `increasedDamage`.
 *
 * Warstwa idle nie modeluje pojedynczych typów wrogów w pakiecie — liczy
 * strefę jako jedną masę HP. Uśrednienie po odkrytych wpisach jest tu
 * uczciwym przybliżeniem: gracz, który wytępił połowę bestiariusza, ma
 * realnie mniej więcej połowę maksymalnego bonusu.
 */
export function bestiaryAverageBonus(state: IdleState): IdleBonuses {
  const total = bundledBestiary().length;
  if (total === 0) return emptyBonuses();

  let sum = 0;
  for (const kills of Object.values(state.bestiary)) sum += bonusFor(kills);

  const out = emptyBonuses();
  out.increasedDamage = sum / total;
  return out;
}

export function bestiaryProgress(state: IdleState): {
  discovered: number;
  total: number;
  completed: number;
} {
  const total = bundledBestiary().length;
  let discovered = 0;
  let completed = 0;
  const topTier = BESTIARY_TIERS.length - 1;

  for (const enemy of bundledBestiary()) {
    const kills = state.bestiary[enemy.id] ?? 0;
    if (kills > 0) discovered += 1;
    if (tierFor(kills) >= topTier) completed += 1;
  }

  return { discovered, total, completed };
}
