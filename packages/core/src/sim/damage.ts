/**
 * Formuły obrażeń — dokładnie GDD §5.4.
 * Ten sam kod napędza grę i symulator balansu (stack §4), więc żadna
 * wartość nie może być tu zaszyta na sztywno poza danymi z /data.
 */
import type { Rng } from "../core/rng.ts";
import type { CombatData } from "../data/schema.ts";
import { clamp } from "../core/math.ts";

export interface AttackContext {
  minDamage: number;
  maxDamage: number;
  skillMult: number;
  /** Σ afiksy_%dmg + bonus z Siły, jako ułamek (0.25 = +25%). */
  increasedDamage: number;
  critChance: number;
  critMult: number;
  attackerLevel: number;
  flatElemental: number;
  /** Odporność celu na żywioł, −0.5 … 0.75. */
  element: string;
}

export interface DamageResult {
  amount: number;
  crit: boolean;
  mitigatedByArmor: number;
}

/** redukcja_pancerza = pancerz / (pancerz + 60 + 12 × poziom_atakującego), cap 75% */
export function armorReduction(armor: number, attackerLevel: number, combat: CombatData): number {
  const denom = armor + combat.armor.base + combat.armor.perAttackerLevel * attackerLevel;
  if (denom <= 0) return 0;
  return clamp(armor / denom, 0, combat.armor.cap);
}

export function computeDamage(
  ctx: AttackContext,
  targetArmor: number,
  targetResist: number,
  rng: Rng,
  combat: CombatData,
): DamageResult {
  const base = rng.range(ctx.minDamage, ctx.maxDamage) * ctx.skillMult;
  const elemental = ctx.flatElemental * ctx.skillMult;

  const afterAttributes = (base + elemental) * (1 + ctx.increasedDamage);

  const reduction = armorReduction(targetArmor, ctx.attackerLevel, combat);
  const crit = rng.next() < ctx.critChance;

  // Odporności żywiołowe: −50% (podatność) … +75% (odporność), cap twardy.
  const resist = clamp(targetResist, -0.5, 0.75);
  const elementMult = ctx.element === "physical" ? 1 : 1 - resist;

  const variance = rng.range(combat.damageVariance.min, combat.damageVariance.max);

  const final =
    afterAttributes * (1 - reduction) * (crit ? ctx.critMult : 1) * elementMult * variance;

  return {
    amount: Math.max(1, final),
    crit,
    mitigatedByArmor: reduction,
  };
}
