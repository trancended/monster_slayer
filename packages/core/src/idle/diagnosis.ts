/**
 * Diagnoza blokady (v4 §2.2, punkt 2 specyfikacji ekranu powrotu).
 *
 * „Powiedz dlaczego gracz utknął. To zamienia frustrację w cel."
 *
 * Cała wartość tego modułu leży w tym, że zwraca **jeden konkretny powód**
 * i **jedną akcję**, a nie listę porad. Lista porad jest równoważna brakowi
 * porady: gracz i tak nie wie, co kliknąć. Dlatego reguły są uporządkowane
 * priorytetowo i pierwsza pasująca wygrywa.
 *
 * Teksty są celowo suche i liczbowe. „Za mało obrażeń obszarowych" niesie
 * informację; „spróbuj wzmocnić postać" nie niesie żadnej.
 */
import { gte, format, type Big } from "../core/bignum.ts";
import { costRange, zoneClearSeconds } from "./curves.ts";
import { upgradeMap, type IdleConfig, type UpgradeDef } from "./config.ts";
import { isUpgradeUnlocked, upgradeLevel } from "./upgrades.ts";
import {
  IDLE_SLOTS,
  type IdleBonuses,
  type IdleRates,
  type IdleState,
  type StuckDiagnosis,
  type SuggestedAction,
} from "./types.ts";

/** Ile poziomów naraz musi być stać gracza, żeby uznać złoto za „leżące odłogiem". */
const IDLE_GOLD_LEVELS = 10;

/** Poniżej tego udziału obrażeń obszarowych w DPS-ie pakietowym pakiet pada pojedynczo. */
const AREA_SHARE_FLOOR = 0.5;

/** O tyle stref przedmiot może być z tyłu, zanim uznamy ekwipunek za przestarzały. */
const GEAR_STALE_ZONES = 10;

export function diagnose(
  state: IdleState,
  cfg: IdleConfig,
  rates: IdleRates,
  bonuses: IdleBonuses,
): StuckDiagnosis {
  const clearSeconds = Number.isFinite(rates.clearSeconds)
    ? rates.clearSeconds
    : zoneClearSeconds(state.zone, cfg.zones, rates.clearDps);

  /**
   * „Utknąłeś" rezerwujemy dla prawdziwej ściany (`stuckSeconds`, domyślnie 90 s).
   * Między celem (40 s) a ścianą gracz nadal idzie do przodu — dostaje radę,
   * ale bez ostrzeżenia. Krzyczenie „utknąłeś" przy 50 s to wilk, na którego
   * gracz przestanie reagować akurat wtedy, gdy naprawdę stanie.
   */
  const blocked = clearSeconds > cfg.zones.stuckSeconds;
  const base = { zone: state.zone, stuck: blocked };

  // — 1. Tempo w normie. Żadnej diagnozy: ekran powrotu ma wtedy pokazać liczby
  //      i przycisk ODBIERZ, a nie doradzać na siłę.
  if (clearSeconds <= cfg.zones.targetClearMax) {
    return {
      ...base,
      stuck: false,
      reason: "none",
      text: `Tempo w normie — strefa schodzi w ${formatSeconds(clearSeconds)}.`,
      suggestion: "",
      action: null,
    };
  }

  // — 2. Obrażenia obszarowe. Sprawdzamy PRZED pojedynczym celem, bo to jest
  //      najczęstsza i najmniej oczywista ściana: DPS rośnie, a strefy stoją.
  //      Warunek `unlocked`: rada wskazująca zablokowane ulepszenie jest gorsza
  //      niż brak rady — gracz klika i nic się nie dzieje.
  const packSize = Math.max(1, cfg.base.packSize);
  const areaDef = upgradeMap(cfg).get("areaDamage");
  if (packSize > 1 && areaDef && isUpgradeUnlocked(state, areaDef)) {
    const areaShare = areaMultiplier(rates) / packSize;
    if (areaShare < AREA_SHARE_FLOOR) {
      return {
        ...base,
        reason: "areaDamage",
        text: "Za mało obrażeń obszarowych — pakiety padają pojedynczo.",
        suggestion: `Obrażenia obszarowe przenoszą cios na resztę pakietu. Przy ${packSize} wrogach to prawie ${packSize}× szybsze czyszczenie.`,
        action: upgradeAction(cfg, "areaDamage"),
      };
    }
  }

  // — 3. Niewydane złoto. Najtańsza możliwa naprawa: gracz ma wszystko,
  //      czego potrzebuje, i po prostu tego nie kupił.
  const idle = bestIdleUpgrade(state, cfg);
  if (idle) {
    return {
      ...base,
      reason: "gold",
      text: `Masz ${format(state.gold, { notation: state.notation })} niewydanego złota.`,
      suggestion: `Stać cię na ${IDLE_GOLD_LEVELS}+ poziomów: ${idle.name}.`,
      action: upgradeAction(cfg, idle.id),
    };
  }

  // — 4. Ekwipunek. Puste sloty albo przedmioty z odległej przeszłości.
  const gear = gearProblem(state);
  if (gear) {
    return {
      ...base,
      reason: "gear",
      text: gear.text,
      suggestion: gear.suggestion,
      action: { kind: "equip", id: gear.slot, label: "Otwórz ekwipunek" },
    };
  }

  // — 5. Prestiż. Reset jest lekcją, nie ścianą (v4 §3, faza E) — proponujemy go
  //      dopiero wtedy, gdy tanie środki są wyczerpane.
  if (state.prestige.points >= cfg.prestige.minPointsToReset && state.deepestZone >= cfg.prestige.unlockZone) {
    return {
      ...base,
      reason: "prestige",
      text: `Krzywa kosztów cię dogoniła na strefie ${state.zone}.`,
      suggestion: `Prestiż da ${state.prestige.points} PP i trwały mnożnik. Powrót tutaj zajmie ułamek czasu.`,
      action: { kind: "prestige", id: "prestige", label: "Pokaż prestiż" },
    };
  }

  // — 6. Domyślnie: brakuje obrażeń na pojedynczy cel.
  const target = cheapestUnlocked(state, cfg, "damage");
  return {
    ...base,
    reason: "singleTarget",
    text: `Za mało obrażeń — strefa ${state.zone} zajmuje ${formatSeconds(clearSeconds)}.`,
    suggestion: `Cel to ${cfg.zones.targetClearMin}–${cfg.zones.targetClearMax} s na strefę. Zbierz złoto i dokup ${target.name}.`,
    action: upgradeAction(cfg, target.id),
  };
}

/** Czy diagnoza wskazuje na coś, co gracz może naprawić jednym kliknięciem. */
export function isActionable(d: StuckDiagnosis): boolean {
  return d.stuck && d.action !== null;
}

// ─────────────────────────────────────────────────────────────── wewnętrzne

/** `clearDps / dps` — ile pakietu zabiera jeden cios. */
function areaMultiplier(rates: IdleRates): number {
  const dps = rates.dps;
  if (dps.m <= 0) return 1;
  const ratio = ratioOf(rates.clearDps, dps);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

function ratioOf(a: Big, b: Big): number {
  if (b.m === 0) return 1;
  return (a.m / b.m) * Math.pow(10, a.e - b.e);
}

/**
 * Najdroższe ulepszenie, na które gracza stać w ilości `IDLE_GOLD_LEVELS`.
 * Najdroższe, a nie najtańsze: skoro złoto leży, to najlepszy zwrot daje ta
 * pozycja, której gracz dotąd unikał właśnie z powodu ceny.
 */
function bestIdleUpgrade(state: IdleState, cfg: IdleConfig): UpgradeDef | null {
  let best: UpgradeDef | null = null;
  let bestCost: Big | null = null;

  for (const def of cfg.upgrades) {
    if (!isUpgradeUnlocked(state, def)) continue;
    const n = upgradeLevel(state, def.id);
    const cost = costRange(def.c0, def.r, n, IDLE_GOLD_LEVELS);
    if (!gte(state.gold, cost)) continue;
    if (bestCost === null || gte(cost, bestCost)) {
      best = def;
      bestCost = cost;
    }
  }
  return best;
}

function cheapestUnlocked(state: IdleState, cfg: IdleConfig, preferred: string): UpgradeDef {
  const map = upgradeMap(cfg);
  const pick = map.get(preferred);
  if (pick && isUpgradeUnlocked(state, pick)) return pick;
  for (const def of cfg.upgrades) if (isUpgradeUnlocked(state, def)) return def;
  return cfg.upgrades[0]!;
}

function upgradeAction(cfg: IdleConfig, id: string): SuggestedAction | null {
  const def = upgradeMap(cfg).get(id);
  if (!def) return null;
  return { kind: "upgrade", id: def.id, label: `Kup: ${def.name}` };
}

function gearProblem(
  state: IdleState,
): { slot: string; text: string; suggestion: string } | null {
  const empty: string[] = [];
  let stalest: { slot: string; zone: number } | null = null;

  for (const slot of IDLE_SLOTS) {
    const item = state.equipment[slot];
    if (!item) {
      empty.push(slot);
      continue;
    }
    if (stalest === null || item.zone < stalest.zone) stalest = { slot, zone: item.zone };
  }

  if (empty.length > 0) {
    return {
      slot: empty[0]!,
      text: `Puste sloty: ${empty.length} z ${IDLE_SLOTS.length}.`,
      suggestion: "Każdy pusty slot to zerowy wkład w DPS. Załóż cokolwiek.",
    };
  }

  if (stalest && state.zone - stalest.zone > GEAR_STALE_ZONES) {
    return {
      slot: stalest.slot,
      text: `Ekwipunek został ${state.zone - stalest.zone} stref z tyłu.`,
      suggestion: "Afiksy skalują się strefą dropu — świeży przedmiot bije stary o klasę.",
    };
  }

  return null;
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return "nieskończoność";
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}
