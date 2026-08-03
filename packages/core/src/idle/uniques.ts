/**
 * Unikaty (v4 §4.6) — najrzadszy tier łupu i jedyny, który **zmienia zasady**.
 *
 * Różnica między unikatem a epikiem nie polega na tym, że unikat ma większe
 * liczby. Polega na tym, że unikat zmusza do przebudowania buildu: „nie możesz
 * trafiać krytycznie", „nie zadajesz obrażeń obszarowych", „działa tylko wtedy,
 * kiedy cię nie ma". To jest tier, o którym gracz pisze na Reddicie (filar F4),
 * a nie ten, który po prostu zakłada.
 *
 * Efekty warunkowe (`keystone`) nie mieszczą się w płaskim `IdleBonuses` —
 * ich reguły rozstrzyga silnik, który tę listę czyta. Tutaj są tylko deklaracje.
 */
import { z } from "zod";
import raw from "../../../../data/uniques.json" with { type: "json" };
import { IDLE_SLOTS, emptyBonuses, type IdleBonuses, type IdleItem, type IdleSlot } from "./types.ts";
import type { Rng } from "../core/rng.ts";

const UniqueEffectsSchema = z
  .object({
    flatDamage: z.number().optional(),
    increasedDamage: z.number().optional(),
    moreDamage: z.number().optional(),
    attackSpeed: z.number().optional(),
    critChance: z.number().optional(),
    critMult: z.number().optional(),
    areaDamage: z.number().optional(),
    goldFind: z.number().optional(),
    magicFind: z.number().optional(),
    offlineEfficiency: z.number().optional(),
    offlineCapHours: z.number().optional(),
    /** Identyfikator reguły warunkowej rozstrzyganej przez silnik. */
    keystone: z.string().optional(),
  })
  .strict();

const UniqueDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slot: z.enum([...IDLE_SLOTS] as [IdleSlot, ...IdleSlot[]]),
  flavor: z.string(),
  modifier: z.string().min(1),
  effects: UniqueEffectsSchema,
});

const UniquesFileSchema = z.object({
  version: z.number(),
  note: z.string().optional(),
  uniques: z.array(UniqueDefSchema).min(1),
});

export type UniqueDef = z.infer<typeof UniqueDefSchema>;

export interface UniqueIndex {
  get(id: string): UniqueDef | undefined;
  all(): readonly UniqueDef[];
  forSlot(slot: IdleSlot): readonly UniqueDef[];
}

export function parseUniques(data: unknown): UniqueIndex {
  const parsed = UniquesFileSchema.parse(data);
  const byId = new Map(parsed.uniques.map((u) => [u.id, u]));
  return {
    get: (id) => byId.get(id),
    all: () => parsed.uniques,
    forSlot: (slot) => parsed.uniques.filter((u) => u.slot === slot),
  };
}

let cached: UniqueIndex | null = null;

export function bundledUniques(): UniqueIndex {
  if (!cached) cached = parseUniques(raw);
  return cached;
}

/**
 * Bonusy unikatu. Skalowanie strefą **nie dotyczy** unikatów: ich wartość leży
 * w regule, nie w liczbie, więc unikat ze strefy 12 pozostaje użyteczny
 * w strefie 300 — i to jest cel, a nie niedopatrzenie.
 */
export function uniqueBonuses(def: UniqueDef): IdleBonuses {
  const out = emptyBonuses();
  const e = def.effects;
  out.flatDamage += e.flatDamage ?? 0;
  out.increasedDamage += e.increasedDamage ?? 0;
  out.attackSpeed += e.attackSpeed ?? 0;
  out.critChance += e.critChance ?? 0;
  out.critMult += e.critMult ?? 0;
  out.areaDamage += e.areaDamage ?? 0;
  out.goldFind += e.goldFind ?? 0;
  out.magicFind += e.magicFind ?? 0;
  out.offlineEfficiency += e.offlineEfficiency ?? 0;
  out.offlineCapHours += e.offlineCapHours ?? 0;
  if (e.moreDamage !== undefined) out.moreDamage.push(e.moreDamage);
  if (e.keystone !== undefined) out.keystones.push(e.keystone);
  return out;
}

/** Losuje unikat — bez afiksów, bo cały jego sens to stały, znany zestaw reguł. */
export function rollUnique(
  rng: Rng,
  zone: number,
  index: UniqueIndex,
  slot?: IdleSlot,
): IdleItem {
  const pool = slot ? index.forSlot(slot) : index.all();
  const def = pool.length > 0 ? rng.pick(pool) : rng.pick(index.all());

  return {
    id: `uq_${def.id}_${rng.int(0, 0xffffff).toString(36)}`,
    baseId: def.id,
    name: def.name,
    slot: def.slot,
    rarity: "unique",
    zone: Math.max(1, Math.floor(zone)),
    affixes: [],
    // Unikat nie ma rolli, więc jakość jest z definicji pełna — inaczej UI
    // pokazywałoby „0%" na przedmiocie, którego nie da się ulepszyć rerollem.
    quality: 1,
    upgradeLevel: 0,
    uniqueId: def.id,
    rerolls: 0,
  };
}

/** Czy przedmiot jest unikatem — jedno miejsce na tę regułę, nie pięć. */
export function isUnique(item: IdleItem): boolean {
  return item.rarity === "unique" || item.uniqueId !== undefined;
}
