/**
 * Zdarzenia telemetryczne warstwy idle (v4 §9.2).
 *
 * Ten plik zawiera **wyłącznie definicje i konstruktory** — zero sieci.
 * Wysyłkę robi klient (`packages/client/src/net/backend.ts`), bo rdzeń nie ma
 * prawa dotknąć `fetch`. Dzięki temu ten sam zestaw zdarzeń da się złożyć
 * w symulatorze balansu i porównać z produkcją bez stawiania backendu.
 *
 * Dwa zdarzenia są ważniejsze od reszty (v4 §9.2):
 *   • `zone_stuck`         → mapa ścian, z niej wynika cały balans
 *   • `churn_last_action`  → gdzie gracze odpadają
 * Ich payload jest zaprojektowany tak, żeby dało się z niego zrobić tabelę
 * przestawną bez dodatkowych joinów.
 */
import { format, log10 } from "../core/bignum.ts";
import type { IdleConfig } from "./config.ts";
import type { IdleRates, IdleState, OfflineReport } from "./types.ts";

export type IdleEventType =
  | "session_start"
  | "session_end"
  | "first_upgrade"
  | "idle_unlocked"
  | "offline_return"
  | "zone_stuck"
  | "prestige"
  | "build_code_copied"
  | "build_code_applied"
  | "purchase"
  | "churn_last_action";

export type TelemetryValue = number | string | boolean;

export interface IdleEvent {
  type: IdleEventType;
  payload: Record<string, TelemetryValue>;
}

const event = (type: IdleEventType, payload: Record<string, TelemetryValue>): IdleEvent => ({
  type,
  payload,
});

/**
 * Złoto raportujemy jako `log10`, nie jako liczbę.
 *
 * Powód jest prozaiczny: `1e240` w JSON-ie to `Infinity` po stronie każdego
 * narzędzia analitycznego. Logarytm mieści się w `float`, zachowuje porządek
 * i nadaje się wprost na oś wykresu.
 */
function goldLog(state: IdleState): number {
  const l = log10(state.goldLifetime);
  return Number.isFinite(l) ? Math.round(l * 100) / 100 : 0;
}

export function sessionStart(state: IdleState, rates: IdleRates): IdleEvent {
  return event("session_start", {
    zone: state.zone,
    deepest: state.deepestZoneEver,
    dps_log: roundLog(rates.dps),
    prestige: state.prestige.count,
    supporter: state.supporter,
    playtime: Math.round(state.playtime),
  });
}

export function sessionEnd(state: IdleState, rates: IdleRates, durationSeconds: number): IdleEvent {
  return event("session_end", {
    duration: Math.round(durationSeconds),
    zone: state.zone,
    dps_log: roundLog(rates.dps),
    gold_log: goldLog(state),
  });
}

/** Krytyczne dla onboardingu (v4 §3, faza A: pierwszy upgrade po ~20 s). */
export function firstUpgrade(upgradeId: string, secondsSinceStart: number): IdleEvent {
  return event("first_upgrade", {
    upgrade: upgradeId,
    t_since_start: Math.round(secondsSinceStart),
  });
}

/** Moment krytyczny z v4 §3, faza C — „możesz zamknąć kartę". */
export function idleUnlocked(state: IdleState, secondsSinceStart: number): IdleEvent {
  return event("idle_unlocked", {
    t_since_start: Math.round(secondsSinceStart),
    zone: state.zone,
  });
}

export function offlineReturn(report: OfflineReport, claimed: boolean): IdleEvent {
  return event("offline_return", {
    away_s: Math.round(report.awaySeconds),
    credited_s: Math.round(report.creditedSeconds),
    capped: report.capped,
    gain_log: roundLog(report.gold),
    kills: report.kills,
    zone_from: report.zoneFrom,
    zone_to: report.zoneTo,
    stuck_reason: report.diagnosis.reason,
    claimed,
  });
}

/**
 * Mapa ścian. `attempts` to liczba prób wejścia w tę strefę, `duration` —
 * sekundy w niej spędzone. Z tych dwóch pól plus `reason` powstaje tabela,
 * która wprost mówi, którą krzywą stroić.
 */
export function zoneStuck(
  state: IdleState,
  attempts: number,
  clearSeconds: number,
  reason: string,
): IdleEvent {
  return event("zone_stuck", {
    zone: state.zone,
    attempts,
    duration: Math.round(state.zoneTimer),
    clear_s: Number.isFinite(clearSeconds) ? Math.round(clearSeconds) : -1,
    reason,
    gold_log: goldLog(state),
  });
}

export function prestige(state: IdleState, gained: number, secondsSinceLast: number): IdleEvent {
  return event("prestige", {
    n: state.prestige.count,
    t_since_last: Math.round(secondsSinceLast),
    pp_gained: gained,
    zone: state.deepestZone,
  });
}

/** Wiralność (v4 §5.8) — to jest metryka kanału dystrybucji, nie ozdoba. */
export function buildCodeCopied(state: IdleState, codeLength: number): IdleEvent {
  return event("build_code_copied", {
    zone: state.deepestZone,
    prestige: state.prestige.count,
    code_len: codeLength,
  });
}

export function buildCodeApplied(
  matched: number,
  missing: number,
  skills: number,
): IdleEvent {
  return event("build_code_applied", { items_matched: matched, items_missing: missing, skills });
}

export function purchase(sku: string, secondsSinceInstall: number): IdleEvent {
  return event("purchase", { sku, t_since_install: Math.round(secondsSinceInstall) });
}

/** Gdzie gracze odpadają. Wołane przy `pagehide`, nie przy zmianie ekranu. */
export function churnLastAction(screen: string, state: IdleState): IdleEvent {
  return event("churn_last_action", {
    screen,
    zone: state.zone,
    deepest: state.deepestZoneEver,
    playtime: Math.round(state.playtime),
  });
}

// ────────────────────────────────────────────────────────────── dławienie

/**
 * `zone_stuck` bez dławienia zalałby kolejkę: gracz stojący pod ścianą przez
 * noc wygenerowałby tysiące identycznych zdarzeń. Emitujemy raz na strefę,
 * dopiero po przekroczeniu progu z konfiguracji.
 */
export class StuckThrottle {
  private lastZone = -1;
  private lastEmitAt = 0;

  private readonly cooldownSeconds: number;

  // Bez parametru-właściwości — patrz komentarz przy `FlagCounter`.
  constructor(cooldownSeconds = 300) {
    this.cooldownSeconds = cooldownSeconds;
  }

  shouldEmit(state: IdleState, cfg: IdleConfig, clearSeconds: number, now: number): boolean {
    if (!Number.isFinite(clearSeconds) && state.zoneTimer < cfg.zones.stuckSeconds) return false;
    if (clearSeconds <= cfg.zones.stuckSeconds) return false;

    const newZone = state.zone !== this.lastZone;
    const cooled = (now - this.lastEmitAt) / 1000 >= this.cooldownSeconds;
    if (!newZone && !cooled) return false;

    this.lastZone = state.zone;
    this.lastEmitAt = now;
    return true;
  }

  reset(): void {
    this.lastZone = -1;
    this.lastEmitAt = 0;
  }
}

/** Czy w ogóle warto rozważać emisję `zone_stuck` — tani filtr przed throttlem. */
export function shouldEmitZoneStuck(
  state: IdleState,
  cfg: IdleConfig,
  clearSeconds: number,
): boolean {
  return clearSeconds > cfg.zones.stuckSeconds && state.zoneTimer >= cfg.zones.stuckSeconds;
}

function roundLog(value: Parameters<typeof log10>[0]): number {
  const l = log10(value);
  return Number.isFinite(l) ? Math.round(l * 100) / 100 : 0;
}

/** Czytelny podgląd zdarzenia w konsoli deweloperskiej. */
export function describeEvent(e: IdleEvent): string {
  const parts = Object.entries(e.payload).map(([k, v]) => `${k}=${v}`);
  return `${e.type} { ${parts.join(", ")} }`;
}

/** Skrót używany przez panel debugowania — formatuje złoto zamiast logować. */
export function debugGold(state: IdleState): string {
  return format(state.goldLifetime, { notation: state.notation });
}
