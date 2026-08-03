/**
 * Postęp w strefach — licznik zabójstw, awans i cofanie się na niższe strefy.
 *
 * Strefa jest w tej grze zegarem: to po niej gracz mierzy postęp, po niej idą
 * odblokowania (v4 §3) i to jej numer trafia do kodu builda. Dlatego cała
 * arytmetyka awansu siedzi w jednym pliku — łącznie z przypadkiem, w którym
 * powrót po nocy przynosi kilkanaście stref naraz.
 */
import { add, isZero, type Big } from "../core/bignum.ts";
import type { IdleConfig } from "./config.ts";
import { isBossZone, killsRequired } from "./curves.ts";
import {
  failResult,
  okResult,
  type ActionResult,
  type IdleRates,
  type IdleState,
} from "./types.ts";

export interface ZoneStatus {
  zone: number;
  boss: boolean;
  killsRequired: number;
  killsDone: number;
  /** 0…1 — gotowe do podpięcia pod pasek postępu. */
  progress: number;
  clearSeconds: number;
  /** Próg z v4 §4.2: powyżej `stuckSeconds` pokazujemy sugestię buildu. */
  stuck: boolean;
}

export function zoneStatus(state: IdleState, cfg: IdleConfig, rates: IdleRates): ZoneStatus {
  const required = killsRequired(state.zone, cfg.zones);
  const done = Math.max(0, Math.min(state.zoneProgress, required));

  return {
    zone: state.zone,
    boss: isBossZone(state.zone, cfg.zones),
    killsRequired: required,
    killsDone: done,
    progress: required > 0 ? done / required : 1,
    clearSeconds: rates.clearSeconds,
    // `Infinity` przy zerowym DPS-ie ma tu wypaść jako „zablokowany", i wypada.
    stuck: rates.clearSeconds > cfg.zones.stuckSeconds,
  };
}

/**
 * Dopisuje zabójstwa i złoto, awansując tyle stref, ile się należy.
 *
 * Wywołanie z offline'u przynosi tysiące zabójstw naraz (v4 §4.5), więc nie ma
 * tu pętli po pojedynczym wrogu ani po klatce — awans liczy się arytmetycznie.
 */
export function registerKills(
  state: IdleState,
  cfg: IdleConfig,
  kills: number,
  gold: Big,
): { zonesAdvanced: number } {
  if (!isZero(gold) && gold.m > 0) {
    state.gold = add(state.gold, gold);
    state.goldThisRun = add(state.goldThisRun, gold);
    state.goldLifetime = add(state.goldLifetime, gold);
  }

  const counted = Number.isFinite(kills) && kills > 0 ? Math.floor(kills) : 0;
  if (counted <= 0) return { zonesAdvanced: 0 };
  state.totals.kills += counted;

  const required = killsRequired(state.zone, cfg.zones);
  const from = state.zone;
  let progress = state.zoneProgress + counted;
  let advanced = 0;

  if (required > 0 && progress >= required && state.zone < cfg.zones.maxZone) {
    // Próg jest wspólny dla wszystkich stref, więc kilkanaście stref naraz
    // wychodzi z jednego dzielenia. Gdyby `killsRequired` zaczęło kiedyś
    // zależeć od strefy, to miejsce musi wrócić do pętli po strefach.
    advanced = Math.min(Math.floor(progress / required), cfg.zones.maxZone - state.zone);
    progress -= advanced * required;
    state.zone += advanced;
  }

  // Na ostatniej strefie licznik nie ma dokąd rosnąć — zatrzymujemy go na pełnym
  // pasku, żeby nie puchł w zapisie przez kolejne dni gry.
  state.zoneProgress = state.zone >= cfg.zones.maxZone ? Math.min(progress, required) : progress;

  if (advanced > 0) {
    state.zoneTimer = 0;
    state.deepestZone = Math.max(state.deepestZone, state.zone);
    state.deepestZoneEver = Math.max(state.deepestZoneEver, state.deepestZone);
    state.totals.bosses += bossesCleared(from, state.zone, cfg);
  }

  return { zonesAdvanced: advanced };
}

/** Ręczne wejście głębiej — dostępne dopiero po wyczyszczeniu bieżącej strefy. */
export function tryAdvanceZone(state: IdleState, cfg: IdleConfig): ActionResult<{ zone: number }> {
  if (state.zone >= cfg.zones.maxZone) return failResult("To już ostatnia strefa");

  const required = killsRequired(state.zone, cfg.zones);
  if (state.zoneProgress < required) {
    return failResult(`Strefa niewyczyszczona — ${Math.floor(state.zoneProgress)}/${required}`);
  }

  const from = state.zone;
  state.zone += 1;
  state.zoneProgress = Math.max(0, state.zoneProgress - required);
  state.zoneTimer = 0;
  state.deepestZone = Math.max(state.deepestZone, state.zone);
  state.deepestZoneEver = Math.max(state.deepestZoneEver, state.deepestZone);
  state.totals.bosses += bossesCleared(from, state.zone, cfg);

  const boss = isBossZone(state.zone, cfg.zones);
  return okResult(boss ? `Strefa ${state.zone} — boss` : `Strefa ${state.zone}`, {
    zone: state.zone,
  });
}

/**
 * Ręczna zmiana strefy. W dół zawsze wolno — farmienie łatwiejszej strefy dla
 * złota to legalna decyzja buildowa, a nie exploit. W górę tylko tam, gdzie
 * gracz już był w tym biegu; głębiej trzeba dojść, nie wpisać.
 */
export function setZone(
  state: IdleState,
  cfg: IdleConfig,
  zone: number,
): ActionResult<{ zone: number }> {
  if (!Number.isFinite(zone)) return failResult("Nieprawidłowa strefa");

  const target = Math.floor(zone);
  if (target < 1 || target > cfg.zones.maxZone) return failResult("Nieprawidłowa strefa");
  if (target > state.deepestZone) {
    return failResult(`Najdalej możesz wejść do strefy ${state.deepestZone}`);
  }
  if (target === state.zone) return okResult(`Jesteś już w strefie ${target}`, { zone: target });

  state.zone = target;
  state.zoneProgress = 0;
  state.zoneTimer = 0;
  return okResult(`Strefa ${target}`, { zone: target });
}

/**
 * Zapowiedź kolejnego odblokowania (v4 §3: „zapowiadaj każde odblokowanie
 * zanim będzie dostępne"). Wyszarzona ikona z konkretnym numerem strefy ciągnie
 * gracza dalej — niespodzianka nie ciągnie.
 *
 * Progi są kopią pól `unlockZone` z `data/idle.json` plus kamienie milowe
 * z v4 §3. Kontrakt tej funkcji nie przewiduje konfiguracji w argumentach
 * (woła ją UI bez dostępu do niej), więc tabelę trzeba trzymać zgodną ręcznie.
 */
const MILESTONES: readonly { unlocksAt: number; label: string }[] = [
  { unlocksAt: 3, label: "Szybkość ataku" },
  { unlocksAt: 4, label: "Znaleźne złoto" },
  { unlocksAt: 6, label: "Szansa na trafienie krytyczne" },
  { unlocksAt: 8, label: "Mnożnik krytyczny" },
  { unlocksAt: 8, label: "Obrażenia obszarowe" },
  { unlocksAt: 10, label: "Pierwszy boss" },
  { unlocksAt: 18, label: "Znajdźka" },
  { unlocksAt: 27, label: "Auto-atak — możesz zamknąć kartę" },
  { unlocksAt: 30, label: "Auto-podnoszenie" },
  { unlocksAt: 35, label: "Auto-rozbiórka" },
  { unlocksAt: 37, label: "Auto-postęp strefy" },
  { unlocksAt: 40, label: "Prestiż" },
];

export function zoneMilestones(zone: number): { unlocksAt: number; label: string } | null {
  for (const m of MILESTONES) if (m.unlocksAt > zone) return m;
  return null;
}

// ───────────────────────────────────────────────────────────── pomocnicze

/** Bossowie z przedziału wyczyszczonych stref `[from, to − 1]`. */
function bossesCleared(from: number, to: number, cfg: IdleConfig): number {
  const every = cfg.zones.bossEvery;
  if (every <= 0 || to <= from) return 0;
  return Math.floor((to - 1) / every) - Math.floor((from - 1) / every);
}
