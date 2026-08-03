import type { Balance } from "../data/schema.ts";
import { StatSheet } from "./stats.ts";
import type { Equipment, Item } from "./item.ts";
import { clamp } from "../core/math.ts";

export interface Attributes {
  strength: number;
  dexterity: number;
  vitality: number;
  will: number;
}

export const ATTRIBUTE_KEYS: (keyof Attributes)[] = ["strength", "dexterity", "vitality", "will"];

export interface CharacterState {
  level: number;
  xp: number;
  attributes: Attributes;
  attributePoints: number;
  skillPoints: number;
  gold: number;
  potions: number;
  equipment: Equipment;
  inventory: Item[];
  killsWithoutDrop: number;
  totalKills: number;
  /**
   * Ilu bossów gracz pokonał. Steruje pulą wrogów: każdy pokonany boss
   * dokłada nowe typy jednostek. Trzymane w postaci, bo ma przetrwać zapis —
   * sam bestiariusz odtwarza się z ziarna i niczego nie zajmuje.
   */
  bossesDefeated: number;
}

export interface DerivedStats {
  maxHp: number;
  maxStamina: number;
  maxPoise: number;
  armor: number;
  moveSpeed: number;
  attackSpeed: number;
  critChance: number;
  critMult: number;
  lifesteal: number;
  cooldownReduction: number;
  elementalResist: number;
  weaponMin: number;
  weaponMax: number;
  increasedDamage: number;
  flatElemental: number;
}

export function createCharacter(balance: Balance): CharacterState {
  return {
    level: 1,
    xp: 0,
    attributes: { strength: 5, dexterity: 5, vitality: 5, will: 5 },
    attributePoints: 0,
    skillPoints: 0,
    gold: 0,
    potions: balance.combat.player.potions.slots,
    equipment: {},
    inventory: [],
    killsWithoutDrop: 0,
    totalKills: 0,
    bossesDefeated: 0,
  };
}

/** XP_do_następnego(n) = round(100 × n^1.35) — GDD §6.1 */
export function xpToNext(level: number, balance: Balance): number {
  const { base, exponent } = balance.progression.xpCurve;
  return Math.round(base * Math.pow(level, exponent));
}

export function totalXpForLevel(level: number, balance: Balance): number {
  let sum = 0;
  for (let n = 1; n < level; n++) sum += xpToNext(n, balance);
  return sum;
}

/**
 * Pełne przeliczenie statystyk: baza → poziom → atrybuty → ekwipunek.
 * Wywoływane przy każdej zmianie stanu postaci, nigdy w pętli walki.
 */
export function deriveStats(ch: CharacterState, balance: Balance): DerivedStats {
  const p = balance.combat.player;
  const prog = balance.progression;
  const attr = prog.attributes;
  const sheet = new StatSheet();

  const num = (group: string, key: string, fallback = 0): number => {
    const g = attr[group];
    const v = g?.[key];
    return typeof v === "number" ? v : fallback;
  };

  // — bonusy z poziomu (GDD §6.2: poziom „coś daje" nawet bez wydania punktów)
  const levelsGained = ch.level - 1;
  sheet.addFlat("maxHp", prog.perLevel.maxHp * levelsGained);
  sheet.addIncreased("increasedDamage", prog.perLevel.baseDamagePct * levelsGained);

  // — atrybuty (GDD §6.3)
  const a = ch.attributes;
  sheet.addIncreased("increasedDamage", a.strength * num("strength", "physDamagePctPerPoint"));
  sheet.addFlat("poise", a.strength * num("strength", "poisePerPoint"));

  sheet.addIncreased("attackSpeed", a.dexterity * num("dexterity", "attackSpeedPctPerPoint"));
  sheet.addFlat("critChance", a.dexterity * num("dexterity", "critChancePerPoint"));
  sheet.addIncreased("moveSpeed", a.dexterity * num("dexterity", "moveSpeedPctPerPoint"));

  sheet.addFlat("maxHp", a.vitality * num("vitality", "maxHpPerPoint"));
  sheet.addFlat("maxStamina", a.vitality * num("vitality", "maxStaminaPerPoint"));
  sheet.addFlat("armor", a.vitality * num("vitality", "armorPerPoint"));

  sheet.addFlat("cooldownReduction", a.will * num("will", "cooldownReductionPerPoint"));

  // — ekwipunek
  let weaponMin = p.weapon.min;
  let weaponMax = p.weapon.max;
  let greedHpPenalty = 0;

  for (const item of Object.values(ch.equipment)) {
    if (!item) continue;
    if (item.minDamage > 0) {
      weaponMin = item.minDamage;
      weaponMax = item.maxDamage;
    }
    sheet.addFlat("armor", item.armor);

    for (const af of item.affixes) {
      const key = af.stat as Parameters<StatSheet["addFlat"]>[0];
      // Afiksy procentowe trzymamy w danych jako liczby 0–100.
      switch (af.stat) {
        case "increasedDamage":
        case "attackSpeed":
        case "moveSpeed":
        case "critDamage":
          sheet.addIncreased(key, af.value / 100);
          break;
        case "critChance":
        case "lifesteal":
        case "cooldownReduction":
        case "elementalResist":
          sheet.addFlat(key, af.value / 100);
          break;
        default:
          sheet.addFlat(key, af.value);
      }
    }

    if (item.legendaryId === "signet_of_greed") greedHpPenalty += 0.2;
  }

  const dexCap = num("dexterity", "moveSpeedCap", 0.25);
  const cdrCap = num("will", "cooldownReductionCap", 0.4);

  // Prefiks „+X obrażeń fizycznych" dokłada się do zakresu broni, a nie do
  // osobnego wiadra — inaczej afiks nie robiłby nic.
  const flatPhys = sheet.get("flatDamage", 0);
  weaponMin += flatPhys;
  weaponMax += flatPhys;

  return {
    maxHp: Math.round(sheet.get("maxHp", p.maxHp) * (1 - greedHpPenalty)),
    maxStamina: Math.round(sheet.get("maxStamina", p.maxStamina)),
    maxPoise: Math.round(sheet.get("poise", p.maxPoise)),
    armor: sheet.get("armor", p.baseArmor),
    // Cap zbiorczy: +25% ze Zręczności (§6.3) + do +15% z przedmiotów (§8.3).
    moveSpeed: p.moveSpeed * (1 + clamp(sheet.get("moveSpeed", 1) - 1, 0, dexCap + 0.15)),
    attackSpeed: 1 + clamp(sheet.get("attackSpeed", 1) - 1, 0, 0.6),
    critChance: clamp(p.baseCritChance + sheet.get("critChance", 0), 0, p.critChanceCap),
    critMult: p.baseCritMult + clamp(sheet.get("critDamage", 1) - 1, 0, 5),
    lifesteal: clamp(sheet.get("lifesteal", 0), 0, 0.08),
    cooldownReduction: clamp(sheet.get("cooldownReduction", 0), 0, cdrCap),
    elementalResist: clamp(sheet.get("elementalResist", 0), -0.5, 0.75),
    weaponMin,
    weaponMax,
    increasedDamage: sheet.get("increasedDamage", 1) - 1,
    flatElemental: sheet.get("flatElemental", 0),
  };
}
