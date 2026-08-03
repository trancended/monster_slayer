/**
 * Konfiguracja idle wbudowana w bundle — trzeci poziom fallbacku, ten sam
 * schemat co `data/bundled.ts` dla balansu walki: serwer → cache → bundle.
 * Gra idle musi wystartować bez sieci, bo offline-first jest tu założeniem
 * projektowym, a nie trybem awaryjnym.
 */
import raw from "../../../../data/idle.json" with { type: "json" };
import { parseIdleConfig, type IdleConfig } from "./config.ts";

export const bundledIdleRaw = raw;

let cached: IdleConfig | null = null;

export function bundledIdleConfig(): IdleConfig {
  if (!cached) cached = parseIdleConfig(raw);
  return cached;
}
