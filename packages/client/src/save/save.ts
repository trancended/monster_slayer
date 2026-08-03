/**
 * Zapis stanu (GDD §11.5). Źródłem prawdy jest IndexedDB — offline-first.
 * `localStorage` odpada: 5 MB, API synchroniczne, blokuje wątek główny w klatce.
 * Przed każdym nadpisaniem poprzedni zapis ląduje pod `.bak`.
 */
import { get, set, del } from "idb-keyval";
import type { CharacterState } from "@ms/core";

export const SAVE_VERSION = 3;

export interface GameSettings {
  difficulty: string;
  /**
   * Skąd bierze się kierunek postaci.
   *  • `movement` — postać patrzy tam, gdzie idzie (WASD). Domyślne, bo na
   *    trackpadzie ciągłe celowanie kursorem jest wyczerpujące.
   *  • `cursor` — klasyczne celowanie myszą, niezależne od kierunku ruchu.
   */
  aimMode: "movement" | "cursor";
  /**
   * Widok. `tpp` — kamera zza pleców, obracająca się za postacią.
   * `iso` — rzut 3/4 z góry, czytelniejszy przy dużych pakietach wrogów.
   * Zmiana wymaga przeładowania sceny, więc gra prosi o odświeżenie.
   */
  cameraMode: "tpp" | "iso";
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
  /**
   * Stan warstwy idle (plan v4). Trzymany jako nieprzezroczysty blob, bo
   * `deserializeIdleState` z rdzenia i tak waliduje każde pole z osobna —
   * duplikowanie tej wiedzy w typie zapisu oznaczałoby dwie migracje zamiast
   * jednej. Odpowiednik `state_blob JSONB` z v4 §7.4.
   */
  idle?: unknown;
}

export const DEFAULT_SETTINGS: GameSettings = {
  difficulty: "hunter",
  aimMode: "movement",
  cameraMode: "tpp",
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
  if (data.save_version < 3) {
    // v3 dokłada warstwę idle. Zapis sprzed pivotu nie ma pola `idle` i to jest
    // poprawny stan: `IdleController` zbuduje świeży stan, a postać z walki
    // zostaje nietknięta. Wipe przy patchu jest anty-wzorcem (v4 §12).
    data.idle = undefined;
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
  // Zapis sprzed proceduralnego bestiariusza nie zna licznika bossów. Postać
  // wchodzi do świata przez podstawienie całego obiektu, więc brak pola dałby
  // `undefined + 1` — czyli NaN w liczniku odblokowań, bez żadnego wyjątku.
  if (typeof ch.bossesDefeated !== "number" || !Number.isFinite(ch.bossesDefeated)) {
    ch.bossesDefeated = 0;
  }

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
