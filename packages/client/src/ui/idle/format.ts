/**
 * Drobiazgi prezentacyjne warstwy idle. Zero logiki gry — wyłącznie mapowanie
 * identyfikatorów na to, co widzi oko.
 */
import type { idle } from "@ms/core";

export const SLOT_ORDER: readonly idle.IdleSlot[] = [
  "weapon",
  "helmet",
  "chest",
  "gloves",
  "boots",
  "belt",
  "amulet",
  "ring1",
  "ring2",
];

export const SLOT_SHORT: Record<idle.IdleSlot, string> = {
  weapon: "Broń",
  helmet: "Hełm",
  chest: "Napierśnik",
  gloves: "Rękawice",
  boots: "Buty",
  belt: "Pas",
  amulet: "Amulet",
  ring1: "Pierścień I",
  ring2: "Pierścień II",
};

export const RARITY_NAME: Record<idle.IdleRarityId, string> = {
  common: "Zwykły",
  magic: "Magiczny",
  rare: "Rzadki",
  epic: "Epicki",
  unique: "Unikat",
};

/**
 * Znak rzadkości. Kolor nie może być jedynym nośnikiem informacji (GDD §10.3),
 * a na screenshocie wklejonym na Reddita nie ma tooltipów — znak działa zawsze.
 */
export const RARITY_MARK: Record<idle.IdleRarityId, string> = {
  common: "·",
  magic: "◆",
  rare: "★",
  epic: "✦",
  unique: "❖",
};

/**
 * Kolory rzadkości. **Duplikat** wartości z `data/idle.json` (`items.rarities[].color`) —
 * CSS nie umie ich stamtąd wziąć, więc przy zmianie palety trzeba ruszyć oba
 * miejsca. Alternatywą byłoby wstrzykiwanie zmiennych CSS w runtime, co za tę
 * cenę nie jest warte dodatkowego kodu.
 */
export const RARITY_COLOR: Record<idle.IdleRarityId, string> = {
  common: "#9aa3b2",
  magic: "#4290ff",
  rare: "#ffd447",
  epic: "#b96bff",
  unique: "#ff8c00",
};

/** Klasa CSS dla kierunku zmiany — używana przy porównywaniu przedmiotów. */
export function deltaClass(value: number): "up" | "down" | "same" {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "same";
}

/** `+12,4%` / `−3,1%` — z polskim minusem i przecinkiem. */
export function signedPercent(value: number, digits = 1): string {
  const v = value * 100;
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(digits).replace(".", ",")}%`;
}
