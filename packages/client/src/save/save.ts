/**
 * Zapis stanu (GDD §11.5). Źródłem prawdy jest IndexedDB — offline-first.
 * `localStorage` odpada: 5 MB, API synchroniczne, blokuje wątek główny w klatce.
 * Przed każdym nadpisaniem poprzedni zapis ląduje pod `.bak`.
 */
import { get, set, del } from "idb-keyval";
import type { CharacterState } from "@ms/core";

export const SAVE_VERSION = 2;

export interface GameSettings {
  difficulty: string;
  shakeIntensity: number;
  uiScale: number;
  colorblind: "none" | "protanopia" | "deuteranopia" | "tritanopia";
  audio: { master: number; music: number; sfx: number; ui: number };
  telemetryOptIn: boolean;
  showFps: boolean;
}

export interface SaveData {
  save_version: number;
  updated_at: string;
  seed: number;
  character: CharacterState;
  encounterIndex: number;
  settings: GameSettings;
  stats: { kills: number; playtime: number; deaths: number };
}

export const DEFAULT_SETTINGS: GameSettings = {
  difficulty: "hunter",
  shakeIntensity: 0.6,
  uiScale: 1,
  colorblind: "none",
  audio: { master: 0.8, music: 0.45, sfx: 0.85, ui: 0.7 },
  telemetryOptIn: false,
  showFps: false,
};

const key = (slot: number) => `save:slot_${slot}`;
const bakKey = (slot: number) => `save:slot_${slot}.bak`;

export async function loadSave(slot = 1): Promise<SaveData | null> {
  try {
    const raw = await get<SaveData>(key(slot));
    if (!raw) return null;
    return migrate(raw);
  } catch (err) {
    console.warn("[save] odczyt nieudany, próbuję backupu", err);
    try {
      const bak = await get<SaveData>(bakKey(slot));
      return bak ? migrate(bak) : null;
    } catch {
      return null;
    }
  }
}

export async function writeSave(data: SaveData, slot = 1): Promise<void> {
  const previous = await get<SaveData>(key(slot));
  if (previous) await set(bakKey(slot), previous);
  await set(key(slot), data);
}

export async function clearSave(slot = 1): Promise<void> {
  await del(key(slot));
  await del(bakKey(slot));
}

/** Migracje wersjonowane polem `save_version` — nowa wersja nigdy nie kasuje starego zapisu. */
function migrate(raw: SaveData): SaveData {
  const data = raw;
  if (data.save_version < 2) {
    // v1 nadawało przedmiotom id z licznika zerowanego przy każdym wczytaniu
    // strony, więc zapisy z tamtej wersji mają duplikaty (`it_1` i w plecaku,
    // i wśród nowego łupu). Keyed each w Svelte wywala się na takim duplikacie
    // i gasi cały panel ekwipunku, dlatego przepisujemy kolizje na unikaty.
    dedupeItemIds(data);
  }
  data.save_version = SAVE_VERSION;
  data.settings = { ...DEFAULT_SETTINGS, ...data.settings };
  data.settings.audio = { ...DEFAULT_SETTINGS.audio, ...data.settings.audio };
  return data;
}

function dedupeItemIds(data: SaveData): void {
  const ch = data.character as CharacterState | undefined;
  if (!ch) return;
  if (!Array.isArray(ch.inventory)) ch.inventory = [];
  if (!ch.equipment || typeof ch.equipment !== "object") ch.equipment = {};

  const seen = new Set<string>();
  const prefix = `fix${Date.now().toString(36)}`;
  let n = 0;

  const fix = (item: { id?: string } | undefined | null): void => {
    if (!item) return;
    if (typeof item.id !== "string" || item.id === "" || seen.has(item.id)) {
      item.id = `${prefix}_${(++n).toString(36)}`;
    }
    seen.add(item.id);
  };

  for (const item of Object.values(ch.equipment)) fix(item);
  for (const item of ch.inventory) fix(item);
}
