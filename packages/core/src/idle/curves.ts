/**
 * Krzywe progresji (v4 §4.1, §4.2, §4.6) — czysta matematyka, zero stanu.
 *
 * Ten plik jest fundamentem balansu: koszty ulepszeń, HP stref, złoto i afiksy
 * liczy się **tylko** tutaj. Reszta warstwy idle woła te funkcje zamiast
 * powtarzać wzory, bo powielona formuła to gwarancja rozjazdu między
 * podglądem w UI, symulacją offline i walidacją serwerową.
 *
 * Wszystko przechodzi przez `Big`, bo koszt setnego poziomu mieści się jeszcze
 * w `number`, ale koszt tysięcznego już nie — a gracz idle dojdzie tam
 * w kilkanaście godzin (v4 §7.6).
 */
import {
  BIG_ONE,
  BIG_ZERO,
  add,
  big,
  div,
  gt,
  isZero,
  log10,
  lte,
  mul,
  powNum,
  scale,
  sub,
  toNumber,
  type Big,
} from "../core/bignum.ts";
import type { ItemsConfig, ZonesConfig } from "./config.ts";

/**
 * Estymata z logarytmu potrafi się rozminąć o jeden poziom przez zaokrąglenie
 * mantysy. Korekta jest domknięciem wyniku, nie wyszukiwaniem — stąd twardy
 * limit obrotów: gdyby kiedykolwiek go dotknęła, znaczy to błąd we wzorze,
 * a nie trudny przypadek brzegowy.
 */
const AFFORDABLE_FIX_STEPS = 8;

// ──────────────────────────────────────────────────────── koszty ulepszeń

/** `C(n) = C₀ · r^n` — koszt zakupu poziomu `n+1` (v4 §4.1). */
export function costAt(c0: number, r: number, n: number): Big {
  if (c0 <= 0 || n < 0) return BIG_ZERO;
  return scale(powNum(r, n), c0);
}

/** `C(n → n+k) = C₀ · r^n · (r^k − 1)/(r − 1)` — cena przycisku „kup ×10". */
export function costRange(c0: number, r: number, n: number, k: number): Big {
  if (k <= 0) return BIG_ZERO;
  // Krzywa płaska (r = 1) jest poza schematem konfiguracji, ale wzór z ilorazem
  // dzieliłby wtedy przez zero — taniej obsłużyć niż debugować NaN w cenie.
  if (r <= 1) return scale(costAt(c0, r, n), k);
  return mul(costAt(c0, r, n), div(sub(powNum(r, k), BIG_ONE), big(r - 1)));
}

/**
 * `k = floor( log(1 + G·(r−1)/(C₀·r^n)) / log r )` — ile poziomów stać gracza.
 *
 * Liczone na logarytmach, bo `G` sięga 1e200 i `toNumber` dawno by tu poległ.
 * Wynik domykamy porównaniem z `costRange`, żeby „kup max" nigdy nie zszedł
 * poniżej zera ani nie zostawił poziomu, na który było stać.
 */
export function affordableLevels(c0: number, r: number, n: number, gold: Big): number {
  if (c0 <= 0 || n < 0 || isZero(gold) || gold.m < 0) return 0;
  if (r <= 1) return Math.max(0, Math.floor(toNumber(div(gold, costAt(c0, r, n)))));

  const unit = costAt(c0, r, n);
  if (isZero(unit)) return 0;

  const ratio = add(div(scale(gold, r - 1), unit), BIG_ONE);
  let k = Math.floor(log10(ratio) / Math.log10(r));
  if (!Number.isFinite(k)) return 0;
  if (k < 0) k = 0;

  for (let i = 0; i < AFFORDABLE_FIX_STEPS && k > 0 && gt(costRange(c0, r, n, k), gold); i++) k--;
  for (let i = 0; i < AFFORDABLE_FIX_STEPS && lte(costRange(c0, r, n, k + 1), gold); i++) k++;
  return k;
}

// ─────────────────────────────────────────────────────────── strefy i HP

/** Ilu zwykłych wrogów trzeba ubić, żeby wyczyścić strefę. */
export function killsRequired(zone: number, cfg: ZonesConfig): number {
  return zone >= 1 ? cfg.killsPerZone : 0;
}

/** `HP(z) = HP₀ · z^p · b^z` — wykładnicza z korektą wielomianową (v4 §4.2). */
export function zoneHp(zone: number, cfg: ZonesConfig): Big {
  const z = Math.max(1, Math.floor(zone));
  return mul(scale(powNum(z, cfg.polyExponent), cfg.hp0), powNum(cfg.expBase, z));
}

export function isBossZone(zone: number, cfg: ZonesConfig): boolean {
  return zone >= 1 && Math.floor(zone) % cfg.bossEvery === 0;
}

export function bossHp(zone: number, cfg: ZonesConfig): Big {
  return scale(zoneHp(zone, cfg), cfg.bossHpMult);
}

/** Suma HP całej strefy: pakiety zwykłych plus boss, jeśli strefa go ma. */
export function zoneTotalHp(zone: number, cfg: ZonesConfig): Big {
  const regular = scale(zoneHp(zone, cfg), killsRequired(zone, cfg));
  return isBossZone(zone, cfg) ? add(regular, bossHp(zone, cfg)) : regular;
}

/**
 * Złoto za jednego zwykłego wroga. Rośnie wolniej niż HP — inaczej ceny
 * ulepszeń przestałyby cokolwiek znaczyć po dwudziestu strefach.
 */
export function goldPerKill(zone: number, cfg: ZonesConfig): Big {
  const z = Math.max(1, Math.floor(zone));
  return mul(
    scale(powNum(z, cfg.goldPolyExponent), cfg.goldPerKill0),
    powNum(cfg.goldExpBase, z),
  );
}

/** Złoto za wyczyszczenie całej strefy — wejście do prognozy offline. */
export function zoneGold(zone: number, cfg: ZonesConfig): Big {
  const per = goldPerKill(zone, cfg);
  const regular = scale(per, killsRequired(zone, cfg));
  return isBossZone(zone, cfg) ? add(regular, scale(per, cfg.bossGoldMult)) : regular;
}

/**
 * Sekundy na wyczyszczenie strefy przy zadanym DPS-ie pakietowym.
 * `Infinity` przy zerowych obrażeniach jest wartością sensowną, nie błędem:
 * ekran diagnozy czyta to jako „nigdy" i o to właśnie chodzi (v4 §2.2).
 */
export function zoneClearSeconds(zone: number, cfg: ZonesConfig, clearDps: Big): number {
  if (isZero(clearDps) || clearDps.m < 0) return Infinity;
  return toNumber(div(zoneTotalHp(zone, cfg), clearDps));
}

// ────────────────────────────────────────────────────────────── przedmioty

/**
 * `wartość = base · (1 + perZone·z) · roll` (v4 §4.6). Strefa dropu jest
 * jedynym źródłem skalowania — dzięki temu przedmiot ze strefy 40 zawsze bije
 * ten ze strefy 20 i nie trzeba osobnych tabel poziomów przedmiotu.
 */
export function affixValue(base: number, zone: number, roll: number, cfg: ItemsConfig): number {
  const z = Math.max(1, Math.floor(zone));
  return base * (1 + cfg.affixPerZone * z) * roll;
}
