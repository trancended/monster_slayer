/**
 * Publiczne wejście do warstwy idle (plan v4). Klient i symulator importują
 * wyłącznie stąd — dzięki temu przeniesienie pliku wewnątrz `idle/` nie jest
 * zmianą łamiącą.
 */

// — kontrakt danych
export * from "./types.ts";
export {
  IdleConfigSchema,
  parseIdleConfig,
  upgradeMap,
  automationMap,
  type AutomationDef,
  type ForgeConfig,
  type IdleConfig,
  type IdleRarityDef,
  type ItemsConfig,
  type OfflineConfig,
  type PrestigeConfig,
  type UpgradeDef,
  type ZonesConfig,
} from "./config.ts";
export { bundledIdleConfig, bundledIdleRaw } from "./bundled.ts";
export {
  IDLE_STATE_VERSION,
  createIdleState,
  defaultLootFilter,
  deserializeIdleState,
  monotonicGuard,
  offlineCapSeconds,
  offlineEfficiency,
  serializeIdleState,
} from "./state.ts";

// — krzywe i ekonomia
export {
  affixValue,
  affordableLevels,
  bossHp,
  costAt,
  costRange,
  goldPerKill,
  isBossZone,
  killsRequired,
  zoneClearSeconds,
  zoneGold,
  zoneHp,
  zoneTotalHp,
} from "./curves.ts";
export {
  buyUpgrade,
  canAfford,
  emptyUpgradeEffects,
  isUpgradeUnlocked,
  maxAffordable,
  upgradeCost,
  upgradeEffects,
  upgradeLevel,
  type UpgradeEffects,
} from "./upgrades.ts";
export { computeRates, effectiveDamage } from "./rates.ts";
export {
  registerKills,
  setZone,
  tryAdvanceZone,
  zoneMilestones,
  zoneStatus,
  type ZoneStatus,
} from "./zones.ts";

// — offline, tło, diagnoza
export {
  applyOffline,
  computeOffline,
  offlineGoldRate,
  totalMaterials,
  walkZones,
  wastedSeconds,
  type ZoneWalk,
} from "./offline.ts";
export { diagnose, isActionable } from "./diagnosis.ts";
export {
  FlagCounter,
  tickBackground,
  validateProgressReport,
  type BackgroundTick,
  type ProgressReport,
  type ReportVerdict,
} from "./background.ts";

// — przedmioty i kuźnia
export {
  DEFAULT_ITEM_WEIGHTS,
  affixText,
  bundledAffixPool,
  equipmentBonuses,
  isUpgradeOver,
  itemBonuses,
  itemLabel,
  itemQuality,
  itemScore,
  parseAffixPool,
  rollAffixes,
  rollItem,
  rollRarity,
  upgradeMultiplier,
  type AffixDef,
  type AffixPool,
  type RollOptions,
} from "./items.ts";
export {
  bundledUniques,
  isUnique,
  parseUniques,
  rollUnique,
  uniqueBonuses,
  type UniqueDef,
  type UniqueIndex,
} from "./uniques.ts";
export {
  rerollAffixes,
  rerollAffixesCost,
  rerollValues,
  rerollValuesCost,
  salvage,
  salvageYield,
  transferUnique,
  upgradeItem,
  upgradeToMaxCost,
  upgradeCost as forgeUpgradeCost,
  type UpgradeCost,
} from "./forge.ts";
export {
  autoEquip,
  equipItem,
  evaluate as evaluateFilter,
  previewFilter,
  sellValue,
  sweepStash,
  unequipItem,
  type FilterVerdict,
  type SweepResult,
} from "./filter.ts";

// — drzewka i prestiż
export {
  activeKeystones,
  allocate as allocateSkill,
  availablePoints as availableSkillPoints,
  branchSpread,
  bundledSkillTree,
  canAllocate as canAllocateSkill,
  earnedPoints as earnedSkillPoints,
  isReachable as isSkillReachable,
  parseSkillTree,
  respec,
  skillBonuses,
  spentCost as spentSkillCost,
  type SkillBranch,
  type SkillNode,
  type SkillTree,
} from "./skilltree.ts";
export {
  allocatePrestige,
  ascensionSparks,
  availablePrestigePoints,
  availableSparks,
  bundledPrestigeTree,
  canAscend,
  canPrestige,
  doAscend,
  doPrestige,
  estimateReturnRatio,
  goldToNextPoint,
  parsePrestigeTree,
  prestigeBonuses,
  prestigeGain,
  prestigeMultiplier,
  prestigePoints,
  respecPrestige,
  type PrestigeNode,
  type PrestigeTree,
} from "./prestige.ts";

// — meta i wiralność
export {
  BUILD_CODE_PREFIX,
  BUILD_PAYLOAD_VERSION,
  applyBuild,
  buildPayload,
  decodeBuild,
  encodeBuild,
  encodePayload,
  planApply,
  type ApplyPlan,
  type BuildAffix,
  type BuildItem,
  type BuildPayload,
} from "./buildcode.ts";
export {
  BESTIARY_TIERS,
  bestiaryAverageBonus,
  bestiaryBonuses,
  bestiaryEntries,
  bestiaryProgress,
  bundledBestiary,
  recordKill,
  tierFor,
  type BestiaryEntry,
  type BestiaryTier,
} from "./bestiary.ts";
export {
  abandonChallenge,
  activeRestriction,
  applyRestriction,
  availableChallenges,
  bonusLoadouts,
  bundledChallenges,
  challengeById,
  challengeBonuses,
  challengeProgress,
  checkCompletion,
  goalProgress,
  parseChallenges,
  remainingSeconds,
  startChallenge,
  type Challenge,
  type Restriction,
} from "./challenges.ts";
export {
  StuckThrottle,
  buildCodeApplied,
  buildCodeCopied,
  churnLastAction,
  describeEvent,
  firstUpgrade,
  idleUnlocked,
  offlineReturn,
  prestige as prestigeEvent,
  purchase,
  sessionEnd,
  sessionStart,
  shouldEmitZoneStuck,
  zoneStuck,
  type IdleEvent,
  type IdleEventType,
} from "./telemetry.ts";

// — fasada
export { IdleEngine, type IdleEngineOptions, type IdleMode } from "./engine.ts";
