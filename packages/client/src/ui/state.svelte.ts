/**
 * Stan HUD-u jako runes Svelte 5. Overlay DOM aktualizowany ~20 Hz;
 * pętla symulacji nigdy nie czeka na DOM (budżet §11.6: DOM ≤ 1 ms/klatkę).
 */
import type { Item, ItemRarityId } from "@ms/core";
import { DEFAULT_SETTINGS, type GameSettings } from "../save/save.ts";

export type Screen =
  | "start"
  | "playing"
  | "paused"
  | "options"
  | "inventory"
  | "dead"
  /** Ekran powrotu (v4 §2.2) — ma pierwszeństwo przed wszystkim innym. */
  | "return"
  /** Panel idle: ulepszenia, strefa, automatyzacje, prestiż. */
  | "idle"
  /** Ekran postaci pod screenshot (v4 §5.8). */
  | "sheet";

export interface Toast {
  id: number;
  text: string;
  rarity?: ItemRarityId;
  kind: "loot" | "level" | "info" | "wave";
}

let toastId = 0;

export const hud = $state({
  screen: "start" as Screen,

  hp: 100,
  maxHp: 100,
  stamina: 100,
  maxStamina: 100,
  potions: 3,
  maxPotions: 3,

  level: 1,
  xp: 0,
  xpToNext: 100,
  gold: 0,
  kills: 0,

  attributePoints: 0,
  skillPoints: 0,
  attributes: { strength: 5, dexterity: 5, vitality: 5, will: 5 },

  encounter: 0,
  zoneLevel: 1,
  enemiesLeft: 0,
  intermission: 0,

  bossName: "",
  bossHp: 0,
  bossMaxHp: 0,
  bossBreak: 0,
  bossBreakMax: 0,
  bossBroken: false,

  heavyCharge: 0,
  dodgeReady: true,
  comboIndex: 0,

  // — combo zabójstw (mnożnik nagród). `comboTier === -1` oznacza serię
  //   poniżej pierwszego progu: licznik już rośnie, ale mnożnik to jeszcze 1.
  comboCount: 0,
  comboTier: -1,
  comboName: "",
  comboMultiplier: 1,
  comboColor: "#9aa3b2",
  /** 0–1, ile zostało do zerwania serii — pasek odlicza w dół. */
  comboFraction: 0,
  comboBest: 0,
  comboToNext: null as number | null,

  fps: 0,
  simMs: 0,
  online: false,
  balanceSource: "bundled" as string,
  gamepad: false,

  equipment: {} as Record<string, Item | undefined>,
  inventory: [] as Item[],

  settings: { ...DEFAULT_SETTINGS } as GameSettings,

  toasts: [] as Toast[],
});

export function pushToast(text: string, kind: Toast["kind"], rarity?: ItemRarityId): void {
  const toast: Toast = { id: ++toastId, text, kind, rarity };
  hud.toasts.push(toast);
  if (hud.toasts.length > 6) hud.toasts.shift();
  setTimeout(() => {
    const idx = hud.toasts.findIndex((t) => t.id === toast.id);
    if (idx >= 0) hud.toasts.splice(idx, 1);
  }, 4200);
}

export const RARITY_HEX: Record<ItemRarityId, string> = {
  common: "#9aa3b2",
  uncommon: "#44c94a",
  rare: "#4290ff",
  epic: "#b96bff",
  legendary: "#ff8c00",
};
