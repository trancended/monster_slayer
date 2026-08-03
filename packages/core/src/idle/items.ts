/**
 * Generowanie przedmiotów warstwy idle (v4 §4.6).
 *
 *   `wartość = base · (1 + 0.08·z) · roll(0.7, 1.0)`
 *
 * Dwie rzeczy, które ten wzór załatwia jednocześnie:
 *  • **strefa dropu jest jedynym źródłem skalowania** — nie ma osobnej tabeli
 *    poziomów przedmiotu, więc przedmiot ze strefy 40 zawsze bije ten ze strefy 20;
 *  • **`roll` jest widoczny dla gracza jako procent jakości** — i to jest
 *    paliwo do rerollowania w kuźni (v4 §5.3). Bez widocznej jakości reroll
 *    wartości byłby ślepym losowaniem, a tak jest pogonią za 100%.
 *
 * Losowanie idzie przez `Rng` z rdzenia (GDD §11.3): łup ma własny strumień,
 * więc nie kradnie sekwencji krytykom ani AI.
 */
import { z } from "zod";
import raw from "../../../../data/idle-affixes.json" with { type: "json" };
import type { Rng } from "../core/rng.ts";
import { affixValue } from "./curves.ts";
import type { IdleConfig, IdleRarityDef } from "./config.ts";
import { isUnique, rollUnique, uniqueBonuses, type UniqueIndex } from "./uniques.ts";
import {
  IDLE_SLOTS,
  emptyBonuses,
  mergeBonuses,
  type IdleAffix,
  type IdleBonuses,
  type IdleEquipment,
  type IdleItem,
  type IdleRarityId,
  type IdleSlot,
} from "./types.ts";

const AffixDefSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Musi pokrywać się z polem `IdleBonuses` — inaczej afiks nie robi nic. */
  stat: z.string().min(1),
  base: z.number(),
  pct: z.boolean(),
  slots: z.array(z.enum([...IDLE_SLOTS] as [IdleSlot, ...IdleSlot[]])).min(1),
  weight: z.number().positive(),
});

const AffixPoolSchema = z.object({
  version: z.number(),
  note: z.string().optional(),
  baseItems: z.record(z.string(), z.object({ name: z.string(), damage: z.number() })),
  prefixes: z.array(z.string()).min(1),
  suffixes: z.array(z.string()).min(1),
  affixes: z.array(AffixDefSchema).min(1),
});

export type AffixDef = z.infer<typeof AffixDefSchema>;

export interface AffixPool {
  version: number;
  affixes: readonly AffixDef[];
  prefixes: readonly string[];
  suffixes: readonly string[];
  baseName(slot: IdleSlot): string;
  baseDamage(slot: IdleSlot): number;
  forSlot(slot: IdleSlot): readonly AffixDef[];
  byId(id: string): AffixDef | undefined;
}

export function parseAffixPool(data: unknown): AffixPool {
  const parsed = AffixPoolSchema.parse(data);
  const bySlot = new Map<IdleSlot, AffixDef[]>();
  for (const slot of IDLE_SLOTS) {
    bySlot.set(
      slot,
      parsed.affixes.filter((a) => a.slots.includes(slot)),
    );
  }
  const byId = new Map(parsed.affixes.map((a) => [a.id, a]));

  return {
    version: parsed.version,
    affixes: parsed.affixes,
    prefixes: parsed.prefixes,
    suffixes: parsed.suffixes,
    baseName: (slot) => parsed.baseItems[slot]?.name ?? "Przedmiot",
    baseDamage: (slot) => parsed.baseItems[slot]?.damage ?? 0,
    forSlot: (slot) => bySlot.get(slot) ?? [],
    byId: (id) => byId.get(id),
  };
}

let cached: AffixPool | null = null;

export function bundledAffixPool(): AffixPool {
  if (!cached) cached = parseAffixPool(raw);
  return cached;
}

// ───────────────────────────────────────────────────────────── losowanie

export interface RollOptions {
  forceRarity?: IdleRarityId;
  slot?: IdleSlot;
  /** Mnożnik znajdźki — przesuwa wagi w stronę rzadszych tierów. */
  magicFind?: number;
}

/**
 * Losowanie rzadkości ze znajdźką.
 *
 * Znajdźka nie mnoży wag rzadkich po równo — przesuwa je **proporcjonalnie do
 * rzadkości**, żeby +100% znajdźki było odczuwalne na unikatach, a nie tylko
 * na magicznych. Waga zwykłych maleje o tyle, ile przybyło reszcie, bo suma
 * wag musi zostać skończona.
 */
export function rollRarity(rng: Rng, cfg: IdleConfig, magicFind = 1): IdleRarityDef {
  const mf = Math.max(1, magicFind);
  const weighted = cfg.items.rarities.map((r) => ({
    def: r,
    // Zwykłe nie korzystają ze znajdźki; im rzadszy tier, tym mocniejszy wpływ.
    weight: r.id === "common" ? r.weight : r.weight * mf,
  }));
  return rng.weighted(weighted, (w) => w.weight).def;
}

export function rollAffixes(
  rng: Rng,
  slot: IdleSlot,
  zone: number,
  count: number,
  cfg: IdleConfig,
  pool: AffixPool,
): IdleAffix[] {
  if (count <= 0) return [];
  const candidates = pool.forSlot(slot);
  if (candidates.length === 0) return [];

  const out: IdleAffix[] = [];
  const used = new Set<string>();

  // Bez odsiewania duplikatów przedmiot potrafi wylosować cztery razy ten sam
  // afiks — technicznie poprawne, wizualnie wygląda jak błąd.
  for (let i = 0; i < count && used.size < candidates.length; i++) {
    let def: AffixDef | undefined;
    for (let attempt = 0; attempt < 12; attempt++) {
      const pick = rng.weighted(candidates, (a) => a.weight);
      if (!used.has(pick.id)) {
        def = pick;
        break;
      }
    }
    if (!def) def = candidates.find((a) => !used.has(a.id));
    if (!def) break;

    used.add(def.id);
    out.push(makeAffix(def, zone, rng.range(cfg.items.rollMin, cfg.items.rollMax), cfg));
  }

  return out;
}

function makeAffix(def: AffixDef, zone: number, roll: number, cfg: IdleConfig): IdleAffix {
  return {
    id: def.id,
    stat: def.stat,
    label: def.label,
    base: def.base,
    roll,
    value: affixValue(def.base, zone, roll, cfg.items),
    pct: def.pct,
  };
}

export function rollItem(
  rng: Rng,
  zone: number,
  cfg: IdleConfig,
  pool: AffixPool,
  uniques: UniqueIndex,
  opts: RollOptions = {},
): IdleItem {
  const slot = opts.slot ?? rng.pick(IDLE_SLOTS);
  const rarityDef =
    opts.forceRarity !== undefined
      ? (cfg.items.rarities.find((r) => r.id === opts.forceRarity) ?? rollRarity(rng, cfg, opts.magicFind))
      : rollRarity(rng, cfg, opts.magicFind);

  if (rarityDef.id === "unique") return rollUnique(rng, zone, uniques, slot);

  const count = rng.int(rarityDef.affixMin, rarityDef.affixMax);
  const affixes = rollAffixes(rng, slot, zone, count, cfg, pool);

  return {
    id: `it_${zone}_${rng.int(0, 0xffffffff).toString(36)}`,
    baseId: slot,
    name: itemName(rng, pool, slot, rarityDef.id, affixes.length),
    slot,
    rarity: rarityDef.id,
    zone: Math.max(1, Math.floor(zone)),
    affixes,
    quality: itemQuality(affixes, cfg),
    upgradeLevel: 0,
    rerolls: 0,
  };
}

/**
 * Nazwa proceduralna: `prefiks + baza + „sufiksu"`. Zwykłe przedmioty zostają
 * przy gołej nazwie bazy — to sygnał „nie warto oglądać", czytelny bez
 * wczytywania się w afiksy.
 */
function itemName(
  rng: Rng,
  pool: AffixPool,
  slot: IdleSlot,
  rarity: IdleRarityId,
  affixCount: number,
): string {
  const base = pool.baseName(slot);
  if (rarity === "common" || affixCount === 0) return base;
  if (rarity === "magic") return `${rng.pick(pool.prefixes)} ${base.toLowerCase()}`;
  return `${rng.pick(pool.prefixes)} ${base.toLowerCase()} ${rng.pick(pool.suffixes)}`;
}

/**
 * Jakość 0–1 znormalizowana do okna `[rollMin, rollMax]`.
 *
 * Normalizacja jest tu konieczna: surowy `roll` z zakresu 0.7–1.0 pokazany
 * graczowi jako „70%" sugerowałby, że da się zejść do zera. Po normalizacji
 * 100% oznacza dokładnie to, co gracz myśli, że oznacza — maksymalne rolle.
 */
export function itemQuality(affixes: readonly IdleAffix[], cfg: IdleConfig): number {
  if (affixes.length === 0) return 1;
  const span = cfg.items.rollMax - cfg.items.rollMin;
  if (span <= 0) return 1;
  let sum = 0;
  for (const a of affixes) sum += (a.roll - cfg.items.rollMin) / span;
  return Math.min(1, Math.max(0, sum / affixes.length));
}

// ───────────────────────────────────────────────────────────────── bonusy

/** Mnożnik wartości afiksów z ulepszenia w kuźni (v4 §5.3). */
export function upgradeMultiplier(item: IdleItem, cfg: IdleConfig): number {
  return 1 + cfg.forge.upgradeStatPerLevel * Math.max(0, item.upgradeLevel);
}

export function itemBonuses(item: IdleItem, cfg: IdleConfig, uniques: UniqueIndex): IdleBonuses {
  if (isUnique(item)) {
    const def = item.uniqueId ? uniques.get(item.uniqueId) : undefined;
    return def ? uniqueBonuses(def) : emptyBonuses();
  }

  const out = emptyBonuses();
  const mult = upgradeMultiplier(item, cfg);

  for (const a of item.affixes) {
    const v = a.value * mult;
    switch (a.stat) {
      case "flatDamage":
        out.flatDamage += v;
        break;
      case "increasedDamage":
        out.increasedDamage += v;
        break;
      case "attackSpeed":
        out.attackSpeed += v;
        break;
      case "critChance":
        out.critChance += v;
        break;
      case "critMult":
        out.critMult += v;
        break;
      case "areaDamage":
        out.areaDamage += v;
        break;
      case "goldFind":
        out.goldFind += v;
        break;
      case "magicFind":
        out.magicFind += v;
        break;
      case "offlineEfficiency":
        out.offlineEfficiency += v;
        break;
      case "offlineCapHours":
        out.offlineCapHours += v;
        break;
      default:
        // Nieznany `stat` to literówka w danych, nie sytuacja do obsłużenia
        // po cichu — ale wywalanie gry na złym JSON-ie byłoby gorsze.
        break;
    }
  }

  return out;
}

export function equipmentBonuses(
  eq: IdleEquipment,
  cfg: IdleConfig,
  uniques: UniqueIndex,
): IdleBonuses {
  const parts: IdleBonuses[] = [];
  for (const slot of IDLE_SLOTS) {
    const item = eq[slot];
    if (item) parts.push(itemBonuses(item, cfg, uniques));
  }
  return parts.length > 0 ? mergeBonuses(...parts) : emptyBonuses();
}

// ─────────────────────────────────────────────────────── porównania i UI

/**
 * Wagi statów do jednej liczby porównawczej. Używane przez auto-ekwipunek
 * (automatyzacja #6) i przez strzałkę „lepszy/gorszy" w panelu.
 *
 * To jest **heurystyka**, nie prawda: dla buildu obszarowego `areaDamage` jest
 * wart wielokrotnie więcej niż tu wynika. Dlatego auto-ekwipunek zawsze da się
 * wyłączyć, a decyzja o buildzie nigdy nie jest automatyzowana (v4 §3.1).
 */
export const DEFAULT_ITEM_WEIGHTS: Readonly<Record<string, number>> = {
  flatDamage: 1.0,
  increasedDamage: 60,
  attackSpeed: 70,
  critChance: 120,
  critMult: 30,
  areaDamage: 80,
  goldFind: 18,
  magicFind: 22,
  offlineEfficiency: 90,
  offlineCapHours: 8,
};

export function itemScore(
  item: IdleItem,
  cfg: IdleConfig,
  weights: Readonly<Record<string, number>> = DEFAULT_ITEM_WEIGHTS,
): number {
  // Unikat wyceniamy wysoko z definicji: jego wartość leży w regule, której
  // żadna waga statu nie wyrazi. Auto-ekwipunek ma go nie wyrzucić.
  if (isUnique(item)) return Number.POSITIVE_INFINITY;

  const mult = upgradeMultiplier(item, cfg);
  let score = 0;
  for (const a of item.affixes) score += a.value * mult * (weights[a.stat] ?? 1);
  return score;
}

export function isUpgradeOver(
  candidate: IdleItem,
  current: IdleItem | undefined,
  cfg: IdleConfig,
  weights?: Readonly<Record<string, number>>,
): boolean {
  if (!current) return true;
  if (isUnique(current)) return false; // unikatu nie podmieniamy automatycznie
  return itemScore(candidate, cfg, weights) > itemScore(current, cfg, weights);
}

/** `Szpon Zmierzchu +7 (94%)` — jedna linijka do listy i do screenshotów. */
export function itemLabel(item: IdleItem): string {
  const up = item.upgradeLevel > 0 ? ` +${item.upgradeLevel}` : "";
  const quality = isUnique(item) ? "" : ` (${Math.round(item.quality * 100)}%)`;
  return `${item.name}${up}${quality}`;
}

/** Tekst afiksu z podstawioną wartością — `+12% obrażeń`. */
export function affixText(a: IdleAffix, item: IdleItem, cfg: IdleConfig): string {
  const value = a.value * upgradeMultiplier(item, cfg);
  const shown = a.pct ? (value * 100).toFixed(1).replace(/\.0$/, "") : Math.round(value).toString();
  return a.label.replace("{v}", shown);
}
