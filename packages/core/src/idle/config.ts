/**
 * Konfiguracja warstwy idle — `data/idle.json`. Wszystkie formuły z v4 §4
 * czytają wyłącznie stąd; żadna stała balansowa nie może wylądować w kodzie,
 * bo wtedy strojenie krzywych wymaga deploya zamiast edycji JSON-a.
 */
import { z } from "zod";

export const UpgradeDefSchema = z.object({
  id: z.enum([
    "damage",
    "attackSpeed",
    "critChance",
    "critMult",
    "goldFind",
    "areaDamage",
    "magicFind",
  ]),
  name: z.string(),
  desc: z.string(),
  /** `C₀` — koszt pierwszego poziomu. */
  c0: z.number().positive(),
  /** `r` — współczynnik wzrostu. Poza 1.07–1.15 krzywa przestaje działać (v4 §4.1). */
  r: z.number().min(1.01).max(1.5),
  /** Przyrost addytywny na poziom. */
  flat: z.number(),
  /** Przyrost multiplikatywny na poziom (składany). */
  mult: z.number(),
  /** Twardy sufit sumarycznego efektu; 0 = brak. */
  cap: z.number(),
  unlockZone: z.number().int().min(0),
});

export const ZonesSchema = z.object({
  /** `HP₀` we wzorze `HP(z) = HP₀ · z^p · b^z`. */
  hp0: z.number().positive(),
  polyExponent: z.number().positive(),
  expBase: z.number().min(1.01),
  killsPerZone: z.number().int().positive(),
  bossEvery: z.number().int().positive(),
  bossHpMult: z.number().positive(),
  goldPerKill0: z.number().positive(),
  goldPolyExponent: z.number().positive(),
  goldExpBase: z.number().min(1),
  bossGoldMult: z.number().positive(),
  /** Docelowe okno czyszczenia strefy w fazie aktywnej (v4 §4.2). */
  targetClearMin: z.number().positive(),
  targetClearMax: z.number().positive(),
  /** Powyżej tylu sekund w strefie pokazujemy sugestię buildu. */
  stuckSeconds: z.number().positive(),
  maxZone: z.number().int().positive(),
  materialsPerZone: z.number().min(0),
});

export const OfflineSchema = z.object({
  capHoursFree: z.number().positive(),
  capHoursSupporter: z.number().positive(),
  efficiencyFree: z.number().min(0).max(1),
  efficiencySupporter: z.number().min(0).max(1),
  /** Krótsza nieobecność nie zasługuje na osobny ekran. */
  minSecondsToShow: z.number().min(0),
  /** Karta w tle liczy się prawie pełną stawką — gracz nie wyszedł z gry. */
  backgroundEfficiency: z.number().min(0).max(1),
  itemsPerHundredKills: z.number().min(0),
});

export const PrestigeConfigSchema = z.object({
  /** `PP = floor(K · sqrt(złoto / T))` (v4 §4.3). */
  k: z.number().positive(),
  t: z.number().positive(),
  multPerPoint: z.number().min(0),
  unlockZone: z.number().int().positive(),
  minPointsToReset: z.number().int().min(1),
  ascension: z.object({
    unlockPrestiges: z.number().int().positive(),
    unlockLifetimePoints: z.number().positive(),
    sparkK: z.number().positive(),
    sparkT: z.number().positive(),
    multPerSpark: z.number().min(0),
  }),
});

export const IdleRaritySchema = z.object({
  id: z.enum(["common", "magic", "rare", "epic", "unique"]),
  name: z.string(),
  affixMin: z.number().int().min(0),
  affixMax: z.number().int().min(0),
  weight: z.number().min(0),
  color: z.string(),
  valueMult: z.number().positive(),
});

export const ItemsSchema = z.object({
  /** `wartość = base · (1 + 0.08·z) · roll(0.7, 1.0)` (v4 §4.6). */
  affixPerZone: z.number().min(0),
  rollMin: z.number().min(0).max(1),
  rollMax: z.number().min(0).max(1),
  dropChancePerKill: z.number().min(0).max(1),
  bossDropCount: z.number().int().min(0),
  rarities: z.array(IdleRaritySchema).min(1),
});

export const AutomationDefSchema = z.object({
  id: z.enum([
    "autoAttack",
    "autoPickup",
    "autoSalvage",
    "autoZone",
    "autoSkill",
    "autoEquip",
    "autoPrestige",
    "autoExpedition",
  ]),
  name: z.string(),
  desc: z.string(),
  unlockZone: z.number().int().min(0),
  unlockPrestige: z.number().int().min(0),
  eliminates: z.string(),
});

const MaterialBundleSchema = z.object({
  scrap: z.number().min(0),
  fragment: z.number().min(0),
  dust: z.number().min(0),
  essence: z.number().min(0),
});

export const ForgeSchema = z.object({
  maxUpgradeLevel: z.number().int().positive(),
  upgradeStatPerLevel: z.number().min(0),
  upgradeGold0: z.number().positive(),
  upgradeGoldR: z.number().min(1),
  upgradeScrap0: z.number().positive(),
  upgradeScrapR: z.number().min(1),
  rerollAffixesFragments: z.number().positive(),
  rerollValuesDust: z.number().positive(),
  /** Każdy kolejny reroll tego samego przedmiotu jest droższy — sink bez dna. */
  rerollCostGrowth: z.number().min(1),
  transferEssence: z.number().positive(),
  salvage: z.record(z.string(), MaterialBundleSchema),
});

export const IdleConfigSchema = z.object({
  version: z.number(),
  base: z.object({
    damage: z.number().positive(),
    attackSpeed: z.number().positive(),
    critChance: z.number().min(0).max(1),
    critChanceCap: z.number().min(0).max(1),
    critMult: z.number().min(1),
    areaDamage: z.number().min(0),
    goldFind: z.number().positive(),
    magicFind: z.number().positive(),
    /** Ilu wrogów naraz — wejście do wzoru na efektywny DPS czyszczenia. */
    packSize: z.number().positive(),
  }),
  upgrades: z.array(UpgradeDefSchema).min(1),
  zones: ZonesSchema,
  offline: OfflineSchema,
  prestige: PrestigeConfigSchema,
  items: ItemsSchema,
  automation: z.array(AutomationDefSchema).min(1),
  forge: ForgeSchema,
  supporter: z.object({
    priceLabel: z.string(),
    loadoutsFree: z.number().int().positive(),
    loadoutsSupporter: z.number().int().positive(),
    stashMultiplier: z.number().positive(),
  }),
});

export type IdleConfig = z.infer<typeof IdleConfigSchema>;
export type UpgradeDef = z.infer<typeof UpgradeDefSchema>;
export type ZonesConfig = z.infer<typeof ZonesSchema>;
export type OfflineConfig = z.infer<typeof OfflineSchema>;
export type PrestigeConfig = z.infer<typeof PrestigeConfigSchema>;
export type ItemsConfig = z.infer<typeof ItemsSchema>;
export type IdleRarityDef = z.infer<typeof IdleRaritySchema>;
export type AutomationDef = z.infer<typeof AutomationDefSchema>;
export type ForgeConfig = z.infer<typeof ForgeSchema>;

export function parseIdleConfig(raw: unknown): IdleConfig {
  return IdleConfigSchema.parse(raw);
}

/** Szybki dostęp do definicji ulepszenia bez przeszukiwania tablicy w pętli. */
export function upgradeMap(config: IdleConfig): Map<string, UpgradeDef> {
  const map = new Map<string, UpgradeDef>();
  for (const u of config.upgrades) map.set(u.id, u);
  return map;
}

export function automationMap(config: IdleConfig): Map<string, AutomationDef> {
  const map = new Map<string, AutomationDef>();
  for (const a of config.automation) map.set(a.id, a);
  return map;
}
