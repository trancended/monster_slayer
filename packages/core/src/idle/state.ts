/**
 * Tworzenie, serializacja i naprawa stanu idle.
 *
 * Save idle jest zapisywany jako zwykły JSON, ale `Big` nie przeżyje
 * `JSON.stringify` w czytelnej formie — dlatego wszystkie pola wielkoliczbowe
 * przechodzą przez `bigToJSON`/`bigFromJSON`. Wersjonowanie działa jak w
 * `save/save.ts`: nowe pole zawsze dostaje domyślną wartość zamiast wywalać
 * cały zapis.
 */
import { BIG_ZERO, bigFromJSON, bigToJSON, type Big } from "../core/bignum.ts";
import type { IdleConfig } from "./config.ts";
import {
  AUTOMATION_IDS,
  IDLE_SLOTS,
  MATERIAL_IDS,
  UPGRADE_IDS,
  type AutomationId,
  type AutomationSlot,
  type IdleAffix,
  type IdleEquipment,
  type IdleItem,
  type IdleSlot,
  type IdleState,
  type LootFilter,
  type MaterialId,
  type UpgradeId,
} from "./types.ts";

export const IDLE_STATE_VERSION = 1;

export function defaultLootFilter(): LootFilter {
  return {
    enabled: false,
    rules: [
      { rarity: "common", action: "salvage", minQuality: 0 },
      { rarity: "magic", action: "salvage", minQuality: 0.8 },
      { rarity: "rare", action: "keep", minQuality: 0 },
      { rarity: "epic", action: "keep", minQuality: 0 },
      { rarity: "unique", action: "keep", minQuality: 0 },
    ],
    keepAffixes: [],
    keepUpgrades: true,
  };
}

export function createIdleState(now = Date.now()): IdleState {
  const upgrades = {} as Record<UpgradeId, number>;
  for (const id of UPGRADE_IDS) upgrades[id] = 0;

  const materials = {} as Record<MaterialId, number>;
  for (const id of MATERIAL_IDS) materials[id] = 0;

  const automation = {} as Record<AutomationId, AutomationSlot>;
  for (const id of AUTOMATION_IDS) automation[id] = { unlocked: false, enabled: true };

  return {
    version: IDLE_STATE_VERSION,

    gold: BIG_ZERO,
    goldThisRun: BIG_ZERO,
    goldLifetime: BIG_ZERO,
    materials,

    upgrades,
    zone: 1,
    zoneProgress: 0,
    zoneTimer: 0,
    deepestZone: 1,
    deepestZoneEver: 1,

    equipment: {},
    stash: [],

    prestige: {
      points: 0,
      spent: 0,
      lifetime: 0,
      count: 0,
      nodes: {},
      sparks: 0,
      ascensions: 0,
      ascensionNodes: {},
      lastPrestigeAt: now,
    },
    skills: {},
    automation,
    bestiary: {},
    challenges: { activeId: null, startedAt: 0, snapshot: null, completed: [], best: {} },
    lootFilter: defaultLootFilter(),
    uniquesFound: [],

    lastSeen: now,
    startedAt: now,
    playtime: 0,
    supporter: false,

    totals: { kills: 0, bosses: 0, items: 0, salvaged: 0, rerolls: 0, offlineSeconds: 0 },

    buildName: "Bez nazwy",
    notation: "short",
  };
}

// ────────────────────────────────────────────────────────── serializacja

const BIG_FIELDS = ["gold", "goldThisRun", "goldLifetime"] as const;

/** Stan gotowy do `JSON.stringify` / IndexedDB. */
export function serializeIdleState(state: IdleState): Record<string, unknown> {
  const out: Record<string, unknown> = { ...state };
  for (const key of BIG_FIELDS) out[key] = bigToJSON(state[key]);
  return out;
}

/**
 * Odczyt zapisu. Każde pole ma fallback, bo zapis sprzed patcha jest normą,
 * a nie wyjątkiem — gra idle działa latami na tym samym save'ie.
 */
export function deserializeIdleState(raw: unknown, now = Date.now()): IdleState {
  const base = createIdleState(now);
  if (typeof raw !== "object" || raw === null) return base;
  const src = raw as Record<string, unknown>;

  const state: IdleState = {
    ...base,
    version: num(src.version, base.version),

    gold: bigOr(src.gold),
    goldThisRun: bigOr(src.goldThisRun),
    goldLifetime: bigOr(src.goldLifetime),
    materials: numberRecord(src.materials, MATERIAL_IDS, 0) as Record<MaterialId, number>,

    upgrades: numberRecord(src.upgrades, UPGRADE_IDS, 0) as Record<UpgradeId, number>,
    zone: Math.max(1, Math.floor(num(src.zone, 1))),
    zoneProgress: Math.max(0, num(src.zoneProgress, 0)),
    zoneTimer: Math.max(0, num(src.zoneTimer, 0)),
    deepestZone: Math.max(1, Math.floor(num(src.deepestZone, 1))),
    deepestZoneEver: Math.max(1, Math.floor(num(src.deepestZoneEver, 1))),

    equipment: mergeEquipment(src.equipment),
    stash: itemArray(src.stash),

    prestige: mergePrestige(src.prestige, base.prestige),
    skills: freeNumberRecord(src.skills),
    automation: mergeAutomation(src.automation),
    bestiary: freeNumberRecord(src.bestiary),
    challenges: mergeChallenges(src.challenges, base),
    lootFilter: mergeFilter(src.lootFilter),
    uniquesFound: stringArray(src.uniquesFound),

    lastSeen: num(src.lastSeen, now),
    startedAt: num(src.startedAt, now),
    playtime: Math.max(0, num(src.playtime, 0)),
    supporter: src.supporter === true,

    totals: { ...base.totals, ...(typeof src.totals === "object" && src.totals ? src.totals : {}) },

    buildName: typeof src.buildName === "string" ? src.buildName : base.buildName,
    notation:
      src.notation === "scientific" || src.notation === "engineering" ? src.notation : "short",
  };

  state.deepestZone = Math.max(state.deepestZone, state.zone);
  state.deepestZoneEver = Math.max(state.deepestZoneEver, state.deepestZone);
  state.version = IDLE_STATE_VERSION;
  return state;
}

/**
 * Zabezpieczenie zegara (v4 §4.5, anty-exploit). Dopóki nie ma serwera,
 * `lastSeen` pochodzi z klienta — a klient potrafi cofnąć albo przesunąć zegar
 * o rok do przodu. Odrzucamy oba przypadki: skok w przód ponad `cap` i tak
 * zostanie przycięty, a cofnięcie zegara nie może wyzerować postępu.
 */
export function monotonicGuard(state: IdleState, now: number): number {
  if (!Number.isFinite(state.lastSeen) || state.lastSeen <= 0) return now;
  if (state.lastSeen > now) return now; // zegar cofnięty → zero zysku, zero kary
  return state.lastSeen;
}

/** Ile sekund gracz ma zaliczone, po przycięciu do capu wynikającego z konta. */
export function offlineCapSeconds(state: IdleState, config: IdleConfig): number {
  const hours = state.supporter ? config.offline.capHoursSupporter : config.offline.capHoursFree;
  return hours * 3600;
}

export function offlineEfficiency(state: IdleState, config: IdleConfig): number {
  return state.supporter ? config.offline.efficiencySupporter : config.offline.efficiencyFree;
}

// ─────────────────────────────────────────────────────────────── pomocnicze

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function bigOr(v: unknown): Big {
  return v === undefined || v === null ? BIG_ZERO : bigFromJSON(v);
}

function numberRecord(
  v: unknown,
  keys: readonly string[],
  fallback: number,
): Record<string, number> {
  const src = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = Math.max(0, num(src[k], fallback));
  return out;
}

/** Rekordy o otwartym zbiorze kluczy (drzewko, bestiariusz) — bez listy kluczy. */
function freeNumberRecord(v: unknown): Record<string, number> {
  const src = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(src)) {
    const n = num(val, 0);
    if (n > 0) out[k] = n;
  }
  return out;
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Przedmioty z zapisu przechodzą przez sito: brak `id`, brak slotu albo NaN
 * w wartości afiksu wywala panel ekwipunku, a nie widać wtedy, co się stało.
 * Taniej odrzucić uszkodzony przedmiot niż stracić cały save.
 */
function sanitizeItem(v: unknown, seen: Set<string>): IdleItem | null {
  if (typeof v !== "object" || v === null) return null;
  const src = v as Record<string, unknown>;
  const slot = src.slot;
  if (typeof slot !== "string" || !(IDLE_SLOTS as readonly string[]).includes(slot)) return null;

  let id = typeof src.id === "string" && src.id !== "" ? src.id : "";
  if (id === "" || seen.has(id)) id = `it_${seen.size.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  seen.add(id);

  const affixes: IdleAffix[] = Array.isArray(src.affixes)
    ? src.affixes
        .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
        .map((a) => ({
          id: typeof a.id === "string" ? a.id : "unknown",
          stat: typeof a.stat === "string" ? a.stat : "flatDamage",
          label: typeof a.label === "string" ? a.label : "{v}",
          base: num(a.base, 0),
          roll: Math.min(1, Math.max(0, num(a.roll, 1))),
          value: num(a.value, 0),
          pct: a.pct === true,
        }))
    : [];

  const rarity = src.rarity;
  return {
    id,
    baseId: typeof src.baseId === "string" ? src.baseId : slot,
    name: typeof src.name === "string" ? src.name : "Przedmiot",
    slot: slot as IdleSlot,
    rarity: (typeof rarity === "string" &&
    ["common", "magic", "rare", "epic", "unique"].includes(rarity)
      ? rarity
      : "common") as IdleItem["rarity"],
    zone: Math.max(1, Math.floor(num(src.zone, 1))),
    affixes,
    quality: Math.min(1, Math.max(0, num(src.quality, 1))),
    upgradeLevel: Math.max(0, Math.floor(num(src.upgradeLevel, 0))),
    ...(typeof src.uniqueId === "string" ? { uniqueId: src.uniqueId } : {}),
    rerolls: Math.max(0, Math.floor(num(src.rerolls, 0))),
  };
}

function itemArray(v: unknown, seen = new Set<string>()): IdleItem[] {
  if (!Array.isArray(v)) return [];
  const out: IdleItem[] = [];
  for (const raw of v) {
    const item = sanitizeItem(raw, seen);
    if (item) out.push(item);
  }
  return out;
}

function mergeEquipment(v: unknown, seen = new Set<string>()): IdleEquipment {
  if (typeof v !== "object" || v === null) return {};
  const src = v as Record<string, unknown>;
  const out: IdleEquipment = {};
  for (const slot of IDLE_SLOTS) {
    const item = sanitizeItem(src[slot], seen);
    // Przedmiot założony w niewłaściwym slocie to uszkodzony zapis — pomijamy.
    if (item && item.slot === slot) out[slot] = item;
  }
  return out;
}

function mergePrestige(v: unknown, base: IdleState["prestige"]): IdleState["prestige"] {
  const src = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  return {
    points: Math.max(0, Math.floor(num(src.points, 0))),
    spent: Math.max(0, Math.floor(num(src.spent, 0))),
    lifetime: Math.max(0, Math.floor(num(src.lifetime, 0))),
    count: Math.max(0, Math.floor(num(src.count, 0))),
    nodes: freeNumberRecord(src.nodes),
    sparks: Math.max(0, Math.floor(num(src.sparks, 0))),
    ascensions: Math.max(0, Math.floor(num(src.ascensions, 0))),
    ascensionNodes: freeNumberRecord(src.ascensionNodes),
    lastPrestigeAt: num(src.lastPrestigeAt, base.lastPrestigeAt),
  };
}

function mergeAutomation(v: unknown): Record<AutomationId, AutomationSlot> {
  const src = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  const out = {} as Record<AutomationId, AutomationSlot>;
  for (const id of AUTOMATION_IDS) {
    const s = (typeof src[id] === "object" && src[id] !== null ? src[id] : {}) as Record<
      string,
      unknown
    >;
    out[id] = { unlocked: s.unlocked === true, enabled: s.enabled !== false };
  }
  return out;
}

function mergeChallenges(v: unknown, base: IdleState): IdleState["challenges"] {
  const src = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  return {
    activeId: typeof src.activeId === "string" ? src.activeId : null,
    startedAt: num(src.startedAt, 0),
    snapshot: typeof src.snapshot === "string" ? src.snapshot : null,
    completed: stringArray(src.completed),
    best: freeNumberRecord(src.best),
  };
}

function mergeFilter(v: unknown): LootFilter {
  const base = defaultLootFilter();
  const src = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  const rules = Array.isArray(src.rules)
    ? src.rules
        .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
        .map((r) => ({
          rarity: (typeof r.rarity === "string" ? r.rarity : "common") as LootFilter["rules"][number]["rarity"],
          action: (r.action === "keep" || r.action === "sell" ? r.action : "salvage") as
            | "keep"
            | "salvage"
            | "sell",
          minQuality: Math.min(1, Math.max(0, num(r.minQuality, 0))),
        }))
    : base.rules;

  return {
    enabled: src.enabled === true,
    rules: rules.length > 0 ? rules : base.rules,
    keepAffixes: stringArray(src.keepAffixes),
    keepUpgrades: src.keepUpgrades !== false,
  };
}
