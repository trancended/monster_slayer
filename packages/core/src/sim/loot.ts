/**
 * Generator łupu — GDD §8. Rzadkości, afiksy skalowane item levelem,
 * ochrona przed pechem (pity) i legendy z unikalnym modyfikatorem.
 */
import type { Rng } from "../core/rng.ts";
import type { AffixDef, Balance } from "../data/schema.ts";
import type { Item, ItemAffix, ItemRarityId } from "../domain/item.ts";
import { clamp } from "../core/math.ts";

const RARITY_ORDER: ItemRarityId[] = ["common", "uncommon", "rare", "epic", "legendary"];

export interface DropResult {
  item: Item | null;
  gold: number;
  potion: boolean;
}

let itemCounter = 0;

export class LootGenerator {
  private readonly balance: Balance;
  private readonly rng: Rng;

  constructor(balance: Balance, rng: Rng) {
    this.balance = balance;
    this.rng = rng;
  }

  /**
   * Ochrona przed pechem (GDD §8.5): licznik zabójstw bez dropu;
   * po 25 zabiciach szansa rośnie liniowo do 100% przy 40.
   */
  private pityChance(baseChance: number, killsWithoutDrop: number): number {
    const { startAfterKills, guaranteedAtKills } = this.balance.affixes.drops.pity;
    if (killsWithoutDrop < startAfterKills) return baseChance;
    const t = (killsWithoutDrop - startAfterKills) / (guaranteedAtKills - startAfterKills);
    return clamp(baseChance + (1 - baseChance) * clamp(t, 0, 1), 0, 1);
  }

  rollDrop(params: {
    dropChance: number;
    goldValue: number;
    itemLevel: number;
    elite: boolean;
    boss: boolean;
    killsWithoutDrop: number;
    goldBonus: number;
  }): DropResult {
    const drops = this.balance.affixes.drops;
    const gold = Math.max(
      1,
      Math.round(params.goldValue * this.rng.range(0.75, 1.35) * (1 + params.goldBonus)),
    );
    const potion = this.rng.chance(drops.potionChance);

    if (params.boss) {
      return { item: this.generateItem(params.itemLevel, "epic"), gold, potion: true };
    }
    if (params.elite) {
      return { item: this.generateItem(params.itemLevel, "rare"), gold, potion };
    }

    const chance = this.pityChance(params.dropChance, params.killsWithoutDrop);
    const item = this.rng.chance(chance) ? this.generateItem(params.itemLevel) : null;
    return { item, gold, potion };
  }

  private rollRarity(minimum?: ItemRarityId): ItemRarityId {
    const minIdx = minimum ? RARITY_ORDER.indexOf(minimum) : 0;
    const pool = this.balance.affixes.rarities.filter(
      (r) => RARITY_ORDER.indexOf(r.id) >= minIdx,
    );
    const chosen = this.rng.weighted(pool, (r) => r.weight);
    return chosen.id;
  }

  generateItem(itemLevel: number, minRarity?: ItemRarityId): Item {
    const { affixes } = this.balance;
    // item level = poziom strefy ±2 (GDD §8.3)
    const ilvl = Math.max(1, itemLevel + this.rng.int(-2, 2));
    const rarityId = this.rollRarity(minRarity);
    const rarity = affixes.rarities.find((r) => r.id === rarityId)!;
    const slotDef = this.rng.pick(affixes.slots);
    const base = affixes.baseItems[slotDef.id];

    let minDamage = 0;
    let maxDamage = 0;
    let armor = 0;
    if (base) {
      if (base.minDamage !== undefined && base.maxDamage !== undefined) {
        minDamage = Math.round(base.minDamage + base.perLevel * (ilvl - 1) * 0.8);
        maxDamage = Math.round(base.maxDamage + base.perLevel * (ilvl - 1) * 1.2);
      }
      if (base.armor !== undefined && base.armor > 0) {
        armor = Math.round(base.armor + base.perLevel * (ilvl - 1));
      }
    }

    const affixCount = this.rng.int(rarity.affixMin, rarity.affixMax);
    const rolled: ItemAffix[] = [];
    const used = new Set<string>();

    const eligible = (list: AffixDef[]): AffixDef[] =>
      list.filter((a) => a.slots.includes(slotDef.id) && !used.has(a.id));

    for (let i = 0; i < affixCount; i++) {
      // Epicki dostaje minimum jeden prefiks z puli mocy (GDD §8.2).
      const preferPrefix = i === 0 && (rarityId === "epic" || rarityId === "legendary");
      const pools = preferPrefix
        ? [eligible(affixes.prefixes)]
        : [eligible(affixes.prefixes), eligible(affixes.suffixes)];
      const flat = pools.flat();
      if (flat.length === 0) break;
      const def = this.rng.pick(flat);
      used.add(def.id);

      const raw =
        (this.rng.range(def.min, def.max) + def.perLevel * (ilvl - 1)) * rarity.valueMult;
      const value = def.cap !== undefined ? Math.min(raw, def.cap) : raw;

      rolled.push({
        id: def.id,
        stat: def.stat,
        value: def.pct ? Math.round(value * 10) / 10 : Math.round(value),
        label: def.label,
        pct: def.pct === true,
      });
    }

    let name = `${base?.name ?? slotDef.name}`;
    let legendaryId: string | undefined;
    let legendaryText: string | undefined;

    if (rarityId === "legendary") {
      const candidates = affixes.legendaries.filter(
        (l) => l.slot === slotDef.id || (slotDef.family === "ring" && l.slot.startsWith("ring")),
      );
      const legendary = candidates.length > 0 ? this.rng.pick(candidates) : null;
      if (legendary) {
        name = legendary.name;
        legendaryId = legendary.id;
        legendaryText = legendary.modifier;
      }
    } else if (rolled.length > 0) {
      name = `${name} ${QUALITY_WORDS[rarityId] ?? ""}`.trim();
    }

    const sellValue = Math.round(
      (5 + ilvl * 3) * (1 + rolled.length * 0.6) * (rarityId === "legendary" ? 6 : 1),
    );

    return {
      id: `it_${(++itemCounter).toString(36)}`,
      name,
      slot: slotDef.id,
      rarity: rarityId,
      itemLevel: ilvl,
      minDamage,
      maxDamage,
      armor,
      affixes: rolled,
      legendaryId,
      legendaryText,
      sellValue,
    };
  }
}

const QUALITY_WORDS: Partial<Record<ItemRarityId, string>> = {
  uncommon: "Łowcy",
  rare: "Weterana",
  epic: "Zgnilizny",
};
