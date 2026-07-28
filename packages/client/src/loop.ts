/**
 * Pętla gry: fixed timestep 60 Hz z akumulatorem + interpolacja renderu
 * (GDD §11.3). Mieszka w kliencie, bo dotyka `requestAnimationFrame`.
 *
 * Cap na liczbę ticków w jednej klatce chroni przed „przyspieszeniem" gry
 * po powrocie z innej karty (localhost.md §12).
 */
import { FIXED_DT, MAX_TICKS_PER_FRAME, type LoopStats } from "@ms/core";

export class FixedLoop {
  private accumulator = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;
  private paused = false;

  /** Skala czasu — używana przez slow-mo przy zabójstwie (GDD §5.6). */
  timeScale = 1;
  private hitstopRemaining = 0;
  private slowMoRemaining = 0;
  private slowMoScale = 1;

  readonly stats: LoopStats = { fps: 0, simMs: 0, renderMs: 0, ticks: 0 };
  private fpsAccum = 0;
  private fpsFrames = 0;

  private readonly tick: (dt: number) => void;
  private readonly render: (alpha: number, realDt: number) => void;

  constructor(tick: (dt: number) => void, render: (alpha: number, realDt: number) => void) {
    this.tick = tick;
    this.render = render;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    // Po wznowieniu zaczynamy od czystego akumulatora — inaczej gra
    // nadrobiłaby kilkaset ticków naraz.
    this.lastTime = performance.now();
    this.accumulator = 0;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Hitstop — zatrzymanie symulacji na N sekund czasu rzeczywistego. */
  requestHitstop(seconds: number): void {
    if (seconds > this.hitstopRemaining) this.hitstopRemaining = seconds;
  }

  requestSlowMo(scale: number, duration: number): void {
    this.slowMoScale = scale;
    this.slowMoRemaining = Math.max(this.slowMoRemaining, duration);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);

    let realDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (realDt > 0.25) realDt = 0.25; // zabezpieczenie po utracie fokusu

    this.fpsAccum += realDt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.stats.fps = Math.round(this.fpsFrames / this.fpsAccum);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    if (!this.paused) {
      let scaled = realDt;

      if (this.hitstopRemaining > 0) {
        this.hitstopRemaining -= realDt;
        scaled = 0; // świat stoi, render dalej leci
      } else if (this.slowMoRemaining > 0) {
        this.slowMoRemaining -= realDt;
        scaled = realDt * this.slowMoScale;
      }

      this.accumulator += scaled * this.timeScale;

      const simStart = performance.now();
      let ticks = 0;
      while (this.accumulator >= FIXED_DT && ticks < MAX_TICKS_PER_FRAME) {
        this.tick(FIXED_DT);
        this.accumulator -= FIXED_DT;
        ticks++;
      }
      if (ticks >= MAX_TICKS_PER_FRAME) this.accumulator = 0;
      this.stats.simMs = performance.now() - simStart;
      this.stats.ticks = ticks;
    }

    const renderStart = performance.now();
    this.render(this.accumulator / FIXED_DT, realDt);
    this.stats.renderMs = performance.now() - renderStart;
  };
}
