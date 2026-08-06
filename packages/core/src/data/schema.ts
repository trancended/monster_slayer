/**
 * Schematy Zod dla /data/*.json — jedynego źródła prawdy balansu (stack §3).
 * Chronią przed uszkodzonym save'em i złym JSON-em z serwera; typy TS
 * są wyprowadzane ze schematów, więc nie mogą się rozjechać z danymi.
 */
import { z } from "zod";

const AttackShape = z.enum(["circle", "cone", "line"]);

export const ComboStepSchema = z.object({
  id: z.number(),
  damageMult: z.number(),
  duration: z.number(),
  cancelAt: z.number(),
  hitAt: z.number(),
  poiseDamage: z.number(),
  range: z.number(),
  arcDeg: z.number(),
  knockback: z.number(),
  staminaCost: z.number(),
  advance: z.number(),
});

export const HeavySchema = ComboStepSchema.omit({ id: true }).extend({
  chargeTime: z.number(),
  guaranteedStagger: z.boolean(),
});

export const DifficultySchema = z.object({
  label: z.string(),
  incomingDamage: z.number(),
  aiAggression: z.number(),
});

/**
 * Combo zabójstw — mnożnik nagród za utrzymanie tempa.
 *
 * Tiery są **progami zabójstw**, nie czasem: gracz ma widzieć, ile brakuje
 * do awansu, a nie zgadywać. Okno kurczy się z każdym tierem, więc utrzymanie
 * „Nieśmiertelnego" wymaga innej gry niż wejście w „Serię" — bez tego combo
 * byłoby darmowym mnożnikiem dla każdego, kto po prostu długo gra.
 */
export const KillComboTierSchema = z.object({
  /** Liczba zabójstw, od której tier obowiązuje. */
  at: z.number().int().positive(),
  name: z.string().min(1),
  mult: z.number().min(1),
  /** Kolor HUD-u — tier niesie też informację kolorem, ale nazwa jest wiodąca. */
  color: z.string(),
});

export const KillComboSchema = z.object({
  _note: z.string().optional(),
  /** Sekundy na kolejne zabójstwo w tierze 0. */
  window: z.number().positive(),
  /** Zmiana okna na tier (ujemna = kurczy się). */
  windowPerTier: z.number(),
  windowMin: z.number().positive(),
  /** Dodatek do szansy na łup za każdy tier — rośnie wolniej niż złoto. */
  dropChanceBonusPerTier: z.number().min(0),
  tiers: z.array(KillComboTierSchema).min(1),
});

export const CombatSchema = z.object({
  version: z.number(),
  player: z.object({
    maxHp: z.number(),
    /** Pasywna regeneracja HP na sekundę. 0 wyłącza. */
    hpRegen: z.number(),
    /** Ułamek max HP zabitego wroga zwracany graczowi jako leczenie. 0 wyłącza. */
    killHealPct: z.number(),
    /**
     * Sufit leczenia za zabójstwo jako mnożnik max HP — jedyne źródło, które
     * wychodzi ponad limit. 1 = brak overhealu, 0 = bez limitu.
     * Regeneracja, mikstury i kradzież życia nadal kończą się na max HP.
     */
    overhealCap: z.number(),
    maxStamina: z.number(),
    staminaRegen: z.number(),
    staminaRegenDelay: z.number(),
    maxPoise: z.number(),
    poiseRegen: z.number(),
    moveSpeed: z.number(),
    sprintMultiplier: z.number(),
    sprintStaminaPerSec: z.number(),
    radius: z.number(),
    mass: z.number(),
    baseArmor: z.number(),
    baseCritChance: z.number(),
    critChanceCap: z.number(),
    baseCritMult: z.number(),
    weapon: z.object({ min: z.number(), max: z.number() }),
    potions: z.object({ slots: z.number(), healPct: z.number(), healDuration: z.number() }),
    /** Sekundy nietykalności po odrodzeniu — arena nie jest czyszczona po śmierci. */
    respawnInvulnerable: z.number(),
  }),
  combo: z.array(ComboStepSchema).min(1),
  heavy: HeavySchema,
  comboWindow: z.number(),
  dodge: z.object({
    duration: z.number(),
    distance: z.number(),
    iFrameStart: z.number(),
    iFrameEnd: z.number(),
    recovery: z.number(),
    cooldown: z.number(),
    staminaCost: z.number(),
  }),
  stagger: z.object({ duration: z.number(), overflow: z.number() }),
  armor: z.object({ base: z.number(), perAttackerLevel: z.number(), cap: z.number() }),
  damageVariance: z.object({ min: z.number(), max: z.number() }),
  inputBufferSeconds: z.number(),
  gameFeel: z.object({
    hitstopNormal: z.number(),
    hitstopHeavy: z.number(),
    hitstopKill: z.number(),
    killSlowMoScale: z.number(),
    killSlowMoDuration: z.number(),
    hitFlashDuration: z.number(),
    shakeDecay: z.number(),
    shakeTraumaHit: z.number(),
    shakeTraumaHeavy: z.number(),
    shakeTraumaHurt: z.number(),
    shakeMaxAmplitudePx: z.number(),
    cameraKickPx: z.number(),
    cameraKickReturn: z.number(),
  }),
  difficulty: z.record(z.string(), DifficultySchema),
  limits: z.object({
    maxEnemies: z.number(),
    maxProjectiles: z.number(),
    attackTokens: z.number(),
  }),
  killCombo: KillComboSchema,
});

export const EnemyAttackSchema = z.object({
  kind: z.enum(["melee", "projectile", "explode", "charge", "combo"]),
  range: z.number(),
  telegraph: z.number(),
  active: z.number(),
  recovery: z.number(),
  cooldown: z.number(),
  poiseDamage: z.number(),
  knockback: z.number(),
  shape: AttackShape,
  arcDeg: z.number().optional(),
  radiusMeters: z.number().optional(),
  chargeSpeed: z.number().optional(),
  chargeDistance: z.number().optional(),
  hits: z.number().optional(),
  hitInterval: z.number().optional(),
  element: z.string().optional(),
  projectile: z
    .object({ speed: z.number(), radius: z.number(), lifetime: z.number() })
    .optional(),
});

export const EnemyDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  archetype: z.string(),
  hp: z.number(),
  damage: z.number(),
  poise: z.number(),
  armor: z.number(),
  xp: z.number(),
  gold: z.number(),
  radius: z.number(),
  mass: z.number(),
  moveSpeed: z.number(),
  color: z.number(),
  isBoss: z.boolean().optional(),
  breakBar: z.number().optional(),
  breakWindow: z.number().optional(),
  breakDamageBonus: z.number().optional(),
  attack: EnemyAttackSchema,
  traits: z.record(z.string(), z.unknown()).default({}),
  dropChance: z.number(),
  /**
   * Koszt budżetowy fali (`World.spawnCost`). Podaje się go **względem etapu**,
   * nie w HP: goblin ≈ 1, ork ≈ 4 i tak samo ich odpowiedniki w setnej rundzie.
   * Liczenie kosztu z absolutnego HP dawało pod koniec fale z jednym wrogiem,
   * bo HP potworów rośnie wykładniczo, a budżet fali liniowo.
   * Brak pola = koszt szacowany z HP i obrażeń (ręczny roster, stare dane).
   */
  cost: z.number().positive().optional(),
  /**
   * Zestaw ataku, z którego zbudowano bossa, wraz z jednozdaniową zapowiedzią
   * taktyczną. Dwa zestawy mogą dzielić parę (rodzaj, kształt) — „szerokie
   * cięcia" i „szybkie pchnięcia" to oba `combo` w stożku — więc bez tego pola
   * nie da się stwierdzić, czy kolejni bossowie naprawdę się różnią.
   */
  kit: z.string().optional(),
  tell: z.string().optional(),
  /**
   * Opis wyglądu dla warstwy graficznej. To **semantyka stworzenia**, nie
   * szczegół renderowania: „krępy, rogaty, z dwuręcznym mieczem" mówi to samo
   * w 2D, 3D i w opisie tekstowym. Klient tłumaczy to na bryły; rdzeń nadal
   * nie wie, że istnieje jakikolwiek renderer.
   *
   * Ręczny roster go nie ma — tam wygląd jest wpisany w `PLANS` po stronie
   * klienta. Pole wypełniają wyłącznie potwory generowane proceduralnie.
   */
  appearance: z
    .object({
      build: z.string(),
      head: z.string(),
      weapon: z.string(),
      shield: z.boolean().optional(),
      cape: z.boolean().optional(),
      accent: z.number(),
      scale: z.number().optional(),
    })
    .optional(),
});

export const EnemiesSchema = z.object({
  version: z.number(),
  archetypes: z.record(
    z.string(),
    z.object({ preferredRange: z.number(), circleWeight: z.number(), separation: z.number() }),
  ),
  perception: z.object({
    visionConeDeg: z.number(),
    visionRange: z.number(),
    hearingRange: z.number(),
    combatHearingRange: z.number(),
  }),
  roster: z.array(EnemyDefSchema).min(1),
  eliteModifiers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      color: z.number(),
      armorMult: z.number().optional(),
      hpRegenPct: z.number().optional(),
      poiseDamageMult: z.number().optional(),
      moveSpeedMult: z.number().optional(),
    }),
  ),
  elite: z.object({
    chancePerPack: z.number(),
    affixCountMin: z.number(),
    affixCountMax: z.number(),
    hpMult: z.number(),
    damageMult: z.number(),
    poiseMult: z.number(),
    xpMult: z.number(),
  }),
});

export const AffixDefSchema = z.object({
  id: z.string(),
  label: z.string(),
  stat: z.string(),
  min: z.number(),
  max: z.number(),
  perLevel: z.number(),
  pct: z.boolean().optional(),
  cap: z.number().optional(),
  slots: z.array(z.string()),
});

export const AffixesSchema = z.object({
  version: z.number(),
  rarities: z.array(
    z.object({
      id: z.enum(["common", "uncommon", "rare", "epic", "legendary"]),
      name: z.string(),
      color: z.number(),
      weight: z.number(),
      affixMin: z.number(),
      affixMax: z.number(),
      valueMult: z.number(),
    }),
  ),
  slots: z.array(
    z.object({ id: z.string(), name: z.string(), baseStat: z.string(), family: z.string().optional() }),
  ),
  baseItems: z.record(
    z.string(),
    z.object({
      name: z.string(),
      minDamage: z.number().optional(),
      maxDamage: z.number().optional(),
      armor: z.number().optional(),
      perLevel: z.number(),
    }),
  ),
  prefixes: z.array(AffixDefSchema),
  suffixes: z.array(AffixDefSchema),
  legendaries: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      slot: z.string(),
      modifier: z.string(),
      effect: z.record(z.string(), z.unknown()),
    }),
  ),
  drops: z.object({
    goldChanceOnKill: z.number(),
    potionChance: z.number(),
    pity: z.object({ startAfterKills: z.number(), guaranteedAtKills: z.number() }),
    eliteGuaranteedRarity: z.string(),
    minibossItems: z.number(),
    minibossMinRarity: z.string(),
  }),
});

export const ProgressionSchema = z.object({
  version: z.number(),
  xpCurve: z.object({ base: z.number(), exponent: z.number() }),
  maxLevel: z.number(),
  perLevel: z.object({
    attributePoints: z.number(),
    skillPoints: z.number(),
    skillPointsHalvedAfterLevel: z.number(),
    maxHp: z.number(),
    baseDamagePct: z.number(),
  }),
  attributes: z.record(z.string(), z.record(z.string(), z.union([z.string(), z.number()]))),
  death: z.object({ goldLossPct: z.number() }),
  zoneScaling: z.object({
    hpPerLevel: z.number(),
    damagePerLevel: z.number(),
    xpPerLevel: z.number(),
  }),
});

/** Komplet definicji balansu — dokładnie to, co Phoenix serwuje z ETagiem. */
export const BalanceSchema = z.object({
  combat: CombatSchema,
  enemies: EnemiesSchema,
  affixes: AffixesSchema,
  progression: ProgressionSchema,
});

export type Balance = z.infer<typeof BalanceSchema>;
export type CombatData = z.infer<typeof CombatSchema>;
export type EnemiesData = z.infer<typeof EnemiesSchema>;
export type EnemyDef = z.infer<typeof EnemyDefSchema>;
export type EnemyAttack = z.infer<typeof EnemyAttackSchema>;
export type AffixesData = z.infer<typeof AffixesSchema>;
export type AffixDef = z.infer<typeof AffixDefSchema>;
export type ProgressionData = z.infer<typeof ProgressionSchema>;
export type ComboStep = z.infer<typeof ComboStepSchema>;
export type DifficultyDef = z.infer<typeof DifficultySchema>;
export type KillComboData = z.infer<typeof KillComboSchema>;
export type KillComboTier = z.infer<typeof KillComboTierSchema>;
