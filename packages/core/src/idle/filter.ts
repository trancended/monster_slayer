/**
 * Filtr łupu i automatyzacje przedmiotowe (v4 §3.1, pozycje 3 i 6).
 *
 * Automatyzacja jest **nagrodą, nie utratą gameplayu** (filar F2). Auto-rozbiórka
 * nie zabiera graczowi decyzji — zabiera mu klikanie w rzeczy, co do których
 * decyzję już podjął, konfigurując filtr. Różnica jest subtelna i cała leży
 * w tym, że reguły ustawia gracz, a nie my.
 *
 * Jedna rzecz jest twarda i niekonfigurowalna: **unikat nigdy nie leci
 * automatycznie**. Filtr, który zjada przedmiot zmieniający zasady gry, kosztuje
 * zaufanie raz i nieodwracalnie (v4 §12).
 */
import { BIG_ZERO, add, scale, type Big } from "../core/bignum.ts";
import type { IdleConfig } from "./config.ts";
import { itemScore, isUpgradeOver } from "./items.ts";
import { salvageYield } from "./forge.ts";
import { isUnique, type UniqueIndex } from "./uniques.ts";
import {
  IDLE_SLOTS,
  MATERIAL_IDS,
  failResult,
  okResult,
  type ActionResult,
  type FilterAction,
  type IdleEquipment,
  type IdleItem,
  type IdleState,
  type LootFilter,
  type MaterialId,
} from "./types.ts";

export type FilterVerdict = FilterAction;

/**
 * Wartość sprzedaży. Skaluje się strefą dropu i rzadkością — dokładnie tak,
 * jak wartość afiksów, żeby sprzedaż nigdy nie była lepsza od rozbiórki
 * „przypadkiem", tylko wtedy, gdy gracz akurat potrzebuje złota.
 */
export function sellValue(item: IdleItem, cfg: IdleConfig): Big {
  const rarity = cfg.items.rarities.find((r) => r.id === item.rarity);
  const mult = rarity?.valueMult ?? 1;
  const base = 8 * (1 + cfg.items.affixPerZone * item.zone) * mult;
  return scale(BIG_ONE_LIKE, base * (1 + 0.2 * item.upgradeLevel));
}

/** Jedynka jako `Big` bez importu stałej — wartość i tak przechodzi przez `scale`. */
const BIG_ONE_LIKE: Big = { m: 1, e: 0 };

/**
 * Werdykt filtru dla pojedynczego przedmiotu.
 *
 * Kolejność sprawdzeń nie jest przypadkowa — od reguł, które **ratują**
 * przedmiot, do tych, które go skazują. Odwrotna kolejność oznaczałaby,
 * że reguła rzadkości zjada przedmiot, zanim ktokolwiek sprawdzi, czy nie jest
 * on lepszy od założonego.
 */
export function evaluate(
  item: IdleItem,
  filter: LootFilter,
  equipment: IdleEquipment,
  cfg: IdleConfig,
): FilterVerdict {
  // 1. Unikat — zawsze zostaje. Nie ma od tego wyjątku i nie będzie.
  if (isUnique(item)) return "keep";

  // 2. Afiks z listy „zawsze zatrzymuj".
  if (filter.keepAffixes.length > 0) {
    for (const a of item.affixes) if (filter.keepAffixes.includes(a.id)) return "keep";
  }

  // 3. Lepszy od założonego w tym slocie.
  if (filter.keepUpgrades && isUpgradeOver(item, equipment[item.slot], cfg)) return "keep";

  // 4. Reguła rzadkości z progiem jakości.
  const rule = filter.rules.find((r) => r.rarity === item.rarity);
  if (!rule) return "keep";
  if (item.quality >= rule.minQuality && rule.action !== "keep") {
    // Przedmiot powyżej progu jakości jest wart obejrzenia mimo rzadkości —
    // to jest sens kolumny „minQuality" w edytorze filtru.
    return "keep";
  }
  return rule.action;
}

export interface SweepResult {
  kept: number;
  salvaged: number;
  sold: number;
  materials: Record<MaterialId, number>;
  gold: Big;
}

/**
 * Przelot przez skrytkę wg filtru. Wołane po każdym dropie w trybie
 * automatycznym i ręcznie z panelu kuźni.
 */
export function sweepStash(
  state: IdleState,
  cfg: IdleConfig,
  _uniques: UniqueIndex,
): SweepResult {
  const materials = {} as Record<MaterialId, number>;
  for (const id of MATERIAL_IDS) materials[id] = 0;

  const result: SweepResult = { kept: 0, salvaged: 0, sold: 0, materials, gold: BIG_ZERO };
  if (!state.lootFilter.enabled) {
    result.kept = state.stash.length;
    return result;
  }

  const keep: IdleItem[] = [];

  for (const item of state.stash) {
    const verdict = evaluate(item, state.lootFilter, state.equipment, cfg);
    if (verdict === "keep") {
      keep.push(item);
      result.kept += 1;
      continue;
    }
    if (verdict === "salvage") {
      const gained = salvageYield(item, cfg);
      for (const id of MATERIAL_IDS) materials[id] += gained[id];
      result.salvaged += 1;
      continue;
    }
    result.gold = add(result.gold, sellValue(item, cfg));
    result.sold += 1;
  }

  state.stash = keep;
  for (const id of MATERIAL_IDS) state.materials[id] = (state.materials[id] ?? 0) + materials[id];
  state.gold = add(state.gold, result.gold);
  state.goldThisRun = add(state.goldThisRun, result.gold);
  state.goldLifetime = add(state.goldLifetime, result.gold);
  state.totals.salvaged += result.salvaged;

  return result;
}

/**
 * Auto-ekwipunek (automatyzacja #6) — zakłada lepsze przedmiot po przedmiocie
 * wg wag statów.
 *
 * Świadome ograniczenie: **nie rusza unikatów**. Wagi statów nie potrafią
 * wycenić reguły „nie możesz trafiać krytycznie", więc automat, który zdejmuje
 * unikat, zawsze podejmuje decyzję o buildzie za gracza — a tego się nie robi
 * (v4 §3.1: „nigdy nie automatyzuj decyzji o buildzie").
 */
export function autoEquip(state: IdleState, cfg: IdleConfig): { equipped: IdleItem[] } {
  const equipped: IdleItem[] = [];

  for (const slot of IDLE_SLOTS) {
    const current = state.equipment[slot];
    if (current && isUnique(current)) continue;

    let best: IdleItem | undefined;
    let bestScore = current ? itemScore(current, cfg) : -1;

    for (const item of state.stash) {
      if (item.slot !== slot || isUnique(item)) continue;
      const score = itemScore(item, cfg);
      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    }

    if (!best) continue;

    state.stash = state.stash.filter((i) => i.id !== best.id);
    if (current) state.stash.push(current);
    state.equipment[slot] = best;
    equipped.push(best);
  }

  return { equipped };
}

/** Ręczne założenie — używane przez panel ekwipunku. */
export function equipItem(state: IdleState, itemId: string): ActionResult<{ item: IdleItem }> {
  const idx = state.stash.findIndex((i) => i.id === itemId);
  if (idx < 0) return failResult("Nie ma takiego przedmiotu w skrytce");

  const item = state.stash[idx]!;
  const current = state.equipment[item.slot];
  state.stash.splice(idx, 1);
  if (current) state.stash.push(current);
  state.equipment[item.slot] = item;

  return okResult(`Założono: ${item.name}`, { item });
}

export function unequipItem(state: IdleState, slot: IdleItem["slot"]): ActionResult {
  const item = state.equipment[slot];
  if (!item) return failResult("Ten slot jest pusty");
  delete state.equipment[slot];
  state.stash.push(item);
  return okResult(`Zdjęto: ${item.name}`);
}

/** Podgląd filtru bez modyfikowania stanu — do edytora reguł. */
export function previewFilter(
  state: IdleState,
  cfg: IdleConfig,
): { keep: number; salvage: number; sell: number } {
  const out = { keep: 0, salvage: 0, sell: 0 };
  for (const item of state.stash) {
    const verdict = state.lootFilter.enabled
      ? evaluate(item, state.lootFilter, state.equipment, cfg)
      : "keep";
    out[verdict] += 1;
  }
  return out;
}
