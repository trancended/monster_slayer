/**
 * Tempo gry — węzeł, przez który przechodzi cała reszta warstwy idle.
 *
 * Offline (§4.5), tryb tła (§5.1), diagnoza blokady (§2.2) i walidacja
 * serwerowa liczą się z tej samej `IdleRates`. To jest celowe: gdy formuła
 * na DPS istnieje w jednym egzemplarzu, raport z ekranu powrotu nie może się
 * rozjechać z tym, co gracz widzi w pasku postępu.
 *
 * Konwencja wzoru jest ta sama co w `StatSheet` (GDD §11.4):
 *   `wartość = (baza + flat) × (1 + Σ increased) × Π (1 + more)`
 * — bonusy spoza tabeli ulepszeń wchodzą wyłącznie przez `IdleBonuses`.
 */
import { BIG_ZERO, big, div, isZero, mul, scale, toNumber, type Big } from "../core/bignum.ts";
import type { IdleConfig } from "./config.ts";
import { goldPerKill, zoneClearSeconds, zoneHp } from "./curves.ts";
import { upgradeEffects, type UpgradeEffects } from "./upgrades.ts";
import type { IdleBonuses, IdleRates, IdleState } from "./types.ts";

/**
 * Margines walidacji statystycznej (v4 §5.1). Nie jest to pokrętło balansu,
 * tylko tolerancja protokołu klient–serwer, dlatego siedzi w kodzie, a nie
 * w `data/idle.json` — zmiana tej liczby to zmiana kontraktu, nie strojenie.
 */
const DPS_TOLERANCE = 1.15;

/**
 * Keystone „Zimna Stal" (v4 §5.4): ataki nie mogą trafiać krytycznie.
 *
 * We wzorze siedzi wyłącznie **zmiana zasady** — twarde wyłączenie krytyka.
 * Rekompensata (`moreDamage`) przychodzi z `data/skilltree.json` jak każdy inny
 * efekt, bo to jest liczba do strojenia, a nie reguła. Trzymanie jej tutaj
 * dawało podwójne naliczenie: raz z danych, raz z kodu.
 */
const KEYSTONE_NO_CRIT = "noCrit";

/** Obrażenia pojedynczego ciosu, uśrednione po krytykach. */
export function effectiveDamage(state: IdleState, cfg: IdleConfig, bonuses: IdleBonuses): Big {
  return damageFrom(upgradeEffects(state, cfg), cfg, bonuses);
}

export function computeRates(
  state: IdleState,
  cfg: IdleConfig,
  bonuses: IdleBonuses,
): IdleRates {
  const eff = upgradeEffects(state, cfg);
  const perHit = damageFrom(eff, cfg, bonuses);

  const attacksPerSecond = Math.max(
    0,
    cfg.base.attackSpeed * (1 + eff.attackSpeed + bonuses.attackSpeed),
  );
  const dps = scale(perHit, attacksPerSecond);

  // Obrażenia obszarowe nie mogą dać więcej niż zabicie całego pakietu naraz —
  // bez tego sufitu jedno ulepszenie skalowałoby czyszczenie w nieskończoność.
  const packSize = Math.max(1, cfg.base.packSize);
  const area = Math.max(0, cfg.base.areaDamage + eff.areaDamage + bonuses.areaDamage);
  const clearDps = scale(dps, Math.min(1 + area * (packSize - 1), packSize));

  // Zabójstwa na sekundę liczymy z HP pojedynczego wroga, nie z całej strefy:
  // to samo tempo obowiązuje w środku strefy i tuż po jej zmianie.
  const hp = zoneHp(state.zone, cfg.zones);
  const kills = isZero(hp) ? BIG_ZERO : div(clearDps, hp);

  // `base.goldFind` to jedynka we wzorze `(1 + znaleźne)` — trzymanie jej
  // w konfiguracji pozwala zrobić start z podwyższonym złotem bez ruszania kodu.
  const goldMult = Math.max(0, cfg.base.goldFind + eff.goldFind + bonuses.goldFind);

  return {
    dps,
    clearDps,
    goldPerSecond: mul(kills, scale(goldPerKill(state.zone, cfg.zones), goldMult)),
    killsPerSecond: toNumber(kills),
    magicFind: Math.max(0, cfg.base.magicFind + eff.magicFind + bonuses.magicFind),
    clearSeconds: zoneClearSeconds(state.zone, cfg.zones, clearDps),
    maxTheoreticalDps: scale(clearDps, DPS_TOLERANCE),
  };
}

// ───────────────────────────────────────────────────────────── wewnętrzne

function damageFrom(eff: UpgradeEffects, cfg: IdleConfig, bonuses: IdleBonuses): Big {
  const flat = cfg.base.damage + eff.flatDamage + bonuses.flatDamage;
  if (flat <= 0) return BIG_ZERO;

  const increased = eff.damageMult - 1 + bonuses.increasedDamage;
  let damage = scale(big(flat), Math.max(0, 1 + increased));
  for (const more of bonuses.moreDamage) damage = scale(damage, Math.max(0, 1 + more));

  if (bonuses.keystones.includes(KEYSTONE_NO_CRIT)) return damage;
  return scale(damage, critAverage(eff, cfg, bonuses));
}

/**
 * Krytyk wchodzi jako wartość oczekiwana, nie jako losowanie. Warstwa idle
 * liczy godziny naraz — wariancja pojedynczego ciosu jest tam nieodróżnialna
 * od średniej, a losowanie zabrałoby determinizm raportu offline.
 */
function critAverage(eff: UpgradeEffects, cfg: IdleConfig, bonuses: IdleBonuses): number {
  const chance = Math.min(
    cfg.base.critChanceCap,
    Math.max(0, cfg.base.critChance + eff.critChance + bonuses.critChance),
  );
  const mult = Math.max(1, cfg.base.critMult + eff.critMult + bonuses.critMult);
  return 1 + chance * (mult - 1);
}
