/**
 * Spoiwo: World (symulacja) ↔ Renderer (Pixi) ↔ InputManager ↔ Audio ↔ zapis.
 * Systemy nie znają się nawzajem — komunikacja idzie przez event bus.
 */
import {
  bus,
  deriveStats,
  FIXED_DT,
  Kind,
  PState,
  World,
  xpToNext,
  type Balance,
  type Item,
} from "@ms/core";
import { FixedLoop } from "./loop.ts";
import { Renderer } from "./render/renderer.ts";
import { InputManager } from "./input/input.ts";
import { audio } from "./audio/audio.ts";
import { hud, pushToast } from "./ui/state.svelte.ts";
import {
  DEFAULT_SETTINGS,
  loadSave,
  writeSave,
  SAVE_VERSION,
  type GameSettings,
  type SaveData,
} from "./save/save.ts";
import {
  connectBalanceLive,
  loadBalance,
  openSession,
  recordEvent,
  setTelemetryOptIn,
  startTelemetryLoop,
  status as netStatus,
  syncSave,
} from "./net/backend.ts";

// `pagehide` nie zdąży dokończyć asynchronicznego zapisu do IndexedDB, więc
// autosave musi być na tyle gęsty, żeby F5 nie gubił postępu (DoD §18.5).
// Payload to kilka kB, koszt zapisu jest pomijalny.
const AUTOSAVE_INTERVAL = 8;

export class Game {
  balance!: Balance;
  world!: World;
  renderer!: Renderer;
  input!: InputManager;
  loop!: FixedLoop;

  private aim = { x: 3, y: 0 };
  private hudTick = 0;
  private autosaveTimer = 0;
  private prevHitDone = 0;
  private lowHp = false;
  private started = false;

  async boot(stageEl: HTMLElement): Promise<void> {
    this.balance = await loadBalance();
    void openSession();

    const save = await loadSave(1);
    const settings: GameSettings = save?.settings ?? { ...DEFAULT_SETTINGS };
    hud.settings = settings;

    this.world = new World({
      balance: this.balance,
      seed: save?.seed ?? (Math.random() * 0xffffffff) >>> 0,
      bus,
      difficulty: settings.difficulty,
    });

    if (save) {
      this.world.character = save.character;
      this.world.encounter.index = Math.max(0, save.encounterIndex - 1);
      this.world.refreshDerived();
      this.world.store.hp[this.world.player] = this.world.derived.maxHp;
      this.world.sessionKills = save.stats.kills;
    }

    this.renderer = new Renderer();
    await this.renderer.init(stageEl, this.balance.combat.gameFeel);

    this.input = new InputManager(stageEl, {
      onMenuToggle: () => this.toggleMenu(),
      onInventoryToggle: () => this.toggleInventory(),
      onGamepadDetected: () => {
        hud.gamepad = true;
        pushToast("Wykryto pada — sterowanie XInput aktywne", "info");
      },
    });
    this.input.attach();

    this.loop = new FixedLoop(
      (dt) => this.tick(dt),
      (alpha, realDt) => this.render(alpha, realDt),
    );

    this.applySettings(settings);
    this.wireEvents();
    this.syncHud(true);

    // Hot reload balansu: systemy czytają nowe wartości od następnego ticku.
    connectBalanceLive((balance) => {
      Object.assign(this.balance, balance);
      this.world.refreshDerived();
      pushToast("Balans przeładowany na żywo", "info");
    });

    this.loop.start();
  }

  // ────────────────────────────────────────────────────────── zdarzenia

  private wireEvents(): void {
    bus.on("enemy:damaged", (e) => {
      this.renderer.spawnDamageNumber(e.amount, e.x, e.y, e.crit, e.element);
    });

    bus.on("player:healed", (e) => {
      const s = this.world.store;
      const p = this.world.player;
      this.renderer.spawnDamageNumber(e.amount, s.x[p]!, s.y[p]!, false, "heal");
    });

    bus.on("hitstop", (e) => {
      this.loop.requestHitstop(e.seconds);
      if (e.slowMoDuration > 0) this.loop.requestSlowMo(e.slowMoScale, e.slowMoDuration);
    });

    bus.on("shake", (e) => {
      this.renderer.camera.addTrauma(
        e.trauma,
        e.dirX,
        e.dirY,
        this.balance.combat.gameFeel.cameraKickPx,
      );
    });

    bus.on("sfx", (e) => audio.play(e.name));

    bus.on("level:up", (e) => {
      pushToast(`Poziom ${e.level}! +3 punkty atrybutów`, "level");
      recordEvent("level_up", { level: e.level, at: Math.round(this.world.elapsed) });
      void this.save();
    });

    bus.on("item:picked", (e) => {
      pushToast(e.name, "loot", e.rarity);
      recordEvent("item_picked", { rarity: e.rarity });
    });

    bus.on("wave:started", (e) => {
      audio.setMood(e.elite || this.world.encounter.isMiniboss ? "boss" : "combat");
      audio.play("waveStart");
      pushToast(
        this.world.encounter.isMiniboss
          ? "Arena mini-bossa"
          : `Encounter ${e.wave}${e.elite ? " — pakiet elitarny" : ""}`,
        "wave",
      );
      recordEvent("wave_started", { wave: e.wave, enemies: e.enemies, elite: e.elite });
    });

    bus.on("wave:cleared", (e) => {
      audio.setMood("explore");
      recordEvent("wave_cleared", { wave: e.wave });
      void this.save();
    });

    bus.on("boss:spawned", (e) => {
      hud.bossName = e.name;
      hud.bossMaxHp = e.hp;
      hud.bossHp = e.hp;
      hud.bossBreakMax = e.breakBar;
      hud.bossBreak = e.breakBar;
      audio.setMood("boss");
    });

    bus.on("boss:broken", () => {
      hud.bossBroken = true;
      pushToast("Break! +50% otrzymywanych obrażeń", "info");
      setTimeout(() => (hud.bossBroken = false), 8000);
    });

    bus.on("boss:died", () => {
      hud.bossName = "";
      audio.setMood("explore");
      void this.save();
    });

    bus.on("player:died", (e) => {
      hud.screen = "dead";
      this.loop.setPaused(false);
      recordEvent("player_died", { room: e.room, level: this.world.character.level });
      pushToast("Poległeś — tracisz 10% złota", "info");
    });

    bus.on("net:status", (e) => {
      hud.online = e.online;
      hud.balanceSource = netStatus.source;
    });
  }

  // ───────────────────────────────────────────────────────── pętla gry

  private tick(dt: number): void {
    if (hud.screen !== "playing") return;
    this.input.writeIntent(this.world.intent, this.aim);
    this.world.tick(dt);

    this.autosaveTimer += dt;
    if (this.autosaveTimer >= AUTOSAVE_INTERVAL) {
      this.autosaveTimer = 0;
      void this.save();
    }
  }

  private render(alpha: number, realDt: number): void {
    // Utrata fokusu → automatyczna pauza + wyciszenie (GDD §4.2).
    if (this.input.focusLost) {
      this.input.focusLost = false;
      if (hud.screen === "playing") this.toggleMenu();
    }

    this.renderer.screenToWorldPoint(this.input.mouseX, this.input.mouseY, this.aim);
    this.renderer.sync(this.world, hud.screen === "playing" ? alpha : 1, realDt);

    // VFX zamachu odpalamy w klatce, w której symulacja zaliczyła trafienie.
    const s = this.world.store;
    const p = this.world.player;
    const state = s.state[p]!;
    const hitDone = s.hitDone[p]!;
    if (hitDone === 1 && this.prevHitDone === 0 && (state === PState.Attack || state === PState.Heavy)) {
      const c = this.balance.combat;
      const step = state === PState.Heavy ? c.heavy : c.combo[s.subStep[p]!]!;
      this.renderer.spawnSwing(
        s.x[p]!,
        s.y[p]!,
        s.facing[p]!,
        (step.arcDeg * Math.PI) / 180,
        step.range,
        state === PState.Heavy,
      );
    }
    this.prevHitDone = hitDone;

    this.hudTick += realDt;
    if (this.hudTick >= 0.05) {
      this.hudTick = 0;
      this.syncHud(false);
    }
  }

  private syncHud(full: boolean): void {
    const w = this.world;
    const s = w.store;
    const ch = w.character;

    hud.hp = Math.max(0, s.hp[w.player]!);
    hud.maxHp = s.maxHp[w.player]!;
    hud.stamina = w.stamina;
    hud.maxStamina = w.derived.maxStamina;
    hud.potions = ch.potions;
    hud.maxPotions = this.balance.combat.player.potions.slots;
    hud.level = ch.level;
    hud.xp = ch.xp;
    hud.xpToNext = xpToNext(ch.level, this.balance);
    hud.gold = ch.gold;
    hud.kills = ch.totalKills;
    hud.attributePoints = ch.attributePoints;
    hud.skillPoints = ch.skillPoints;
    hud.attributes = { ...ch.attributes };
    hud.encounter = w.encounter.index;
    hud.zoneLevel = w.encounter.zoneLevel;
    hud.enemiesLeft = w.encounter.remaining;
    hud.intermission = w.encounter.active ? 0 : Math.max(0, w.encounter.intermission);
    hud.heavyCharge = s.state[w.player] === PState.HeavyCharge ? w.heavyChargeRatio : 0;
    hud.comboIndex = w.comboIndex;
    hud.fps = this.loop.stats.fps;
    hud.simMs = this.loop.stats.simMs;
    hud.gamepad = this.input.gamepadIndex !== null;

    if (w.bossEntity >= 0 && s.alive[w.bossEntity]) {
      hud.bossHp = Math.max(0, s.hp[w.bossEntity]!);
      hud.bossMaxHp = s.maxHp[w.bossEntity]!;
      hud.bossBreak = Math.max(0, s.breakBar[w.bossEntity]!);
      hud.bossBreakMax = s.breakBarMax[w.bossEntity]!;
    } else if (hud.bossName && !s.alive[w.bossEntity]) {
      hud.bossName = "";
    }

    // Winieta + przytłumienie dźwięku poniżej 30% HP (GDD §10.2).
    const low = hud.hp / hud.maxHp < 0.3 && hud.hp > 0;
    if (low !== this.lowHp) {
      this.lowHp = low;
      audio.setLowHealth(low);
    }

    if (full) {
      hud.equipment = { ...ch.equipment };
      hud.inventory = [...ch.inventory];
    } else if (hud.inventory.length !== ch.inventory.length) {
      hud.inventory = [...ch.inventory];
    }
  }

  // ────────────────────────────────────────────────────── sterowanie UI

  async startGame(): Promise<void> {
    if (!this.started) {
      this.started = true;
      // Dopiero gest użytkownika może wznowić AudioContext.
      await audio.resume();
      startTelemetryLoop();
    }
    hud.screen = "playing";
    this.loop.setPaused(false);
  }

  toggleMenu(): void {
    if (hud.screen === "playing") {
      hud.screen = "paused";
      this.loop.setPaused(true);
      audio.play("uiClick");
    } else if (hud.screen === "paused" || hud.screen === "options" || hud.screen === "inventory") {
      hud.screen = "playing";
      this.loop.setPaused(false);
      audio.play("uiClick");
    }
  }

  /**
   * Ekwipunek musi dać się otworzyć także z menu pauzy — wcześniej przycisk
   * „Ekwipunek" w pauzie nie robił nic, bo obsługiwany był tylko stan `playing`,
   * przez co gra wyglądała na zawieszoną.
   */
  toggleInventory(): void {
    if (hud.screen === "inventory") {
      this.closeInventory();
      return;
    }
    if (hud.screen === "playing" || hud.screen === "paused" || hud.screen === "options") {
      this.syncHud(true);
      hud.screen = "inventory";
      this.loop.setPaused(true);
      // Input trzymany w chwili otwarcia nie może przeciekać do gry.
      this.input.clearHeld();
      this.world.intent.attackHeld = false;
      this.world.intent.moveX = 0;
      this.world.intent.moveY = 0;
    }
  }

  closeInventory(): void {
    if (hud.screen !== "inventory") return;
    hud.screen = "playing";
    this.loop.setPaused(false);
    this.input.clearHeld();
  }

  resume(): void {
    hud.screen = "playing";
    this.loop.setPaused(false);
  }

  restartAfterDeath(): void {
    // Odradzamy natychmiast — bez tego gracz oglądał 2.4 s martwego ekranu
    // po kliknięciu „Wróć na arenę".
    this.world.respawnNow();
    hud.screen = "playing";
    this.loop.setPaused(false);
  }

  applySettings(settings: GameSettings): void {
    hud.settings = settings;
    this.world.difficultyId = settings.difficulty;
    this.renderer.camera.shakeIntensity = settings.shakeIntensity;
    audio.settings = { ...settings.audio };
    audio.applySettings();
    setTelemetryOptIn(settings.telemetryOptIn);
    document.documentElement.style.setProperty("--ui-scale", String(settings.uiScale));
    document.documentElement.dataset.colorblind = settings.colorblind;
    void this.save();
  }

  equip(item: Item): void {
    const ch = this.world.character;
    const slot = item.slot;
    const current = ch.equipment[slot];
    ch.equipment[slot] = item;
    const idx = ch.inventory.findIndex((i) => i.id === item.id);
    if (idx >= 0) ch.inventory.splice(idx, 1);
    if (current) ch.inventory.push(current);
    this.world.refreshDerived();
    this.syncHud(true);
    audio.play("pickup");
    void this.save();
  }

  unequip(slot: string): void {
    const ch = this.world.character;
    const item = ch.equipment[slot];
    if (!item) return;
    delete ch.equipment[slot];
    ch.inventory.push(item);
    this.world.refreshDerived();
    this.syncHud(true);
    void this.save();
  }

  sell(item: Item): void {
    const ch = this.world.character;
    const idx = ch.inventory.findIndex((i) => i.id === item.id);
    if (idx < 0) return;
    ch.inventory.splice(idx, 1);
    ch.gold += item.sellValue;
    this.world.refreshDerived();
    this.syncHud(true);
    audio.play("gold");
    void this.save();
  }

  sellAll(rarities: string[]): void {
    const ch = this.world.character;
    let gained = 0;
    for (let i = ch.inventory.length - 1; i >= 0; i--) {
      const item = ch.inventory[i]!;
      if (rarities.includes(item.rarity)) {
        gained += item.sellValue;
        ch.inventory.splice(i, 1);
      }
    }
    ch.gold += gained;
    this.syncHud(true);
    if (gained > 0) {
      audio.play("gold");
      pushToast(`Sprzedano za ${gained} złota`, "info");
    }
    void this.save();
  }

  allocate(attr: "strength" | "dexterity" | "vitality" | "will"): void {
    const ch = this.world.character;
    if (ch.attributePoints <= 0) return;
    ch.attributePoints--;
    ch.attributes[attr]++;
    this.world.refreshDerived();
    this.world.derived = deriveStats(ch, this.balance);
    this.syncHud(true);
    audio.play("uiClick");
    void this.save();
  }

  // ───────────────────────────────────────────────────────────── zapis

  async save(): Promise<void> {
    const raw: SaveData = {
      save_version: SAVE_VERSION,
      updated_at: new Date().toISOString(),
      seed: this.world.rng.seed,
      character: this.world.character,
      encounterIndex: this.world.encounter.index,
      settings: hud.settings,
      stats: {
        kills: this.world.character.totalKills,
        playtime: Math.round(this.world.elapsed),
        deaths: 0,
      },
    };
    // `hud.settings` to proxy runes Svelte 5 — `structuredClone` w IndexedDB
    // rzuca na nim DataCloneError. Zapis i tak jest czystym JSON-em, więc
    // round-trip przez JSON zdejmuje proxy i gwarantuje serializowalność.
    const data: SaveData = JSON.parse(JSON.stringify(raw)) as SaveData;
    try {
      await writeSave(data, 1);
      void syncSave(1, data);
    } catch (err) {
      console.warn("[save] zapis nieudany", err);
    }
  }

  countAlive(): number {
    const s = this.world.store;
    let n = 0;
    for (let i = 0; i < s.count; i++) if (s.alive[i] && s.kind[i] === Kind.Enemy) n++;
    return n;
  }
}

export const game = new Game();
export { FIXED_DT };
