/**
 * Kontrakt warstwy idle (plan v4). Jeden plik z kształtem stanu, żeby moduły
 * — krzywe, offline, kuźnia, drzewko, prestiż, kod builda — nie musiały się
 * znać nawzajem. Wszystko poniżej jest czystymi danymi: serializowalne,
 * bez metod, bez referencji do świata walki.
 *
 * Zasada: funkcje warstwy idle są **czyste** i mają sygnaturę
 * `(state, config, …) → wynik`. Mutacja stanu zdarza się wyłącznie w
 * `IdleEngine` (klient) — dzięki temu każdą formułę da się przetestować
 * i policzyć w symulatorze bez uruchamiania gry.
 */
import type { Big, Notation } from "../core/bignum.ts";

// ────────────────────────────────────────────────────────────── słowniki

/** Ulepszenia za złoto (v4 §4.1). */
export type UpgradeId =
  | "damage"
  | "attackSpeed"
  | "critChance"
  | "critMult"
  | "goldFind"
  | "areaDamage"
  | "magicFind";

export const UPGRADE_IDS: readonly UpgradeId[] = [
  "damage",
  "attackSpeed",
  "critChance",
  "critMult",
  "goldFind",
  "areaDamage",
  "magicFind",
];

/** Surowce kuźni (v4 §5.3). */
export type MaterialId = "scrap" | "fragment" | "dust" | "essence";

export const MATERIAL_IDS: readonly MaterialId[] = ["scrap", "fragment", "dust", "essence"];

export const MATERIAL_LABELS: Record<MaterialId, string> = {
  scrap: "Złom",
  fragment: "Fragmenty",
  dust: "Pył",
  essence: "Esencja",
};

/** Drabina automatyzacji (v4 §3.1) — kolejność ma znaczenie dla progresji. */
export type AutomationId =
  | "autoAttack"
  | "autoPickup"
  | "autoSalvage"
  | "autoZone"
  | "autoSkill"
  | "autoEquip"
  | "autoPrestige"
  | "autoExpedition";

export const AUTOMATION_IDS: readonly AutomationId[] = [
  "autoAttack",
  "autoPickup",
  "autoSalvage",
  "autoZone",
  "autoSkill",
  "autoEquip",
  "autoPrestige",
  "autoExpedition",
];

/** Rzadkości v4 (§4.6) — rozszerzają skalę z GDD o osobny tier unikatu. */
export type IdleRarityId = "common" | "magic" | "rare" | "epic" | "unique";

/** Dziewięć slotów (v4 §5.2). */
export const IDLE_SLOTS = [
  "weapon",
  "helmet",
  "chest",
  "gloves",
  "boots",
  "belt",
  "amulet",
  "ring1",
  "ring2",
] as const;

export type IdleSlot = (typeof IDLE_SLOTS)[number];

export const SLOT_LABELS: Record<IdleSlot, string> = {
  weapon: "Broń",
  helmet: "Hełm",
  chest: "Napierśnik",
  gloves: "Rękawice",
  boots: "Buty",
  belt: "Pas",
  amulet: "Amulet",
  ring1: "Pierścień I",
  ring2: "Pierścień II",
};

// ────────────────────────────────────────────────────────────── przedmioty

export interface IdleAffix {
  id: string;
  /** Klucz statystyki — musi pokrywać się z polami `IdleBonuses`. */
  stat: string;
  /** Etykieta z `{v}` w miejscu wartości. */
  label: string;
  /** Wartość bazowa przed skalowaniem strefą i rollem. */
  base: number;
  /** Jakość pojedynczego afiksu, `rollMin…rollMax` (v4 §4.6). */
  roll: number;
  /** Wartość końcowa: `base · (1 + perZone·z) · roll`. */
  value: number;
  pct: boolean;
}

export interface IdleItem {
  id: string;
  baseId: string;
  name: string;
  slot: IdleSlot;
  rarity: IdleRarityId;
  /** Strefa dropu — jedyne źródło skalowania wartości afiksów. */
  zone: number;
  affixes: IdleAffix[];
  /** Średnia rolli, 0–1. Widoczna dla gracza jako procent jakości. */
  quality: number;
  /** Ulepszenie w kuźni, 0…`maxUpgradeLevel`. */
  upgradeLevel: number;
  /** Ustawione tylko dla unikatów — klucz do `data/uniques.json`. */
  uniqueId?: string;
  /** Licznik rerolli — każdy kolejny jest droższy (sink bez dna, v4 §5.3). */
  rerolls: number;
}

export type IdleEquipment = Partial<Record<IdleSlot, IdleItem>>;

// ───────────────────────────────────────────────────────────────── bonusy

/**
 * Zbiorcze bonusy spoza tabeli ulepszeń: drzewko, prestiż, przedmioty,
 * bestiariusz, wyzwania, unikaty. To jest **jedyny** kanał, którym te warstwy
 * wpływają na DPS — dzięki temu dodanie nowego źródła bonusów nie wymaga
 * dotykania wzoru na obrażenia.
 *
 * Konwencja jak w `StatSheet` (GDD §11.4):
 *   `wartość = (baza + flat) × (1 + Σ increased) × Π (1 + more)`
 */
export interface IdleBonuses {
  flatDamage: number;
  /** Sumowane addytywnie, `0.35` = +35%. */
  increasedDamage: number;
  /** Multiplikatywne — rzadkie, zarezerwowane dla keystone'ów i unikatów. */
  moreDamage: number[];
  attackSpeed: number;
  /** Punkty procentowe w ułamku: `0.05` = +5 pkt proc. */
  critChance: number;
  critMult: number;
  areaDamage: number;
  goldFind: number;
  magicFind: number;
  /** Dodatek do `efficiency` offline (v4 §4.5). */
  offlineEfficiency: number;
  /** Dodatek do `cap` offline w godzinach. */
  offlineCapHours: number;
  /** Aktywne keystone'y — zmieniają zasady, nie liczby (v4 §5.4). */
  keystones: string[];
  /** Bonus obrażeń przeciw typowi wroga (bestiariusz, v4 §5.7). */
  perEnemy: Record<string, number>;
}

export function emptyBonuses(): IdleBonuses {
  return {
    flatDamage: 0,
    increasedDamage: 0,
    moreDamage: [],
    attackSpeed: 0,
    critChance: 0,
    critMult: 0,
    areaDamage: 0,
    goldFind: 0,
    magicFind: 0,
    offlineEfficiency: 0,
    offlineCapHours: 0,
    keystones: [],
    perEnemy: {},
  };
}

/** Scala wiele źródeł bonusów w jedno. Kolejność nie ma znaczenia. */
export function mergeBonuses(...sources: readonly IdleBonuses[]): IdleBonuses {
  const out = emptyBonuses();
  for (const s of sources) {
    out.flatDamage += s.flatDamage;
    out.increasedDamage += s.increasedDamage;
    out.moreDamage.push(...s.moreDamage);
    out.attackSpeed += s.attackSpeed;
    out.critChance += s.critChance;
    out.critMult += s.critMult;
    out.areaDamage += s.areaDamage;
    out.goldFind += s.goldFind;
    out.magicFind += s.magicFind;
    out.offlineEfficiency += s.offlineEfficiency;
    out.offlineCapHours += s.offlineCapHours;
    for (const k of s.keystones) if (!out.keystones.includes(k)) out.keystones.push(k);
    for (const [id, v] of Object.entries(s.perEnemy)) out.perEnemy[id] = (out.perEnemy[id] ?? 0) + v;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────── stan

export interface AutomationSlot {
  unlocked: boolean;
  enabled: boolean;
}

export interface PrestigeState {
  /** Niewydane punkty prestiżu. */
  points: number;
  /** Wydane w drzewku trwałym. */
  spent: number;
  /** Suma zdobytych PP przez całe życie konta — do progów odblokowań. */
  lifetime: number;
  /** Ile razy gracz prestiżował. */
  count: number;
  /** Alokacja w drzewku trwałym: `nodeId → poziom`. */
  nodes: Record<string, number>;
  /** Warstwa 2 (v4 §4.4). */
  sparks: number;
  ascensions: number;
  ascensionNodes: Record<string, number>;
  /** `Date.now()` ostatniego resetu — do telemetrii `t_since_last`. */
  lastPrestigeAt: number;
}

export interface ChallengeState {
  /** Aktywne wyzwanie albo `null`. Jedno naraz — inaczej nie da się ich balansować. */
  activeId: string | null;
  startedAt: number;
  /** Stan postaci sprzed wejścia w wyzwanie, do przywrócenia po zakończeniu. */
  snapshot: string | null;
  completed: string[];
  /** Najlepszy wynik per wyzwanie (zwykle osiągnięta strefa). */
  best: Record<string, number>;
}

export type FilterAction = "keep" | "salvage" | "sell";

export interface LootFilterRule {
  rarity: IdleRarityId;
  action: FilterAction;
  /** Próg jakości 0–1; poniżej niego przedmiot leci mimo rzadkości. */
  minQuality: number;
}

export interface LootFilter {
  enabled: boolean;
  rules: LootFilterRule[];
  /** Afiksy, które zawsze ratują przedmiot przed rozbiórką. */
  keepAffixes: string[];
  /** Zawsze zatrzymuj przedmiot lepszy od założonego wg wag statów. */
  keepUpgrades: boolean;
}

export interface IdleTotals {
  kills: number;
  bosses: number;
  items: number;
  salvaged: number;
  rerolls: number;
  offlineSeconds: number;
}

/**
 * Kompletny stan warstwy idle. Zapisywany w całości do IndexedDB
 * (i docelowo w `state_blob JSONB` po stronie Phoeniksa — v4 §7.4).
 */
export interface IdleState {
  version: number;

  // — ekonomia
  gold: Big;
  /** Złoto zarobione od ostatniego prestiżu — wejście do wzoru na PP. */
  goldThisRun: Big;
  /** Złoto zarobione przez całe życie konta. */
  goldLifetime: Big;
  materials: Record<MaterialId, number>;

  // — ulepszenia i strefy
  upgrades: Record<UpgradeId, number>;
  zone: number;
  /** Zabici w bieżącej strefie. */
  zoneProgress: number;
  /** Sekundy spędzone w bieżącej strefie bez awansu — wejście do diagnozy. */
  zoneTimer: number;
  deepestZone: number;
  deepestZoneEver: number;

  // — przedmioty
  equipment: IdleEquipment;
  /** Skrytka. Auto-rozbiórka pilnuje, żeby nie rosła w nieskończoność. */
  stash: IdleItem[];

  // — meta
  prestige: PrestigeState;
  skills: Record<string, number>;
  automation: Record<AutomationId, AutomationSlot>;
  bestiary: Record<string, number>;
  challenges: ChallengeState;
  lootFilter: LootFilter;
  /** Odkryte unikaty — kodeks pamięta je nawet po prestiżu. */
  uniquesFound: string[];

  // — czas i konto
  /**
   * `Date.now()` ostatniego zapisu sesji. Docelowo ustawiane **wyłącznie
   * serwerowo** (v4 §4.5) — zegar klienta nigdy nie dotyka tej wartości.
   * Offline-first: dopóki nie ma backendu, pilnuje jej `monotonicGuard`.
   */
  lastSeen: number;
  startedAt: number;
  playtime: number;
  supporter: boolean;

  totals: IdleTotals;

  // — prezentacja
  buildName: string;
  notation: Notation;
}

// ───────────────────────────────────────────────────────────── pochodne

/**
 * Tempo gry wyliczone ze stanu. To jest jedyna rzecz, którą warstwa offline
 * potrzebuje, żeby policzyć zysk bez symulacji (v4 §4.5).
 */
export interface IdleRates {
  /** Obrażenia na sekundę przeciw pojedynczemu celowi. */
  dps: Big;
  /** Efektywny DPS po uwzględnieniu obrażeń obszarowych i liczby wrogów. */
  clearDps: Big;
  goldPerSecond: Big;
  killsPerSecond: number;
  /** Mnożnik szansy na lepszą rzadkość. */
  magicFind: number;
  /** Sekundy potrzebne na wyczyszczenie bieżącej strefy. */
  clearSeconds: number;
  /** Górna granica, jaką serwer zaakceptuje w raporcie klienta (v4 §5.1). */
  maxTheoreticalDps: Big;
}

export type StuckReason = "none" | "singleTarget" | "areaDamage" | "crit" | "gold" | "gear" | "prestige";

/**
 * Diagnoza blokady — druga z trzech rzeczy, które **musi** robić ekran powrotu
 * (v4 §2.2). Zamienia frustrację w cel.
 */
export interface StuckDiagnosis {
  stuck: boolean;
  zone: number;
  reason: StuckReason;
  /** Zdanie po polsku: „za mało obrażeń obszarowych". */
  text: string;
  /** Jedna sugerowana akcja — przycisk, nie menu. */
  suggestion: string;
  action: SuggestedAction | null;
}

export interface SuggestedAction {
  kind: "upgrade" | "skill" | "forge" | "prestige" | "equip" | "zone";
  id: string;
  label: string;
}

/** Podsumowanie nieobecności — ładunek najważniejszego ekranu w grze. */
export interface OfflineReport {
  /** Rzeczywista nieobecność. */
  awaySeconds: number;
  /** Nieobecność po przycięciu do `cap`. */
  creditedSeconds: number;
  capped: boolean;
  capSeconds: number;
  efficiency: number;

  kills: number;
  gold: Big;
  items: number;
  rareItems: number;
  materials: Record<MaterialId, number>;

  zoneFrom: number;
  zoneTo: number;

  diagnosis: StuckDiagnosis;
  /** Czy w ogóle jest co pokazywać (nieobecność poniżej progu → pomijamy ekran). */
  worthShowing: boolean;
}

/** Zwrotka akcji gracza — jedna forma dla UI, dźwięku i telemetrii. */
export interface ActionResult<T = undefined> {
  ok: boolean;
  /** Komunikat po polsku, gotowy do tosta. */
  message: string;
  value?: T;
}

export const okResult = <T>(message: string, value?: T): ActionResult<T> => ({
  ok: true,
  message,
  ...(value === undefined ? {} : { value }),
});

export const failResult = <T = undefined>(message: string): ActionResult<T> => ({
  ok: false,
  message,
});
