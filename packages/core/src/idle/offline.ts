/**
 * Postęp offline (v4 §4.5) — obliczenie deterministyczne, **nigdy symulacja**.
 *
 * To jest system, od którego zależy D1 → D7 (v4 §2.1). Trzy decyzje projektowe,
 * których nie wolno tu zmienić bez świadomości konsekwencji:
 *
 *  1. **Liczymy z różnicy timestampów, nie z klatek.** Odporne na exploity,
 *     tanie i natychmiastowe. Powrót po tygodniu kosztuje tyle samo co po minucie.
 *  2. **Marsz przez strefy idzie w pętli po strefach, nie po zabójstwach.**
 *     Kilkadziesiąt iteracji zamiast milionów — O(liczba_stref).
 *  3. **Efficiency wchodzi jako skrócenie budżetu czasu, nie jako mnożnik zysku.**
 *     Matematycznie to samo (`rate · Δt · eff`), ale dzięki temu postęp stref
 *     i złoto są spójne: gracz nie zobaczy strefy, na którą nie zarobił.
 *
 * Anty-exploit: `lastSeen` przechodzi przez `monotonicGuard`. Docelowo tę
 * wartość ustawia wyłącznie serwer (v4 §4.5) — zegar klienta nigdy jej nie dotyka.
 */
import { BIG_ZERO, add, div, isZero, scale, toNumber, type Big } from "../core/bignum.ts";
import type { IdleConfig } from "./config.ts";
import { bossHp, goldPerKill, killsRequired, isBossZone, zoneClearSeconds, zoneHp } from "./curves.ts";
import { computeRates } from "./rates.ts";
import { diagnose } from "./diagnosis.ts";
import { monotonicGuard, offlineCapSeconds, offlineEfficiency } from "./state.ts";
import { registerKills } from "./zones.ts";
import {
  MATERIAL_IDS,
  type IdleBonuses,
  type IdleRates,
  type IdleState,
  type MaterialId,
  type OfflineReport,
} from "./types.ts";

/**
 * Bezpiecznik pętli. Przy capie 24 h i strefie czyszczonej w 25 s teoretyczny
 * sufit to ~3 500 stref — limit z zapasem, żeby błąd w danych balansu objawił
 * się jako dziwny wynik, a nie jako zawieszona zakładka.
 */
const MAX_ZONE_STEPS = 20_000;

export interface ZoneWalk {
  zoneFrom: number;
  zoneTo: number;
  /** Postęp w strefie docelowej — liczba zabójstw w niedokończonej strefie. */
  progressTo: number;
  kills: number;
  gold: Big;
  bosses: number;
  secondsUsed: number;
  secondsLeft: number;
  /** `true`, gdy marsz zatrzymała ściana, a nie koniec budżetu czasu. */
  blocked: boolean;
}

/**
 * Mnożnik znaleźnego wyprowadzony z `IdleRates`. `rates` policzono dla
 * `state.zone`, więc iloraz jest tu dokładny — a dzięki temu nie trzeba
 * przekazywać przez pół warstwy osobnego pola „ile mam goldFind".
 */
function goldMultiplier(state: IdleState, cfg: IdleConfig, rates: IdleRates): number {
  const perKill = goldPerKill(state.zone, cfg.zones);
  if (isZero(perKill) || rates.killsPerSecond <= 0) return 1;
  const expected = scale(perKill, rates.killsPerSecond);
  if (isZero(expected)) return 1;
  const mult = toNumber(div(rates.goldPerSecond, expected));
  return Number.isFinite(mult) && mult > 0 ? mult : 1;
}

/**
 * Marsz przez strefy w granicach budżetu czasu.
 *
 * Reguła ściany: gdy wyczyszczenie bieżącej strefy zajęłoby więcej niż
 * `stuckSeconds`, marsz się **zatrzymuje**, a reszta czasu idzie na farmienie
 * w miejscu. Bez tego gracz wraca rano do strefy 900, której nie umie przejść —
 * a to zamienia najważniejszy ekran w grze w komunikat o porażce (v4 §2.2).
 */
export function walkZones(
  state: IdleState,
  cfg: IdleConfig,
  rates: IdleRates,
  budgetSeconds: number,
): ZoneWalk {
  const empty: ZoneWalk = {
    zoneFrom: state.zone,
    zoneTo: state.zone,
    progressTo: state.zoneProgress,
    kills: 0,
    gold: BIG_ZERO,
    bosses: 0,
    secondsUsed: 0,
    secondsLeft: Math.max(0, budgetSeconds),
    blocked: false,
  };
  if (!Number.isFinite(budgetSeconds) || budgetSeconds <= 0) return empty;
  if (isZero(rates.clearDps) || rates.clearDps.m <= 0) return { ...empty, blocked: true };

  const goldMult = goldMultiplier(state, cfg, rates);
  const zonesCfg = cfg.zones;

  let zone = state.zone;
  let progress = state.zoneProgress;
  let budget = budgetSeconds;
  let kills = 0;
  let bosses = 0;
  let gold = BIG_ZERO;
  let blocked = false;

  const secondsPerKill = (z: number): number =>
    toNumber(div(zoneHp(z, zonesCfg), rates.clearDps));

  for (let step = 0; step < MAX_ZONE_STEPS; step++) {
    if (budget <= 0 || zone >= zonesCfg.maxZone) break;

    // Ścianę mierzymy czasem pełnego przejścia strefy, nie czasem resztki —
    // inaczej gracz z niemal wyczyszczoną strefą przepchnąłby się przez próg
    // i utknął dopiero strefę dalej, już bez sensownej diagnozy.
    if (zoneClearSeconds(zone, zonesCfg, rates.clearDps) > zonesCfg.stuckSeconds) {
      blocked = true;
      break;
    }

    const perKill = secondsPerKill(zone);
    if (!Number.isFinite(perKill) || perKill <= 0) {
      blocked = true;
      break;
    }

    const required = killsRequired(zone, zonesCfg);
    const remaining = Math.max(0, required - progress);
    const boss = isBossZone(zone, zonesCfg);
    const bossSeconds = boss ? toNumber(div(bossHp(zone, zonesCfg), rates.clearDps)) : 0;
    const needed = remaining * perKill + bossSeconds;

    if (needed <= budget) {
      budget -= needed;
      kills += remaining;
      gold = add(gold, scale(goldPerKill(zone, zonesCfg), remaining * goldMult));
      if (boss) {
        bosses += 1;
        gold = add(gold, scale(goldPerKill(zone, zonesCfg), zonesCfg.bossGoldMult * goldMult));
      }
      zone += 1;
      progress = 0;
      continue;
    }

    // Budżet kończy się w środku strefy — zaliczamy część zabójstw i wychodzimy.
    const partial = Math.min(remaining, Math.floor(budget / perKill));
    if (partial > 0) {
      budget -= partial * perKill;
      kills += partial;
      progress += partial;
      gold = add(gold, scale(goldPerKill(zone, zonesCfg), partial * goldMult));
    }
    break;
  }

  // Faza farmienia w miejscu: czas, który został po napotkaniu ściany albo po
  // dojściu do ostatniej strefy, nadal ma dawać złoto. Strefa się nie zmienia.
  if (budget > 0) {
    const perKill = secondsPerKill(zone);
    if (Number.isFinite(perKill) && perKill > 0) {
      const extra = Math.floor(budget / perKill);
      if (extra > 0) {
        kills += extra;
        gold = add(gold, scale(goldPerKill(zone, zonesCfg), extra * goldMult));
        budget -= extra * perKill;
        // Postęp zatrzymujemy tuż pod progiem: gracz ma zobaczyć pełny pasek
        // i nieprzekroczoną strefę, bo to jest wizualny komunikat „tu stoisz".
        const required = killsRequired(zone, zonesCfg);
        if (blocked && required > 0) progress = Math.min(progress + extra, required - 1);
      }
    }
  }

  return {
    zoneFrom: state.zone,
    zoneTo: zone,
    progressTo: progress,
    kills,
    gold,
    bosses,
    secondsUsed: Math.max(0, budgetSeconds - Math.max(0, budget)),
    secondsLeft: Math.max(0, budget),
    blocked,
  };
}

/**
 * Pełny raport nieobecności — ładunek ekranu z v4 §2.2.
 * Funkcja jest **czysta**: niczego nie zapisuje. Zapis robi `applyOffline`
 * dopiero po kliknięciu ODBIERZ, żeby zamknięcie karty na ekranie powrotu
 * nie zjadło nagrody.
 */
export function computeOffline(
  state: IdleState,
  cfg: IdleConfig,
  bonuses: IdleBonuses,
  now: number,
): OfflineReport {
  const lastSeen = monotonicGuard(state, now);
  const awaySeconds = Math.max(0, (now - lastSeen) / 1000);

  const capSeconds = offlineCapSeconds(state, cfg) + Math.max(0, bonuses.offlineCapHours) * 3600;
  const creditedSeconds = Math.min(awaySeconds, capSeconds);
  const efficiency = Math.min(1, Math.max(0, offlineEfficiency(state, cfg) + bonuses.offlineEfficiency));

  const rates = computeRates(state, cfg, bonuses);
  const walk = walkZones(state, cfg, rates, creditedSeconds * efficiency);

  const items = itemsFromKills(walk.kills, cfg, rates.magicFind);
  const materials = materialsFromWalk(walk, cfg);

  // Diagnozę stawiamy dla strefy, w której gracz FAKTYCZNIE stanął — nie dla
  // tej, z której wychodził. Inaczej ekran powrotu tłumaczyłby wczorajszą ścianę.
  const arrived: IdleState = { ...state, zone: walk.zoneTo, zoneProgress: walk.progressTo };
  const arrivedRates = computeRates(arrived, cfg, bonuses);

  return {
    awaySeconds,
    creditedSeconds,
    capped: awaySeconds > capSeconds,
    capSeconds,
    efficiency,

    kills: walk.kills,
    gold: walk.gold,
    items: items.total,
    rareItems: items.rare,
    materials,

    zoneFrom: walk.zoneFrom,
    zoneTo: walk.zoneTo,

    diagnosis: diagnose(arrived, cfg, arrivedRates, bonuses),
    worthShowing: awaySeconds >= cfg.offline.minSecondsToShow && walk.kills > 0,
  };
}

/**
 * Dopisuje raport do stanu i przesuwa `lastSeen`.
 *
 * Idempotentne względem podwójnego kliknięcia: po zastosowaniu `lastSeen`
 * równa się `now`, więc drugie wywołanie z tym samym raportem nic nie dodaje.
 * To nie jest ozdoba — przycisk ODBIERZ da się kliknąć dwa razy szybciej,
 * niż Svelte zdąży przerysować ekran.
 */
export function applyOffline(
  state: IdleState,
  cfg: IdleConfig,
  report: OfflineReport,
  now: number,
): boolean {
  if (state.lastSeen >= now) return false;

  registerKills(state, cfg, report.kills, report.gold);
  // `registerKills` awansuje strefy z licznika zabójstw; raport zna wynik
  // dokładniej (uwzględnia bossów i ścianę), więc domykamy stan jego wartością.
  state.zone = Math.max(1, Math.min(report.zoneTo, cfg.zones.maxZone));
  state.deepestZone = Math.max(state.deepestZone, state.zone);
  state.deepestZoneEver = Math.max(state.deepestZoneEver, state.deepestZone);

  for (const id of MATERIAL_IDS) {
    state.materials[id] = (state.materials[id] ?? 0) + (report.materials[id] ?? 0);
  }

  state.totals.items += report.items;
  state.totals.offlineSeconds += Math.round(report.creditedSeconds);
  state.lastSeen = now;
  return true;
}

// ─────────────────────────────────────────────────────────────── pomocnicze

function itemsFromKills(
  kills: number,
  cfg: IdleConfig,
  magicFind: number,
): { total: number; rare: number } {
  if (kills <= 0) return { total: 0, rare: 0 };
  const total = Math.floor((kills / 100) * cfg.offline.itemsPerHundredKills * Math.max(1, magicFind));
  if (total <= 0) return { total: 0, rare: 0 };

  // „Rzadkie" na ekranie powrotu to rare + epic + unique — gracz czyta tę liczbę
  // jako „ile warto obejrzeć", a nie jako techniczny tier.
  let rareWeight = 0;
  let totalWeight = 0;
  for (const r of cfg.items.rarities) {
    totalWeight += r.weight;
    if (r.id === "rare" || r.id === "epic" || r.id === "unique") rareWeight += r.weight;
  }
  const share = totalWeight > 0 ? rareWeight / totalWeight : 0;
  return { total, rare: Math.floor(total * share * Math.max(1, magicFind)) };
}

function materialsFromWalk(walk: ZoneWalk, cfg: IdleConfig): Record<MaterialId, number> {
  const out = {} as Record<MaterialId, number>;
  for (const id of MATERIAL_IDS) out[id] = 0;

  const zones = Math.max(0, walk.zoneTo - walk.zoneFrom);
  const base = zones * cfg.zones.materialsPerZone;
  out.scrap = Math.floor(base * 4);
  out.fragment = Math.floor(base);
  out.dust = Math.floor(base);
  // Esencja leci wyłącznie z bossów — to najrzadszy surowiec i jedyne wejście
  // do transferu unikalnego moda (v4 §5.3).
  out.essence = walk.bosses;
  return out;
}

/** Suma wszystkich surowców — skrót dla UI, żeby nie powtarzać pętli w komponencie. */
export function totalMaterials(materials: Record<MaterialId, number>): number {
  let n = 0;
  for (const id of MATERIAL_IDS) n += materials[id] ?? 0;
  return n;
}

/** Ile realnego czasu przepadło na capie — do neutralnej informacji na ekranie powrotu. */
export function wastedSeconds(report: OfflineReport): number {
  return Math.max(0, report.awaySeconds - report.creditedSeconds);
}

/** Czy zysk w ogóle jest niezerowy (używane przez `mul` w podglądzie tempa). */
export function hasGain(report: OfflineReport): boolean {
  return report.kills > 0 || !isZero(report.gold);
}

/** Średnie tempo z raportu — `złoto/s`, do porównania z tempem online. */
export function offlineGoldRate(report: OfflineReport): Big {
  if (report.creditedSeconds <= 0) return BIG_ZERO;
  return scale(report.gold, 1 / report.creditedSeconds);
}
