export type ItemRarityId = "common" | "uncommon" | "rare" | "epic" | "legendary";

export interface ItemAffix {
  id: string;
  stat: string;
  value: number;
  label: string;
  pct: boolean;
}

export interface Item {
  id: string;
  name: string;
  slot: string;
  rarity: ItemRarityId;
  itemLevel: number;
  minDamage: number;
  maxDamage: number;
  armor: number;
  affixes: ItemAffix[];
  legendaryId?: string;
  legendaryText?: string;
  sellValue: number;
}

export type Equipment = Partial<Record<string, Item>>;

export function affixText(a: ItemAffix): string {
  const rounded = a.pct ? a.value.toFixed(1).replace(/\.0$/, "") : Math.round(a.value).toString();
  return a.label.replace("{v}", rounded);
}

/** Prosty score do porównania „czy nowy przedmiot jest lepszy" w podpowiedzi HUD. */
export function itemScore(item: Item): number {
  let score = (item.minDamage + item.maxDamage) * 1.5 + item.armor * 0.8;
  for (const a of item.affixes) {
    switch (a.stat) {
      case "maxHp":
        score += a.value * 0.35;
        break;
      case "increasedDamage":
      case "critDamage":
        score += a.value * 1.1;
        break;
      case "critChance":
        score += a.value * 3;
        break;
      case "flatDamage":
      case "flatElemental":
        score += a.value * 2;
        break;
      default:
        score += a.value * 0.9;
    }
  }
  return score;
}
