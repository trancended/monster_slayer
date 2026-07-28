/**
 * Stałe kroku symulacji. Świadomie *tylko* stałe — sama pętla oparta na
 * `requestAnimationFrame` żyje w kliencie (`packages/client/src/loop.ts`),
 * bo `packages/core` nie może importować niczego z przeglądarki. Dzięki temu
 * ten sam kod walki napędza grę i headless symulator balansu.
 *
 * Fixed timestep 60 Hz jest wymogiem, nie optymalizacją: i-frames uniku
 * (0.10–0.42 s) muszą być identyczne przy 60, 120 i 144 Hz odświeżania.
 */
export const TICK_RATE = 60;
export const FIXED_DT = 1 / TICK_RATE;

/** Cap ticków w jednej klatce — ochrona przed „przyspieszeniem" po powrocie z innej karty. */
export const MAX_TICKS_PER_FRAME = 5;

export interface LoopStats {
  fps: number;
  simMs: number;
  renderMs: number;
  ticks: number;
}
