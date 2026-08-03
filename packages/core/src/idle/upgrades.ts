/**
 * Tabela ulepszeń za złoto (v4 §4.1) — jedyne miejsce, w którym poziom
 * ulepszenia zamienia się w liczbę wpływającą na walkę.
 *
 * Podział ról: `curves.ts` wie, ile coś kosztuje, ten plik wie, co gracz za to
 * dostaje i czy go na to stać. Dzięki temu `rates.ts` nigdy nie zagląda do
 * `state.upgrades` — dostaje gotowe `UpgradeEffects` i składa z nich DPS.
 */
import { BIG_ZERO, format, gt, lte, max as bigMax, sub, type Big } from "../core/bignum.ts";
import type { IdleConfig, UpgradeDef } from "./config.ts";
import { affordableLevels, costRange } from "./curves.ts";
import {
  failResult,
  okResult,
  type ActionResult,
  type IdleState,
  type UpgradeId,
} from "./types.ts";

/**
 * Zsumowany wkład całej tabeli ulepszeń. Wszystkie pola są zwykłymi `number`:
 * to są mnożniki i ułamki, a nie wartości rosnące wykładniczo w nieskończoność
 * (poza `damageMult`, który przy realnych poziomach nie zbliża się do granicy
 * `float64` — koszt takiego poziomu przekroczyłby złoto dostępne w grze).
 */
export interface UpgradeEffects {
  /** Suma `flat` z ulepszenia „Obrażenia". */
  flatDamage: number;
  /** Mnożnik złożony `(1 + mult)^n` z ulepszenia „Obrażenia". */
  damageMult: number;
  /** Ułamek: `0.15` = +15% ataków na sekundę. */
  attackSpeed: number;
  /** Ułamek punktów procentowych, już po przycięciu do `cap`. */
  critChance: number;
  /** Dodatek do mnożnika krytyka, nie mnożnik sam w sobie. */
  critMult: number;
  goldFind: number;
  /** Ułamek obrażeń przenoszonych na pakiet, już po przycięciu do `cap`. */
  areaDamage: number;
  magicFind: number;
}

export function emptyUpgradeEffects(): UpgradeEffects {
  return {
    flatDamage: 0,
    damageMult: 1,
    attackSpeed: 0,
    critChance: 0,
    critMult: 0,
    areaDamage: 0,
    goldFind: 0,
    magicFind: 0,
  };
}

// ───────────────────────────────────────────────────────────── odczyty

export function upgradeLevel(state: IdleState, id: UpgradeId): number {
  const n = state.upgrades[id];
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Odblokowania idą po najgłębszej strefie w historii konta — prestiż ich nie zabiera. */
export function isUpgradeUnlocked(state: IdleState, def: UpgradeDef): boolean {
  return state.deepestZoneEver >= def.unlockZone;
}

/**
 * Koszt `count` kolejnych poziomów. Liczba jest przycinana do sufitu efektu,
 * żeby cena na przycisku „×10" zgadzała się z tym, co naprawdę zostanie
 * pobrane, gdy do capu brakuje już tylko trzech poziomów.
 */
export function upgradeCost(
  state: IdleState,
  cfg: IdleConfig,
  id: UpgradeId,
  count: number,
): Big {
  const def = defOf(cfg, id);
  if (!def) return BIG_ZERO;
  const n = upgradeLevel(state, id);
  const k = Math.min(Math.floor(count), levelsToCap(def, n));
  return k > 0 ? costRange(def.c0, def.r, n, k) : BIG_ZERO;
}

/** Ile poziomów gracz kupi teraz: ograniczone złotem **i** sufitem efektu. */
export function maxAffordable(state: IdleState, cfg: IdleConfig, id: UpgradeId): number {
  const def = defOf(cfg, id);
  if (!def || !isUpgradeUnlocked(state, def)) return 0;
  const n = upgradeLevel(state, id);
  return Math.min(affordableLevels(def.c0, def.r, n, state.gold), levelsToCap(def, n));
}

// ───────────────────────────────────────────────────────────────── zakup

/**
 * Jedyna funkcja w pliku, która mutuje stan — zdejmuje złoto i podnosi poziom.
 * Zakup na sztywną liczbę jest „wszystko albo nic": częściowa realizacja
 * przycisku „×10" wygląda jak błąd, a nie jak uprzejmość.
 */
export function buyUpgrade(
  state: IdleState,
  cfg: IdleConfig,
  id: UpgradeId,
  count: number | "max",
): ActionResult<{ levels: number; spent: Big }> {
  const def = defOf(cfg, id);
  if (!def) return failResult("Nieznane ulepszenie");
  if (!isUpgradeUnlocked(state, def)) {
    return failResult(`${def.name}: odblokowanie w strefie ${def.unlockZone}`);
  }

  const n = upgradeLevel(state, id);
  const room = levelsToCap(def, n);
  if (room <= 0) return failResult(`${def.name}: osiągnięto limit efektu`);

  const levels =
    count === "max" ? maxAffordable(state, cfg, id) : Math.min(Math.floor(count), room);
  if (levels <= 0) return failResult("Za mało złota");

  const spent = costRange(def.c0, def.r, n, levels);
  if (gt(spent, state.gold)) return failResult(`Za mało złota — potrzeba ${format(spent)}`);

  // `affordableLevels` gwarantuje `spent ≤ gold`, ale odejmowanie na mantysie
  // float64 potrafi zostawić ujemny pył przy różnicy rzędu 1e−15 względem
  // salda. Ujemne złoto rozlałoby się na każdą kolejną formułę — ucinamy tu.
  state.gold = bigMax(BIG_ZERO, sub(state.gold, spent));
  state.upgrades[id] = n + levels;

  return okResult(`${def.name} +${levels} ${levelWord(levels)} za ${format(spent)}`, {
    levels,
    spent,
  });
}

// ───────────────────────────────────────────────────────────────── efekty

/** Przelicza całą tabelę na wartości gotowe do wzoru na obrażenia. */
export function upgradeEffects(state: IdleState, cfg: IdleConfig): UpgradeEffects {
  const eff = emptyUpgradeEffects();

  for (const def of cfg.upgrades) {
    const n = upgradeLevel(state, def.id);
    if (n <= 0) continue;

    switch (def.id) {
      case "damage":
        eff.flatDamage += def.flat * n;
        // Mnożnik składa się zamiast sumować — to on trzyma krzywą obrażeń
        // przy krzywej HP wtedy, gdy sam `flat` już dawno nie nadąża.
        eff.damageMult *= Math.pow(1 + def.mult, n);
        break;
      case "attackSpeed":
        eff.attackSpeed = capped(def, eff.attackSpeed + perLevel(def) * n);
        break;
      case "critChance":
        eff.critChance = capped(def, eff.critChance + perLevel(def) * n);
        break;
      case "critMult":
        eff.critMult = capped(def, eff.critMult + perLevel(def) * n);
        break;
      case "goldFind":
        eff.goldFind = capped(def, eff.goldFind + perLevel(def) * n);
        break;
      case "areaDamage":
        eff.areaDamage = capped(def, eff.areaDamage + perLevel(def) * n);
        break;
      case "magicFind":
        eff.magicFind = capped(def, eff.magicFind + perLevel(def) * n);
        break;
    }
  }

  return eff;
}

// ───────────────────────────────────────────────────────────── pomocnicze

function defOf(cfg: IdleConfig, id: UpgradeId): UpgradeDef | undefined {
  return cfg.upgrades.find((u) => u.id === id);
}

/**
 * Przyrost na poziom. Konfiguracja opisuje go raz jako `flat` (punkty statu),
 * raz jako `mult` (ułamek) — z punktu widzenia sufitu i sumowania to ta sama
 * liczba, więc nie ma sensu rozdzielać tego w każdym `case`.
 */
function perLevel(def: UpgradeDef): number {
  return def.flat !== 0 ? def.flat : def.mult;
}

function capped(def: UpgradeDef, value: number): number {
  return def.cap > 0 ? Math.min(value, def.cap) : value;
}

/**
 * Ile poziomów zostało do sufitu. `cap` opisuje sumę efektu, nie liczbę
 * poziomów (v4 §4.1) — inaczej zmiana `flat` w JSON-ie cicho przesuwałaby
 * limit szansy na krytyka. Brak sufitu (`cap = 0`) → brak ograniczenia.
 */
function levelsToCap(def: UpgradeDef, level: number): number {
  const per = perLevel(def);
  if (def.cap <= 0 || per <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor(def.cap / per) - level);
}

/** Polska odmiana: 1 poziom, 2 poziomy, 5 poziomów, 12 poziomów. */
function levelWord(n: number): string {
  if (n === 1) return "poziom";
  const last = n % 10;
  const teen = n % 100;
  return last >= 2 && last <= 4 && (teen < 12 || teen > 14) ? "poziomy" : "poziomów";
}

/** Czy stać gracza choć na jeden poziom — skrót dla podświetleń w UI. */
export function canAfford(state: IdleState, cfg: IdleConfig, id: UpgradeId): boolean {
  const def = defOf(cfg, id);
  if (!def || !isUpgradeUnlocked(state, def)) return false;
  const n = upgradeLevel(state, id);
  if (levelsToCap(def, n) <= 0) return false;
  return lte(costRange(def.c0, def.r, n, 1), state.gold);
}
