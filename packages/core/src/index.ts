export { Rng, RngStreams } from "./core/rng.ts";
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
