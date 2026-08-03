/**
 * Audio (GDD §12) — syntezowane proceduralnie, **zero plików dźwiękowych**.
 *
 * Poprzednia wersja była greyboxem: jeden ton plus jeden szum na zdarzenie.
 * Brzmiało to jak sygnalizacja, a nie jak walka. Prawdziwe uderzenie składa się
 * z **trzech warstw rozłożonych w czasie**, i to jest cała różnica:
 *
 *   1. **Transjent** (0–8 ms) — trzask zetknięcia. Bardzo krótki, jasny szum.
 *      To on niesie „mocno" i to jego brak sprawia, że dźwięk jest miękki.
 *   2. **Korpus** (8–120 ms) — ton o gwałtownie opadającej wysokości. Niesie
 *      MASĘ: 60 Hz to obuch, 400 Hz to sztylet.
 *   3. **Ogon** (do 600 ms) — materiał celu. Metal dzwoni niehartmonicznie,
 *      kość pęka sucho, ciało chlupie, jad syczy.
 *
 * Do tego trzy rzeczy, które zamieniają „dźwięki" w „przestrzeń":
 *
 *  • **Pogłos splotowy** z proceduralnie wygenerowaną odpowiedzią impulsową.
 *    Bez niego wszystko brzmi jakby grało w słuchawkach, a nie na arenie.
 *  • **Panorama i tłumienie z odległości** — cios z lewej słychać z lewej.
 *  • **Limiter na masterze** — przy dwudziestu wrogach bez niego mix się przestera.
 *
 * `AudioContext` startuje dopiero po geście użytkownika — ekran „Graj" jest
 * wymogiem technicznym polityki autoplay, nie decyzją UX.
 */
export type MusicMood = "explore" | "combat" | "boss";

/** Materiał celu — decyduje o ogonie uderzenia. */
export type HitMaterial = "flesh" | "bone" | "metal" | "toxic";

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

/** Pozycja w świecie + pozycja słuchacza; z nich liczymy panoramę i głośność. */
export interface Spatial {
  x: number;
  y: number;
}

interface VoiceOpts {
  bus?: keyof Bus;
  /** −1 (lewo) … +1 (prawo). */
  pan?: number;
  /** Udział w pogłosie, 0–1. */
  reverb?: number;
  delay?: number;
  /** Tłumienie z odległości, 0–1. */
  distance?: number;
}

/** Powyżej tylu metrów dźwięk jest praktycznie niesłyszalny. */
const MAX_AUDIBLE = 26;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private bus: Bus | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private convolver: ConvolverNode | null = null;
  private reverbSend: GainNode | null = null;
  private musicTimer: number | null = null;
  private mood: MusicMood = "explore";
  private musicStep = 0;
  private lowHpFilter: BiquadFilterNode | null = null;

  /** Pozycja słuchacza (gracza) w świecie — aktualizowana z pętli gry. */
  private listenerX = 0;
  private listenerY = 0;

  settings: AudioSettings = { master: 0.8, music: 0.45, sfx: 0.85, ui: 0.7 };
  enabled = true;

  /** Wywoływane z handlera kliknięcia — inaczej przeglądarka zablokuje kontekst. */
  async resume(): Promise<void> {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.buildNoise();
      this.buildGraph();
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.startMusic();
  }

  /** Pozycja gracza — źródło panoramy i tłumienia. Wołane z pętli renderowania. */
  setListener(x: number, y: number): void {
    this.listenerX = x;
    this.listenerY = y;
  }

  private buildGraph(): void {
    const ctx = this.ctx!;

    // Limiter: bez niego dwudziestu wrogów naraz przesterowuje wyjście.
    // Wysoki próg i szybki atak — ma łapać szczyty, nie kompresować dynamiki.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.16;

    const master = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 20000;
    master.connect(limiter).connect(filter).connect(ctx.destination);
    this.lowHpFilter = filter;

    const music = ctx.createGain();
    const sfx = ctx.createGain();
    const ui = ctx.createGain();
    music.connect(master);
    sfx.connect(master);
    ui.connect(master);

    // — pogłos: wspólna magistrala aux. Każdy dźwięk wysyła do niej ułamek
    //   sygnału, zamiast przechodzić przez splot w całości. Jeden konwolwer
    //   na całą grę zamiast jednego na dźwięk.
    const convolver = ctx.createConvolver();
    convolver.buffer = this.buildImpulseResponse();
    const send = ctx.createGain();
    send.gain.value = 1;
    const ret = ctx.createGain();
    ret.gain.value = 0.9;
    send.connect(convolver).connect(ret).connect(master);
    this.convolver = convolver;
    this.reverbSend = send;

    this.bus = { master, music, sfx, ui };
    this.applySettings();
  }

  /**
   * Odpowiedź impulsowa areny — szum o wykładniczo opadającej obwiedni,
   * przefiltrowany w dziedzinie czasu przez proste tłumienie wysokich.
   *
   * To nie jest pomiar prawdziwego wnętrza, tylko wiarygodna atrapa: ucho
   * czyta z niej rozmiar pomieszczenia i to wystarcza. 1.1 s ogona daje
   * „kamienna arena", nie „katedra" i nie „studio".
   */
  private buildImpulseResponse(): AudioBuffer {
    const ctx = this.ctx!;
    const seconds = 1.1;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // Obwiednia: szybki spadek na starcie, długi ogon.
        const env = Math.pow(1 - t, 2.6);
        const white = Math.random() * 2 - 1;
        // Jednobiegunowy filtr dolnoprzepustowy — wysokie gasną szybciej
        // niż niskie, tak jak w realnym wnętrzu.
        lp += (white - lp) * 0.22;
        data[i] = lp * env;
      }
      // Wczesne odbicia: kilka dyskretnych ech przed ogonem. Bez nich pogłos
      // brzmi jak mgła, a nie jak ściany w konkretnej odległości.
      for (const [delayMs, amp] of [[11, 0.5], [19, 0.38], [31, 0.28], [43, 0.2]] as const) {
        const idx = Math.floor((delayMs / 1000) * ctx.sampleRate) + (ch === 1 ? 37 : 0);
        if (idx < len) data[idx] += amp * (Math.random() > 0.5 ? 1 : -1);
      }
    }
    return buf;
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
    const len = Math.floor(ctx.sampleRate * 1.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  /** Przytłumienie muzyki o −6 dB na czas ważnego dźwięku. */
  private duck(seconds: number): void {
    if (!this.bus || !this.ctx) return;
    const now = this.ctx.currentTime;
    const g = this.bus.music.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(this.settings.music * 0.5, now, 0.03);
    g.setTargetAtTime(this.settings.music, now + seconds, 0.25);
  }

  /** Winieta dźwiękowa przy niskim HP — przytłumienie wysokich tonów. */
  setLowHealth(active: boolean): void {
    if (!this.lowHpFilter || !this.ctx) return;
    this.lowHpFilter.frequency.setTargetAtTime(active ? 1400 : 20000, this.ctx.currentTime, 0.25);
  }

  // ────────────────────────────────────────────────────── warstwa głosów

  /**
   * Punkt wejścia pojedynczego dźwięku: panorama, tłumienie i wysyłka
   * na pogłos. Zwraca węzeł, do którego podłącza się źródło.
   */
  private voice(o: VoiceOpts): GainNode | null {
    if (!this.ctx || !this.bus) return null;
    const ctx = this.ctx;

    const out = ctx.createGain();
    out.gain.value = o.distance ?? 1;

    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, o.pan ?? 0));
    out.connect(panner).connect(this.bus[o.bus ?? "sfx"]);

    // Wysyłka na pogłos idzie z sygnału PRZED panoramą — pogłos ma otaczać,
    // nie siedzieć po tej samej stronie co źródło.
    const send = o.reverb ?? 0.18;
    if (send > 0 && this.reverbSend) {
      const aux = ctx.createGain();
      aux.gain.value = send * (o.distance ?? 1);
      out.connect(aux).connect(this.reverbSend);
    }
    return out;
  }

  /** Panorama i tłumienie wyliczone z pozycji w świecie. */
  private spatial(at?: Spatial): { pan: number; distance: number } {
    if (!at) return { pan: 0, distance: 1 };
    const dx = at.x - this.listenerX;
    const dy = at.y - this.listenerY;
    const dist = Math.hypot(dx, dy);
    // Panorama z osi X świata; w rzucie 3/4 to wystarczająco dobre przybliżenie
    // tego, co widzi gracz, a pełne HRTF byłoby tu przesadą.
    const pan = Math.max(-1, Math.min(1, dx / 9));
    // Tłumienie liniowo-kwadratowe: blisko prawie bez zmian, dalej szybko cicho.
    const k = Math.max(0, 1 - dist / MAX_AUDIBLE);
    return { pan, distance: k * k * 0.85 + (dist < 1 ? 0.15 : 0) };
  }

  private tone(opts: {
    freq: number;
    to?: number;
    dur: number;
    type?: OscillatorType;
    gain?: number;
    attack?: number;
    detune?: number;
  } & VoiceOpts): void {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const out = this.voice(opts);
    if (!out) return;

    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? "sine";
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.detune) osc.detune.value = opts.detune;
    if (opts.to !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + opts.dur);
    }

    const peak = opts.gain ?? 0.3;
    const attack = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);

    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.02);
  }

  private noise(opts: {
    dur: number;
    gain?: number;
    filter?: number;
    /** Docelowa częstotliwość filtra — daje „świst" zamiast szumu. */
    filterTo?: number;
    q?: number;
    type?: BiquadFilterType;
    attack?: number;
  } & VoiceOpts): void {
    if (!this.ctx || !this.noiseBuffer || !this.enabled) return;
    const ctx = this.ctx;
    const out = this.voice(opts);
    if (!out) return;

    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    // Losowy punkt startu w buforze — inaczej każdy szum ma ten sam „kształt".
    const offset = Math.random() * (this.noiseBuffer.duration - opts.dur - 0.05);

    const filter = ctx.createBiquadFilter();
    filter.type = opts.type ?? "bandpass";
    filter.frequency.setValueAtTime(opts.filter ?? 1200, t0);
    if (opts.filterTo !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.filterTo), t0 + opts.dur);
    }
    filter.Q.value = opts.q ?? 1;

    const g = ctx.createGain();
    const peak = opts.gain ?? 0.25;
    const attack = opts.attack ?? 0.001;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);

    src.connect(filter).connect(g).connect(out);
    src.start(t0, Math.max(0, offset));
    src.stop(t0 + opts.dur + 0.02);
  }

  /** Wariancja pitchu — bez niej powtarzalne trafienia brzmią jak karabin. */
  private vary(base: number, amount = 0.16): number {
    return base * (1 - amount / 2 + Math.random() * amount);
  }

  // ───────────────────────────────────────────────── uderzenia i zamachy

  /**
   * Uderzenie w cel. Trzy warstwy (transjent → korpus → ogon materiału)
   * plus skalowanie mocą ciosu.
   *
   * @param power 0–1.5; steruje głośnością, długością korpusu i jasnością
   *              transjentu. Draśnięcie i dobicie mają brzmieć różnie.
   */
  hit(o: { material: HitMaterial; power?: number; crit?: boolean; at?: Spatial }): void {
    if (!this.ctx || !this.enabled) return;
    const p = Math.max(0.2, Math.min(1.5, o.power ?? 0.7));
    const { pan, distance } = this.spatial(o.at);
    if (distance <= 0.02) return;
    const sp: VoiceOpts = { pan, distance, reverb: 0.22 };

    // — 1. transjent: bardzo krótki, jasny trzask zetknięcia
    this.noise({
      ...sp,
      dur: 0.022,
      gain: 0.34 * p,
      filter: this.vary(o.crit ? 5200 : 3800),
      filterTo: 1400,
      q: 0.7,
      type: "highpass",
    });

    // — 2. korpus: opadający ton niosący masę ciosu
    this.tone({
      ...sp,
      freq: this.vary(o.crit ? 230 : 170) / (0.6 + p * 0.5),
      to: 46,
      dur: 0.09 + p * 0.07,
      type: "triangle",
      gain: 0.3 * p,
      attack: 0.002,
    });

    // — 3. ogon: to on mówi, w CO trafiłeś
    switch (o.material) {
      case "flesh":
        // Mokre, tłumione — pasmo wąskie i nisko.
        this.noise({ ...sp, dur: 0.13, gain: 0.24 * p, filter: this.vary(420), q: 1.6, delay: 0.012 });
        this.tone({ ...sp, freq: this.vary(95), to: 52, dur: 0.16, type: "sine", gain: 0.16 * p, delay: 0.01 });
        break;
      case "bone":
        // Suchy trzask: krótkie, jasne pasmo plus drugi, cichszy trzask.
        this.noise({ ...sp, dur: 0.06, gain: 0.3 * p, filter: this.vary(2100), q: 3.2, delay: 0.008 });
        this.noise({ ...sp, dur: 0.04, gain: 0.16 * p, filter: this.vary(3400), q: 4, delay: 0.03 });
        break;
      case "metal":
        // Dzwonienie niehartmoniczne — trzy tony w niecałkowitych proporcjach.
        // Proporcje całkowite dałyby dzwonek, a nie uderzenie w pancerz.
        for (const [mult, gain, dur] of [[1, 0.15, 0.5], [2.37, 0.1, 0.42], [3.81, 0.06, 0.34]] as const) {
          this.tone({
            ...sp,
            freq: this.vary(520) * mult,
            dur: dur * (0.7 + p * 0.4),
            type: "sine",
            gain: gain * p,
            delay: 0.006,
            reverb: 0.34,
          });
        }
        this.noise({ ...sp, dur: 0.09, gain: 0.2 * p, filter: this.vary(4200), q: 2, delay: 0.005 });
        break;
      case "toxic":
        // Syk plus chlupnięcie — pasmo pełznące w dół.
        this.noise({ ...sp, dur: 0.22, gain: 0.22 * p, filter: 2600, filterTo: 500, q: 1.2, delay: 0.01 });
        this.tone({ ...sp, freq: this.vary(140), to: 70, dur: 0.18, type: "sawtooth", gain: 0.1 * p, delay: 0.02 });
        break;
    }

    if (o.crit) {
      // Krytyk dostaje własny, wyższy dzwon — rozpoznawalny bez patrzenia
      // na liczbę obrażeń, tak samo jak czerwony błysk w warstwie graficznej.
      this.tone({ ...sp, freq: this.vary(1180), to: 760, dur: 0.26, type: "triangle", gain: 0.2, delay: 0.004, reverb: 0.4 });
    }
  }

  /**
   * Świst zamachu. Sekret jest w **przemiataniu filtra**, nie w jego położeniu:
   * statyczne pasmo brzmi jak szum, przemiatane — jak ostrze tnące powietrze.
   */
  private whoosh(o: { weight: number; at?: Spatial }): void {
    const { pan, distance } = this.spatial(o.at);
    const w = o.weight;
    this.noise({
      pan,
      distance,
      reverb: 0.12,
      dur: 0.1 + w * 0.16,
      gain: (0.1 + w * 0.14) * distance,
      filter: this.vary(900 + (1 - w) * 2200),
      filterTo: this.vary(320 + (1 - w) * 900),
      q: 1.1 + w * 0.6,
      attack: 0.02 + w * 0.04,
      type: "bandpass",
    });
    if (w > 0.6) {
      // Ciężki zamach ma dodatkowo podmuch niskich — masa broni.
      this.tone({ pan, distance, freq: 150, to: 54, dur: 0.26, type: "sawtooth", gain: 0.14 * distance, attack: 0.05 });
    }
  }

  /**
   * Wokalizacja wroga: detuneowane piły przez pasmowe filtry formantowe.
   * Trzy formanty to minimum, przy którym mózg słyszy „gardło", a nie „syntezator".
   */
  private growl(o: { pitch: number; dur: number; gain: number; at?: Spatial; rising?: boolean }): void {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const { pan, distance } = this.spatial(o.at);
    if (distance <= 0.02) return;

    const out = this.voice({ pan, distance, reverb: 0.26 });
    if (!out) return;
    const t0 = ctx.currentTime;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(o.gain, t0 + 0.03);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    env.connect(out);

    // Formanty zbliżone do samogłoski „a" opuszczonej o oktawę — brzmi jak
    // krzyk stworzenia, a nie jak mowa.
    for (const [f, q, g] of [[520, 6, 1], [1180, 9, 0.55], [2600, 12, 0.3]] as const) {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = this.vary(f, 0.24);
      bp.Q.value = q;
      const lvl = ctx.createGain();
      lvl.gain.value = g;
      bp.connect(lvl).connect(env);

      for (const detune of [-9, 11]) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.detune.value = detune;
        osc.frequency.setValueAtTime(o.pitch, t0);
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(30, o.rising ? o.pitch * 1.5 : o.pitch * 0.55),
          t0 + o.dur,
        );
        osc.connect(bp);
        osc.start(t0);
        osc.stop(t0 + o.dur + 0.03);
      }
    }
  }

  // ──────────────────────────────────────────────────────── zdarzenia

  play(name: string, at?: Spatial): void {
    if (!this.ctx || !this.enabled) return;
    const { pan, distance } = this.spatial(at);
    const sp: VoiceOpts = { pan, distance };

    switch (name) {
      // — zamachy gracza: trzeci cios combo jest cięższy
      case "swing1":
      case "swing2":
        this.whoosh({ weight: 0.25, at });
        break;
      case "swing3":
        this.whoosh({ weight: 0.55, at });
        break;
      case "heavySwing":
        this.whoosh({ weight: 1, at });
        break;
      case "whiff":
        this.whoosh({ weight: 0.12, at });
        break;
      case "enemySwing":
        this.whoosh({ weight: 0.35, at });
        break;

      // — trafienia. `hit()` z materiałem woła klient; te są zapasowe,
      //   gdyby zdarzenie przyszło bez informacji o celu.
      case "hit":
        this.hit({ material: "flesh", power: 0.7, at });
        break;
      case "hitHeavy":
        this.hit({ material: "flesh", power: 1.3, at });
        break;

      case "stagger":
        this.noise({ ...sp, dur: 0.18, gain: 0.24, filter: 900, filterTo: 220, q: 1.4 });
        this.tone({ ...sp, freq: 300, to: 84, dur: 0.3, type: "triangle", gain: 0.2 });
        break;

      case "break":
        // Przełamanie pancerza: pęknięcie metalu, więc długi niehartmoniczny ogon.
        this.duck(0.8);
        this.noise({ ...sp, dur: 0.1, gain: 0.4, filter: 5200, filterTo: 900, q: 0.8, type: "highpass" });
        for (const [m, g] of [[1, 0.16], [2.41, 0.12], [4.13, 0.07]] as const) {
          this.tone({ ...sp, freq: 380 * m, dur: 0.9, type: "sine", gain: g, reverb: 0.5 });
        }
        this.tone({ ...sp, freq: 140, to: 44, dur: 0.5, type: "sawtooth", gain: 0.22 });
        break;

      case "dodge":
        // Szelest tkaniny — krótki, wysoki, przemiatany w dół.
        this.noise({ ...sp, dur: 0.16, gain: 0.14, filter: 4200, filterTo: 900, q: 1.2, attack: 0.01 });
        break;

      case "charge":
        this.tone({ ...sp, freq: 90, to: 300, dur: 0.9, type: "sawtooth", gain: 0.1, attack: 0.25, reverb: 0.3 });
        this.noise({ ...sp, dur: 0.9, gain: 0.06, filter: 240, filterTo: 900, q: 0.6, attack: 0.3 });
        break;
      case "charge_go":
        this.whoosh({ weight: 0.9, at });
        this.growl({ pitch: 150, dur: 0.4, gain: 0.24, at, rising: true });
        break;

      case "playerHurt":
        // Gracz: stęknięcie plus uderzenie w pancerz. Ma być czytelne nawet
        // w środku wrzawy, więc dostaje minimum pogłosu i pełną głośność.
        this.growl({ pitch: 220, dur: 0.26, gain: 0.2 });
        this.noise({ dur: 0.1, gain: 0.26, filter: 620, filterTo: 200, q: 1, reverb: 0.1 });
        break;

      case "enemyDeath":
        this.growl({ pitch: this.vary(260), dur: 0.5, gain: 0.26, at });
        this.hit({ material: "flesh", power: 0.9, at });
        break;

      case "bossDeath":
        this.duck(1.6);
        this.growl({ pitch: 120, dur: 1.4, gain: 0.34, at });
        this.tone({ ...sp, freq: 90, to: 32, dur: 1.6, type: "sawtooth", gain: 0.26, reverb: 0.6 });
        this.noise({ ...sp, dur: 1.2, gain: 0.22, filter: 700, filterTo: 120, q: 0.5, reverb: 0.5 });
        break;

      case "death":
        this.duck(1.4);
        this.growl({ pitch: 200, dur: 0.9, gain: 0.3 });
        this.tone({ freq: 260, to: 46, dur: 1.3, type: "sine", gain: 0.24, reverb: 0.5 });
        break;

      case "explosion":
        // Wybuch: trzask, huk i długi ogon. Bez transjentu brzmi jak przeciąg.
        this.noise({ ...sp, dur: 0.05, gain: 0.5, filter: 6000, filterTo: 1600, q: 0.5, type: "highpass" });
        this.noise({ ...sp, dur: 0.55, gain: 0.42, filter: 900, filterTo: 90, q: 0.4, type: "lowpass", reverb: 0.45 });
        this.tone({ ...sp, freq: 110, to: 26, dur: 0.6, type: "sawtooth", gain: 0.3, reverb: 0.4 });
        break;

      case "shoot":
        this.noise({ ...sp, dur: 0.07, gain: 0.18, filter: 3200, filterTo: 900, q: 1.4 });
        this.tone({ ...sp, freq: this.vary(760), to: 300, dur: 0.14, type: "triangle", gain: 0.12 });
        break;

      case "alert":
        this.growl({ pitch: this.vary(320), dur: 0.24, gain: 0.18, at, rising: true });
        break;

      // Każdy telegraf ma unikalny dźwięk — reakcja bez patrzenia na wroga.
      case "telegraph_circle":
        this.duck(0.4);
        this.tone({ ...sp, freq: 300, dur: 0.22, type: "sine", gain: 0.2, reverb: 0.3 });
        this.tone({ ...sp, freq: 300, dur: 0.18, type: "sine", gain: 0.2, delay: 0.3, reverb: 0.3 });
        break;
      case "telegraph_cone":
        this.duck(0.4);
        this.tone({ ...sp, freq: 440, to: 720, dur: 0.42, type: "triangle", gain: 0.2, reverb: 0.3 });
        break;
      case "telegraph_line":
        this.duck(0.4);
        this.tone({ ...sp, freq: 900, to: 620, dur: 0.35, type: "square", gain: 0.13, reverb: 0.25 });
        break;

      // — interfejs: bez panoramy i bez pogłosu, zawsze na wprost
      case "potion":
        this.tone({ freq: 420, to: 900, dur: 0.35, type: "sine", gain: 0.24, bus: "ui", reverb: 0 });
        break;
      case "gold":
        // Brzęk monety: dwa niehartmoniczne tony, nie jeden czysty.
        this.tone({ freq: this.vary(1900), dur: 0.1, type: "triangle", gain: 0.1, bus: "ui", reverb: 0.1 });
        this.tone({ freq: this.vary(2730), dur: 0.07, type: "sine", gain: 0.06, bus: "ui", reverb: 0.1, delay: 0.01 });
        break;
      case "pickup":
        this.tone({ freq: 760, to: 1180, dur: 0.14, type: "sine", gain: 0.16, bus: "ui", reverb: 0 });
        break;
      case "levelUp":
        this.duck(1.0);
        [523, 659, 784, 1047].forEach((f, i) =>
          this.tone({ freq: f, dur: 0.34, type: "triangle", gain: 0.2, bus: "ui", delay: i * 0.08, reverb: 0.25 }),
        );
        break;
      case "loot_rare":
        this.tone({ freq: 620, to: 930, dur: 0.3, type: "sine", gain: 0.18, bus: "ui", reverb: 0.2 });
        break;
      case "loot_epic":
        this.duck(0.6);
        [660, 880, 1100].forEach((f, i) =>
          this.tone({ freq: f, dur: 0.4, type: "sine", gain: 0.2, bus: "ui", delay: i * 0.07, reverb: 0.25 }),
        );
        break;
      case "loot_legendary":
        this.duck(1.2);
        [523, 784, 1047, 1319].forEach((f, i) =>
          this.tone({ freq: f, dur: 0.7, type: "triangle", gain: 0.24, bus: "ui", delay: i * 0.1, reverb: 0.35 }),
        );
        break;
      case "uiClick":
        this.tone({ freq: 620, dur: 0.05, type: "square", gain: 0.09, bus: "ui", reverb: 0 });
        break;
      case "waveStart":
        this.duck(0.5);
        this.tone({ freq: 90, to: 150, dur: 0.7, type: "sawtooth", gain: 0.16, bus: "ui", reverb: 0.4 });
        this.noise({ dur: 0.6, gain: 0.1, filter: 300, filterTo: 900, q: 0.7, bus: "ui", reverb: 0.4, attack: 0.15 });
        break;
      case "comboTier":
        [784, 1047, 1319].forEach((f, i) =>
          this.tone({ freq: f, dur: 0.16, type: "triangle", gain: 0.13, bus: "ui", delay: i * 0.045, reverb: 0.2 }),
        );
        break;
      case "comboBreak":
        this.tone({ freq: 420, to: 180, dur: 0.26, type: "sine", gain: 0.12, bus: "ui", reverb: 0.2 });
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
    this.musicTimer = window.setInterval(() => {
      this.musicStep++;
      this.musicTick();
    }, 480);
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

    this.tone({ freq: root, dur: 0.9, type: "triangle", gain: 0.1, bus: "music", reverb: 0.3 });
    if (this.mood !== "explore" && s % 2 === 0) {
      this.noise({ dur: 0.09, gain: 0.06, filter: 5200, q: 1.5, bus: "music", reverb: 0.2 });
    }
    if (this.mood === "boss" && s % 4 === 0) {
      this.tone({ freq: root * 4, to: root * 3, dur: 0.6, type: "sawtooth", gain: 0.05, bus: "music", reverb: 0.4 });
    }
    if (s % 8 === 0) {
      this.tone({ freq: root * 6, dur: 1.6, type: "sine", gain: 0.03, bus: "music", attack: 0.4, reverb: 0.5 });
    }
  }
}

export const audio = new AudioEngine();
