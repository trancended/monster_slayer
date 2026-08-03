/**
 * Wyzwania (v4 §5.5) — runy z ograniczeniem, dające trwały bonus.
 *
 * „Wyzwania to najtańszy content w grze: zero nowych assetów, dziesiątki
 * godzin rozgrywki." Cała mechanika sprowadza się do trzech rzeczy:
 * ograniczenie, cel, trwała nagroda.
 *
 * Twarde wymaganie bezpieczeństwa: **wejście w wyzwanie robi migawkę stanu**,
 * a wyjście ją przywraca. Wyzwanie, które kasuje postęp, to wipe — a wipe
 * kosztuje zaufanie raz i nieodwracalnie (v4 §12).
 */
import { z } from "zod";
import raw from "../../../../data/challenges.json" with { type: "json" };
import { deserializeIdleState, serializeIdleState } from "./state.ts";
import {
  IDLE_SLOTS,
  UPGRADE_IDS,
  emptyBonuses,
  failResult,
  okResult,
  type ActionResult,
  type IdleBonuses,
  type IdleState,
} from "./types.ts";

const RestrictionSchema = z.object({
  kind: z.enum([
    "noEquipment",
    "noUpgrades",
    "singleSkillBranch",
    "noCrit",
    "noAreaDamage",
    "timeLimit",
    "goldCap",
    "noPrestige",
    "weaponOnly",
    "fixedZone",
    "noKeystones",
  ]),
  value: z.number().optional(),
});

const GoalSchema = z.object({
  kind: z.enum(["reachZone", "totalKills"]),
  value: z.number().positive(),
});

const RewardSchema = z
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
    unlockKeystone: z.string().optional(),
    unlockLoadout: z.number().optional(),
  })
  .strict();

const ChallengeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  desc: z.string().min(1),
  restriction: RestrictionSchema,
  goal: GoalSchema,
  reward: RewardSchema,
  rewardText: z.string().min(1),
  unlockZone: z.number().int().min(0),
});

const ChallengesFileSchema = z.object({
  version: z.number(),
  note: z.string().optional(),
  challenges: z.array(ChallengeSchema).min(1),
});

export type Challenge = z.infer<typeof ChallengeSchema>;
export type Restriction = z.infer<typeof RestrictionSchema>;

export function parseChallenges(data: unknown): readonly Challenge[] {
  return ChallengesFileSchema.parse(data).challenges;
}

let cached: readonly Challenge[] | null = null;

export function bundledChallenges(): readonly Challenge[] {
  if (!cached) cached = parseChallenges(raw);
  return cached;
}

export function challengeById(id: string): Challenge | undefined {
  return bundledChallenges().find((c) => c.id === id);
}

/** Odblokowane rekordem głębokości i jeszcze nieukończone. */
export function availableChallenges(state: IdleState): Challenge[] {
  return bundledChallenges().filter(
    (c) => state.deepestZoneEver >= c.unlockZone && !state.challenges.completed.includes(c.id),
  );
}

// ─────────────────────────────────────────────────────────── wejście i wyjście

/**
 * Start wyzwania. Migawka stanu idzie do `challenges.snapshot` — to jest
 * jedyny powód, dla którego można bezpiecznie zerować postęp gracza.
 *
 * Reset dotyczy tylko warstwy biegu (złoto, ulepszenia, strefa). Skrytka,
 * kodeks, bestiariusz i PP zostają — wyzwanie ma być ograniczeniem, nie karą.
 */
export function startChallenge(
  state: IdleState,
  id: string,
  now: number,
): ActionResult<{ challenge: Challenge }> {
  if (state.challenges.activeId !== null) {
    const active = challengeById(state.challenges.activeId);
    return failResult(`Trwa już wyzwanie: ${active?.name ?? state.challenges.activeId}`);
  }

  const challenge = challengeById(id);
  if (!challenge) return failResult("Nie ma takiego wyzwania");
  if (state.challenges.completed.includes(id)) return failResult("To wyzwanie jest ukończone");
  if (state.deepestZoneEver < challenge.unlockZone) {
    return failResult(`Wymaga rekordu strefy ${challenge.unlockZone}`);
  }

  state.challenges.snapshot = JSON.stringify(serializeIdleState(state));
  state.challenges.activeId = id;
  state.challenges.startedAt = now;

  applyRestrictionReset(state, challenge.restriction);

  return okResult(`Wyzwanie: ${challenge.name}`, { challenge });
}

/**
 * Zerowanie wymuszone przez ograniczenie. Świadomie minimalne: wyzwanie ma
 * zmieniać reguły, a nie odbierać wszystko — im mniej kasujemy, tym mniej
 * gracz ma powodów, żeby w wyzwanie nigdy nie wejść.
 */
function applyRestrictionReset(state: IdleState, restriction: Restriction): void {
  state.zone = 1;
  state.zoneProgress = 0;
  state.zoneTimer = 0;
  state.deepestZone = 1;
  state.gold = deserializeIdleState({}).gold;
  state.goldThisRun = state.gold;

  if (restriction.kind === "noUpgrades") {
    for (const id of UPGRADE_IDS) state.upgrades[id] = 0;
  }

  if (restriction.kind === "noEquipment") {
    for (const slot of IDLE_SLOTS) {
      const item = state.equipment[slot];
      if (item) {
        state.stash.push(item);
        delete state.equipment[slot];
      }
    }
  }

  if (restriction.kind === "weaponOnly") {
    for (const slot of IDLE_SLOTS) {
      if (slot === "weapon") continue;
      const item = state.equipment[slot];
      if (item) {
        state.stash.push(item);
        delete state.equipment[slot];
      }
    }
  }
}

/** Porzucenie — przywraca migawkę bit w bit. Zero kary za spróbowanie. */
export function abandonChallenge(state: IdleState): ActionResult {
  const id = state.challenges.activeId;
  if (id === null) return failResult("Nie masz aktywnego wyzwania");

  const restored = restoreSnapshot(state);
  state.challenges.activeId = null;
  state.challenges.startedAt = 0;
  state.challenges.snapshot = null;

  const name = challengeById(id)?.name ?? id;
  return restored
    ? okResult(`Porzucono: ${name}. Stan przywrócony.`)
    : okResult(`Porzucono: ${name}.`);
}

/**
 * Sprawdzenie ukończenia. Zwraca `null`, gdy nic się nie wydarzyło — dzięki
 * temu wołający może to odpalać co tick bez sprawdzania warunków u siebie.
 */
export function checkCompletion(
  state: IdleState,
  now: number,
): ActionResult<{ challenge: Challenge }> | null {
  const id = state.challenges.activeId;
  if (id === null) return null;

  const challenge = challengeById(id);
  if (!challenge) {
    state.challenges.activeId = null;
    return null;
  }

  // Limit czasu jest jedynym ograniczeniem, które potrafi wyzwanie PRZERWAĆ.
  if (challenge.restriction.kind === "timeLimit") {
    const limit = (challenge.restriction.value ?? 0) * 1000;
    if (limit > 0 && now - state.challenges.startedAt > limit) {
      restoreSnapshot(state);
      state.challenges.activeId = null;
      state.challenges.snapshot = null;
      return failResult(`Czas minął — ${challenge.name} nieukończone`);
    }
  }

  const progress = goalProgress(state, challenge);
  if (progress.current < progress.target) return null;

  const best = Math.max(state.challenges.best[id] ?? 0, progress.current);
  restoreSnapshot(state);
  state.challenges.activeId = null;
  state.challenges.snapshot = null;
  state.challenges.best[id] = best;
  if (!state.challenges.completed.includes(id)) state.challenges.completed.push(id);

  return okResult(`Ukończono: ${challenge.name} → ${challenge.rewardText}`, { challenge });
}

function restoreSnapshot(state: IdleState): boolean {
  if (state.challenges.snapshot === null) return false;
  try {
    const parsed = deserializeIdleState(JSON.parse(state.challenges.snapshot) as unknown);
    // Wyników wyzwania nie wolno stracić przy przywracaniu — nadpisujemy stan
    // migawką, ale listę ukończonych i rekordy zostawiamy z bieżącego stanu.
    const completed = [...state.challenges.completed];
    const best = { ...state.challenges.best };

    Object.assign(state, parsed);
    state.challenges.completed = completed;
    state.challenges.best = best;
    state.challenges.activeId = null;
    state.challenges.snapshot = null;
    return true;
  } catch {
    // Uszkodzona migawka nie może zablokować gracza w wyzwaniu na zawsze.
    state.challenges.snapshot = null;
    return false;
  }
}

// ────────────────────────────────────────────────────────── postęp i bonusy

export function goalProgress(
  state: IdleState,
  challenge: Challenge,
): { current: number; target: number; ratio: number } {
  const current =
    challenge.goal.kind === "reachZone" ? state.deepestZone : state.totals.kills;
  const target = challenge.goal.value;
  return { current, target, ratio: target > 0 ? Math.min(1, current / target) : 1 };
}

export function challengeProgress(
  state: IdleState,
): { id: string; name: string; current: number; target: number; ratio: number } | null {
  const id = state.challenges.activeId;
  if (id === null) return null;
  const challenge = challengeById(id);
  if (!challenge) return null;
  const p = goalProgress(state, challenge);
  return { id, name: challenge.name, ...p };
}

export function activeRestriction(state: IdleState): Restriction | null {
  const id = state.challenges.activeId;
  if (id === null) return null;
  return challengeById(id)?.restriction ?? null;
}

/** Trwałe bonusy z ukończonych wyzwań — kumulują się bez końca. */
export function challengeBonuses(state: IdleState): IdleBonuses {
  const out = emptyBonuses();

  for (const id of state.challenges.completed) {
    const challenge = challengeById(id);
    if (!challenge) continue;
    const r = challenge.reward;
    out.flatDamage += r.flatDamage ?? 0;
    out.increasedDamage += r.increasedDamage ?? 0;
    out.attackSpeed += r.attackSpeed ?? 0;
    out.critChance += r.critChance ?? 0;
    out.critMult += r.critMult ?? 0;
    out.areaDamage += r.areaDamage ?? 0;
    out.goldFind += r.goldFind ?? 0;
    out.magicFind += r.magicFind ?? 0;
    out.offlineEfficiency += r.offlineEfficiency ?? 0;
    out.offlineCapHours += r.offlineCapHours ?? 0;
    if (r.moreDamage !== undefined) out.moreDamage.push(r.moreDamage);
    if (r.unlockKeystone !== undefined) out.keystones.push(r.unlockKeystone);
  }

  return out;
}

/**
 * Bonusy **odjęte** przez aktywne ograniczenie. Nakładane na końcu łańcucha,
 * bo ograniczenie ma unieważnić także to, co dają unikaty i drzewko.
 */
export function applyRestriction(bonuses: IdleBonuses, restriction: Restriction | null): IdleBonuses {
  if (!restriction) return bonuses;
  const out: IdleBonuses = { ...bonuses, moreDamage: [...bonuses.moreDamage], keystones: [...bonuses.keystones], perEnemy: { ...bonuses.perEnemy } };

  switch (restriction.kind) {
    case "noCrit":
      out.critChance = -1;
      out.keystones.push("noCrit");
      break;
    case "noAreaDamage":
      out.areaDamage = -100;
      break;
    case "noKeystones":
      out.keystones = [];
      break;
    default:
      break;
  }

  return out;
}

/** Ile sekund zostało w wyzwaniu na czas; `null` gdy limitu nie ma. */
export function remainingSeconds(state: IdleState, now: number): number | null {
  const restriction = activeRestriction(state);
  if (!restriction || restriction.kind !== "timeLimit") return null;
  const limit = (restriction.value ?? 0) * 1000;
  return Math.max(0, (state.challenges.startedAt + limit - now) / 1000);
}

/** Dodatkowe sloty loadoutu zdobyte wyzwaniami. */
export function bonusLoadouts(state: IdleState): number {
  let n = 0;
  for (const id of state.challenges.completed) {
    n += challengeById(id)?.reward.unlockLoadout ?? 0;
  }
  return n;
}
