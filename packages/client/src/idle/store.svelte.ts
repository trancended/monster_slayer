/**
 * Most między `IdleEngine` (czysty TS w rdzeniu) a Svelte 5.
 *
 * Silnik celowo nie jest reaktywny: runes na obiekcie, po którym warstwa idle
 * iteruje setki razy przy marszu offline, kosztowałyby więcej niż cała reszta
 * obliczeń. Zamiast tego trzymamy **płaską migawkę** przepisywaną ~5 razy na
 * sekundę — DOM i tak nie odróżni częstszej aktualizacji, a budżet z GDD §11.6
 * (DOM ≤ 1 ms/klatkę) zostaje nietknięty.
 */
import { idle, format, formatCount, type Big } from "@ms/core";

type Engine = idle.IdleEngine;

export interface IdleSnapshot {
  ready: boolean;

  gold: string;
  goldPerSecond: string;
  dps: string;
  clearDps: string;

  zone: number;
  deepestZone: number;
  zoneProgress: number;
  zoneKills: number;
  zoneKillsRequired: number;
  isBoss: boolean;
  clearSeconds: number;
  stuck: boolean;

  nextMilestone: { unlocksAt: number; label: string } | null;

  prestigePoints: number;
  prestigeCount: number;
  prestigeGain: number;
  prestigeUnlocked: boolean;
  sparks: number;

  skillPoints: number;
  keystones: string[];

  stashCount: number;
  materials: Record<string, number>;

  diagnosisText: string;
  diagnosisSuggestion: string;
  diagnosisStuck: boolean;

  upgrades: UpgradeView[];
  automation: AutomationView[];
}

export interface UpgradeView {
  id: idle.UpgradeId;
  name: string;
  desc: string;
  level: number;
  unlocked: boolean;
  unlockZone: number;
  cost1: string;
  cost10: string;
  maxLevels: number;
  affordable1: boolean;
  affordable10: boolean;
}

export interface AutomationView {
  id: idle.AutomationId;
  name: string;
  desc: string;
  unlocked: boolean;
  enabled: boolean;
  unlockLabel: string;
}

const EMPTY_SNAPSHOT: IdleSnapshot = {
  ready: false,
  gold: "0",
  goldPerSecond: "0",
  dps: "0",
  clearDps: "0",
  zone: 1,
  deepestZone: 1,
  zoneProgress: 0,
  zoneKills: 0,
  zoneKillsRequired: 10,
  isBoss: false,
  clearSeconds: 0,
  stuck: false,
  nextMilestone: null,
  prestigePoints: 0,
  prestigeCount: 0,
  prestigeGain: 0,
  prestigeUnlocked: false,
  sparks: 0,
  skillPoints: 0,
  keystones: [],
  stashCount: 0,
  materials: { scrap: 0, fragment: 0, dust: 0, essence: 0 },
  diagnosisText: "",
  diagnosisSuggestion: "",
  diagnosisStuck: false,
  upgrades: [],
  automation: [],
};

/** Migawka czytana przez komponenty. Nigdy nie zapisuj do niej z UI. */
export const idleHud = $state<IdleSnapshot>({ ...EMPTY_SNAPSHOT });

/** Raport powrotu — `null`, dopóki nie ma czego pokazać. */
export const returnScreen = $state<{ report: idle.OfflineReport | null }>({ report: null });

/**
 * Pełna migawka jest droga: buduje 15 obiektów i liczy „ile poziomów stać
 * gracza" dla każdego ulepszenia. Robienie tego 5 razy na sekundę, kiedy żaden
 * panel idle nie jest zamontowany, to czysta alokacja w trakcie walki — wprost
 * przeciwko budżetowi z GDD §11.6. Tabele przeliczamy więc tylko wtedy,
 * gdy ktoś na nie patrzy; liczniki HUD-u lecą zawsze.
 */
export function syncIdle(engine: Engine, full = true): void {
  const s = engine.state;
  const rates = engine.rates;
  const zone = engine.zone;
  const diag = engine.diagnosis;
  const notation = s.notation;
  const fmt = (v: Big): string => format(v, { notation });

  idleHud.ready = true;
  idleHud.gold = fmt(s.gold);
  idleHud.goldPerSecond = fmt(rates.goldPerSecond);
  idleHud.dps = fmt(rates.dps);
  idleHud.clearDps = fmt(rates.clearDps);

  idleHud.zone = s.zone;
  idleHud.deepestZone = s.deepestZone;
  idleHud.zoneProgress = zone.progress;
  idleHud.zoneKills = zone.killsDone;
  idleHud.zoneKillsRequired = zone.killsRequired;
  idleHud.isBoss = zone.boss;
  idleHud.clearSeconds = zone.clearSeconds;
  idleHud.stuck = zone.stuck;
  idleHud.nextMilestone = idle.zoneMilestones(s.deepestZoneEver);

  idleHud.prestigePoints = s.prestige.points;
  idleHud.prestigeCount = s.prestige.count;
  idleHud.prestigeGain = idle.prestigePoints(s, engine.config);
  idleHud.prestigeUnlocked = s.deepestZoneEver >= engine.config.prestige.unlockZone;
  idleHud.sparks = s.prestige.sparks;

  idleHud.skillPoints = idle.availableSkillPoints(s, engine.skillTree);
  idleHud.keystones = idle.activeKeystones(s, engine.skillTree).map((n) => n.name);

  idleHud.stashCount = s.stash.length;
  idleHud.materials = { ...s.materials };

  idleHud.diagnosisText = diag.text;
  idleHud.diagnosisSuggestion = diag.suggestion;
  idleHud.diagnosisStuck = diag.stuck;

  if (!full) return;

  idleHud.upgrades = engine.config.upgrades.map((def) => {
    const level = idle.upgradeLevel(s, def.id);
    const unlocked = idle.isUpgradeUnlocked(s, def);
    const cost1 = idle.upgradeCost(s, engine.config, def.id, 1);
    const cost10 = idle.upgradeCost(s, engine.config, def.id, 10);
    return {
      id: def.id,
      name: def.name,
      desc: def.desc,
      level,
      unlocked,
      unlockZone: def.unlockZone,
      cost1: fmt(cost1),
      cost10: fmt(cost10),
      maxLevels: idle.maxAffordable(s, engine.config, def.id),
      affordable1: unlocked && idle.canAfford(s, engine.config, def.id),
      affordable10: unlocked && idle.maxAffordable(s, engine.config, def.id) >= 10,
    };
  });

  idleHud.automation = engine.config.automation.map((def) => {
    const slot = s.automation[def.id];
    return {
      id: def.id,
      name: def.name,
      desc: def.desc,
      unlocked: slot?.unlocked ?? false,
      enabled: slot?.enabled ?? true,
      // Zapowiedź odblokowania (v4 §3): wyszarzona pozycja z konkretnym progiem
      // ciągnie gracza dalej. Niespodzianka nie ciągnie.
      unlockLabel:
        def.unlockZone > 0 ? `strefa ${def.unlockZone}` : `${def.unlockPrestige}. prestiż`,
    };
  });
}

/** Skrót do liczników, które chcemy widzieć bez formatowania w szablonie. */
export function count(n: number): string {
  return formatCount(n);
}
