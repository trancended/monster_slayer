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
export {
  ARENA_RADIUS,
  Buffered,
  World,
  type EncounterState,
  type Obstacle,
  type PickupPayload,
  type PlayerIntent,
} from "./sim/world.ts";

/**
 * Proceduralny bestiariusz. `traitLabels` wychodzi na zewnątrz, bo HUD musi
 * nazwać atrybuty bossa po polsku — nazwy mieszkają przy generatorze, żeby
 * dodanie atrybutu było jedną zmianą, a nie dwiema rozjeżdżającymi się listami.
 */
export {
  generateBestiary,
  traitLabels,
  GENERATED_TRAITS,
  MAX_BOSS_TIERS,
  UNLOCKS_PER_BOSS,
  type Bestiary,
  type GeneratedTrait,
} from "./sim/enemygen.ts";
