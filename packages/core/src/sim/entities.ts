/**
 * ECS z kompozycją — gorące dane w `Float32Array` (GDD §11.3).
 * Gracz i wróg dzielą te same tablice i te same systemy ruchu/kolizji.
 * Alokacje w trakcie walki: 0 — encje pochodzą z free-listy, nie z `new`.
 */
export const MAX_ENTITIES = 512;

export const Kind = {
  None: 0,
  Player: 1,
  Enemy: 2,
  Projectile: 3,
  Pickup: 4,
  Hazard: 5,
  Decoy: 6,
} as const;
export type KindValue = (typeof Kind)[keyof typeof Kind];

/** Stany gracza — maszyna z GDD §5. */
export const PState = {
  Idle: 0,
  Move: 1,
  Attack: 2,
  HeavyCharge: 3,
  Heavy: 4,
  Dodge: 5,
  Hurt: 6,
  Dead: 7,
  Drink: 8,
} as const;

/** FSM wroga — GDD §7.6: IDLE → PATROL → ALERT → CHASE → COMBAT ⇄ REPOSITION → STAGGERED → DEATH */
export const EState = {
  Idle: 0,
  Patrol: 1,
  Alert: 2,
  Chase: 3,
  Combat: 4,
  Reposition: 5,
  Telegraph: 6,
  Attacking: 7,
  Recover: 8,
  Staggered: 9,
  Death: 10,
} as const;

export const Flag = {
  Elite: 1 << 0,
  Boss: 1 << 1,
  HasToken: 1 << 2,
  Broken: 1 << 3,
  Invulnerable: 1 << 4,
  Blocking: 1 << 5,
} as const;

export class EntityStore {
  readonly kind = new Uint8Array(MAX_ENTITIES);
  readonly alive = new Uint8Array(MAX_ENTITIES);
  readonly defIdx = new Int16Array(MAX_ENTITIES);

  readonly x = new Float32Array(MAX_ENTITIES);
  readonly y = new Float32Array(MAX_ENTITIES);
  readonly prevX = new Float32Array(MAX_ENTITIES);
  readonly prevY = new Float32Array(MAX_ENTITIES);
  readonly vx = new Float32Array(MAX_ENTITIES);
  readonly vy = new Float32Array(MAX_ENTITIES);
  readonly radius = new Float32Array(MAX_ENTITIES);
  readonly facing = new Float32Array(MAX_ENTITIES);

  readonly hp = new Float32Array(MAX_ENTITIES);
  readonly maxHp = new Float32Array(MAX_ENTITIES);
  readonly poise = new Float32Array(MAX_ENTITIES);
  readonly maxPoise = new Float32Array(MAX_ENTITIES);
  readonly armor = new Float32Array(MAX_ENTITIES);
  readonly damage = new Float32Array(MAX_ENTITIES);
  readonly mass = new Float32Array(MAX_ENTITIES);
  readonly speed = new Float32Array(MAX_ENTITIES);
  readonly level = new Uint8Array(MAX_ENTITIES);

  readonly state = new Uint8Array(MAX_ENTITIES);
  readonly stateTime = new Float32Array(MAX_ENTITIES);
  readonly stateDuration = new Float32Array(MAX_ENTITIES);
  readonly cooldown = new Float32Array(MAX_ENTITIES);
  readonly hitDone = new Uint8Array(MAX_ENTITIES);
  readonly subStep = new Uint8Array(MAX_ENTITIES);
  readonly flags = new Uint16Array(MAX_ENTITIES);
  readonly eliteMods = new Uint8Array(MAX_ENTITIES);

  readonly hitFlash = new Float32Array(MAX_ENTITIES);
  readonly lifetime = new Float32Array(MAX_ENTITIES);
  readonly owner = new Int16Array(MAX_ENTITIES);
  readonly payload = new Float32Array(MAX_ENTITIES);

  readonly breakBar = new Float32Array(MAX_ENTITIES);
  readonly breakBarMax = new Float32Array(MAX_ENTITIES);
  readonly breakWindow = new Float32Array(MAX_ENTITIES);

  readonly xpValue = new Float32Array(MAX_ENTITIES);
  readonly goldValue = new Float32Array(MAX_ENTITIES);

  private readonly free: number[] = [];
  private highWater = 0;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.alive.fill(0);
    this.kind.fill(0);
    this.free.length = 0;
    this.highWater = 0;
  }

  spawn(kind: KindValue): number {
    const id = this.free.pop() ?? (this.highWater < MAX_ENTITIES ? this.highWater++ : -1);
    if (id < 0) return -1;

    this.alive[id] = 1;
    this.kind[id] = kind;
    this.defIdx[id] = -1;
    this.vx[id] = 0;
    this.vy[id] = 0;
    this.facing[id] = 0;
    this.state[id] = 0;
    this.stateTime[id] = 0;
    this.stateDuration[id] = 0;
    this.cooldown[id] = 0;
    this.hitDone[id] = 0;
    this.subStep[id] = 0;
    this.flags[id] = 0;
    this.eliteMods[id] = 0;
    this.hitFlash[id] = 0;
    this.lifetime[id] = 0;
    this.owner[id] = -1;
    this.payload[id] = 0;
    this.breakBar[id] = 0;
    this.breakBarMax[id] = 0;
    this.breakWindow[id] = 0;
    this.armor[id] = 0;
    return id;
  }

  despawn(id: number): void {
    if (!this.alive[id]) return;
    this.alive[id] = 0;
    this.kind[id] = Kind.None;
    this.free.push(id);
  }

  get count(): number {
    return this.highWater;
  }

  hasFlag(id: number, flag: number): boolean {
    return ((this.flags[id] as number) & flag) !== 0;
  }

  setFlag(id: number, flag: number, on: boolean): void {
    if (on) this.flags[id] = (this.flags[id] as number) | flag;
    else this.flags[id] = (this.flags[id] as number) & ~flag;
  }

  /** Zapamiętanie pozycji przed tickiem — render interpoluje między prev a bieżącą. */
  snapshot(): void {
    this.prevX.set(this.x);
    this.prevY.set(this.y);
  }
}
