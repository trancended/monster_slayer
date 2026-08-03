/**
 * Tryb tła i walidacja raportów klienta (v4 §5.1).
 *
 * Gra ma trzy tryby liczenia walki:
 *   • **aktywny** — klient (ECS + PixiJS), pełna animacja, serwer waliduje statystycznie
 *   • **tło**     — karta w tle albo bez fokusu: formuła zamknięta, zero rysowania
 *   • **offline** — brak sesji, liczone przy powrocie (`offline.ts`)
 *
 * Ten plik obsługuje dwa środkowe przypadki. Tryb tła jest tym samym marszem
 * po strefach co offline, tylko z krótkim `dt` i wyższą efektywnością — gracz
 * nie wyszedł z gry, więc karanie go za przełączenie zakładki byłoby złamaniem
 * filara F1 („czas gracza jest święty").
 */
import { BIG_ZERO, scale, type Big } from "../core/bignum.ts";
import type { IdleConfig } from "./config.ts";
import { walkZones } from "./offline.ts";
import { registerKills } from "./zones.ts";
import type { IdleRates, IdleState } from "./types.ts";

export interface BackgroundTick {
  kills: number;
  gold: Big;
  zonesAdvanced: number;
  /** `true`, gdy postać stoi pod ścianą — HUD w tle pokazuje wtedy ostrzeżenie. */
  blocked: boolean;
}

/**
 * Krok w trybie tła. `dt` w sekundach — wołane co ~1 s, nie co klatkę.
 *
 * Marsz po strefach jest ten sam co w offline, łącznie z regułą ściany:
 * w tle też nie wolno przelecieć przez 800 stref, bo gracz wróciłby do gry
 * w miejscu, którego nie rozumie.
 */
export function tickBackground(
  state: IdleState,
  cfg: IdleConfig,
  rates: IdleRates,
  dt: number,
): BackgroundTick {
  const empty: BackgroundTick = { kills: 0, gold: BIG_ZERO, zonesAdvanced: 0, blocked: false };
  if (!Number.isFinite(dt) || dt <= 0) return empty;

  const walk = walkZones(state, cfg, rates, dt * cfg.offline.backgroundEfficiency);
  if (walk.kills <= 0 && walk.gold.m === 0) return { ...empty, blocked: walk.blocked };

  registerKills(state, cfg, walk.kills, walk.gold);
  state.zone = Math.max(1, Math.min(walk.zoneTo, cfg.zones.maxZone));
  state.deepestZone = Math.max(state.deepestZone, state.zone);
  state.deepestZoneEver = Math.max(state.deepestZoneEver, state.deepestZone);
  state.zoneTimer += dt;

  return {
    kills: walk.kills,
    gold: walk.gold,
    zonesAdvanced: walk.zoneTo - walk.zoneFrom,
    blocked: walk.blocked,
  };
}

// ─────────────────────────────────────────── walidacja statystyczna (§5.1)

/**
 * Serwer zna ekwipunek i drzewko gracza, więc zna `max_theoretical_dps`.
 * Klient raportuje postęp co 5 s, serwer sprawdza:
 *
 *   `zgłoszony_postęp ≤ max_theoretical_dps · Δt · 1.15`
 *
 * Margines 15% siedzi już w `rates.maxTheoreticalDps`. To jest **tanie
 * i wystarczające** dla gry bez PvP o realną wartość — pełna autorytatywność
 * kosztowałaby symulację 10 000 sesji na serwerze i nie kupiłaby nic więcej.
 */
export interface ProgressReport {
  kills: number;
  zone: number;
  seconds: number;
}

export interface ReportVerdict {
  accepted: boolean;
  /** Przekroczenie daje flagę, **nie bana** — fałszywy alarm to zwykle lag, nie cheat. */
  flag: boolean;
  reason: string;
}

export function validateProgressReport(
  rates: IdleRates,
  cfg: IdleConfig,
  report: ProgressReport,
): ReportVerdict {
  if (!Number.isFinite(report.kills) || report.kills < 0) {
    return { accepted: false, flag: true, reason: "Liczba zabójstw poza zakresem" };
  }
  if (!Number.isFinite(report.seconds) || report.seconds <= 0) {
    return { accepted: false, flag: false, reason: "Zerowy odcinek czasu" };
  }
  if (report.zone < 1 || report.zone > cfg.zones.maxZone) {
    return { accepted: false, flag: true, reason: "Strefa poza zakresem" };
  }

  // Zabójstwo kosztuje co najmniej HP jednego wroga bieżącej strefy; przy
  // maksymalnym teoretycznym DPS-ie daje to sufit zabójstw na sekundę.
  const ceiling = maxKills(rates, cfg, report.zone, report.seconds);
  if (report.kills > ceiling) {
    return {
      accepted: false,
      flag: true,
      reason: `Zgłoszono ${report.kills} zabójstw, sufit to ${Math.floor(ceiling)}`,
    };
  }
  return { accepted: true, flag: false, reason: "" };
}

function maxKills(rates: IdleRates, cfg: IdleConfig, zone: number, seconds: number): number {
  const budget = scale(rates.maxTheoreticalDps, seconds);
  const hp = zoneHpFor(zone, cfg);
  if (hp.m <= 0) return Infinity;
  return (budget.m / hp.m) * Math.pow(10, budget.e - hp.e);
}

function zoneHpFor(zone: number, cfg: IdleConfig): Big {
  // Import cykliczny z `curves.ts` byłby tu niepotrzebny — HP liczymy w miejscu
  // z tych samych parametrów, bo to jedno mnożenie i nie ma czego dzielić.
  const z = Math.max(1, Math.floor(zone));
  const l = Math.log10(cfg.zones.hp0) + cfg.zones.polyExponent * Math.log10(z) + z * Math.log10(cfg.zones.expBase);
  const e = Math.floor(l);
  return { m: Math.pow(10, l - e), e };
}

/**
 * Licznik flag sesji. Trzy flagi → sesja przechodzi w tryb serwerowy
 * (v4 §5.1). Nie ma bana, nie ma komunikatu — gracz z zepsutym zegarem
 * albo z lagiem po prostu dostaje wolniejszy, autorytatywny tryb.
 */
export class FlagCounter {
  private count = 0;
  private readonly limit: number;

  // Bez skrótu `constructor(private readonly limit)`: parametry-właściwości nie
  // przechodzą przez natywne stripowanie typów w Node, a na nim stoi symulator
  // balansu (`pnpm sim`) i testy jednostkowe.
  constructor(limit = 3) {
    this.limit = limit;
  }

  /** Zwraca `true`, gdy próg został właśnie przekroczony. */
  record(verdict: ReportVerdict): boolean {
    if (!verdict.flag) return false;
    this.count += 1;
    return this.count >= this.limit;
  }

  get flags(): number {
    return this.count;
  }

  get tripped(): boolean {
    return this.count >= this.limit;
  }

  reset(): void {
    this.count = 0;
  }
}
