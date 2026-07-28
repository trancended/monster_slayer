/**
 * Audio (GDD §12). Graf Web Audio z osobnymi busami: master / muzyka / SFX / UI,
 * duckingiem −6 dB i wariancją pitchu ±8%.
 *
 * SFX są syntezowane proceduralnie — greybox dźwiękowy. Dzięki temu budżet
 * assetów startowych to 0 MB, a każdy telegraf ma własny, rozpoznawalny dźwięk
 * już w M1, zanim powstanie bank próbek.
 *
 * `AudioContext` startuje dopiero po geście użytkownika — ekran „Graj" jest
 * wymogiem technicznym polityki autoplay, nie decyzją UX.
 */
export type MusicMood = "explore" | "combat" | "boss";

interface Bus {
  master: GainNode;
  music: GainNode;
  sfx: GainNode;
  ui: GainNode;
}

export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  ui: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private bus: Bus | null = null;
  private duckTimer = 0;
  private noiseBuffer: AudioBuffer | null = null;
  private musicTimer: number | null = null;
  private mood: MusicMood = "explore";
  private musicStep = 0;
  private lowHpFilter: BiquadFilterNode | null = null;

  settings: AudioSettings = { master: 0.8, music: 0.45, sfx: 0.85, ui: 0.7 };
  enabled = true;

  /** Wywoływane z handlera kliknięcia — inaczej przeglądarka zablokuje kontekst. */
  async resume(): Promise<void> {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.buildGraph();
      this.buildNoise();
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.startMusic();
  }

  private buildGraph(): void {
    const ctx = this.ctx!;
    const master = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 20000;
    master.connect(filter).connect(ctx.destination);
    this.lowHpFilter = filter;

    const music = ctx.createGain();
    const sfx = ctx.createGain();
    const ui = ctx.createGain();
    music.connect(master);
    sfx.connect(master);
    ui.connect(master);

    this.bus = { master, music, sfx, ui };
    this.applySettings();
  }

  applySettings(): void {
    if (!this.bus) return;
    const on = this.enabled ? 1 : 0;
    this.bus.master.gain.value = this.settings.master * on;
    this.bus.music.gain.value = this.settings.music;
    this.bus.sfx.gain.value = this.settings.sfx;
    this.bus.ui.gain.value = this.settings.ui;
  }

  private buildNoise(): void {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * 0.7);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  /** Przytłumienie miksu o −6 dB na czas ważnego dźwięku (telegraf bossa, niskie HP). */
  private duck(seconds: number): void {
    if (!this.bus || !this.ctx) return;
    const now = this.ctx.currentTime;
    const g = this.bus.music.gain;
    const target = this.settings.music * 0.5;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(target, now, 0.03);
    this.duckTimer = Math.max(this.duckTimer, seconds);
    g.setTargetAtTime(this.settings.music, now + seconds, 0.25);
  }

  /** Winieta dźwiękowa przy niskim HP — przytłumienie wysokich tonów. */
  setLowHealth(active: boolean): void {
    if (!this.lowHpFilter || !this.ctx) return;
    this.lowHpFilter.frequency.setTargetAtTime(
      active ? 1400 : 20000,
      this.ctx.currentTime,
      0.25,
    );
  }

  private tone(opts: {
    freq: number;
    to?: number;
    dur: number;
    type?: OscillatorType;
    gain?: number;
    bus?: keyof Bus;
    delay?: number;
    attack?: number;
  }): void {
    if (!this.ctx || !this.bus || !this.enabled) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? "sine";
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + opts.dur);

    const peak = opts.gain ?? 0.3;
    const attack = opts.attack ?? 0.006;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);

    osc.connect(g).connect(this.bus[opts.bus ?? "sfx"]);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.02);
  }

  private noise(opts: {
    dur: number;
    gain?: number;
    filter?: number;
    q?: number;
    type?: BiquadFilterType;
    bus?: keyof Bus;
    delay?: number;
  }): void {
    if (!this.ctx || !this.bus || !this.noiseBuffer || !this.enabled) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type ?? "bandpass";
    filter.frequency.value = opts.filter ?? 1200;
    filter.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain ?? 0.25, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    src.connect(filter).connect(g).connect(this.bus[opts.bus ?? "sfx"]);
    src.start(t0);
    src.stop(t0 + opts.dur + 0.02);
  }

  /** Wariancja pitchu ±8% — bez niej powtarzalne trafienia brzmią jak karabin. */
  private vary(base: number): number {
    return base * (0.92 + Math.random() * 0.16);
  }

  play(name: string): void {
    if (!this.ctx || !this.enabled) return;
    switch (name) {
      case "swing1":
      case "swing2":
        this.noise({ dur: 0.13, gain: 0.16, filter: this.vary(2400), q: 1.4 });
        break;
      case "swing3":
        this.noise({ dur: 0.22, gain: 0.22, filter: this.vary(1500), q: 1.1 });
        break;
      case "heavySwing":
        this.noise({ dur: 0.3, gain: 0.3, filter: this.vary(900), q: 0.8 });
        this.tone({ freq: 160, to: 60, dur: 0.3, type: "sawtooth", gain: 0.2 });
        break;
      case "whiff":
        this.noise({ dur: 0.1, gain: 0.07, filter: this.vary(3600), q: 2 });
        break;
      case "hit":
        this.noise({ dur: 0.1, gain: 0.34, filter: this.vary(700), q: 0.9 });
        this.tone({ freq: this.vary(190), to: 80, dur: 0.1, type: "square", gain: 0.16 });
        break;
      case "hitHeavy":
        this.noise({ dur: 0.2, gain: 0.42, filter: this.vary(420), q: 0.7 });
        this.tone({ freq: this.vary(120), to: 45, dur: 0.24, type: "sawtooth", gain: 0.28 });
        break;
      case "stagger":
        this.tone({ freq: 320, to: 90, dur: 0.32, type: "triangle", gain: 0.24 });
        break;
      case "break":
        this.duck(0.8);
        this.tone({ freq: 700, to: 140, dur: 0.7, type: "sawtooth", gain: 0.3 });
        this.noise({ dur: 0.6, gain: 0.3, filter: 900, q: 0.5 });
        break;
      case "dodge":
        this.noise({ dur: 0.16, gain: 0.16, filter: this.vary(1100), q: 2.4 });
        break;
      case "charge":
        this.tone({ freq: 110, to: 420, dur: 0.9, type: "triangle", gain: 0.12, attack: 0.2 });
        break;
      case "playerHurt":
        this.tone({ freq: this.vary(210), to: 70, dur: 0.3, type: "sawtooth", gain: 0.3 });
        this.noise({ dur: 0.2, gain: 0.2, filter: 500 });
        break;
      case "enemyDeath":
        this.tone({ freq: this.vary(280), to: 60, dur: 0.34, type: "triangle", gain: 0.22 });
        break;
      case "bossDeath":
        this.duck(1.6);
        this.tone({ freq: 220, to: 40, dur: 1.6, type: "sawtooth", gain: 0.35 });
        this.noise({ dur: 1.2, gain: 0.3, filter: 400, q: 0.4 });
        break;
      case "death":
        this.duck(1.4);
        this.tone({ freq: 300, to: 50, dur: 1.2, type: "sine", gain: 0.3 });
        break;
      case "explosion":
        this.noise({ dur: 0.5, gain: 0.42, filter: 260, q: 0.4, type: "lowpass" });
        this.tone({ freq: 90, to: 30, dur: 0.5, type: "sawtooth", gain: 0.3 });
        break;
      case "shoot":
        this.tone({ freq: this.vary(880), to: 320, dur: 0.16, type: "square", gain: 0.14 });
        break;
      case "enemySwing":
        this.noise({ dur: 0.14, gain: 0.13, filter: this.vary(1700), q: 1.6 });
        break;
      case "alert":
        this.tone({ freq: 520, to: 780, dur: 0.14, type: "square", gain: 0.1 });
        break;
      // Każdy telegraf ma unikalny dźwięk — reakcja bez patrzenia na wroga.
      case "telegraph_circle":
        this.duck(0.4);
        this.tone({ freq: 300, to: 300, dur: 0.3, type: "sine", gain: 0.2 });
        this.tone({ freq: 300, to: 300, dur: 0.2, type: "sine", gain: 0.2, delay: 0.35 });
        break;
      case "telegraph_cone":
        this.duck(0.4);
        this.tone({ freq: 460, to: 720, dur: 0.42, type: "triangle", gain: 0.2 });
        break;
      case "telegraph_line":
        this.duck(0.4);
        this.tone({ freq: 900, to: 620, dur: 0.35, type: "square", gain: 0.14 });
        break;
      case "charge_go":
        this.noise({ dur: 0.45, gain: 0.28, filter: 700, q: 0.6 });
        break;
      case "potion":
        this.tone({ freq: 420, to: 900, dur: 0.35, type: "sine", gain: 0.24, bus: "ui" });
        break;
      case "gold":
        this.tone({ freq: this.vary(1500), dur: 0.09, type: "triangle", gain: 0.12, bus: "ui" });
        break;
      case "pickup":
        this.tone({ freq: 760, to: 1180, dur: 0.14, type: "sine", gain: 0.16, bus: "ui" });
        break;
      case "levelUp":
        this.duck(1.0);
        [523, 659, 784, 1047].forEach((f, i) =>
          this.tone({ freq: f, dur: 0.34, type: "triangle", gain: 0.22, bus: "ui", delay: i * 0.08 }),
        );
        break;
      case "loot_rare":
        this.tone({ freq: 620, to: 930, dur: 0.3, type: "sine", gain: 0.2, bus: "ui" });
        break;
      case "loot_epic":
        this.duck(0.6);
        [660, 880, 1100].forEach((f, i) =>
          this.tone({ freq: f, dur: 0.4, type: "sine", gain: 0.22, bus: "ui", delay: i * 0.07 }),
        );
        break;
      case "loot_legendary":
        this.duck(1.2);
        [523, 784, 1047, 1319].forEach((f, i) =>
          this.tone({ freq: f, dur: 0.7, type: "triangle", gain: 0.26, bus: "ui", delay: i * 0.1 }),
        );
        break;
      case "uiClick":
        this.tone({ freq: 620, dur: 0.05, type: "square", gain: 0.1, bus: "ui" });
        break;
      case "waveStart":
        this.tone({ freq: 180, to: 300, dur: 0.5, type: "sawtooth", gain: 0.18, bus: "ui" });
        break;
      default:
        break;
    }
  }

  // ─────────────────────────────────────────── muzyka adaptacyjna

  setMood(mood: MusicMood): void {
    if (this.mood === mood) return;
    this.mood = mood;
  }

  private startMusic(): void {
    if (this.musicTimer !== null || !this.ctx) return;
    const step = () => {
      this.musicStep++;
      this.musicTick();
    };
    // Crossfade między warstwami realizuje sama gęstość zdarzeń + gain busa.
    this.musicTimer = window.setInterval(step, 480);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private musicTick(): void {
    if (!this.ctx || !this.enabled) return;
    const s = this.musicStep;
    const roots = this.mood === "boss" ? [55, 58, 55, 51] : [65.4, 61.7, 58.3, 65.4];
    const root = roots[Math.floor(s / 8) % roots.length]!;

    this.tone({ freq: root, dur: 0.9, type: "triangle", gain: 0.1, bus: "music" });
    if (this.mood !== "explore" && s % 2 === 0) {
      this.noise({ dur: 0.09, gain: 0.07, filter: 5200, q: 1.5, bus: "music" });
    }
    if (this.mood === "boss" && s % 4 === 0) {
      this.tone({ freq: root * 4, to: root * 3, dur: 0.6, type: "sawtooth", gain: 0.05, bus: "music" });
    }
    if (s % 8 === 0) {
      this.tone({ freq: root * 6, dur: 1.6, type: "sine", gain: 0.035, bus: "music", attack: 0.4 });
    }
  }
}

export const audio = new AudioEngine();
