/**
 * Prestiż i Ascensja (v4 §4.3, §4.4) — pętla 30-dniowa, bez której gra kończy
 * się dokładnie w tej skali czasu.
 *
 *   `PP = floor( K · sqrt( złoto_zarobione_w_biegu / T ) )`
 *
 * Pierwiastek jest tu kluczowy i nie wolno go zamienić na logarytm ani na
 * krzywą liniową: sprawia, że **każdy kolejny PP kosztuje coraz więcej
 * postępu, ale żaden nie jest niemożliwy**. Logarytm dławi late game,
 * a liniowość zamienia prestiż w formalność.
 *
 * Warunek dobrego prestiżu (v4 §4.3): pierwszy reset musi pozwolić dojść do
 * poprzedniego punktu w ~30–40% czasu. Wolniej — gracz czuje karę. Szybciej —
 * resety przestają cokolwiek znaczyć. Sprawdza to `estimateReturnRatio`.
 *
 * Warstwa 3 (Transcendencja) jest świadomie nieobecna — to rok 2. W UI zostaje
 * po niej haczyk, w kodzie nie ma nic, bo martwy szkielet warstwy kosztuje
 * więcej niż jej brak.
 */
import { z } from "zod";
import raw from "../../../../data/prestige-tree.json" with { type: "json" };
import { div, log10, scale, sqrt, toNumber, type Big } from "../core/bignum.ts";
import { big } from "../core/bignum.ts";
import type { IdleConfig } from "./config.ts";
import { createIdleState } from "./state.ts";
import {
  UPGRADE_IDS,
  emptyBonuses,
  failResult,
  okResult,
  type ActionResult,
  type IdleBonuses,
  type IdleState,
  type UpgradeId,
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

const PrestigeNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  desc: z.string(),
  maxPoints: z.number().int().positive(),
  cost: z.number().int().positive(),
  requires: z.array(z.string()),
  ring: z.number().int().min(0),
  angle: z.number().min(0).max(360),
  effects: EffectsSchema,
});

const PrestigeTreeSchema = z.object({
  version: z.number(),
  meta: z.object({ note: z.string().optional() }).optional(),
  nodes: z.array(PrestigeNodeSchema).min(1),
  ascension: z.array(PrestigeNodeSchema).min(1),
});

export type PrestigeNode = z.infer<typeof PrestigeNodeSchema>;

export interface PrestigeTree {
  version: number;
  nodes: readonly PrestigeNode[];
  ascension: readonly PrestigeNode[];
  get(id: string): PrestigeNode | undefined;
}

export function parsePrestigeTree(data: unknown): PrestigeTree {
  const parsed = PrestigeTreeSchema.parse(data);
  const byId = new Map<string, PrestigeNode>();
  for (const n of [...parsed.nodes, ...parsed.ascension]) byId.set(n.id, n);

  for (const n of byId.values()) {
    for (const req of n.requires) {
      if (!byId.has(req)) throw new Error(`[prestige] węzeł ${n.id} wymaga nieistniejącego ${req}`);
    }
  }

  return {
    version: parsed.version,
    nodes: parsed.nodes,
    ascension: parsed.ascension,
    get: (id) => byId.get(id),
  };
}

let cached: PrestigeTree | null = null;

export function bundledPrestigeTree(): PrestigeTree {
  if (!cached) cached = parsePrestigeTree(raw);
  return cached;
}

// ────────────────────────────────────────────────────── warstwa 1: prestiż

/**
 * `PP = floor(K · sqrt(goldThisRun / T))`.
 *
 * `goldThisRun` bywa rzędu 1e40 — dzielenie i pierwiastek idą przez `Big`,
 * bo `toNumber` na tej skali zwróciłby `Infinity` i gracz dostałby `NaN` PP.
 */
export function prestigePoints(state: IdleState, cfg: IdleConfig): number {
  const ratio = div(state.goldThisRun, big(cfg.prestige.t));
  if (ratio.m <= 0) return 0;
  const points = toNumber(scale(sqrt(ratio), cfg.prestige.k));
  if (!Number.isFinite(points) || points <= 0) return 0;
  return Math.floor(points);
}

/** Ile PP doda ten konkretny reset. Alias czytelny w UI („Zyskasz: 42 PP"). */
export function prestigeGain(state: IdleState, cfg: IdleConfig): number {
  return prestigePoints(state, cfg);
}

/**
 * Ile złota trzeba jeszcze zarobić do kolejnego PP — najlepsza możliwa
 * informacja na przycisku prestiżu, bo zamienia „jeszcze nie" w konkretny cel.
 */
export function goldToNextPoint(state: IdleState, cfg: IdleConfig): Big {
  const next = prestigePoints(state, cfg) + 1;
  const needed = big(cfg.prestige.t * Math.pow(next / cfg.prestige.k, 2));
  const diff = toNumber(div(state.goldThisRun, needed));
  if (diff >= 1) return big(0);
  return scale(needed, 1 - diff);
}

export function canPrestige(state: IdleState, cfg: IdleConfig): ActionResult {
  if (state.deepestZone < cfg.prestige.unlockZone) {
    return failResult(`Prestiż odblokowuje się na strefie ${cfg.prestige.unlockZone}`);
  }
  const gain = prestigePoints(state, cfg);
  if (gain < cfg.prestige.minPointsToReset) {
    return failResult(`Za mało zarobione — reset dałby ${gain} PP`);
  }
  return okResult(`Reset da ${gain} PP`);
}

/**
 * Reset. Kasuje: poziomy ulepszeń, złoto biegu, strefy, postęp w strefie.
 * **Zostawia**: PP i drzewko trwałe, unikaty w kodeksie, bestiariusz, ukończone
 * wyzwania, odblokowane automatyzacje, ekwipunek i skrytkę.
 *
 * Ekwipunek zostaje świadomie: v4 §12 wymienia wipe postępu jako anty-wzorzec
 * („jednorazowa strata zaufania, nieodwracalna"), a przedmioty są tym, co gracz
 * uważa za swoje. Reset dotyka liczb, nie własności.
 */
export function doPrestige(
  state: IdleState,
  cfg: IdleConfig,
  now: number,
): ActionResult<{ gained: number; count: number }> {
  const check = canPrestige(state, cfg);
  if (!check.ok) return failResult(check.message);

  const gained = prestigePoints(state, cfg);
  const fresh = createIdleState(now);

  state.gold = fresh.gold;
  state.goldThisRun = fresh.goldThisRun;
  for (const id of UPGRADE_IDS) state.upgrades[id as UpgradeId] = 0;
  state.zone = 1;
  state.zoneProgress = 0;
  state.zoneTimer = 0;
  state.deepestZone = 1;

  state.prestige.points += gained;
  state.prestige.lifetime += gained;
  state.prestige.count += 1;
  state.prestige.lastPrestigeAt = now;
  state.lastSeen = now;

  return okResult(`Prestiż ${state.prestige.count} — zyskujesz ${gained} PP`, {
    gained,
    count: state.prestige.count,
  });
}

/** `mnożnik = 1 + multPerPoint · (PP posiadane + PP wydane)` (v4 §4.3). */
export function prestigeMultiplier(state: IdleState, cfg: IdleConfig): number {
  const total = state.prestige.points + state.prestige.spent;
  return 1 + cfg.prestige.multPerPoint * total;
}

// ──────────────────────────────────────────────────── warstwa 2: ascensja

/** Iskry liczone tym samym pierwiastkiem, tylko z dorobku PP zamiast złota. */
export function ascensionSparks(state: IdleState, cfg: IdleConfig): number {
  const a = cfg.prestige.ascension;
  const ratio = state.prestige.lifetime / a.sparkT;
  if (ratio <= 0) return 0;
  const sparks = a.sparkK * Math.sqrt(ratio);
  return Number.isFinite(sparks) ? Math.floor(sparks) : 0;
}

export function canAscend(state: IdleState, cfg: IdleConfig): ActionResult {
  const a = cfg.prestige.ascension;
  if (state.prestige.count < a.unlockPrestiges) {
    return failResult(`Ascensja wymaga ${a.unlockPrestiges} prestiży (masz ${state.prestige.count})`);
  }
  if (state.prestige.lifetime < a.unlockLifetimePoints) {
    return failResult(
      `Ascensja wymaga ${a.unlockLifetimePoints} zdobytych PP (masz ${state.prestige.lifetime})`,
    );
  }
  const sparks = ascensionSparks(state, cfg);
  if (sparks < 1) return failResult("Za mało dorobku na Iskrę");
  return okResult(`Ascensja da ${sparks} Iskier`);
}

/** Resetuje PP i drzewko trwałe. Iskry i drzewko ascensji zostają. */
export function doAscend(
  state: IdleState,
  cfg: IdleConfig,
  now: number,
): ActionResult<{ sparks: number }> {
  const check = canAscend(state, cfg);
  if (!check.ok) return failResult(check.message);

  const sparks = ascensionSparks(state, cfg);
  const reset = doPrestige(state, cfg, now);
  if (!reset.ok) {
    // Ascensja bez resetu biegu nie ma sensu, ale brak PP do zebrania też jej
    // nie blokuje — po prostu czyścimy warstwę 1 ręcznie.
    state.gold = createIdleState(now).gold;
    state.zone = 1;
    state.zoneProgress = 0;
    state.deepestZone = 1;
    for (const id of UPGRADE_IDS) state.upgrades[id as UpgradeId] = 0;
  }

  state.prestige.points = 0;
  state.prestige.spent = 0;
  state.prestige.nodes = {};
  state.prestige.count = 0;
  state.prestige.sparks += sparks;
  state.prestige.ascensions += 1;
  state.prestige.lastPrestigeAt = now;

  return okResult(`Ascensja ${state.prestige.ascensions} — zyskujesz ${sparks} Iskier`, { sparks });
}

// ──────────────────────────────────────────────────────── drzewka i bonusy

function availableFor(state: IdleState, tree: PrestigeTree, ascension: boolean): number {
  const pool = ascension ? state.prestige.sparks : state.prestige.points + state.prestige.spent;
  const nodes = ascension ? tree.ascension : tree.nodes;
  const store = ascension ? state.prestige.ascensionNodes : state.prestige.nodes;

  let spent = 0;
  for (const node of nodes) {
    const levels = store[node.id] ?? 0;
    if (levels > 0) spent += levels * node.cost;
  }
  return Math.max(0, pool - spent);
}

export function availablePrestigePoints(state: IdleState, tree: PrestigeTree): number {
  return availableFor(state, tree, false);
}

export function availableSparks(state: IdleState, tree: PrestigeTree): number {
  return availableFor(state, tree, true);
}

export function allocatePrestige(
  state: IdleState,
  tree: PrestigeTree,
  nodeId: string,
  count = 1,
): ActionResult<{ points: number }> {
  const node = tree.get(nodeId);
  if (!node) return failResult("Nie ma takiego węzła");

  const ascension = tree.ascension.some((n) => n.id === nodeId);
  const store = ascension ? state.prestige.ascensionNodes : state.prestige.nodes;

  let placed = 0;
  for (let i = 0; i < Math.max(1, Math.floor(count)); i++) {
    const current = store[nodeId] ?? 0;
    if (current >= node.maxPoints) break;

    for (const req of node.requires) {
      if ((store[req] ?? 0) <= 0) {
        if (placed === 0) return failResult(`Wymaga: ${tree.get(req)?.name ?? req}`);
        break;
      }
    }
    if (availableFor(state, tree, ascension) < node.cost) break;

    store[nodeId] = current + 1;
    placed += 1;
  }

  if (placed === 0) {
    return failResult(
      (store[nodeId] ?? 0) >= node.maxPoints
        ? `${node.name} — maksimum osiągnięte`
        : `Brakuje ${ascension ? "Iskier" : "PP"} — ${node.name} kosztuje ${node.cost}`,
    );
  }

  // `spent` pilnujemy tylko dla warstwy 1: mnożnik z §4.3 liczy PP posiadane
  // i wydane razem, więc nie może zgubić punktów zainwestowanych w drzewko.
  if (!ascension) {
    state.prestige.spent += placed * node.cost;
    state.prestige.points = Math.max(0, state.prestige.points - placed * node.cost);
  }

  return okResult(`${node.name} ${store[nodeId]}/${node.maxPoints}`, { points: placed });
}

/** Respec drzewka trwałego — również darmowy, z tego samego powodu co w §5.4. */
export function respecPrestige(state: IdleState): ActionResult<{ refunded: number }> {
  const refunded = state.prestige.spent;
  if (refunded === 0 && Object.keys(state.prestige.nodes).length === 0) {
    return failResult("Nie masz czego zresetować");
  }
  state.prestige.points += refunded;
  state.prestige.spent = 0;
  state.prestige.nodes = {};
  return okResult(`Zwrócono ${refunded} PP`, { refunded });
}

export function prestigeBonuses(
  state: IdleState,
  cfg: IdleConfig,
  tree: PrestigeTree,
): IdleBonuses {
  const out = emptyBonuses();

  // Bazowy mnożnik z samego posiadania PP (v4 §4.3) wchodzi jako `increased`,
  // żeby nie mnożył się z drzewkiem w sposób nie do przewidzenia.
  out.increasedDamage += prestigeMultiplier(state, cfg) - 1;

  const apply = (nodes: readonly PrestigeNode[], store: Record<string, number>): void => {
    for (const node of nodes) {
      const levels = Math.min(Math.max(0, store[node.id] ?? 0), node.maxPoints);
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
      if (e.moreDamage !== undefined) {
        for (let i = 0; i < levels; i++) out.moreDamage.push(e.moreDamage);
      }
    }
  };

  apply(tree.nodes, state.prestige.nodes);
  apply(tree.ascension, state.prestige.ascensionNodes);

  // Iskry same w sobie też dają mnożnik — inaczej ascensja byłaby czystą stratą
  // do momentu wydania Iskier, a to jest dokładnie ten moment, w którym gracz
  // odchodzi (v4 §2.1, pętla 30-dniowa).
  out.increasedDamage += cfg.prestige.ascension.multPerSpark * state.prestige.sparks;

  return out;
}

/**
 * Szacunek warunku z v4 §4.3: jaki ułamek poprzedniego czasu zajmie powrót
 * do tej samej strefy po resecie. Cel to 0.30–0.40.
 *
 * Model jest zgrubny — zakłada, że czas dojścia skaluje się odwrotnie do
 * mnożnika obrażeń — ale wystarcza, żeby wykryć krzywą ustawioną o rząd
 * wielkości źle, a o to tu chodzi.
 */
export function estimateReturnRatio(state: IdleState, cfg: IdleConfig): number {
  const gain = prestigePoints(state, cfg);
  if (gain <= 0) return 1;
  const before = prestigeMultiplier(state, cfg);
  const after = 1 + cfg.prestige.multPerPoint * (state.prestige.points + state.prestige.spent + gain);
  return before / after;
}

/** Log10 zarobku biegu — używane przez podgląd krzywej w panelu prestiżu. */
export function runProgressLog(state: IdleState): number {
  const l = log10(state.goldThisRun);
  return Number.isFinite(l) ? l : 0;
}
