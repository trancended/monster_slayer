export { Rng, RngStreams } from "./core/rng.ts";
export * from "./core/bignum.ts";
export * as idle from "./idle/index.ts";
export { EventBus, bus, type GameEvents } from "./core/bus.ts";
export { FIXED_DT, TICK_RATE, MAX_TICKS_PER_FRAME, type LoopStats } from "./core/loop.ts";
export { SpatialHash } from "./core/spatial.ts";
export * from "./core/math.ts";

export { StatSheet, type StatKey } from "./domain/stats.ts";
export {
  affixText,
  itemScore,
  type Equipment,
  type Item,
  type ItemAffix,
  type ItemRarityId,
} from "./domain/item.ts";
export {
  ATTRIBUTE_KEYS,
  createCharacter,
  deriveStats,
  normalizeCharacter,
  totalXpForLevel,
  xpToNext,
  type Attributes,
  type CharacterState,
  type DerivedStats,
} from "./domain/character.ts";

export {
  BalanceSchema,
  type Balance,
  type CombatData,
  type EnemiesData,
  type EnemyDef,
  type EnemyAttack,
  type AffixesData,
  type ProgressionData,
  type ComboStep,
  type DifficultyDef,
  type KillComboData,
  type KillComboTier,
} from "./data/schema.ts";
export { bundledBalance, bundledRaw } from "./data/bundled.ts";

export {
  EntityStore,
  EState,
  Flag,
  Kind,
  MAX_ENTITIES,
  PState,
  type KindValue,
} from "./sim/entities.ts";
export { armorReduction, computeDamage, type AttackContext, type DamageResult } from "./sim/damage.ts";
export { KillCombo, multiplierFor, type ComboSnapshot } from "./sim/combo.ts";
export { LootGenerator, type DropResult } from "./sim/loot.ts";

/**
 * Kowal: reguły przekuwania zbędnego wyposażenia w legendę. Wystawione w całości,
 * bo interfejs musi pokazywać wycenę i podpowiedzi („30 zwykłych albo 10 epickich"),
 * a nie tylko wołać akcję na ślepo.
 */
export {
  FORGE_CORE_COST,
  FORGE_JUNK_RARITIES,
  FORGE_POWER,
  FORGE_TARGET_POWER,
  forgePower,
  forgeQuote,
  itemsNeeded,
  type ForgeQuote,
} from "./sim/smith.ts";
export {
  ARENA_RADIUS,
  Buffered,
  MAX_ZONE_LEVEL,
  World,
  zoneLevelFor,
  type EncounterState,
  type Obstacle,
  type PickupPayload,
  type PlayerIntent,
} from "./sim/world.ts";

/**
 * Areny: biomy i losowe przeszkody. Renderer potrzebuje `BiomeDef` i `Obstacle`,
 * żeby zbudować kadr — paleta i rodzaj roślinności to opis miejsca, nie zestaw
 * poleceń graficznych (ta sama zasada, co przy `EnemyDef.appearance`).
 */
export {
  BIOMES,
  ROUNDS_PER_BIOME,
  biomeForRound,
  generateArena,
  type ArenaLayout,
  type BackdropKind,
  type BiomeDef,
  type PropKind,
  type SkyBody,
} from "./sim/arena.ts";

/**
 * Proceduralny bestiariusz. `traitLabels` wychodzi na zewnątrz, bo HUD musi
 * nazwać atrybuty bossa po polsku — nazwy mieszkają przy generatorze, żeby
 * dodanie atrybutu było jedną zmianą, a nie dwiema rozjeżdżającymi się listami.
 */
export {
  generateBestiary,
  traitLabels,
  speciesNameFor,
  speciesTemplateFor,
  speciesStageForBossTier,
  BOSSES_PER_SPECIES,
  GENERATED_TRAITS,
  MAX_BOSS_TIERS,
  MAX_SPECIES,
  ROUNDS_PER_SPECIES,
  UNITS_PER_SPECIES,
  UNIT_ARCHETYPES,
  UNLOCKS_PER_BOSS,
  type Bestiary,
  type GeneratedTrait,
  type SpeciesTemplate,
  type UnitArchetype,
} from "./sim/enemygen.ts";
