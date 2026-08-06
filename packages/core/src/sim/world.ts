/**
 * Rdzeń symulacji — 60 Hz, bez DOM, bez sieci (GDD §11.0).
 * Ten sam plik napędza grę w przeglądarce i headless symulator balansu.
 */
import type { EventBus } from "../core/bus.ts";
import { RngStreams } from "../core/rng.ts";
import { SpatialHash } from "../core/spatial.ts";
import { clamp, dist, inCone, TAU } from "../core/math.ts";
import type { Balance, EnemyDef } from "../data/schema.ts";
import {
  generateBestiary,
  traitLabels,
  BOSSES_PER_SPECIES,
  MAX_BOSS_TIERS,
  MAX_SPECIES,
  ROUNDS_PER_SPECIES,
  UNITS_PER_SPECIES,
  UNLOCKS_PER_BOSS,
  speciesNameFor,
  type Bestiary,
} from "./enemygen.ts";
import {
  ARENA_RADIUS,
  generateArena,
  ROUNDS_PER_BIOME,
  type ArenaLayout,
  type Obstacle,
} from "./arena.ts";
import {
  createCharacter,
  deriveStats,
  xpToNext,
  type CharacterState,
  type DerivedStats,
} from "../domain/character.ts";
import type { Item } from "../domain/item.ts";
import { EntityStore, EState, Flag, Kind, PState } from "./entities.ts";
import { computeDamage, type AttackContext } from "./damage.ts";
import { LootGenerator } from "./loot.ts";
import { KillCombo } from "./combo.ts";
import { updateEnemyAi } from "./ai.ts";
import { FORGE_CORE_COST, forgeQuote, type ForgeQuote } from "./smith.ts";

/**
 * Promień areny mieszka teraz w `arena.ts` (obok reguł rozstawiania przeszkód),
 * ale reeksportujemy go stąd — połowa gry importuje go z `world.ts`.
 */
export { ARENA_RADIUS };
export type { Obstacle };

/**
 * Zasięg automatycznego zwracania się do wroga w trybie „kierunek ruchu".
 * Nieco większy od najdłuższego zasięgu ataku gracza — postać ma się obracać
 * do celu, zanim ten wejdzie w zasięg ciosu, a nie dopiero przy nim.
 */
const AUTO_FACE_RANGE = 6;

export interface PlayerIntent {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  /**
   * Gracz nie prowadzi kursora — kierunek ma wynikać z ruchu, a w bezruchu
   * z położenia najbliższego wroga. Ustawiane przez warstwę wejścia w trybie
   * celowania „kierunek ruchu" (domyślnym, bo na trackpadzie prowadzenie
   * kursora i chodzenie naraz jest niewykonalne).
   */
  autoFace: boolean;
  attackPressed: boolean;
  attackHeld: boolean;
  heavyPressed: boolean;
  dodgePressed: boolean;
  sprint: boolean;
  potionPressed: boolean;
}

export interface PickupPayload {
  /** `core` to rdzeń kowala z bossa — waluta warsztatu (`sim/smith.ts`). */
  type: "gold" | "potion" | "item" | "core";
  amount: number;
  item?: Item;
}

export const Buffered = { None: 0, Attack: 1, Dodge: 2, Potion: 3, Heavy: 4 } as const;

/** Licznik z zapisu, który może być pusty albo uszkodzony. Zawsze liczba ≥ 0. */
function count(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : 0;
}

/**
 * Sufit poziomu strefy. Podniesiony z 25: przy dwustu rundach areny wszystko
 * powyżej pięćdziesiątej rundy przestawało rosnąć — wrogowie, item level łupu
 * i nagrody stały w miejscu, więc dalsza gra nie dawała już nic poza licznikiem.
 */
export const MAX_ZONE_LEVEL = 60;

/** Poziom strefy dla rundy: rośnie co dwie rundy, sufit `MAX_ZONE_LEVEL` (GDD §9.2). */
export function zoneLevelFor(round: number): number {
  return Math.min(MAX_ZONE_LEVEL, 1 + Math.floor((Math.max(1, round) - 1) / 2));
}

export interface EncounterState {
  index: number;
  zoneLevel: number;
  intermission: number;
  active: boolean;
  isMiniboss: boolean;
  isElite: boolean;
  remaining: number;
}

export class World {
  readonly store = new EntityStore();
  readonly spatial = new SpatialHash(2.5);
  readonly rng: RngStreams;
  readonly bus: EventBus;
  readonly balance: Balance;
  readonly loot: LootGenerator;
  /** Seria zabójstw — mnożnik złota i XP (patrz `combo.ts`). */
  readonly killCombo: KillCombo;

  readonly player = 0;
  character: CharacterState;
  derived: DerivedStats;

  stamina = 100;
  private staminaDelay = 0;
  poise = 30;
  comboIndex = 0;
  comboTimer = 0;
  private dodgeCooldown = 0;
  private attackHoldTimer = 0;
  private heavyCharge = 0;
  private heavyReleased = false;
  private potionHealRemaining = 0;
  private potionHealRate = 0;
  private respawnTimer = 0;
  private invulnTimer = 0;
  private cheatDeathCooldown = 0;
  private igniteTimers = new Float32Array(512);

  bufferedAction: number = Buffered.None;
  private bufferTimer = 0;

  readonly obstacles: Obstacle[] = [];
  /**
   * Aktualna arena: biom, horyzont i układ przeszkód. Wymieniana po każdym
   * wygranym poziomie (patrz `advanceArena`). Zawartość jest wyprowadzana
   * z `(ziarno, runda)`, więc nie trafia do zapisu — wystarczy numer rundy.
   */
  arena: ArenaLayout;
  readonly pickups = new Map<number, PickupPayload>();
  readonly enemyDefs: EnemyDef[];
  /**
   * Proceduralny bestiariusz doklejony za ręcznym rosterem. Generowany w całości
   * przy starcie, bo `defIdx` encji to indeks w `enemyDefs` — tablica musi mieć
   * ten sam kształt w każdej sesji, inaczej wczytany zapis wskazywałby na
   * innego potwora.
   */
  readonly bestiary: Bestiary;
  /** Indeks pierwszego wygenerowanego wpisu — wszystko przed nim jest ręczne. */
  private readonly genOffset: number;
  /** Indeks pierwszej jednostki gatunkowej w `enemyDefs`. Układ ustala konstruktor. */
  private readonly speciesOffset: number;

  encounter: EncounterState = {
    index: 0,
    zoneLevel: 1,
    intermission: 3,
    active: false,
    isMiniboss: false,
    isElite: false,
    remaining: 0,
  };

  bossEntity = -1;
  difficultyId = "hunter";
  elapsed = 0;
  sessionKills = 0;
  paused = false;

  readonly intent: PlayerIntent = {
    moveX: 0,
    moveY: 0,
    aimX: 1,
    aimY: 0,
    autoFace: false,
    attackPressed: false,
    attackHeld: false,
    heavyPressed: false,
    dodgePressed: false,
    sprint: false,
    potionPressed: false,
  };

  constructor(opts: { balance: Balance; seed: number; bus: EventBus; difficulty?: string }) {
    this.balance = opts.balance;
    this.bus = opts.bus;
    this.rng = new RngStreams(opts.seed);
    this.loot = new LootGenerator(opts.balance, this.rng.loot);
    this.killCombo = new KillCombo(opts.balance.combat.killCombo);
    this.bestiary = generateBestiary(opts.seed);
    this.genOffset = opts.balance.enemies.roster.length;
    this.enemyDefs = [
      ...opts.balance.enemies.roster,
      ...this.bestiary.bosses,
      ...this.bestiary.unlocks.flat(),
      ...this.bestiary.species.flat(),
    ];
    this.speciesOffset =
      this.genOffset + MAX_BOSS_TIERS + MAX_BOSS_TIERS * UNLOCKS_PER_BOSS;
    this.difficultyId = opts.difficulty ?? "hunter";
    this.character = createCharacter(opts.balance);
    this.derived = deriveStats(this.character, opts.balance);
    this.arena = this.buildArena(1);
    this.spawnPlayer();
  }

  // ─────────────────────────────────────────────────────────── arena

  /**
   * Buduje układ areny dla rundy i podmienia listę przeszkód w miejscu —
   * `obstacles` jest `readonly`, bo AI i kolizje trzymają do niej referencję.
   *
   * `avoid` chroni środek areny (punkt odrodzenia) i aktualną pozycję gracza:
   * arena wymienia się w trakcie oddechu, więc drzewo nie ma prawa wyrosnąć
   * tam, gdzie ktoś stoi.
   */
  private buildArena(round: number): ArenaLayout {
    const s = this.store;
    const p = this.player;
    const avoid = [{ x: 0, y: 0, r: 1.2 }];
    if (s.alive[p]) avoid.push({ x: s.x[p]!, y: s.y[p]!, r: s.radius[p]! + 1.0 });

    const layout = generateArena(round, this.rng.seed, avoid);
    this.obstacles.length = 0;
    for (const o of layout.obstacles) this.obstacles.push(o);
    return layout;
  }

  /**
   * Ustawia arenę pod bieżącą rundę **bez ogłaszania przejścia**. Potrzebne po
   * wczytaniu zapisu: konstruktor zbudował arenę rundy 1, a zapis przywraca
   * na przykład dwudziestą — bez tego każdy powrót do gry lądował na pierwszej
   * planszy, mimo że licznik rund mówił co innego.
   */
  resetArena(): void {
    this.arena = this.buildArena(this.encounter.index + 1);
    this.announcedSpecies = this.speciesStage;
  }

  /**
   * Przejście na następną arenę. Wołane po wygranym poziomie, w chwili
   * rozpoczęcia oddechu — nagrodą za czyszczenie fali jest **zmiana miejsca**,
   * a nie tylko rosnąca liczba w HUD-zie.
   *
   * Łupy leżące na ziemi zostają: arena się zmienia, ale nikt nie zabiera
   * graczowi tego, co już wypadło.
   */
  private advanceArena(round: number): void {
    const before = this.arena;
    this.arena = this.buildArena(round);
    this.bus.emit("arena:changed", {
      round: this.arena.round,
      biomeId: this.arena.biome.id,
      biomeName: this.arena.biome.name,
      biomeIndex: this.arena.biomeIndex,
      /** Zmiana biomu (co `ROUNDS_PER_BIOME` rund) to inny kolor i inny horyzont. */
      newBiome: before.biome.id !== this.arena.biome.id,
      roundsPerBiome: ROUNDS_PER_BIOME,
      zoneLevel: zoneLevelFor(round),
    });
  }

  private spawnPlayer(): void {
    const id = this.store.spawn(Kind.Player);
    const s = this.store;
    s.x[id] = 0;
    s.y[id] = 0;
    s.prevX[id] = 0;
    s.prevY[id] = 0;
    s.radius[id] = this.balance.combat.player.radius;
    s.mass[id] = this.balance.combat.player.mass;
    s.maxHp[id] = this.derived.maxHp;
    s.hp[id] = this.derived.maxHp;
    s.level[id] = 1;
    s.state[id] = PState.Idle;
    this.stamina = this.derived.maxStamina;
    this.poise = this.derived.maxPoise;
  }

  /**
   * Górny pułap HP z uwzględnieniem overhealu z zabójstw.
   * `overhealCap` = 1 znosi overheal, 0 oznacza brak limitu.
   */
  get overhealLimit(): number {
    const cap = this.balance.combat.player.overhealCap;
    const max = this.store.maxHp[this.player];
    if (cap <= 0) return Number.POSITIVE_INFINITY;
    return max * Math.max(1, cap);
  }

  refreshDerived(): void {
    const before = this.derived.maxHp;
    this.derived = deriveStats(this.character, this.balance);
    const s = this.store;
    s.maxHp[this.player] = this.derived.maxHp;
    if (this.derived.maxHp > before) s.hp[this.player] += this.derived.maxHp - before;
    // Przycinamy do pułapu overhealu, a nie do max HP — inaczej awans na poziom
    // albo zmiana ekwipunku kasowałaby nadwyżkę zebraną zabójstwami.
    s.hp[this.player] = Math.min(s.hp[this.player], this.overhealLimit);
    this.stamina = Math.min(this.stamina, this.derived.maxStamina);
  }

  get difficulty() {
    return (
      this.balance.combat.difficulty[this.difficultyId] ??
      this.balance.combat.difficulty.hunter!
    );
  }

  get isDead(): boolean {
    return this.store.state[this.player] === PState.Dead;
  }

  get hp(): number {
    return this.store.hp[this.player];
  }

  get maxHp(): number {
    return this.store.maxHp[this.player];
  }

  // ─────────────────────────────────────────────────────────── tick

  tick(dt: number): void {
    if (this.paused) return;
    this.elapsed += dt;
    this.store.snapshot();

    tickTimers(dt);
    this.updateBuffer(dt);
    this.updatePlayer(dt);
    this.rebuildSpatial();
    updateEnemyAi(this, dt);
    this.updateProjectiles(dt);
    this.updateHazards(dt);
    this.updatePickups(dt);
    this.resolveCollisions();
    this.updateEncounter(dt);
    this.updateCombo(dt);
    this.decayVisuals(dt);
  }

  /**
   * Zegar serii. Odliczamy w `tick`, a nie w kliencie, bo od tego zależy
   * wysokość nagrody — a nagrody liczy symulacja, nie warstwa prezentacji.
   */
  private updateCombo(dt: number): void {
    const broken = this.killCombo.tick(dt);
    if (broken > 0) {
      this.bus.emit("combo:broken", { count: broken, best: this.killCombo.best });
      this.bus.emit("sfx", { name: "comboBreak" });
    }
  }

  private rebuildSpatial(): void {
    const s = this.store;
    this.spatial.clear();
    for (let i = 0; i < s.count; i++) {
      if (!s.alive[i]) continue;
      if (s.kind[i] === Kind.Enemy || s.kind[i] === Kind.Player) {
        this.spatial.insert(i, s.x[i], s.y[i]);
      }
    }
  }

  private decayVisuals(dt: number): void {
    const s = this.store;
    for (let i = 0; i < s.count; i++) {
      if (!s.alive[i]) continue;
      if (s.hitFlash[i] > 0) s.hitFlash[i] = Math.max(0, s.hitFlash[i] - dt);
      if (this.igniteTimers[i] > 0) {
        this.igniteTimers[i] -= dt;
        if (s.kind[i] === Kind.Enemy && s.alive[i]) {
          const dps = s.maxHp[i] * 0.12;
          this.damageEnemy(i, dps * dt, false, "fire", 0, 0, 0, true);
        }
      }
    }
  }

  // ─────────────────────────────────────────────────── input buffer

  /** Input buffering 150 ms (GDD §4.1) — komenda pod koniec animacji wykona się natychmiast po niej. */
  private updateBuffer(dt: number): void {
    if (this.bufferTimer > 0) {
      this.bufferTimer -= dt;
      if (this.bufferTimer <= 0) this.bufferedAction = Buffered.None;
    }
    const i = this.intent;
    if (i.dodgePressed) this.buffer(Buffered.Dodge);
    else if (i.potionPressed) this.buffer(Buffered.Potion);
    else if (i.heavyPressed) this.buffer(Buffered.Heavy);
    else if (i.attackPressed) this.buffer(Buffered.Attack);

    i.attackPressed = false;
    i.dodgePressed = false;
    i.potionPressed = false;
    i.heavyPressed = false;
  }

  private buffer(action: number): void {
    this.bufferedAction = action;
    this.bufferTimer = this.balance.combat.inputBufferSeconds;
  }

  private consumeBuffer(): void {
    this.bufferedAction = Buffered.None;
    this.bufferTimer = 0;
  }

  // ────────────────────────────────────────────────────────── player

  private updatePlayer(dt: number): void {
    const s = this.store;
    const p = this.player;
    const c = this.balance.combat;

    if (s.state[p] === PState.Dead) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawnNow();
      return;
    }

    if (this.cheatDeathCooldown > 0) this.cheatDeathCooldown -= dt;
    if (this.invulnTimer > 0) this.invulnTimer -= dt;

    // — mikstura leczy w czasie, nie natychmiast (GDD §5.1)
    if (this.potionHealRemaining > 0) {
      const heal = Math.min(this.potionHealRate * dt, this.potionHealRemaining);
      s.hp[p] = Math.min(s.maxHp[p], s.hp[p] + heal);
      this.potionHealRemaining -= heal;
    }

    // — pasywna regeneracja HP. Świadome odstępstwo od GDD §5.1 („brak
    //   regeneracji, tylko mikstury / lifesteal") na życzenie projektowe.
    //   Kończy się na max HP — nadwyżkę ponad limit daje wyłącznie leczenie
    //   za zabójstwo. Wyłącza się `player.hpRegen = 0` w data/combat.json.
    if (c.player.hpRegen > 0 && s.hp[p] < s.maxHp[p]) {
      s.hp[p] = Math.min(s.maxHp[p], s.hp[p] + c.player.hpRegen * dt);
    }

    // — regeneracja poise i staminy
    this.poise = Math.min(this.derived.maxPoise, this.poise + c.player.poiseRegen * dt);
    if (this.staminaDelay > 0) this.staminaDelay -= dt;
    else this.stamina = Math.min(this.derived.maxStamina, this.stamina + c.player.staminaRegen * dt);

    s.stateTime[p] += dt;
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.comboIndex = 0;
    }
    if (this.dodgeCooldown > 0) this.dodgeCooldown -= dt;

    // — celowanie: kierunek do kursora (soft-lock kierunkowy)
    let aimDx = this.intent.aimX - s.x[p];
    let aimDy = this.intent.aimY - s.y[p];

    // W trybie „kierunek ruchu" stojąca postać nie miałaby jak się obrócić —
    // wróg za plecami wymagałby zrobienia kroku, żeby go w ogóle dosięgnąć.
    // Dlatego w bezruchu przejmuje kierunek najbliższego wroga. To jedyne
    // miejsce, w którym silnik celuje za gracza, i dotyczy wyłącznie OBROTU:
    // decyzja o ataku, uniku i pozycji pozostaje po jego stronie.
    const moving = this.intent.moveX * this.intent.moveX + this.intent.moveY * this.intent.moveY > 0.02;
    if (this.intent.autoFace && !moving) {
      const target = this.nearestEnemy(s.x[p], s.y[p], AUTO_FACE_RANGE);
      if (target >= 0) {
        aimDx = s.x[target] - s.x[p];
        aimDy = s.y[target] - s.y[p];
      }
    }

    if (aimDx * aimDx + aimDy * aimDy > 0.01 && this.canRotate(s.state[p], s.stateTime[p])) {
      s.facing[p] = Math.atan2(aimDy, aimDx);
    }

    switch (s.state[p]) {
      case PState.Idle:
      case PState.Move:
        this.updateGrounded(dt);
        break;
      case PState.Attack:
      case PState.Heavy:
        this.updateAttack(dt);
        break;
      case PState.HeavyCharge:
        this.updateHeavyCharge(dt);
        break;
      case PState.Dodge:
        this.updateDodge(dt);
        break;
      case PState.Hurt:
        s.vx[p] *= 0.86;
        s.vy[p] *= 0.86;
        if (s.stateTime[p] >= s.stateDuration[p]) this.setPlayerState(PState.Idle, 0);
        break;
      case PState.Drink:
        s.vx[p] *= 0.9;
        s.vy[p] *= 0.9;
        if (s.stateTime[p] >= s.stateDuration[p]) this.setPlayerState(PState.Idle, 0);
        break;
    }

    s.x[p] += s.vx[p] * dt;
    s.y[p] += s.vy[p] * dt;
    this.constrainToArena(p);
  }

  private canRotate(state: number, stateTime: number): boolean {
    if (state === PState.Dodge) return stateTime < 0.05;
    if (state === PState.Attack || state === PState.Heavy) return stateTime < 0.09;
    if (state === PState.Hurt || state === PState.Dead) return false;
    return true;
  }

  private setPlayerState(state: number, duration: number): void {
    const s = this.store;
    s.state[this.player] = state;
    s.stateTime[this.player] = 0;
    s.stateDuration[this.player] = duration;
    s.hitDone[this.player] = 0;
  }

  private updateGrounded(dt: number): void {
    const s = this.store;
    const p = this.player;
    const c = this.balance.combat;

    // Akcje z bufora — priorytet: unik > mikstura > ciężki > atak
    if (this.bufferedAction === Buffered.Dodge && this.tryDodge()) return;
    if (this.bufferedAction === Buffered.Potion && this.tryPotion()) return;
    if (this.bufferedAction === Buffered.Heavy && this.tryHeavyCharge()) return;
    if (this.bufferedAction === Buffered.Attack && this.tryAttack()) return;

    const mx = this.intent.moveX;
    const my = this.intent.moveY;
    const len = Math.hypot(mx, my);
    let speed = this.derived.moveSpeed;

    const sprinting = this.intent.sprint && len > 0.1 && this.stamina > 1;
    if (sprinting) {
      speed *= c.player.sprintMultiplier;
      this.spendStamina(c.player.sprintStaminaPerSec * dt, false);
    }

    if (len > 0.1) {
      s.vx[p] = (mx / len) * speed;
      s.vy[p] = (my / len) * speed;
      if (s.state[p] !== PState.Move) {
        s.state[p] = PState.Move;
        s.stateTime[p] = 0;
      }
    } else {
      s.vx[p] *= 0.72;
      s.vy[p] *= 0.72;
      if (Math.abs(s.vx[p]) < 0.02 && Math.abs(s.vy[p]) < 0.02) {
        s.vx[p] = 0;
        s.vy[p] = 0;
        if (s.state[p] !== PState.Idle) {
          s.state[p] = PState.Idle;
          s.stateTime[p] = 0;
        }
      }
    }
  }

  private spendStamina(amount: number, resetDelay = true): boolean {
    if (this.stamina < amount) {
      if (amount > 5) this.bus.emit("player:staminaEmpty", {});
      return false;
    }
    this.stamina -= amount;
    if (resetDelay) this.staminaDelay = this.balance.combat.player.staminaRegenDelay;
    else this.staminaDelay = Math.max(this.staminaDelay, 0.12);
    return true;
  }

  private tryAttack(): boolean {
    const c = this.balance.combat;
    const step = c.combo[Math.min(this.comboIndex, c.combo.length - 1)]!;
    if (step.staminaCost > 0 && !this.spendStamina(step.staminaCost)) return false;
    this.consumeBuffer();
    this.attackHoldTimer = 0;
    this.setPlayerState(PState.Attack, step.duration / this.derived.attackSpeed);
    this.store.subStep[this.player] = this.comboIndex;
    this.bus.emit("player:attack", { combo: this.comboIndex + 1, heavy: false });
    this.bus.emit("sfx", { name: `swing${this.comboIndex + 1}` });
    return true;
  }

  private tryHeavyCharge(): boolean {
    this.consumeBuffer();
    this.heavyCharge = 0;
    this.heavyReleased = false;
    this.setPlayerState(PState.HeavyCharge, 999);
    this.bus.emit("sfx", { name: "charge" });
    return true;
  }

  private tryDodge(): boolean {
    const c = this.balance.combat;
    if (this.dodgeCooldown > 0) return false;
    if (!this.spendStamina(c.dodge.staminaCost)) return false;
    this.consumeBuffer();

    const s = this.store;
    const p = this.player;
    let dx = this.intent.moveX;
    let dy = this.intent.moveY;
    const len = Math.hypot(dx, dy);
    if (len < 0.1) {
      dx = Math.cos(s.facing[p]);
      dy = Math.sin(s.facing[p]);
    } else {
      dx /= len;
      dy /= len;
    }

    const travelTime = c.dodge.duration - c.dodge.recovery;
    const speed = c.dodge.distance / travelTime;
    s.vx[p] = dx * speed;
    s.vy[p] = dy * speed;
    this.dodgeCooldown = c.dodge.duration + c.dodge.cooldown;
    this.setPlayerState(PState.Dodge, c.dodge.duration);
    this.bus.emit("player:dodged", { x: s.x[p], y: s.y[p], iframe: true });
    this.bus.emit("sfx", { name: "dodge" });

    // Legenda „Buty Widma": unik zostawia iluzję przyciągającą wrogów.
    if (this.hasLegendary("wraith_boots")) this.spawnDecoy(s.x[p], s.y[p], 3);
    return true;
  }

  private tryPotion(): boolean {
    if (this.character.potions <= 0) return false;
    if (this.potionHealRemaining > 0) return false;
    this.consumeBuffer();
    const c = this.balance.combat.player.potions;
    const willBonus =
      this.character.attributes.will *
      Number(this.balance.progression.attributes.will?.potionEffectPctPerPoint ?? 0);
    const total = this.store.maxHp[this.player] * c.healPct * (1 + willBonus);
    this.potionHealRemaining = total;
    this.potionHealRate = total / c.healDuration;
    this.character.potions--;
    this.setPlayerState(PState.Drink, 0.5);
    this.bus.emit("potion:used", { remaining: this.character.potions });
    this.bus.emit("sfx", { name: "potion" });
    return true;
  }

  private updateHeavyCharge(dt: number): void {
    const s = this.store;
    const p = this.player;
    const heavy = this.balance.combat.heavy;
    s.vx[p] *= 0.82;
    s.vy[p] *= 0.82;
    this.heavyCharge = Math.min(heavy.chargeTime, this.heavyCharge + dt);

    // Unik przerywa ładowanie w każdej chwili.
    if (this.bufferedAction === Buffered.Dodge && this.tryDodge()) return;

    const released = !this.intent.attackHeld || this.heavyReleased;
    if (released) {
      if (!this.spendStamina(heavy.staminaCost)) {
        this.setPlayerState(PState.Idle, 0);
        return;
      }
      this.setPlayerState(PState.Heavy, heavy.duration / this.derived.attackSpeed);
      this.bus.emit("player:attack", { combo: 0, heavy: true });
      this.bus.emit("sfx", { name: "heavySwing" });
    }
  }

  get heavyChargeRatio(): number {
    return this.heavyCharge / this.balance.combat.heavy.chargeTime;
  }

  private updateAttack(dt: number): void {
    const s = this.store;
    const p = this.player;
    const c = this.balance.combat;
    const isHeavy = s.state[p] === PState.Heavy;
    const step = isHeavy ? c.heavy : c.combo[s.subStep[p]]!;
    const progress = s.stateTime[p] / s.stateDuration[p];

    // Krok do przodu w trakcie zamachu — bez tego ataki „nie sięgają".
    const advance = step.advance * (1 - clamp(progress * 1.4, 0, 1));
    s.vx[p] = Math.cos(s.facing[p]) * advance * 3.2;
    s.vy[p] = Math.sin(s.facing[p]) * advance * 3.2;

    if (!s.hitDone[p] && progress >= step.hitAt) {
      s.hitDone[p] = 1;
      this.resolvePlayerHit(step, isHeavy);
    }

    // Animation cancel: unik przerywa atak po `cancelAt` długości (GDD §4.1).
    if (progress >= step.cancelAt) {
      if (this.bufferedAction === Buffered.Dodge && this.tryDodge()) return;
    }

    // Combo cancel: gdy cios już trafił, kolejne kliknięcie od razu przechodzi
    // do następnego ciosu, zamiast czekać na koniec animacji. To jest różnica
    // między „atak co animację" a „atak co klik".
    if (
      !isHeavy &&
      s.hitDone[p] === 1 &&
      progress >= step.cancelAt &&
      this.bufferedAction === Buffered.Attack
    ) {
      this.comboIndex = (s.subStep[p] + 1) % c.combo.length;
      this.comboTimer = c.comboWindow;
      if (this.tryAttack()) return;
    }

    if (s.stateTime[p] >= s.stateDuration[p]) {
      if (isHeavy) {
        this.comboIndex = 0;
        this.comboTimer = 0;
      } else {
        this.comboIndex = (s.subStep[p] + 1) % c.combo.length;
        this.comboTimer = c.comboWindow;
      }

      // Trzymanie LPM po zakończeniu ciosu przechodzi w ładowanie ciężkiego.
      if (!isHeavy && this.intent.attackHeld) {
        this.attackHoldTimer += dt;
        this.tryHeavyCharge();
        return;
      }
      this.setPlayerState(PState.Idle, 0);
    }
  }

  private resolvePlayerHit(
    step: { damageMult: number; poiseDamage: number; range: number; arcDeg: number; knockback: number },
    isHeavy: boolean,
  ): void {
    const s = this.store;
    const p = this.player;
    const c = this.balance.combat;
    const chargeScale = isHeavy ? 0.5 + 0.5 * this.heavyChargeRatio : 1;

    const ctx: AttackContext = {
      minDamage: this.derived.weaponMin,
      maxDamage: this.derived.weaponMax,
      skillMult: step.damageMult * chargeScale,
      increasedDamage: this.derived.increasedDamage,
      critChance: this.derived.critChance,
      critMult: this.derived.critMult,
      attackerLevel: this.character.level,
      flatElemental: this.derived.flatElemental,
      element: "physical",
    };

    const arcRad = (step.arcDeg * Math.PI) / 180;
    const found = this.spatial.query(s.x[p], s.y[p], step.range + 1.5);
    const results = this.spatial.results();
    let hits = 0;
    let killed = false;

    for (let k = 0; k < found; k++) {
      const e = results[k];
      if (e === p || !s.alive[e] || s.kind[e] !== Kind.Enemy) continue;
      if (!inCone(s.x[p], s.y[p], s.facing[p], arcRad, step.range, s.x[e], s.y[e], s.radius[e]))
        continue;

      const dmg = computeDamage(ctx, s.armor[e], 0, this.rng.crit, c);
      let amount = dmg.amount;

      // Blok frontalny szkieletów — obejść albo złamać ciężkim (GDD §7.2).
      const def = this.enemyDefs[s.defIdx[e]];
      const block = def?.traits?.["frontalBlock"] as
        | { arcDeg: number; reduction: number }
        | undefined;
      let blocked = false;
      if (block && !isHeavy && s.state[e] !== EState.Staggered) {
        const toPlayer = Math.atan2(s.y[p] - s.y[e], s.x[p] - s.x[e]);
        const facingDiff = Math.abs(((toPlayer - s.facing[e] + Math.PI * 3) % TAU) - Math.PI);
        if (facingDiff <= (block.arcDeg * Math.PI) / 180 / 2) {
          amount *= 1 - block.reduction;
          blocked = true;
        }
      }

      // Okno break bar bossa: +50% otrzymywanych obrażeń.
      if (s.breakWindow[e] > 0) amount *= 1 + (def?.breakDamageBonus ?? 0.5);

      const dead = this.damageEnemy(
        e,
        amount,
        dmg.crit,
        "physical",
        step.poiseDamage * (isHeavy ? 1 : 1),
        Math.cos(s.facing[p]) * step.knockback,
        Math.sin(s.facing[p]) * step.knockback,
        blocked,
      );
      if (dead) killed = true;
      hits++;

      if (this.derived.lifesteal > 0) {
        const heal = amount * this.derived.lifesteal;
        s.hp[p] = Math.min(s.maxHp[p], s.hp[p] + heal);
      }
      // Legenda „Kieł Pożogi": trzeci cios combo podpala cel.
      if (this.hasLegendary("fang_of_conflagration") && !isHeavy && s.subStep[p] === 2) {
        this.igniteTimers[e] = 4;
      }
    }

    const feel = c.gameFeel;
    if (hits > 0) {
      const hitstop = killed
        ? feel.hitstopKill
        : isHeavy
          ? feel.hitstopHeavy
          : feel.hitstopNormal;
      this.bus.emit("hitstop", {
        seconds: hitstop,
        slowMoScale: killed ? feel.killSlowMoScale : 1,
        slowMoDuration: killed ? feel.killSlowMoDuration : 0,
      });
      this.bus.emit("shake", {
        trauma: isHeavy ? feel.shakeTraumaHeavy : feel.shakeTraumaHit,
        dirX: Math.cos(s.facing[p]),
        dirY: Math.sin(s.facing[p]),
      });
      this.bus.emit("sfx", { name: isHeavy ? "hitHeavy" : "hit", x: s.x[p], y: s.y[p] });
    } else {
      this.bus.emit("sfx", { name: "whiff" });
    }
  }

  private updateDodge(dt: number): void {
    const s = this.store;
    const p = this.player;
    const c = this.balance.combat;
    const t = s.stateTime[p];

    if (t >= c.dodge.duration - c.dodge.recovery) {
      s.vx[p] *= 0.78;
      s.vy[p] *= 0.78;
    }

    if (t >= s.stateDuration[p]) {
      this.setPlayerState(PState.Idle, 0);
      // Bufor przechowany przez unik odpala się natychmiast po recovery.
      if (this.bufferedAction === Buffered.Attack) this.tryAttack();
    }
  }

  /** Klatki nietykalności 0.10 s → 0.42 s uniku (GDD §5.3). */
  get playerInvulnerable(): boolean {
    const s = this.store;
    const p = this.player;
    if (this.invulnTimer > 0) return true;
    if (s.hasFlag(p, Flag.Invulnerable)) return true;
    if (s.state[p] !== PState.Dodge) return false;
    const c = this.balance.combat.dodge;
    return s.stateTime[p] >= c.iFrameStart && s.stateTime[p] <= c.iFrameEnd;
  }

  // ────────────────────────────────────────────────────────── damage

  /** @returns true jeśli wróg zginął. */
  damageEnemy(
    e: number,
    amount: number,
    crit: boolean,
    element: string,
    poiseDamage: number,
    kbX: number,
    kbY: number,
    blocked: boolean,
  ): boolean {
    const s = this.store;
    if (!s.alive[e] || s.hp[e] <= 0) return false;

    s.hp[e] -= amount;
    s.hitFlash[e] = this.balance.combat.gameFeel.hitFlashDuration;

    this.bus.emit("enemy:damaged", {
      entity: e,
      amount,
      crit,
      x: s.x[e],
      y: s.y[e],
      element: blocked ? "blocked" : element,
    });

    if (kbX !== 0 || kbY !== 0) {
      const massScale = 1 / Math.max(0.4, s.mass[e]);
      s.vx[e] += kbX * massScale * 9;
      s.vy[e] += kbY * massScale * 9;
    }

    if (s.hp[e] <= 0) {
      this.killEnemy(e);
      return true;
    }

    // — Cierniowy: część obrażeń wraca do gracza, ale tylko ze zwarcia.
    //   Bez warunku odległości cecha karałaby też łuczników i buildy dystansowe,
    //   które z definicji nie mają jak jej uniknąć.
    const thorns = this.enemyDefs[s.defIdx[e]!]?.traits?.["thorns"] as
      | { reflectPct: number; range: number }
      | undefined;
    if (thorns && !blocked) {
      const p = this.player;
      if (dist(s.x[e]!, s.y[e]!, s.x[p]!, s.y[p]!) <= thorns.range + s.radius[p]!) {
        this.damagePlayer(amount * thorns.reflectPct, 0, "thorns", s.x[e]!, s.y[e]!);
      }
    }

    if (poiseDamage > 0) this.applyPoiseDamage(e, poiseDamage);
    return false;
  }

  private applyPoiseDamage(e: number, poiseDamage: number): void {
    const s = this.store;
    const stagger = this.balance.combat.stagger;

    // Bossowie mają break bar zamiast zwykłego staggera (GDD §5.5).
    if (s.breakBarMax[e] > 0) {
      if (s.breakWindow[e] > 0) return;
      s.breakBar[e] -= poiseDamage;
      if (s.breakBar[e] <= 0) {
        const def = this.enemyDefs[s.defIdx[e]];
        s.breakBar[e] = s.breakBarMax[e];
        s.breakWindow[e] = def?.breakWindow ?? 8;
        s.state[e] = EState.Staggered;
        s.stateTime[e] = 0;
        s.stateDuration[e] = stagger.duration * 1.6;
        s.setFlag(e, Flag.Broken, true);
        this.bus.emit("boss:broken", { entity: e, window: s.breakWindow[e] });
        this.bus.emit("sfx", { name: "break" });
      }
      return;
    }

    s.poise[e] -= poiseDamage;
    if (s.poise[e] <= 0) {
      const overflow = -s.poise[e];
      s.poise[e] = s.maxPoise[e] - Math.min(s.maxPoise[e] * stagger.overflow, overflow);
      s.state[e] = EState.Staggered;
      s.stateTime[e] = 0;
      s.stateDuration[e] = stagger.duration;
      this.releaseToken(e);
      this.bus.emit("enemy:staggered", { entity: e, x: s.x[e], y: s.y[e] });
      this.bus.emit("sfx", { name: "stagger" });
    }
  }

  damagePlayer(amount: number, poiseDamage: number, source: string, fromX: number, fromY: number): void {
    const s = this.store;
    const p = this.player;
    if (s.state[p] === PState.Dead || this.playerInvulnerable) return;

    const final = amount * this.difficulty.incomingDamage;
    s.hp[p] -= final;
    s.hitFlash[p] = this.balance.combat.gameFeel.hitFlashDuration;

    const feel = this.balance.combat.gameFeel;
    const dx = s.x[p] - fromX;
    const dy = s.y[p] - fromY;
    const len = Math.hypot(dx, dy) || 1;
    this.bus.emit("shake", { trauma: feel.shakeTraumaHurt, dirX: dx / len, dirY: dy / len });
    this.bus.emit("player:damaged", { amount: final, hp: s.hp[p], maxHp: s.maxHp[p], source });
    this.bus.emit("sfx", { name: "playerHurt" });

    this.poise -= poiseDamage;
    if (this.poise <= 0) {
      this.poise = this.derived.maxPoise;
      this.setPlayerState(PState.Hurt, this.balance.combat.stagger.duration * 0.6);
      s.vx[p] = (dx / len) * 4;
      s.vy[p] = (dy / len) * 4;
    }

    if (s.hp[p] <= 0) {
      // Legenda „Pancerz Ostatniego Tchu".
      if (this.hasLegendary("last_breath_plate") && this.cheatDeathCooldown <= 0) {
        s.hp[p] = 1;
        this.cheatDeathCooldown = 90;
        s.setFlag(p, Flag.Invulnerable, true);
        setTimeoutSafe(() => s.setFlag(p, Flag.Invulnerable, false), 2);
        return;
      }
      this.killPlayer();
    }
  }

  private killPlayer(): void {
    const s = this.store;
    s.hp[this.player] = 0;
    this.setPlayerState(PState.Dead, 0);
    this.respawnTimer = 2.4;
    const lost = Math.floor(this.character.gold * this.balance.progression.death.goldLossPct);
    this.character.gold -= lost;

    // Śmierć zrywa serię natychmiast, niezależnie od zegara. Bez tego combo
    // byłoby darmowe: gracz mógłby zginąć w środku „Zagłady" i wrócić po
    // odrodzeniu na tym samym mnożniku, czyli agresja przestałaby cokolwiek
    // kosztować.
    const brokenCombo = this.killCombo.reset();
    if (brokenCombo > 0) {
      this.bus.emit("combo:broken", { count: brokenCombo, best: this.killCombo.best });
    }

    this.bus.emit("player:died", { room: `encounter_${this.encounter.index}` });
    this.bus.emit("sfx", { name: "death" });
  }

  /**
   * Odrodzenie bez resetu areny: encounter, wrogowie i ich stan HP zostają
   * nietknięte — wraca tylko gracz. Postęp w walce nie przepada, więc śmierć
   * kosztuje złoto i czas, a nie cały pakiet.
   *
   * Wrogowie stoją tam, gdzie stali, dlatego respawn daje krótką nietykalność —
   * bez niej powrót w środek pakietu byłby pętlą śmierci.
   */
  respawnNow(): void {
    const s = this.store;
    const p = this.player;

    // Pociski i kałuże z poprzedniego życia znikają — inaczej gracz ginie
    // od czegoś, na co nie miał już wpływu.
    for (let i = 0; i < s.count; i++) {
      if (s.alive[i] && (s.kind[i] === Kind.Projectile || s.kind[i] === Kind.Hazard)) {
        s.despawn(i);
      }
    }

    s.x[p] = 0;
    s.y[p] = 0;
    s.prevX[p] = 0;
    s.prevY[p] = 0;
    s.vx[p] = 0;
    s.vy[p] = 0;
    s.hp[p] = s.maxHp[p];
    this.stamina = this.derived.maxStamina;
    this.poise = this.derived.maxPoise;
    this.character.potions = this.balance.combat.player.potions.slots;
    this.comboIndex = 0;
    this.comboTimer = 0;
    this.potionHealRemaining = 0;
    this.consumeBuffer();
    this.setPlayerState(PState.Idle, 0);
    this.respawnTimer = 0;
    this.invulnTimer = this.balance.combat.player.respawnInvulnerable;

    // Wrogowie gubią cel na moment — dostajemy oddech na repozycję.
    for (let i = 0; i < s.count; i++) {
      if (!s.alive[i] || s.kind[i] !== Kind.Enemy) continue;
      this.releaseToken(i);
      s.state[i] = EState.Chase;
      s.stateTime[i] = 0;
      s.cooldown[i] = Math.max(s.cooldown[i], 1.0);
    }
  }

  /**
   * Najbliższy żywy wróg w promieniu. Zwraca −1, gdy takiego nie ma.
   * Liniowe przejście po encjach jest tu tańsze niż zapytanie do siatki
   * przestrzennej: wywołujemy to raz na tick, a wrogów jest najwyżej kilkanaście.
   */
  private nearestEnemy(x: number, y: number, maxRange: number): number {
    const s = this.store;
    let best = -1;
    let bestDist = maxRange * maxRange;
    for (let i = 0; i < s.count; i++) {
      if (!s.alive[i] || s.kind[i] !== Kind.Enemy) continue;
      const dx = s.x[i] - x;
      const dy = s.y[i] - y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  private killEnemy(e: number): void {
    const s = this.store;
    const def = this.enemyDefs[s.defIdx[e]];
    if (!def) {
      s.despawn(e);
      return;
    }
    const elite = s.hasFlag(e, Flag.Elite);
    const boss = s.hasFlag(e, Flag.Boss);

    this.character.totalKills++;
    this.sessionKills++;
    this.releaseToken(e);

    // — leczenie za zabójstwo: ułamek maksymalnego HP celu, czyli twardsi
    //   wrogowie realnie się opłacają. Jako jedyne źródło leczenia wychodzi
    //   ponad limit HP (overheal) — regeneracja i mikstury kończą się na max.
    const killHealPct = this.balance.combat.player.killHealPct;
    if (killHealPct > 0 && s.state[this.player] !== PState.Dead) {
      const p = this.player;
      const before = s.hp[p];
      s.hp[p] = Math.min(this.overhealLimit, before + s.maxHp[e] * killHealPct);
      const healed = s.hp[p] - before;
      if (healed >= 1) this.bus.emit("player:healed", { amount: healed, hp: s.hp[p] });
    }

    // Pełzacz Zarazy eksploduje także po śmierci — presja na repozycję.
    if (def.attack.kind === "explode") this.explode(e, def, true);

    // — combo: zabójstwo przedłuża serię i podnosi mnożnik nagród.
    //   Liczymy je PRZED wypłatą, żeby to zabójstwo już z niego korzystało —
    //   inaczej pierwszy cios każdego tieru byłby wart tyle, co poprzedniego.
    const tierUp = this.killCombo.add();
    const comboMult = this.killCombo.multiplier;
    this.bus.emit("combo:changed", {
      count: this.killCombo.kills,
      tier: this.killCombo.tierIndex,
      name: this.killCombo.tier?.name ?? "",
      multiplier: comboMult,
      tierUp,
      x: s.x[e],
      y: s.y[e],
    });
    if (tierUp) this.bus.emit("sfx", { name: "comboTier" });

    this.bus.emit("enemy:died", {
      entity: e,
      typeId: def.id,
      x: s.x[e],
      y: s.y[e],
      xp: s.xpValue[e],
      elite,
    });
    if (boss) {
      this.bus.emit("boss:died", { entity: e, name: def.name });
      this.bossEntity = -1;
      this.unlockAfterBoss();
    }
    this.bus.emit("sfx", { name: boss ? "bossDeath" : "enemyDeath", x: s.x[e], y: s.y[e] });

    // Mnożnik combo dotyczy XP i złota. Nie dotyka obrażeń — combo ma
    // nagradzać tempo, a nie zastępować build (patrz `combo.ts`).
    this.grantXp(Math.round(s.xpValue[e] * comboMult));

    const goldBonus = this.hasLegendary("signet_of_greed") ? 0.5 : 0;
    const drop = this.loot.rollDrop({
      dropChance: def.dropChance + this.killCombo.dropChanceBonus,
      goldValue: s.goldValue[e] * comboMult,
      itemLevel: this.encounter.zoneLevel,
      elite,
      boss,
      killsWithoutDrop: this.character.killsWithoutDrop,
      goldBonus,
    });

    this.spawnPickup(s.x[e], s.y[e], { type: "gold", amount: drop.gold });
    if (drop.potion) this.spawnPickup(s.x[e] + 0.5, s.y[e], { type: "potion", amount: 1 });
    if (drop.item) {
      this.character.killsWithoutDrop = 0;
      this.spawnPickup(s.x[e] - 0.5, s.y[e], { type: "item", amount: 1, item: drop.item });
      this.bus.emit("item:dropped", {
        id: drop.item.id,
        rarity: drop.item.rarity,
        x: s.x[e],
        y: s.y[e],
      });
    } else {
      this.character.killsWithoutDrop++;
    }
    if (boss) {
      for (let i = 1; i < this.balance.affixes.drops.minibossItems; i++) {
        const extra = this.loot.generateItem(this.encounter.zoneLevel);
        this.spawnPickup(s.x[e] + i * 0.7, s.y[e] + 0.6, { type: "item", amount: 1, item: extra });
      }
      // Rdzeń kowala — jedyne źródło tej waluty w grze. Leży na ziemi jak każdy
      // inny łup: nagroda, którą gracz podnosi, czyta się mocniej niż licznik,
      // który po cichu urósł.
      this.spawnPickup(s.x[e] - 0.9, s.y[e] + 0.8, { type: "core", amount: 1 });
    }

    s.despawn(e);
  }

  private grantXp(amount: number): void {
    const ch = this.character;
    const prog = this.balance.progression;
    ch.xp += amount;
    let leveled = false;

    while (ch.level < prog.maxLevel && ch.xp >= xpToNext(ch.level, this.balance)) {
      ch.xp -= xpToNext(ch.level, this.balance);
      ch.level++;
      ch.attributePoints += prog.perLevel.attributePoints;
      const grantsSkill =
        ch.level <= prog.perLevel.skillPointsHalvedAfterLevel || ch.level % 2 === 0;
      if (grantsSkill) ch.skillPoints += prog.perLevel.skillPoints;
      leveled = true;
      this.bus.emit("level:up", {
        level: ch.level,
        attributePoints: ch.attributePoints,
        skillPoints: ch.skillPoints,
      });
      this.bus.emit("sfx", { name: "levelUp" });
    }

    if (leveled) {
      this.refreshDerived();
      // Awans dobija do pełna, ale nie zdejmuje nadwyżki z overhealu —
      // inaczej zabicie grubego wroga na progu poziomu kasowałoby własną nagrodę.
      this.store.hp[this.player] = Math.max(
        this.store.hp[this.player],
        this.store.maxHp[this.player],
      );
      this.store.level[this.player] = Math.min(255, ch.level);
    }
    this.bus.emit("xp:gained", {
      amount,
      total: ch.xp,
      toNext: xpToNext(ch.level, this.balance),
    });
  }

  private hasLegendary(id: string): boolean {
    for (const item of Object.values(this.character.equipment)) {
      if (item?.legendaryId === id) return true;
    }
    return false;
  }

  // ─────────────────────────────────────────────────── attack tokens

  /** Attack token system (GDD §7.6) — max 2 wrogów naraz atakuje, reszta krąży. */
  tokensInUse = 0;

  requestToken(e: number): boolean {
    const s = this.store;
    if (s.hasFlag(e, Flag.HasToken)) return true;
    if (this.tokensInUse >= this.balance.combat.limits.attackTokens) return false;
    s.setFlag(e, Flag.HasToken, true);
    this.tokensInUse++;
    return true;
  }

  releaseToken(e: number): void {
    const s = this.store;
    if (!s.hasFlag(e, Flag.HasToken)) return;
    s.setFlag(e, Flag.HasToken, false);
    this.tokensInUse = Math.max(0, this.tokensInUse - 1);
  }

  // ─────────────────────────────────────────────────────── spawnowanie

  spawnEnemy(defIdx: number, x: number, y: number, level: number, elite: boolean): number {
    const s = this.store;
    const def = this.enemyDefs[defIdx];
    if (!def) return -1;
    const id = s.spawn(Kind.Enemy);
    if (id < 0) return -1;

    const scale = this.balance.progression.zoneScaling;
    const eliteCfg = this.balance.enemies.elite;
    const lvl = Math.max(1, level);

    let hp = def.hp * (1 + scale.hpPerLevel * (lvl - 1));
    let dmg = def.damage * (1 + scale.damagePerLevel * (lvl - 1));
    let poise = def.poise;
    let xp = def.xp * (1 + scale.xpPerLevel * (lvl - 1));
    let armor = def.armor;
    let speed = def.moveSpeed;

    s.defIdx[id] = defIdx;
    s.x[id] = x;
    s.y[id] = y;
    s.prevX[id] = x;
    s.prevY[id] = y;
    s.radius[id] = def.radius;
    s.mass[id] = def.mass;
    s.level[id] = Math.min(255, lvl);
    s.facing[id] = Math.atan2(-y, -x);
    // Patrol, nie Idle: wróg wchodzi na arenę i sam szuka gracza.
    s.state[id] = EState.Patrol;

    if (elite) {
      hp *= eliteCfg.hpMult;
      dmg *= eliteCfg.damageMult;
      poise *= eliteCfg.poiseMult;
      xp *= eliteCfg.xpMult;
      s.setFlag(id, Flag.Elite, true);

      const count = this.rng.ai.int(eliteCfg.affixCountMin, eliteCfg.affixCountMax);
      let mask = 0;
      const mods = this.balance.enemies.eliteModifiers;
      for (let i = 0; i < count; i++) {
        const idx = this.rng.ai.int(0, mods.length - 1);
        mask |= 1 << idx;
      }
      s.eliteMods[id] = mask;
      for (let i = 0; i < mods.length; i++) {
        if (!(mask & (1 << i))) continue;
        const m = mods[i]!;
        if (m.armorMult) armor *= m.armorMult;
        if (m.moveSpeedMult) speed *= m.moveSpeedMult;
      }
    }

    s.maxHp[id] = hp;
    s.hp[id] = hp;
    s.damage[id] = dmg;
    s.maxPoise[id] = poise;
    s.poise[id] = poise;
    s.armor[id] = armor;
    s.speed[id] = speed;
    s.xpValue[id] = xp;
    s.goldValue[id] = def.gold * (1 + 0.15 * (lvl - 1));

    if (def.isBoss) {
      s.setFlag(id, Flag.Boss, true);
      s.breakBarMax[id] = def.breakBar ?? 140;
      s.breakBar[id] = s.breakBarMax[id];
      this.bossEntity = id;
      this.bus.emit("boss:spawned", {
        entity: id,
        name: def.name,
        hp,
        breakBar: s.breakBarMax[id],
      });
    }
    return id;
  }

  spawnProjectile(
    owner: number,
    x: number,
    y: number,
    angle: number,
    speed: number,
    radius: number,
    lifetime: number,
    damage: number,
  ): number {
    const s = this.store;
    let count = 0;
    for (let i = 0; i < s.count; i++) if (s.alive[i] && s.kind[i] === Kind.Projectile) count++;
    if (count >= this.balance.combat.limits.maxProjectiles) return -1;

    const id = s.spawn(Kind.Projectile);
    if (id < 0) return -1;
    s.x[id] = x;
    s.y[id] = y;
    s.prevX[id] = x;
    s.prevY[id] = y;
    s.vx[id] = Math.cos(angle) * speed;
    s.vy[id] = Math.sin(angle) * speed;
    s.radius[id] = radius;
    s.facing[id] = angle;
    s.lifetime[id] = lifetime;
    s.damage[id] = damage;
    s.owner[id] = owner;
    s.defIdx[id] = s.defIdx[owner];
    return id;
  }

  spawnHazard(x: number, y: number, radius: number, duration: number, dps: number): void {
    const id = this.store.spawn(Kind.Hazard);
    if (id < 0) return;
    const s = this.store;
    s.x[id] = x;
    s.y[id] = y;
    s.prevX[id] = x;
    s.prevY[id] = y;
    s.radius[id] = radius;
    s.lifetime[id] = duration;
    s.payload[id] = dps;
  }

  private spawnDecoy(x: number, y: number, duration: number): void {
    const id = this.store.spawn(Kind.Decoy);
    if (id < 0) return;
    const s = this.store;
    s.x[id] = x;
    s.y[id] = y;
    s.prevX[id] = x;
    s.prevY[id] = y;
    s.radius[id] = 0.4;
    s.lifetime[id] = duration;
  }

  spawnPickup(x: number, y: number, payload: PickupPayload): void {
    const id = this.store.spawn(Kind.Pickup);
    if (id < 0) return;
    const s = this.store;
    const a = this.rng.vfx.range(0, TAU);
    const d = this.rng.vfx.range(0.2, 0.9);
    s.x[id] = x + Math.cos(a) * d;
    s.y[id] = y + Math.sin(a) * d;
    s.prevX[id] = s.x[id];
    s.prevY[id] = s.y[id];
    s.radius[id] = 0.35;
    s.lifetime[id] = 45;
    s.payload[id] =
      payload.type === "gold" ? 0 : payload.type === "potion" ? 1 : payload.type === "core" ? 3 : 2;
    this.pickups.set(id, payload);
  }

  // ───────────────────────────────────────────────────── pociski itd.

  private updateProjectiles(dt: number): void {
    const s = this.store;
    for (let i = 0; i < s.count; i++) {
      if (!s.alive[i] || s.kind[i] !== Kind.Projectile) continue;
      s.x[i] += s.vx[i] * dt;
      s.y[i] += s.vy[i] * dt;
      s.lifetime[i] -= dt;

      if (s.lifetime[i] <= 0 || dist(s.x[i], s.y[i], 0, 0) > ARENA_RADIUS + 2) {
        s.despawn(i);
        continue;
      }
      for (const o of this.obstacles) {
        if (dist(s.x[i], s.y[i], o.x, o.y) < o.r + s.radius[i]) {
          s.despawn(i);
          break;
        }
      }
      if (!s.alive[i]) continue;

      const p = this.player;
      if (
        dist(s.x[i], s.y[i], s.x[p], s.y[p]) < s.radius[i] + s.radius[p] &&
        s.state[p] !== PState.Dead
      ) {
        if (!this.playerInvulnerable) {
          this.damagePlayer(s.damage[i], 10, "projectile", s.x[i], s.y[i]);
        }
        s.despawn(i);
      }
    }
  }

  private updateHazards(dt: number): void {
    const s = this.store;
    const p = this.player;
    for (let i = 0; i < s.count; i++) {
      if (!s.alive[i]) continue;
      if (s.kind[i] === Kind.Hazard) {
        s.lifetime[i] -= dt;
        if (s.lifetime[i] <= 0) {
          s.despawn(i);
          continue;
        }
        if (
          s.state[p] !== PState.Dead &&
          !this.playerInvulnerable &&
          dist(s.x[i], s.y[i], s.x[p], s.y[p]) < s.radius[i] + s.radius[p]
        ) {
          s.hp[p] -= s.payload[i] * dt * this.difficulty.incomingDamage;
          if (s.hp[p] <= 0) this.killPlayer();
        }
      } else if (s.kind[i] === Kind.Decoy) {
        s.lifetime[i] -= dt;
        if (s.lifetime[i] <= 0) s.despawn(i);
      }
    }
  }

  private updatePickups(dt: number): void {
    const s = this.store;
    const p = this.player;
    const MAGNET = 2.6;
    for (let i = 0; i < s.count; i++) {
      if (!s.alive[i] || s.kind[i] !== Kind.Pickup) continue;
      s.lifetime[i] -= dt;
      if (s.lifetime[i] <= 0) {
        this.pickups.delete(i);
        s.despawn(i);
        continue;
      }
      const d = dist(s.x[i], s.y[i], s.x[p], s.y[p]);
      if (d < MAGNET) {
        const pull = clamp((MAGNET - d) / MAGNET, 0, 1) * 9;
        s.x[i] += ((s.x[p] - s.x[i]) / (d || 1)) * pull * dt;
        s.y[i] += ((s.y[p] - s.y[i]) / (d || 1)) * pull * dt;
      }
      if (d < s.radius[p] + s.radius[i] + 0.25) this.collect(i);
    }
  }

  private collect(id: number): void {
    const payload = this.pickups.get(id);
    this.pickups.delete(id);
    this.store.despawn(id);
    if (!payload) return;

    if (payload.type === "gold") {
      this.character.gold += payload.amount;
      this.bus.emit("gold:gained", { amount: payload.amount, total: this.character.gold });
      this.bus.emit("sfx", { name: "gold" });
    } else if (payload.type === "core") {
      const first = !this.character.smithUnlocked;
      this.character.forgeCores += payload.amount;
      this.character.smithUnlocked = true;
      this.bus.emit("forge:core", {
        total: this.character.forgeCores,
        first,
        target: FORGE_CORE_COST,
      });
      this.bus.emit("sfx", { name: first ? "forgeUnlock" : "forgeCore" });
    } else if (payload.type === "potion") {
      const max = this.balance.combat.player.potions.slots;
      this.character.potions = Math.min(max, this.character.potions + 1);
      this.bus.emit("potion:used", { remaining: this.character.potions });
      this.bus.emit("sfx", { name: "pickup" });
    } else if (payload.item) {
      this.character.inventory.push(payload.item);
      this.bus.emit("item:picked", {
        id: payload.item.id,
        rarity: payload.item.rarity,
        name: payload.item.name,
      });
      this.bus.emit("sfx", { name: `loot_${payload.item.rarity}` });
    }
  }

  // ───────────────────────────────────────────────────────── kolizje

  private constrainToArena(id: number): void {
    const s = this.store;
    const r = s.radius[id];
    const d = Math.hypot(s.x[id], s.y[id]);
    const limit = ARENA_RADIUS - r;
    if (d > limit) {
      const k = limit / d;
      s.x[id] *= k;
      s.y[id] *= k;
    }
    for (const o of this.obstacles) {
      const dx = s.x[id] - o.x;
      const dy = s.y[id] - o.y;
      const dd = Math.hypot(dx, dy);
      const min = o.r + r;
      if (dd < min && dd > 1e-5) {
        s.x[id] = o.x + (dx / dd) * min;
        s.y[id] = o.y + (dy / dd) * min;
      }
    }
  }

  private resolveCollisions(): void {
    const s = this.store;
    const p = this.player;
    // Separacja gracz ↔ wróg; wrogowie rozpychają się w AI (boids).
    for (let i = 0; i < s.count; i++) {
      if (!s.alive[i] || s.kind[i] !== Kind.Enemy) continue;
      this.constrainToArena(i);
      const dx = s.x[i] - s.x[p];
      const dy = s.y[i] - s.y[p];
      const d = Math.hypot(dx, dy);
      const min = s.radius[i] + s.radius[p];
      if (d < min && d > 1e-5) {
        const push = (min - d) * 0.5;
        const nx = dx / d;
        const ny = dy / d;
        const massRatio = s.mass[p] / (s.mass[p] + s.mass[i]);
        s.x[i] += nx * push * massRatio * 2;
        s.y[i] += ny * push * massRatio * 2;
        if (s.state[p] !== PState.Dodge) {
          s.x[p] -= nx * push * (1 - massRatio) * 2;
          s.y[p] -= ny * push * (1 - massRatio) * 2;
        }
      }
    }
    this.constrainToArena(p);
  }

  explode(e: number, def: EnemyDef, onDeath: boolean): void {
    const s = this.store;
    const radius = def.attack.radiusMeters ?? 2.6;
    const p = this.player;
    if (
      !this.playerInvulnerable &&
      s.state[p] !== PState.Dead &&
      dist(s.x[e], s.y[e], s.x[p], s.y[p]) < radius + s.radius[p]
    ) {
      this.damagePlayer(s.damage[e], def.attack.poiseDamage, def.id, s.x[e], s.y[e]);
    }
    const pool = def.traits?.["poisonPool"] as
      | { duration: number; radius: number; dps: number }
      | undefined;
    if (pool) this.spawnHazard(s.x[e], s.y[e], pool.radius, pool.duration, pool.dps);

    this.bus.emit("shake", { trauma: 0.4, dirX: 0, dirY: 0 });
    this.bus.emit("sfx", { name: "explosion", x: s.x[e], y: s.y[e] });
    if (!onDeath) {
      s.hp[e] = 0;
      this.killEnemy(e);
    }
  }

  // ────────────────────────────────────────────────────── encountery

  /**
   * Rytm strefy (GDD §9.2): lekki → średni → ciężki (elita) → punkt kontrolny.
   * Co piąty encounter to arena mini-bossa.
   */
  private updateEncounter(dt: number): void {
    const s = this.store;
    let aliveEnemies = 0;
    for (let i = 0; i < s.count; i++) {
      if (s.alive[i] && s.kind[i] === Kind.Enemy) aliveEnemies++;
    }
    this.encounter.remaining = aliveEnemies;

    if (this.encounter.active) {
      if (aliveEnemies === 0) {
        this.encounter.active = false;
        // Zasada 3/1: po trzech encounterach dłuższy oddech.
        const breather = this.encounter.index % 3 === 0 ? 12 : 4;
        this.encounter.intermission = breather;
        this.bus.emit("wave:cleared", { wave: this.encounter.index, nextIn: breather });
        // Wygrany poziom = nowa arena. Wymieniamy ją na starcie oddechu, żeby
        // gracz zwiedził nowe miejsce, zanim wejdzie następna fala — przejście
        // po rozpoczęciu walki byłoby wyrwaniem gruntu pod nogami.
        this.advanceArena(this.encounter.index + 1);
      }
      return;
    }

    if (this.isDead) return;

    this.encounter.intermission -= dt;
    if (this.encounter.intermission <= 0) this.startEncounter();
  }

  private startEncounter(): void {
    const e = this.encounter;
    e.index++;
    e.zoneLevel = zoneLevelFor(e.index);
    e.active = true;
    e.isMiniboss = e.index % 5 === 0;
    e.isElite = !e.isMiniboss && this.rng.ai.chance(this.balance.enemies.elite.chancePerPack);
    this.announceSpecies();

    const rng = this.rng.ai;
    const roster = this.enemyDefs;
    const idxOf = (id: string) => roster.findIndex((d) => d.id === id);

    if (e.isMiniboss) {
      // Każdy kolejny boss to inny wpis bestiariusza — inny zestaw ataków,
      // inne atrybuty, inna sylwetka. Pierwszy boss nadal jest ręcznie
      // strojonym Rycerzem Zgnilizny: pierwsze zderzenie z mechaniką bossa
      // ma być przewidywalne dla twórcy, a dopiero potem robi się dziko.
      const tier = Math.min(MAX_BOSS_TIERS, Math.ceil(e.index / 5));
      const bossIdx = tier === 1 ? idxOf("rot_knight") : this.bossDefIdx(tier);
      const pos = this.edgePoint(rng.range(0, TAU));
      this.spawnEnemy(bossIdx, pos.x, pos.y, e.zoneLevel, false);

      // Świta bossa to jednostki z aktualnej puli, nie wieczne gobliny.
      const escort = this.spawnPool();
      for (let i = 0; i < 2; i++) {
        const p2 = this.edgePoint(rng.range(0, TAU));
        this.spawnEnemy(rng.pick(escort), p2.x, p2.y, e.zoneLevel, false);
      }
      this.bus.emit("wave:started", { wave: e.index, enemies: 3, elite: false });
      return;
    }

    // Budżet rośnie z numerem encounteru; twardy limit 24 wrogów (GDD §11.6).
    const budget = 3 + e.index * 1.7;
    const pool = this.spawnPool();

    let spent = 0;
    let spawned = 0;

    while (spent < budget && spawned < this.balance.combat.limits.maxEnemies) {
      const pick = rng.pick(pool);
      const c = this.spawnCost(pick);
      if (spent + c > budget + 1) break;
      const pos = this.edgePoint(rng.range(0, TAU));
      const isElite = e.isElite && spawned === 0;
      this.spawnEnemy(pick, pos.x, pos.y, e.zoneLevel, isElite);
      spent += c;
      spawned++;
    }

    this.bus.emit("wave:started", { wave: e.index, enemies: spawned, elite: e.isElite });
  }

  /**
   * Nagroda za bossa: do puli wchodzą nowe typy wrogów. Emitujemy ich nazwy,
   * bo odblokowanie, którego gracz nie zauważy, nie jest nagrodą — a zobaczy je
   * dopiero za kilka fal, gdy los wreszcie je wybierze.
   */
  private unlockAfterBoss(): void {
    // `count` chroni przed zapisem bez tego pola: `undefined + 1` to `NaN`,
    // który zapisałby się z powrotem do postaci i wyłączył odblokowania na stałe.
    const tier = count(this.character.bossesDefeated) + 1;
    this.character.bossesDefeated = tier;
    if (tier > MAX_BOSS_TIERS) return;

    const batch = this.bestiary.unlocks[tier - 1] ?? [];
    this.bus.emit("bestiary:unlocked", {
      tier,
      units: batch.map((d) => ({ name: d.name, traits: traitLabels(d.traits) })),
      nextBoss: this.bestiary.bosses[tier]?.name ?? "",
    });
  }

  /**
   * Przyzwanie sług przez bossa (cecha `summon`). Sługi wchodzą **z krawędzi
   * areny**, nie pod nogami gracza — przyzwanie ma zmusić do repozycji,
   * a nie zadać obrażenia z niczego.
   *
   * Limit wrogów pilnuje `spawnEnemy`, więc boss w zatłoczonej arenie po prostu
   * nie dostawi nic ponad limit.
   */
  summonMinions(summoner: number, count: number): void {
    const pool = this.spawnPool();
    if (pool.length === 0) return;
    const s = this.store;

    for (let i = 0; i < count; i++) {
      const pos = this.edgePoint(this.rng.ai.range(0, TAU));
      this.spawnEnemy(this.rng.ai.pick(pool), pos.x, pos.y, this.encounter.zoneLevel, false);
    }
    this.bus.emit("enemy:summoned", {
      entity: summoner,
      count,
      x: s.x[summoner]!,
      y: s.y[summoner]!,
    });
    this.bus.emit("sfx", { name: "alert", x: s.x[summoner]!, y: s.y[summoner]! });
  }

  // ──────────────────────────────────────────────────────────── kowal

  /** Przedmioty z plecaka o podanych identyfikatorach. Pomija nieznane. */
  private itemsByIds(ids: readonly string[]): Item[] {
    const wanted = new Set(ids);
    return this.character.inventory.filter((it) => wanted.has(it.id));
  }

  /**
   * Wycena przekucia dla wskazanych przedmiotów z plecaka. Warstwa interfejsu
   * pyta o to na każde kliknięcie, więc liczy się tylko to, co widać.
   */
  forgeQuoteFor(ids: readonly string[]): ForgeQuote {
    return forgeQuote(this.itemsByIds(ids), this.character.forgeCores);
  }

  /**
   * Przekucie: zabiera wskazane przedmioty oraz rdzeń i zwraca **losową legendę**.
   *
   * Item level bierzemy z aktualnej strefy, ale nie niżej niż najlepszy z oddanych
   * przedmiotów — inaczej przekucie znoszonego, ale wysokopoziomowego łupu dawałoby
   * legendę słabszą od materiału, z którego powstała.
   */
  reforge(ids: readonly string[]): { ok: boolean; message: string; item?: Item } {
    const items = this.itemsByIds(ids);
    const quote = forgeQuote(items, this.character.forgeCores);
    if (!quote.ready) return { ok: false, message: quote.reason || "Nie da się przekuć" };

    const level = Math.max(
      this.encounter.zoneLevel,
      ...items.map((it) => it.itemLevel),
    );

    const doomed = new Set(items.map((it) => it.id));
    this.character.inventory = this.character.inventory.filter((it) => !doomed.has(it.id));
    this.character.forgeCores -= FORGE_CORE_COST;
    this.character.forgedLegendaries += 1;

    const item = this.loot.generateItem(level, "legendary");
    this.character.inventory.push(item);

    this.bus.emit("forge:reforged", {
      id: item.id,
      name: item.name,
      slot: item.slot,
      itemLevel: item.itemLevel,
      consumed: items.length,
      power: quote.power,
      coresLeft: this.character.forgeCores,
    });
    this.bus.emit("sfx", { name: "forge" });
    return { ok: true, message: `${item.name} (poz. ${item.itemLevel})`, item };
  }

  /** Indeks bossa danego tieru w `enemyDefs`. Układ tablicy ustala konstruktor. */
  private bossDefIdx(tier: number): number {
    return this.genOffset + (Math.min(MAX_BOSS_TIERS, Math.max(1, tier)) - 1);
  }

  /**
   * Etap gatunku. Zmienia się co dziesięć rund, ale **nie szybciej, niż gracz
   * pokona dwóch bossów** — nowy gatunek jest nagrodą za bossów, a nie za
   * przewinięcie licznika fal. Etap 0 to ręczny roster: gobliny, szkielety, orki.
   */
  get speciesStage(): number {
    // Oba licznika czytamy przez `count`: wczytany zapis bywa starszy od kodu
    // i nie zna `bossesDefeated`. Bez tego `Math.min` propagował `NaN` dalej,
    // a gra nie wstawała wcale — brakujące pole w zapisie nie ma prawa być
    // błędem krytycznym (DoD §18.5).
    const byRound = Math.floor((count(this.encounter.index) - 1) / ROUNDS_PER_SPECIES);
    const byBoss = Math.floor(count(this.character.bossesDefeated) / BOSSES_PER_SPECIES);
    return Math.max(0, Math.min(byRound, byBoss, MAX_SPECIES));
  }

  /** Nazwa aktualnego gatunku — HUD nazywa to, z czym gracz właśnie walczy. */
  get speciesName(): string {
    const stage = this.speciesStage;
    return stage === 0 ? "Hordy Pogranicza" : speciesNameFor(stage);
  }

  /** Ostatni ogłoszony etap — zmiana gatunku ma zostać zauważona dokładnie raz. */
  private announcedSpecies = -1;

  private announceSpecies(): void {
    const stage = this.speciesStage;
    if (stage === this.announcedSpecies) return;
    const first = this.announcedSpecies < 0;
    this.announcedSpecies = stage;
    // Pierwsze wejście do gry nie jest „zmianą gatunku" — na starcie i tak nie
    // ma z czym porównać, a komunikat zjadłby uwagę potrzebną na naukę walki.
    if (first || stage === 0) return;

    const info = this.bestiary.speciesInfo[stage - 1];
    this.bus.emit("species:changed", {
      stage,
      name: info?.name ?? this.speciesName,
      tell: info?.tell ?? "",
      units: (this.bestiary.species[stage - 1] ?? []).map((d) => ({
        name: d.name,
        archetype: d.archetype,
        traits: traitLabels(d.traits),
      })),
    });
  }

  /**
   * Pula typów do losowania fali. Trzon bierze się z **gatunku aktualnego etapu**
   * — co dziesięć rund cały skład wymienia się na inny, mocniejszy. Rytm strefy
   * decyduje, które archetypy wchodzą: lekka fala to roje i strzelcy, ciężka
   * dokłada bruisera i bombera (GDD §9.2).
   */
  private spawnPool(): number[] {
    const tier = ((this.encounter.index - 1) % 3) as 0 | 1 | 2;
    const stage = this.speciesStage;
    const pool: number[] = [];

    if (stage === 0) {
      const idxOf = (id: string) => this.enemyDefs.findIndex((d) => d.id === id);
      const base =
        tier === 0
          ? ["goblin_scout", "goblin_scout", "goblin_thrower"]
          : tier === 1
            ? ["goblin_scout", "goblin_thrower", "skeleton_warrior", "plague_crawler"]
            : ["skeleton_warrior", "skeleton_archer", "orc_berserker", "orc_shaman", "plague_crawler"];
      for (const idx of base.map(idxOf)) if (idx >= 0) pool.push(idx);
    } else {
      // Slot = pozycja archetypu w `UNIT_ARCHETYPES`:
      // 0 rój, 1 strzelec, 2 bruiser, 3 kaster, 4 bomber.
      const slots =
        tier === 0 ? [0, 0, 1] : tier === 1 ? [0, 1, 3, 4] : [0, 1, 2, 2, 3, 4];
      const base = this.speciesOffset + (stage - 1) * UNITS_PER_SPECIES;
      for (const slot of slots) pool.push(base + slot);
    }

    /*
     * Domieszka z ostatnich dwóch bossów. Nagroda za bossa ma zostać widoczna,
     * ale tylko dwa ostatnie tiery: przy wszystkich czterdziestu pula puchła do
     * osiemdziesięciu wpisów i gatunek etapu przestawał być rozpoznawalny —
     * fala zamieniała się w przegląd całego bestiariusza.
     */
    const unlockedBase = this.genOffset + MAX_BOSS_TIERS;
    const unlockedCount = Math.min(count(this.character.bossesDefeated), MAX_BOSS_TIERS) * UNLOCKS_PER_BOSS;
    for (let i = Math.max(0, unlockedCount - UNLOCKS_PER_BOSS * 2); i < unlockedCount; i++) {
      pool.push(unlockedBase + i);
    }
    return pool;
  }

  /**
   * Koszt budżetowy typu. Dla wpisów ręcznych zostaje strojona tabela, wpisy
   * generowane przynoszą własny `cost` — **względny w obrębie etapu**, nie
   * liczony z HP. Szacowanie z HP kończyło się falą z jednym wrogiem w setnej
   * rundzie: HP potworów rośnie wykładniczo, a budżet fali liniowo.
   */
  private spawnCost(defIdx: number): number {
    const def = this.enemyDefs[defIdx];
    if (!def) return 2;
    if (def.cost !== undefined) return def.cost;
    const manual: Record<string, number> = {
      goblin_scout: 1,
      goblin_thrower: 1.3,
      skeleton_warrior: 2.2,
      skeleton_archer: 2.4,
      plague_crawler: 1.8,
      orc_berserker: 4,
      orc_shaman: 4.2,
    };
    const fixed = manual[def.id];
    if (fixed !== undefined) return fixed;
    // Kalibracja na ręcznym rosterze: goblin (45 hp, 7 dmg) ≈ 1,
    // ork berserker (160 hp, 22 dmg) ≈ 4.
    return Math.max(1, (def.hp / 45 + def.damage / 7) / 2);
  }

  private edgePoint(angle: number): { x: number; y: number } {
    const r = ARENA_RADIUS - 1.5;
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
  }
}

/** Minimalny odpowiednik setTimeout liczony w sekundach symulacji, bez zależności od DOM. */
const pendingTimers: { t: number; fn: () => void }[] = [];
function setTimeoutSafe(fn: () => void, seconds: number): void {
  pendingTimers.push({ t: seconds, fn });
}
export function tickTimers(dt: number): void {
  for (let i = pendingTimers.length - 1; i >= 0; i--) {
    const timer = pendingTimers[i]!;
    timer.t -= dt;
    if (timer.t <= 0) {
      timer.fn();
      pendingTimers.splice(i, 1);
    }
  }
}
