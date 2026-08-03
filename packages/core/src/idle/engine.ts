/**
 * Fasada warstwy idle — jedno miejsce, które zna wszystkie moduły naraz.
 *
 * Po co osobna klasa, skoro reszta warstwy jest czysto funkcyjna: bo łańcuch
 * „bonusy → tempo → strefa" trzeba składać w tej samej kolejności w grze,
 * w symulatorze balansu i w podglądzie kodu builda. Trzy kopie tego łańcucha
 * rozjechałyby się w tydzień.
 *
 * Klasa żyje w `packages/core`, więc nadal nie dotyka przeglądarki: czas
 * wchodzi parametrem, losowość przez `Rng`, zapis przez `serializeIdleState`.
 * Klient dokłada tylko pętlę i DOM.
 */
import { Rng } from "../core/rng.ts";
import { bundledIdleConfig } from "./bundled.ts";
import type { IdleConfig } from "./config.ts";
import { bestiaryAverageBonus, recordKill } from "./bestiary.ts";
import { activeRestriction, applyRestriction, challengeBonuses, checkCompletion } from "./challenges.ts";
import { diagnose } from "./diagnosis.ts";
import { equipmentBonuses, rollItem, type AffixPool } from "./items.ts";
import { bundledAffixPool } from "./items.ts";
import { computeRates } from "./rates.ts";
import { skillBonuses, bundledSkillTree, type SkillTree } from "./skilltree.ts";
import { prestigeBonuses, bundledPrestigeTree, type PrestigeTree } from "./prestige.ts";
import { bundledUniques, type UniqueIndex } from "./uniques.ts";
import { sweepStash } from "./filter.ts";
import { tickBackground } from "./background.ts";
import { computeOffline } from "./offline.ts";
import { createIdleState } from "./state.ts";
import { zoneStatus, type ZoneStatus } from "./zones.ts";
import {
  mergeBonuses,
  type AutomationId,
  type IdleBonuses,
  type IdleItem,
  type IdleRates,
  type IdleState,
  type OfflineReport,
  type StuckDiagnosis,
} from "./types.ts";

export type IdleMode = "active" | "background";

export interface IdleEngineOptions {
  state?: IdleState;
  config?: IdleConfig;
  seed?: number;
  now?: number;
}

export class IdleEngine {
  readonly config: IdleConfig;
  readonly skillTree: SkillTree;
  readonly prestigeTree: PrestigeTree;
  readonly affixes: AffixPool;
  readonly uniques: UniqueIndex;
  readonly rng: Rng;

  state: IdleState;

  /**
   * Bonusy i tempo są przeliczane leniwie. Wołanie `computeRates` co klatkę
   * kosztowałoby kilkadziesiąt operacji na `Big` bez żadnego powodu — stan
   * zmienia się przy akcji gracza, nie 60 razy na sekundę.
   */
  private bonusCache: IdleBonuses | null = null;
  private ratesCache: IdleRates | null = null;

  constructor(opts: IdleEngineOptions = {}) {
    this.config = opts.config ?? bundledIdleConfig();
    this.skillTree = bundledSkillTree();
    this.prestigeTree = bundledPrestigeTree();
    this.affixes = bundledAffixPool();
    this.uniques = bundledUniques();
    this.rng = new Rng(opts.seed ?? 0x5eed1d1e);
    this.state = opts.state ?? createIdleState(opts.now ?? 0);
  }

  /** Woła się po każdej zmianie stanu, która może ruszyć DPS. */
  invalidate(): void {
    this.bonusCache = null;
    this.ratesCache = null;
  }

  /**
   * Pełny łańcuch bonusów. Kolejność ma znaczenie tylko na końcu:
   * ograniczenie wyzwania nakładamy **po** wszystkim, bo ma unieważnić także
   * to, co dają unikaty i keystone'y.
   */
  get bonuses(): IdleBonuses {
    if (this.bonusCache) return this.bonusCache;

    const merged = mergeBonuses(
      skillBonuses(this.state, this.skillTree),
      prestigeBonuses(this.state, this.config, this.prestigeTree),
      equipmentBonuses(this.state.equipment, this.config, this.uniques),
      bestiaryAverageBonus(this.state),
      challengeBonuses(this.state),
    );

    this.bonusCache = applyRestriction(merged, activeRestriction(this.state));
    return this.bonusCache;
  }

  get rates(): IdleRates {
    if (!this.ratesCache) this.ratesCache = computeRates(this.state, this.config, this.bonuses);
    return this.ratesCache;
  }

  get zone(): ZoneStatus {
    return zoneStatus(this.state, this.config, this.rates);
  }

  get diagnosis(): StuckDiagnosis {
    return diagnose(this.state, this.config, this.rates, this.bonuses);
  }

  // ────────────────────────────────────────────────────────────────── tick

  /**
   * Krok symulacji. `dt` w sekundach.
   *
   * Tryb aktywny **nie liczy tu walki** — tam rządzi ECS i gracz. Ten tick
   * pilnuje wyłącznie zegarów: czasu w strefie, ukończenia wyzwania i tego,
   * czy postęp nie stoi zbyt długo (wejście do `zone_stuck`).
   */
  tick(dt: number, mode: IdleMode, now: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;

    this.state.playtime += dt;
    this.state.zoneTimer += dt;

    if (mode === "background") {
      const result = tickBackground(this.state, this.config, this.rates, dt);
      if (result.zonesAdvanced > 0 || result.kills > 0) this.invalidate();
    }

    const completed = checkCompletion(this.state, now);
    if (completed) this.invalidate();
  }

  /**
   * Zabójstwa zgłoszone przez warstwę walki (tryb aktywny). Nie liczymy tu
   * obrażeń — klient już to zrobił; my przeliczamy skutki ekonomiczne.
   */
  reportKills(enemyId: string, count: number): void {
    if (count <= 0) return;
    const tier = recordKill(this.state, enemyId, count);
    if (tier.tierUp) this.invalidate();
  }

  /** Losuje drop dla bieżącej strefy z uwzględnieniem znajdźki. */
  rollDrop(): IdleItem {
    return rollItem(this.rng, this.state.zone, this.config, this.affixes, this.uniques, {
      magicFind: this.rates.magicFind,
    });
  }

  /** Wrzuca przedmiot do skrytki i — jeśli filtr działa — od razu go przemiela. */
  collect(item: IdleItem): void {
    this.state.stash.push(item);
    this.state.totals.items += 1;
    if (item.rarity === "unique" && !this.state.uniquesFound.includes(item.baseId)) {
      this.state.uniquesFound.push(item.baseId);
    }
    if (this.state.lootFilter.enabled && this.automationOn("autoSalvage")) {
      sweepStash(this.state, this.config, this.uniques);
    }
    this.invalidate();
  }

  // ───────────────────────────────────────────────────────────────── offline

  offlineReport(now: number): OfflineReport {
    return computeOffline(this.state, this.config, this.bonuses, now);
  }

  // ─────────────────────────────────────────────────────────── automatyzacje

  automationOn(id: AutomationId): boolean {
    const slot = this.state.automation[id];
    return slot !== undefined && slot.unlocked && slot.enabled;
  }

  /**
   * Odblokowuje automatyzacje, na które gracz zapracował.
   * Zwraca listę nowo odblokowanych — każda z nich zasługuje na toast, bo
   * automatyzacja jest **nagrodą**, a nie cichą zmianą ustawień (filar F2).
   */
  refreshAutomation(): AutomationId[] {
    const unlocked: AutomationId[] = [];
    for (const def of this.config.automation) {
      const slot = this.state.automation[def.id];
      if (!slot || slot.unlocked) continue;
      const byZone = def.unlockZone > 0 && this.state.deepestZoneEver >= def.unlockZone;
      const byPrestige = def.unlockPrestige > 0 && this.state.prestige.count >= def.unlockPrestige;
      if (byZone || byPrestige) {
        slot.unlocked = true;
        unlocked.push(def.id);
      }
    }
    return unlocked;
  }
}
