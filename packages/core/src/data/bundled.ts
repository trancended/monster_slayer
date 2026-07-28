/**
 * Trzeci poziom fallbacku dla balansu (localhost.md §9.2):
 * serwer → cache IndexedDB → dane wbudowane w bundle.
 * Gra uruchamia się zawsze, także z wyłączonym backendem.
 */
import combat from "../../../../data/combat.json" with { type: "json" };
import enemies from "../../../../data/enemies.json" with { type: "json" };
import affixes from "../../../../data/affixes.json" with { type: "json" };
import progression from "../../../../data/progression.json" with { type: "json" };

import { BalanceSchema, type Balance } from "./schema.ts";

export const bundledRaw = { combat, enemies, affixes, progression };

let cached: Balance | null = null;

export function bundledBalance(): Balance {
  if (!cached) cached = BalanceSchema.parse(bundledRaw);
  return cached;
}
