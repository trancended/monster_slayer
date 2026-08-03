/**
 * Kuźnia (v4 §5.3) — pięć akcji, z których jedna jest ważniejsza od reszty.
 *
 * **Reroll wartości** (nie afiksów) to najlepszy sink w grze: gracz goni 100%
 * jakości i zawsze ma na co wydać pył. Reroll afiksów kończy się, gdy trafi
 * dobry zestaw; reroll wartości nie kończy się nigdy, bo 97% zawsze może być
 * 98%. Dlatego każdy kolejny reroll TEGO SAMEGO przedmiotu jest droższy —
 * inaczej pył przestałby być walutą, a stał się formalnością.
 *
 * Wszystkie funkcje mutujące najpierw sprawdzają zasoby i przy braku zwracają
 * `failResult` mówiący **ile brakuje**. „Za mało materiałów" to komunikat,
 * który zmusza gracza do liczenia w głowie; „brakuje 340 złomu" — nie.
 */
import { BIG_ZERO, add, format, gte, powNum, scale, sub, type Big } from "../core/bignum.ts";
import type { IdleConfig } from "./config.ts";
import { itemQuality, rollAffixes, upgradeMultiplier, type AffixPool } from "./items.ts";
import { isUnique, type UniqueIndex } from "./uniques.ts";
import type { Rng } from "../core/rng.ts";
import {
  MATERIAL_IDS,
  failResult,
  okResult,
  type ActionResult,
  type IdleItem,
  type IdleState,
  type MaterialId,
} from "./types.ts";

export interface UpgradeCost {
  gold: Big;
  scrap: number;
}

/** Koszt kolejnego poziomu ulepszenia. Rośnie wykładniczo — jak wszystko tutaj. */
export function upgradeCost(item: IdleItem, cfg: IdleConfig): UpgradeCost {
  const n = Math.max(0, item.upgradeLevel);
  return {
    gold: scale(powNum(cfg.forge.upgradeGoldR, n), cfg.forge.upgradeGold0),
    scrap: Math.ceil(cfg.forge.upgradeScrap0 * Math.pow(cfg.forge.upgradeScrapR, n)),
  };
}

export function upgradeItem(
  state: IdleState,
  item: IdleItem,
  cfg: IdleConfig,
): ActionResult<{ level: number }> {
  if (item.upgradeLevel >= cfg.forge.maxUpgradeLevel) {
    return failResult(`Maksymalne ulepszenie to +${cfg.forge.maxUpgradeLevel}`);
  }

  const cost = upgradeCost(item, cfg);
  if (!gte(state.gold, cost.gold)) {
    return failResult(`Brakuje ${format(sub(cost.gold, state.gold), { notation: state.notation })} złota`);
  }
  if ((state.materials.scrap ?? 0) < cost.scrap) {
    return failResult(`Brakuje ${cost.scrap - (state.materials.scrap ?? 0)} złomu`);
  }

  state.gold = sub(state.gold, cost.gold);
  state.materials.scrap -= cost.scrap;
  item.upgradeLevel += 1;

  const pct = Math.round((upgradeMultiplier(item, cfg) - 1) * 100);
  return okResult(`${item.name} +${item.upgradeLevel} (statystyki +${pct}%)`, {
    level: item.upgradeLevel,
  });
}

// ──────────────────────────────────────────────────────────────── rerolle

/** Koszt rośnie z licznikiem `rerolls` — wspólna reguła obu rerolli. */
function scaledCost(base: number, rerolls: number, growth: number): number {
  return Math.ceil(base * Math.pow(growth, Math.max(0, rerolls)));
}

export function rerollAffixesCost(item: IdleItem, cfg: IdleConfig): number {
  return scaledCost(cfg.forge.rerollAffixesFragments, item.rerolls, cfg.forge.rerollCostGrowth);
}

/**
 * Nowy zestaw afiksów. Ryzykowna operacja: gracz może stracić dobry zestaw.
 * Właśnie dlatego jest osobna od rerollu wartości — mieszanie ich w jedną
 * akcję zabrałoby graczowi możliwość podjęcia decyzji, a decyzja to filar F2.
 */
export function rerollAffixes(
  state: IdleState,
  item: IdleItem,
  rng: Rng,
  cfg: IdleConfig,
  pool: AffixPool,
): ActionResult<{ item: IdleItem }> {
  if (isUnique(item)) return failResult("Unikat ma stały zestaw — nie da się go przelosować");

  const cost = rerollAffixesCost(item, cfg);
  if ((state.materials.fragment ?? 0) < cost) {
    return failResult(`Brakuje ${cost - (state.materials.fragment ?? 0)} fragmentów`);
  }

  const rarity = cfg.items.rarities.find((r) => r.id === item.rarity);
  const count =
    rarity !== undefined ? rng.int(rarity.affixMin, rarity.affixMax) : item.affixes.length;

  state.materials.fragment -= cost;
  item.affixes = rollAffixes(rng, item.slot, item.zone, count, cfg, pool);
  item.quality = itemQuality(item.affixes, cfg);
  item.rerolls += 1;
  state.totals.rerolls += 1;

  return okResult(`Nowe afiksy — jakość ${Math.round(item.quality * 100)}%`, { item });
}

export function rerollValuesCost(item: IdleItem, cfg: IdleConfig): number {
  return scaledCost(cfg.forge.rerollValuesDust, item.rerolls, cfg.forge.rerollCostGrowth);
}

/**
 * Nowe rolle w tych samych afiksach — bezpieczna wersja rerollu i główny sink.
 * Zestaw statów zostaje, zmienia się tylko jakość.
 */
export function rerollValues(
  state: IdleState,
  item: IdleItem,
  rng: Rng,
  cfg: IdleConfig,
): ActionResult<{ quality: number; previous: number }> {
  if (isUnique(item)) return failResult("Unikat nie ma rolli do przelosowania");
  if (item.affixes.length === 0) return failResult("Ten przedmiot nie ma afiksów");

  const cost = rerollValuesCost(item, cfg);
  if ((state.materials.dust ?? 0) < cost) {
    return failResult(`Brakuje ${cost - (state.materials.dust ?? 0)} pyłu`);
  }

  const previous = item.quality;
  state.materials.dust -= cost;

  for (const a of item.affixes) {
    a.roll = rng.range(cfg.items.rollMin, cfg.items.rollMax);
    a.value = a.base * (1 + cfg.items.affixPerZone * item.zone) * a.roll;
  }
  item.quality = itemQuality(item.affixes, cfg);
  item.rerolls += 1;
  state.totals.rerolls += 1;

  const delta = Math.round((item.quality - previous) * 100);
  const sign = delta > 0 ? `+${delta}` : `${delta}`;
  return okResult(`Jakość ${Math.round(item.quality * 100)}% (${sign} pkt proc.)`, {
    quality: item.quality,
    previous,
  });
}

// ────────────────────────────────────────────────────── rozbiórka i transfer

export function salvageYield(item: IdleItem, cfg: IdleConfig): Record<MaterialId, number> {
  const out = {} as Record<MaterialId, number>;
  for (const id of MATERIAL_IDS) out[id] = 0;

  const table = cfg.forge.salvage[item.rarity];
  if (!table) return out;

  // Ulepszony przedmiot oddaje więcej — bez tego gracz karałby się za każde
  // ulepszenie, którego później nie potrzebował.
  const bonus = 1 + 0.15 * Math.max(0, item.upgradeLevel);
  for (const id of MATERIAL_IDS) out[id] = Math.floor((table[id] ?? 0) * bonus);
  return out;
}

export function salvage(
  state: IdleState,
  item: IdleItem,
  cfg: IdleConfig,
): ActionResult<{ gained: Record<MaterialId, number> }> {
  const idx = state.stash.findIndex((i) => i.id === item.id);
  if (idx < 0) return failResult("Tego przedmiotu nie ma w skrytce");

  const gained = salvageYield(item, cfg);
  state.stash.splice(idx, 1);
  for (const id of MATERIAL_IDS) state.materials[id] = (state.materials[id] ?? 0) + gained[id];
  state.totals.salvaged += 1;

  const summary = MATERIAL_IDS.filter((id) => gained[id] > 0)
    .map((id) => `${gained[id]} ${MATERIAL_SHORT[id]}`)
    .join(", ");
  return okResult(summary === "" ? "Rozebrano" : `Rozebrano: ${summary}`, { gained });
}

const MATERIAL_SHORT: Record<MaterialId, string> = {
  scrap: "złomu",
  fragment: "fragm.",
  dust: "pyłu",
  essence: "esencji",
};

/**
 * Transfer unikalnego moda na inny przedmiot — późna gra, bardzo drogo
 * (v4 §5.3). To jest jedyny sposób, żeby połączyć regułę unikatu z afiksami
 * epika, więc esencja musi być rzadka: inaczej cały tier unikatu traci sens.
 */
export function transferUnique(
  state: IdleState,
  from: IdleItem,
  to: IdleItem,
  cfg: IdleConfig,
  uniques: UniqueIndex,
): ActionResult<{ item: IdleItem }> {
  if (!isUnique(from) || from.uniqueId === undefined) {
    return failResult("Źródło musi być unikatem");
  }
  if (isUnique(to)) return failResult("Celem nie może być inny unikat");
  if (from.slot !== to.slot) return failResult("Sloty muszą się zgadzać");

  const def = uniques.get(from.uniqueId);
  if (!def) return failResult("Nieznany unikat");

  const cost = cfg.forge.transferEssence;
  if ((state.materials.essence ?? 0) < cost) {
    return failResult(`Brakuje ${cost - (state.materials.essence ?? 0)} esencji`);
  }

  const fromIdx = state.stash.findIndex((i) => i.id === from.id);
  if (fromIdx < 0) return failResult("Unikat musi być w skrytce");

  state.materials.essence -= cost;
  state.stash.splice(fromIdx, 1);
  to.uniqueId = def.id;
  to.name = `${to.name} — ${def.name}`;

  return okResult(`Przeniesiono mod: ${def.modifier}`, { item: to });
}

/** Ile jeszcze kosztuje doprowadzenie przedmiotu do maksymalnego ulepszenia. */
export function upgradeToMaxCost(item: IdleItem, cfg: IdleConfig): UpgradeCost {
  let gold = BIG_ZERO;
  let scrap = 0;
  for (let n = item.upgradeLevel; n < cfg.forge.maxUpgradeLevel; n++) {
    const step = upgradeCost({ ...item, upgradeLevel: n }, cfg);
    gold = add(gold, step.gold);
    scrap += step.scrap;
  }
  return { gold, scrap };
}
