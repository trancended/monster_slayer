/**
 * AI przeciwników — GDD §7.6.
 * FSM: IDLE → PATROL → ALERT → CHASE → COMBAT ⇄ REPOSITION → STAGGERED → DEATH
 *
 * Trzy mechanizmy decydują o czytelności walki 1 vs 8:
 *  1. Attack token system — najwyżej 2 wrogów atakuje naraz, reszta krąży.
 *  2. Separacja (boids) — wrogowie nie zlewają się w jedną bryłę.
 *  3. Telegraf ≥ 0.42 s z własnym dźwiękiem — reakcja bez patrzenia na wroga.
 */
import { angleDiff, clamp, dist, inCone } from "../core/math.ts";
import { EState, Flag, Kind, PState } from "./entities.ts";
import type { World } from "./world.ts";

export function updateEnemyAi(world: World, dt: number): void {
  const s = world.store;
  const p = world.player;
  const perception = world.balance.enemies.perception;
  const aggression = world.difficulty.aiAggression;
  const playerAlive = s.state[p] !== PState.Dead;

  for (let e = 0; e < s.count; e++) {
    if (!s.alive[e] || s.kind[e] !== Kind.Enemy) continue;

    const def = world.enemyDefs[s.defIdx[e]];
    if (!def) continue;
    const arch =
      world.balance.enemies.archetypes[def.archetype] ??
      ({ preferredRange: 0, circleWeight: 0.3, separation: 1 } as const);

    s.stateTime[e] += dt;
    if (s.cooldown[e] > 0) s.cooldown[e] -= dt;
    if (s.breakWindow[e] > 0) s.breakWindow[e] -= dt;

    // Regeneracja poise poza staggerem.
    if (s.state[e] !== EState.Staggered && s.poise[e] < s.maxPoise[e]) {
      s.poise[e] = Math.min(s.maxPoise[e], s.poise[e] + 5 * dt);
    }
    applyEliteTraits(world, e, dt);
    applyGeneratedTraits(world, e, def, dt);

    // Cel: iluzja z „Butów Widma" ma pierwszeństwo przed graczem.
    const decoy = findDecoy(world);
    const targetX = decoy >= 0 ? s.x[decoy] : s.x[p];
    const targetY = decoy >= 0 ? s.y[decoy] : s.y[p];
    const toTarget = dist(s.x[e], s.y[e], targetX, targetY);

    let desiredX = 0;
    let desiredY = 0;

    switch (s.state[e]) {
      case EState.Idle:
      case EState.Patrol: {
        if (!playerAlive) break;
        if (perceives(world, e, perception)) {
          s.state[e] = EState.Alert;
          s.stateTime[e] = 0;
          s.stateDuration[e] = 0.25;
          world.bus.emit("sfx", { name: "alert", x: s.x[e], y: s.y[e] });
          break;
        }
        // Wrogowie wchodzą na arenę od krawędzi, czyli spoza zasięgu wzroku
        // (17.5 m > 14 m). Bez patrolu do środka nigdy by gracza nie zauważyli.
        if (s.state[e] === EState.Patrol) {
          const toCenter = Math.hypot(s.x[e], s.y[e]);
          if (toCenter > 1) {
            desiredX = -s.x[e] / toCenter;
            desiredY = -s.y[e] / toCenter;
            faceTarget(s, e, 0, 0, dt, 5);
          }
        }
        break;
      }

      case EState.Alert: {
        faceTarget(s, e, targetX, targetY, dt, 10);
        if (s.stateTime[e] >= s.stateDuration[e]) setState(s, e, EState.Chase);
        break;
      }

      case EState.Chase: {
        if (!playerAlive) {
          setState(s, e, EState.Idle);
          break;
        }
        faceTarget(s, e, targetX, targetY, dt, 7);
        const engage = def.attack.range * (def.attack.kind === "projectile" ? 0.92 : 0.85);
        if (toTarget <= Math.max(engage, arch.preferredRange)) {
          setState(s, e, EState.Combat);
        } else {
          desiredX = (targetX - s.x[e]) / (toTarget || 1);
          desiredY = (targetY - s.y[e]) / (toTarget || 1);
        }
        break;
      }

      case EState.Combat: {
        if (!playerAlive) {
          setState(s, e, EState.Idle);
          break;
        }
        faceTarget(s, e, targetX, targetY, dt, 6);

        const wantsRange = arch.preferredRange;
        const canAttack =
          s.cooldown[e] <= 0 &&
          toTarget <= def.attack.range &&
          (def.attack.kind === "explode" || world.requestToken(e));

        if (canAttack) {
          setState(s, e, EState.Telegraph);
          s.stateDuration[e] = def.attack.telegraph / aggression;
          s.subStep[e] = 0;
          world.bus.emit("sfx", {
            name: `telegraph_${def.attack.shape}`,
            x: s.x[e],
            y: s.y[e],
          });
          break;
        }

        // Bez tokenu albo na cooldownie: krążenie / trzymanie dystansu.
        const nx = (targetX - s.x[e]) / (toTarget || 1);
        const ny = (targetY - s.y[e]) / (toTarget || 1);
        if (wantsRange > 0) {
          const err = toTarget - wantsRange;
          desiredX = nx * clamp(err / 3, -1, 1);
          desiredY = ny * clamp(err / 3, -1, 1);
        } else if (toTarget > def.attack.range * 0.8) {
          desiredX = nx;
          desiredY = ny;
        }
        // Krążenie — prostopadle do kierunku na gracza.
        const side = (e % 2 === 0 ? 1 : -1) * arch.circleWeight;
        desiredX += -ny * side;
        desiredY += nx * side;
        break;
      }

      case EState.Telegraph: {
        // W trakcie telegrafu wróg jeszcze koryguje kierunek, ale wolno —
        // gracz musi móc go „obejść" unikiem.
        faceTarget(s, e, targetX, targetY, dt, def.attack.kind === "charge" ? 4 : 2.2);
        if (def.attack.kind === "explode") {
          const n = toTarget || 1;
          desiredX = ((targetX - s.x[e]) / n) * 0.6;
          desiredY = ((targetY - s.y[e]) / n) * 0.6;
        }
        if (s.stateTime[e] >= s.stateDuration[e]) {
          beginAttack(world, e, def, targetX, targetY);
        }
        break;
      }

      case EState.Attacking: {
        const done = runAttack(world, e, def, dt);
        if (done) {
          setState(s, e, EState.Recover);
          s.stateDuration[e] = def.attack.recovery;
        }
        break;
      }

      case EState.Recover: {
        s.vx[e] *= 0.86;
        s.vy[e] *= 0.86;
        if (s.stateTime[e] >= s.stateDuration[e]) {
          world.releaseToken(e);
          s.cooldown[e] = def.attack.cooldown / aggression;
          setState(s, e, EState.Combat);
        }
        break;
      }

      case EState.Staggered: {
        s.vx[e] *= 0.82;
        s.vy[e] *= 0.82;
        if (s.stateTime[e] >= s.stateDuration[e]) {
          s.setFlag(e, Flag.Broken, false);
          setState(s, e, EState.Combat);
        }
        break;
      }
    }

    // — ruch: cel + separacja + omijanie przeszkód
    if (s.state[e] !== EState.Staggered && s.state[e] !== EState.Attacking && s.state[e] !== EState.Recover) {
      const sep = separation(world, e, arch.separation);
      desiredX += sep.x;
      desiredY += sep.y;
      const avoid = avoidObstacles(world, e);
      desiredX += avoid.x;
      desiredY += avoid.y;

      const len = Math.hypot(desiredX, desiredY);
      const speed = s.speed[e] * (s.breakWindow[e] > 0 ? 0.6 : 1);
      if (len > 0.01) {
        const targetVx = (desiredX / len) * speed * Math.min(1, len);
        const targetVy = (desiredY / len) * speed * Math.min(1, len);
        s.vx[e] += (targetVx - s.vx[e]) * Math.min(1, dt * 9);
        s.vy[e] += (targetVy - s.vy[e]) * Math.min(1, dt * 9);
      } else {
        s.vx[e] *= 0.85;
        s.vy[e] *= 0.85;
      }
    }

    s.x[e] += s.vx[e] * dt;
    s.y[e] += s.vy[e] * dt;
  }
}

function setState(s: World["store"], e: number, state: number): void {
  s.state[e] = state;
  s.stateTime[e] = 0;
  s.hitDone[e] = 0;
}

function faceTarget(
  s: World["store"],
  e: number,
  tx: number,
  ty: number,
  dt: number,
  rate: number,
): void {
  const want = Math.atan2(ty - s.y[e], tx - s.x[e]);
  s.facing[e] += angleDiff(s.facing[e], want) * Math.min(1, dt * rate);
}

/** Percepcja: stożek 110° / 14 m + promień słuchu 8 m (18 m w walce). */
function perceives(
  world: World,
  e: number,
  perception: { visionConeDeg: number; visionRange: number; hearingRange: number; combatHearingRange: number },
): boolean {
  const s = world.store;
  const p = world.player;
  const d = dist(s.x[e], s.y[e], s.x[p], s.y[p]);

  const inCombat = world.tokensInUse > 0;
  const hearing = inCombat ? perception.combatHearingRange : perception.hearingRange;
  if (d <= hearing) return true;
  if (d > perception.visionRange) return false;

  return inCone(
    s.x[e],
    s.y[e],
    s.facing[e],
    (perception.visionConeDeg * Math.PI) / 180,
    perception.visionRange,
    s.x[p],
    s.y[p],
    s.radius[p],
  );
}

/** Personal space przez boids — bez tego 8 wrogów zlewa się w jedną bryłę. */
function separation(world: World, e: number, weight: number): { x: number; y: number } {
  const s = world.store;
  const found = world.spatial.query(s.x[e], s.y[e], 2.4);
  const results = world.spatial.results();
  let x = 0;
  let y = 0;
  for (let k = 0; k < found; k++) {
    const o = results[k];
    if (o === e || !s.alive[o] || s.kind[o] !== Kind.Enemy) continue;
    const dx = s.x[e] - s.x[o];
    const dy = s.y[e] - s.y[o];
    const d = Math.hypot(dx, dy);
    const min = (s.radius[e] + s.radius[o]) * 1.55;
    if (d < min && d > 1e-4) {
      const push = (min - d) / min;
      x += (dx / d) * push;
      y += (dy / d) * push;
    }
  }
  return { x: x * weight, y: y * weight };
}

function avoidObstacles(world: World, e: number): { x: number; y: number } {
  const s = world.store;
  let x = 0;
  let y = 0;
  for (const o of world.obstacles) {
    const dx = s.x[e] - o.x;
    const dy = s.y[e] - o.y;
    const d = Math.hypot(dx, dy);
    const min = o.r + s.radius[e] + 0.5;
    if (d < min && d > 1e-4) {
      const push = (min - d) / min;
      x += (dx / d) * push * 1.6;
      y += (dy / d) * push * 1.6;
    }
  }
  return { x, y };
}

function findDecoy(world: World): number {
  const s = world.store;
  for (let i = 0; i < s.count; i++) {
    if (s.alive[i] && s.kind[i] === Kind.Decoy) return i;
  }
  return -1;
}

function applyEliteTraits(world: World, e: number, dt: number): void {
  const s = world.store;
  if (!s.hasFlag(e, Flag.Elite)) return;
  const mods = world.balance.enemies.eliteModifiers;
  const mask = s.eliteMods[e];
  for (let i = 0; i < mods.length; i++) {
    if (!(mask & (1 << i))) continue;
    const m = mods[i]!;
    // Regenerujący: 3% HP/s poza walką (bez tokenu ataku).
    if (m.hpRegenPct && !s.hasFlag(e, Flag.HasToken)) {
      s.hp[e] = Math.min(s.maxHp[e], s.hp[e] + s.maxHp[e] * m.hpRegenPct * dt);
    }
  }
}

/**
 * Cechy z proceduralnego bestiariusza. Dwie mają stan, więc mieszkają tutaj,
 * a nie w tabeli danych: furia przełącza się raz i na stałe, przyzywanie ma
 * własny zegar.
 */
function applyGeneratedTraits(
  world: World,
  e: number,
  def: NonNullable<World["enemyDefs"][number]>,
  dt: number,
): void {
  const s = world.store;

  // — Furia: poniżej progu HP rosną obrażenia i prędkość. Mnożniki nakładamy
  //   RAZ, po czym zapalamy flagę — mnożenie co klatkę urwałoby walkę
  //   w ułamku sekundy.
  const rage = def.traits?.["enrage"] as
    | { hpThreshold: number; damageMult: number; speedMult: number }
    | undefined;
  if (rage && !s.hasFlag(e, Flag.Enraged) && s.hp[e]! / s.maxHp[e]! <= rage.hpThreshold) {
    s.setFlag(e, Flag.Enraged, true);
    s.damage[e]! *= rage.damageMult;
    s.speed[e]! *= rage.speedMult;
    world.bus.emit("enemy:enraged", { entity: e, name: def.name, x: s.x[e]!, y: s.y[e]! });
    world.bus.emit("sfx", { name: "alert", x: s.x[e]!, y: s.y[e]! });
  }

  // — Przyzywanie: co `interval` sekund boss dostawia sługi z aktualnej puli.
  //   Zegar rusza dopiero w walce, żeby boss nie wszedł na arenę z gotową
  //   świtą, zanim gracz go w ogóle zobaczy.
  const summon = def.traits?.["summon"] as { interval: number; count: number } | undefined;
  if (summon && s.state[e] !== EState.Patrol && s.state[e] !== EState.Idle) {
    s.summonTimer[e]! += dt;
    if (s.summonTimer[e]! >= summon.interval) {
      s.summonTimer[e] = 0;
      world.summonMinions(e, summon.count);
    }
  }
}

function beginAttack(
  world: World,
  e: number,
  def: NonNullable<World["enemyDefs"][number]>,
  targetX: number,
  targetY: number,
): void {
  const s = world.store;
  setState(s, e, EState.Attacking);
  s.stateDuration[e] =
    def.attack.kind === "combo"
      ? (def.attack.hits ?? 1) * (def.attack.hitInterval ?? 0.4)
      : def.attack.active;

  if (def.attack.kind === "projectile" && def.attack.projectile) {
    const angle = Math.atan2(targetY - s.y[e], targetX - s.x[e]);
    s.facing[e] = angle;
    world.spawnProjectile(
      e,
      s.x[e] + Math.cos(angle) * (s.radius[e] + 0.3),
      s.y[e] + Math.sin(angle) * (s.radius[e] + 0.3),
      angle,
      def.attack.projectile.speed,
      def.attack.projectile.radius,
      def.attack.projectile.lifetime,
      elementalDamage(world, s.damage[e], def.attack.element),
    );
    world.bus.emit("sfx", { name: "shoot", x: s.x[e], y: s.y[e] });
  } else if (def.attack.kind === "charge") {
    const speed = def.attack.chargeSpeed ?? 12;
    s.vx[e] = Math.cos(s.facing[e]) * speed;
    s.vy[e] = Math.sin(s.facing[e]) * speed;
    world.bus.emit("sfx", { name: "charge_go", x: s.x[e], y: s.y[e] });
  } else if (def.attack.kind === "explode") {
    world.explode(e, def, false);
  } else {
    world.bus.emit("sfx", { name: "enemySwing", x: s.x[e], y: s.y[e] });
  }
}

/** @returns true gdy atak dobiegł końca. */
function runAttack(
  world: World,
  e: number,
  def: NonNullable<World["enemyDefs"][number]>,
  dt: number,
): boolean {
  const s = world.store;
  const kind = def.attack.kind;

  if (kind === "charge") {
    // Szarża: obrażenia przy kontakcie, potem długie recovery (GDD §7.2).
    if (!s.hitDone[e] && overlapsPlayer(world, e, s.radius[e] + 0.35)) {
      s.hitDone[e] = 1;
      hitPlayer(world, e, def);
    }
    s.vx[e] *= 1 - Math.min(1, dt * 1.4);
    s.vy[e] *= 1 - Math.min(1, dt * 1.4);
    return s.stateTime[e] >= s.stateDuration[e];
  }

  if (kind === "combo") {
    // 4-ciosowe combo Rycerza Zgnilizny — każdy cios osobno testowany stożkiem,
    // więc odejście w bok w środku serii realnie działa.
    const interval = def.attack.hitInterval ?? 0.4;
    const hits = def.attack.hits ?? 1;
    const due = Math.min(hits, Math.floor(s.stateTime[e] / interval) + 1);
    while (s.subStep[e] < due) {
      s.subStep[e]++;
      meleeHit(world, e, def);
      world.bus.emit("sfx", { name: "enemySwing", x: s.x[e], y: s.y[e] });
    }
    return s.stateTime[e] >= s.stateDuration[e];
  }

  if (kind === "melee") {
    if (!s.hitDone[e]) {
      s.hitDone[e] = 1;
      meleeHit(world, e, def);
    }
    return s.stateTime[e] >= s.stateDuration[e];
  }

  // projectile / explode — efekt odpalił się w beginAttack
  return s.stateTime[e] >= s.stateDuration[e];
}

function meleeHit(world: World, e: number, def: NonNullable<World["enemyDefs"][number]>): void {
  const s = world.store;
  const p = world.player;
  const arc = ((def.attack.arcDeg ?? 90) * Math.PI) / 180;
  if (inCone(s.x[e], s.y[e], s.facing[e], arc, def.attack.range, s.x[p], s.y[p], s.radius[p])) {
    hitPlayer(world, e, def);
  }
}

function overlapsPlayer(world: World, e: number, extra: number): boolean {
  const s = world.store;
  const p = world.player;
  return dist(s.x[e], s.y[e], s.x[p], s.y[p]) < extra + s.radius[p];
}

function hitPlayer(world: World, e: number, def: NonNullable<World["enemyDefs"][number]>): void {
  const s = world.store;
  let poiseDmg = def.attack.poiseDamage;
  // Elita „Roztrzaskujący": podwójny poise damage.
  if (s.hasFlag(e, Flag.Elite)) {
    const mods = world.balance.enemies.eliteModifiers;
    for (let i = 0; i < mods.length; i++) {
      if (s.eliteMods[e] & (1 << i) && mods[i]!.poiseDamageMult) {
        poiseDmg *= mods[i]!.poiseDamageMult!;
      }
    }
  }
  let dmg = elementalDamage(world, s.damage[e], def.attack.element);
  // Aura Ork Szamana: +25% obrażeń sojusznikom w 8 m.
  dmg *= 1 + auraBonus(world, e);
  world.damagePlayer(dmg, poiseDmg, def.id, s.x[e], s.y[e]);
}

function elementalDamage(world: World, base: number, element: string | undefined): number {
  if (!element || element === "physical") return base;
  return base * (1 - world.derived.elementalResist);
}

function auraBonus(world: World, e: number): number {
  const s = world.store;
  let bonus = 0;
  for (let i = 0; i < s.count; i++) {
    if (!s.alive[i] || s.kind[i] !== Kind.Enemy || i === e) continue;
    const def = world.enemyDefs[s.defIdx[i]];
    const aura = def?.traits?.["aura"] as { radius: number; damageBonus: number } | undefined;
    if (!aura) continue;
    if (dist(s.x[e], s.y[e], s.x[i], s.y[i]) <= aura.radius) bonus += aura.damageBonus;
  }
  return bonus;
}
