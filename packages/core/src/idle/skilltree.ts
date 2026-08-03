/**
 * Drzewko umiejętności (v4 §5.4) — ~60 węzłów, 3 gałęzie, 6 keystone'ów.
 *
 * Dwie reguły, które definiują ten system i nie podlegają negocjacji:
 *
 *  1. **Respec jest darmowy i natychmiastowy.** Kara za respec zabija
 *     eksperymentowanie, a eksperymentowanie jest tutaj głównym contentem:
 *     głębia gry jest generatywna (filar F3), więc każda bariera przed
 *     przebudową buildu wprost odejmuje graczowi godziny rozgrywki.
 *  2. **Keystone zmienia zasady, nie liczby.** Węzeł, który daje +15%
 *     obrażeń, jest wypełniaczem; węzeł, który zabiera krytyki w zamian za
 *     mnożnik, jest treścią, o której gracz napisze na Reddicie (filar F4).
 *
 * Punkty naliczamy z **rekordu głębokości** (`deepestZoneEver`), a nie
 * z licznika zabójstw — inaczej farmienie jednej strefy dawałoby punkty bez
 * końca i cała krzywa progresji przestałaby cokolwiek znaczyć.
 */
import { z } from "zod";
import raw from "../../../../data/skilltree.json" with { type: "json" };
import {
  emptyBonuses,
  failResult,
  okResult,
  type ActionResult,
  type IdleBonuses,
  type IdleState,
} from "./types.ts";

const EffectsSchema = z
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
  })
  .strict();

const SkillNodeSchema = z.object({
  id: z.string().min(1),
  branch: z.string().min(1),
  name: z.string().min(1),
  desc: z.string(),
  maxPoints: z.number().int().positive(),
  cost: z.number().int().positive(),
  requires: z.array(z.string()),
  /** Pierścień 0–4 i kąt 0–359 — z tego UI rysuje układ promienisty. */
  ring: z.number().int().min(0),
  angle: z.number().min(0).max(360),
  effects: EffectsSchema,
  keystone: z.boolean(),
});

const BranchSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tagline: z.string(),
  angleFrom: z.number(),
  angleTo: z.number(),
});

const SkillTreeSchema = z.object({
  version: z.number(),
  meta: z.object({
    /** 1 punkt co N stref rekordu. */
    pointsPerZones: z.number().int().positive(),
    pointsPerBoss: z.number().int().min(0),
    bossEvery: z.number().int().positive(),
    note: z.string().optional(),
  }),
  branches: z.array(BranchSchema).min(1),
  nodes: z.array(SkillNodeSchema).min(1),
});

export type SkillNode = z.infer<typeof SkillNodeSchema>;
export type SkillBranch = z.infer<typeof BranchSchema>;
export type SkillEffects = z.infer<typeof EffectsSchema>;

export interface SkillTree {
  version: number;
  meta: z.infer<typeof SkillTreeSchema>["meta"];
  branches: readonly SkillBranch[];
  nodes: readonly SkillNode[];
  get(id: string): SkillNode | undefined;
  ofBranch(branchId: string): readonly SkillNode[];
}

export function parseSkillTree(data: unknown): SkillTree {
  const parsed = SkillTreeSchema.parse(data);
  const byId = new Map(parsed.nodes.map((n) => [n.id, n]));

  // Sierota w `requires` to węzeł, do którego nigdy nie da się dojść — a taki
  // błąd w danych jest niewidoczny w grze aż do momentu, gdy gracz utknie
  // przed pustym miejscem w drzewku. Taniej wywalić się na starcie.
  for (const node of parsed.nodes) {
    for (const req of node.requires) {
      if (!byId.has(req)) {
        throw new Error(`[skilltree] węzeł ${node.id} wymaga nieistniejącego ${req}`);
      }
    }
  }

  return {
    version: parsed.version,
    meta: parsed.meta,
    branches: parsed.branches,
    nodes: parsed.nodes,
    get: (id) => byId.get(id),
    ofBranch: (branchId) => parsed.nodes.filter((n) => n.branch === branchId),
  };
}

let cached: SkillTree | null = null;

export function bundledSkillTree(): SkillTree {
  if (!cached) cached = parseSkillTree(raw);
  return cached;
}

// ──────────────────────────────────────────────────────────────── punkty

export function earnedPoints(state: IdleState, tree: SkillTree): number {
  const { pointsPerZones, pointsPerBoss, bossEvery } = tree.meta;
  const record = Math.max(1, state.deepestZoneEver);
  const fromZones = Math.floor(record / pointsPerZones);
  const fromBosses = Math.floor(record / bossEvery) * pointsPerBoss;
  return fromZones + fromBosses;
}

export function spentPoints(state: IdleState): number {
  let sum = 0;
  for (const v of Object.values(state.skills)) sum += Math.max(0, v);
  return sum;
}

/**
 * Wydane punkty liczymy jako `poziomy × koszt węzła`, więc keystone
 * (cost 3) faktycznie kosztuje trzy punkty, a nie jeden.
 */
export function spentCost(state: IdleState, tree: SkillTree): number {
  let sum = 0;
  for (const [id, levels] of Object.entries(state.skills)) {
    const node = tree.get(id);
    if (!node || levels <= 0) continue;
    sum += levels * node.cost;
  }
  return sum;
}

export function availablePoints(state: IdleState, tree: SkillTree): number {
  return Math.max(0, earnedPoints(state, tree) - spentCost(state, tree));
}

// ─────────────────────────────────────────────────────────────── alokacja

export function isReachable(state: IdleState, tree: SkillTree, nodeId: string): boolean {
  const node = tree.get(nodeId);
  if (!node) return false;
  for (const req of node.requires) {
    if ((state.skills[req] ?? 0) <= 0) return false;
  }
  return true;
}

export function canAllocate(state: IdleState, tree: SkillTree, nodeId: string): ActionResult {
  const node = tree.get(nodeId);
  if (!node) return failResult("Nie ma takiego węzła");

  const current = state.skills[nodeId] ?? 0;
  if (current >= node.maxPoints) return failResult(`${node.name} — maksimum osiągnięte`);

  for (const req of node.requires) {
    if ((state.skills[req] ?? 0) <= 0) {
      const reqNode = tree.get(req);
      return failResult(`Wymaga: ${reqNode?.name ?? req}`);
    }
  }

  if (availablePoints(state, tree) < node.cost) {
    return failResult(`Brakuje punktów — ${node.name} kosztuje ${node.cost}`);
  }
  return okResult("");
}

export function allocate(
  state: IdleState,
  tree: SkillTree,
  nodeId: string,
  count = 1,
): ActionResult<{ points: number }> {
  const node = tree.get(nodeId);
  if (!node) return failResult("Nie ma takiego węzła");

  let placed = 0;
  for (let i = 0; i < Math.max(1, Math.floor(count)); i++) {
    const check = canAllocate(state, tree, nodeId);
    if (!check.ok) {
      if (placed === 0) return failResult(check.message);
      break;
    }
    state.skills[nodeId] = (state.skills[nodeId] ?? 0) + 1;
    placed += 1;
  }

  const level = state.skills[nodeId] ?? 0;
  return okResult(
    node.keystone
      ? `${node.name} — keystone aktywny`
      : `${node.name} ${level}/${node.maxPoints}`,
    { points: placed },
  );
}

/**
 * Respec — **darmowy i natychmiastowy** (v4 §5.4). Nie ma tu waluty,
 * cooldownu ani potwierdzenia: każde tarcie w tym miejscu zmniejsza liczbę
 * buildów, które gracz przetestuje, a to jest dokładnie ten content,
 * na którym stoi cała gra.
 */
export function respec(state: IdleState): ActionResult<{ refunded: number }> {
  const refunded = spentPoints(state);
  if (refunded === 0) return failResult("Nie masz czego zresetować");
  state.skills = {};
  return okResult(`Zwrócono ${refunded} punktów`, { refunded });
}

// ──────────────────────────────────────────────────────────────── bonusy

export function skillBonuses(state: IdleState, tree: SkillTree): IdleBonuses {
  const out = emptyBonuses();

  for (const [id, levelsRaw] of Object.entries(state.skills)) {
    const node = tree.get(id);
    if (!node) continue;
    const levels = Math.min(Math.max(0, levelsRaw), node.maxPoints);
    if (levels <= 0) continue;

    const e = node.effects;
    out.flatDamage += (e.flatDamage ?? 0) * levels;
    out.increasedDamage += (e.increasedDamage ?? 0) * levels;
    out.attackSpeed += (e.attackSpeed ?? 0) * levels;
    out.critChance += (e.critChance ?? 0) * levels;
    out.critMult += (e.critMult ?? 0) * levels;
    out.areaDamage += (e.areaDamage ?? 0) * levels;
    out.goldFind += (e.goldFind ?? 0) * levels;
    out.magicFind += (e.magicFind ?? 0) * levels;
    out.offlineEfficiency += (e.offlineEfficiency ?? 0) * levels;
    out.offlineCapHours += (e.offlineCapHours ?? 0) * levels;

    // `more` jest multiplikatywne, więc każdy poziom wchodzi osobno.
    if (e.moreDamage !== undefined) {
      for (let i = 0; i < levels; i++) out.moreDamage.push(e.moreDamage);
    }

    if (node.keystone) out.keystones.push(node.id);
  }

  return out;
}

/** Aktywne keystone'y z nazwami — ekran postaci eksponuje je na wierzchu. */
export function activeKeystones(state: IdleState, tree: SkillTree): SkillNode[] {
  return tree.nodes.filter((n) => n.keystone && (state.skills[n.id] ?? 0) > 0);
}

/** Rozkład wydanych punktów po gałęziach — nagłówek „Rzeź 24 / Nawałnica 6". */
export function branchSpread(state: IdleState, tree: SkillTree): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of tree.branches) out[b.id] = 0;
  for (const [id, levels] of Object.entries(state.skills)) {
    const node = tree.get(id);
    if (!node || levels <= 0) continue;
    out[node.branch] = (out[node.branch] ?? 0) + levels * node.cost;
  }
  return out;
}
