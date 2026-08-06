/**
 * Kowal — przekuwanie zbędnego wyposażenia w legendę.
 *
 * Problem, który to rozwiązuje: po kilkudziesięciu rundach plecak zapełnia się
 * przedmiotami, których nikt nigdy nie założy. Sprzedaż daje złoto, ale złoto
 * przestaje być wąskim gardłem — a więc łup przestaje cokolwiek znaczyć.
 * Przekuwanie zamienia tę stertę w **kierunek**: dwadzieścia niepotrzebnych
 * przedmiotów to konkretny krok do legendy.
 *
 * Dwie waluty, obie z gry, nie z ekranu ulepszeń:
 *
 * 1. **Rdzeń kowala** — wypada z każdego pokonanego bossa. To on uruchamia
 *    warsztat i on ogranicza tempo: bez bossów nie ma legend, choćby plecak
 *    pękał w szwach.
 * 2. **Moc przekucia** — suma wartości oddanych przedmiotów wg rzadkości.
 *
 * Wynikiem jest legenda **losowego typu**. To celowe: przekuwanie ma być
 * sposobem na zdobycie legendy w ogóle, a nie sposobem na wybranie tej jednej,
 * której gracz akurat chce — inaczej cały system łupu przestałby mieć znaczenie.
 */
import type { Item, ItemRarityId } from "../domain/item.ts";

/**
 * Moc przekucia wg rzadkości. Skala wynika z docelowej relacji:
 * **30 zwykłych = 10 epickich = jedna legenda**, a wpisy pośrednie leżą między
 * nimi monotonicznie. Legendy też da się oddać, ale to zawsze zła transakcja —
 * pięć legend na jedną losową to nie wymiana, to hazard.
 */
export const FORGE_POWER: Record<ItemRarityId, number> = {
  common: 1,
  uncommon: 1.5,
  rare: 2,
  epic: 3,
  legendary: 5,
};

/** Ile mocy trzeba na jedną legendę. */
export const FORGE_TARGET_POWER = 30;

/** Ile rdzeni kowala zużywa jedno przekucie. */
export const FORGE_CORE_COST = 1;

/** Rzadkości, które automat „wybierz zbędne" oddaje bez pytania. */
export const FORGE_JUNK_RARITIES: readonly ItemRarityId[] = ["common", "uncommon", "rare"];

export function forgePower(items: readonly Item[]): number {
  let sum = 0;
  for (const item of items) sum += FORGE_POWER[item.rarity] ?? 1;
  // Ułamki z „1.5" potrafią dać 29.999999999999996 przy dwudziestu wpisach,
  // a wtedy gotowe przekucie wyglądałoby na niegotowe.
  return Math.round(sum * 100) / 100;
}

export interface ForgeQuote {
  power: number;
  target: number;
  cores: number;
  coreCost: number;
  /** Ile mocy brakuje do progu (0 = próg osiągnięty). */
  missingPower: number;
  /** Ile rdzeni brakuje (0 = wystarcza). */
  missingCores: number;
  ready: boolean;
  /** Gotowy komunikat o brakach — HUD nie ma liczyć tego sam. */
  reason: string;
}

/**
 * Wycena przekucia. Zwraca **czego brakuje**, a nie samo „nie da się":
 * „za mało materiałów" każe graczowi liczyć w głowie, „brakuje 6 mocy" nie.
 */
export function forgeQuote(items: readonly Item[], cores: number): ForgeQuote {
  const power = forgePower(items);
  const have = Number.isFinite(cores) ? Math.max(0, Math.floor(cores)) : 0;
  const missingPower = Math.max(0, Math.round((FORGE_TARGET_POWER - power) * 100) / 100);
  const missingCores = Math.max(0, FORGE_CORE_COST - have);

  let reason = "";
  if (missingCores > 0 && missingPower > 0) {
    reason = `Brakuje ${missingPower} mocy i ${missingCores} rdzenia z bossa`;
  } else if (missingCores > 0) {
    reason = `Brakuje ${missingCores} rdzenia z bossa`;
  } else if (missingPower > 0) {
    reason = `Brakuje ${missingPower} mocy — dołóż przedmiotów`;
  }

  return {
    power,
    target: FORGE_TARGET_POWER,
    cores: have,
    coreCost: FORGE_CORE_COST,
    missingPower,
    missingCores,
    ready: missingPower === 0 && missingCores === 0,
    reason,
  };
}

/**
 * Ile przedmiotów danej rzadkości trzeba na jedno przekucie — do podpowiedzi
 * w interfejsie („30 zwykłych albo 10 epickich").
 */
export function itemsNeeded(rarity: ItemRarityId): number {
  return Math.ceil(FORGE_TARGET_POWER / (FORGE_POWER[rarity] ?? 1));
}
