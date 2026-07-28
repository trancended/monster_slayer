/**
 * Symulator balansu (stack §4) — headless, bez przeglądarki.
 *
 * Kluczowa zasada: importuje *dokładnie ten sam* kod walki co gra
 * (`@ms/core`). Osobna implementacja rozjechałaby się z produkcją w kilka
 * tygodni i byłaby gorsza niż jej brak.
 *
 * Wynik: tabela TTK/DPS per przeciwnik per poziom, porównana z celami z GDD §7.3.
 */
import {
  bundledBalance,
  EventBus,
  FIXED_DT,
  LootGenerator,
  Rng,
  World,
  type Balance,
} from "../../core/src/index.ts";

interface Row {
  enemy: string;
  archetype: string;
  level: number;
  ttk: number;
  dps: number;
  hits: number;
  targetMin: number;
  targetMax: number;
  verdict: string;
}

/** Docelowe TTK z GDD §7.3. */
const TTK_TARGETS: Record<string, [number, number]> = {
  swarmer: [1.5, 2.5],
  ranged: [1.5, 3.5],
  bomber: [1.5, 3.0],
  bruiser: [5, 8],
  caster: [4, 8],
  miniboss: [45, 70],
};

const MAX_SECONDS = 240;

function simulateOne(balance: Balance, enemyId: string, level: number, seed: number): { ttk: number; damage: number; hits: number } | null {
  const bus = new EventBus();
  const world = new World({ balance, seed, bus, difficulty: "hunter" });

  // Wyłączamy spawner encounterów — testujemy pojedynczy cel.
  world.encounter.intermission = Number.POSITIVE_INFINITY;

  // Postać skalowana do poziomu strefy: to samo, co dostaje gracz „na czasie".
  const ch = world.character;
  ch.level = level;
  const perLevel = balance.progression.perLevel.attributePoints;
  const points = (level - 1) * perLevel;
  ch.attributes.strength = 5 + Math.round(points * 0.45);
  ch.attributes.vitality = 5 + Math.round(points * 0.3);
  ch.attributes.dexterity = 5 + Math.round(points * 0.25);

  // „Przeciętny build": gracz na poziomie 1 gra bronią startową, wyżej ma
  // niepełny zestaw Niezwykłych kilka poziomów za strefą. Bez modelu ekwipunku
  // symulacja mierzy gołe pięści i każdy wróg wychodzi na worek na ciosy.
  if (level > 1) {
    const gear = new LootGenerator(balance, new Rng(seed ^ 0xa17e));
    const gearLevel = Math.max(1, level - 2);
    for (const slot of ["weapon", "helmet", "chest", "gloves", "boots", "belt"]) {
      let item = gear.generateItem(gearLevel, "uncommon");
      // generateItem losuje slot — dobijamy do żądanego, żeby zestaw był spójny.
      for (let guard = 0; guard < 80 && item.slot !== slot; guard++) {
        item = gear.generateItem(gearLevel, "uncommon");
      }
      if (item.slot === slot) ch.equipment[slot] = item;
    }
  }
  world.refreshDerived();
  world.store.hp[world.player] = 1e9; // izolujemy TTK od śmierci gracza
  world.store.maxHp[world.player] = 1e9;

  const defIdx = balance.enemies.roster.findIndex((d) => d.id === enemyId);
  if (defIdx < 0) return null;
  const target = world.spawnEnemy(defIdx, 3.5, 0, level, false);
  if (target < 0) return null;

  const totalHp = world.store.maxHp[target];
  let damage = 0;
  let hits = 0;
  bus.on("enemy:damaged", (e) => {
    damage += e.amount;
    hits++;
  });

  let t = 0;
  const s = world.store;
  while (t < MAX_SECONDS && s.alive[target] && s.hp[target] > 0) {
    const dx = s.x[target] - s.x[world.player];
    const dy = s.y[target] - s.y[world.player];
    const d = Math.hypot(dx, dy);

    world.intent.aimX = s.x[target];
    world.intent.aimY = s.y[target];
    // „Przeciętny build": dochodzi do celu i utrzymuje combo, bez uników.
    if (d > 1.7) {
      world.intent.moveX = dx / d;
      world.intent.moveY = dy / d;
    } else {
      world.intent.moveX = 0;
      world.intent.moveY = 0;
    }
    world.intent.attackPressed = d <= 2.0;
    world.intent.attackHeld = false;

    world.tick(FIXED_DT);
    t += FIXED_DT;
  }

  if (s.alive[target] && s.hp[target] > 0) return null;
  return { ttk: t, damage: Math.max(damage, totalHp), hits };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function run(): void {
  const balance = bundledBalance();
  const trials = Number(process.env.SIM_TRIALS ?? 40);
  const levels = [1, 5, 10, 15, 20];
  const rows: Row[] = [];

  for (const def of balance.enemies.roster) {
    for (const level of levels) {
      if (def.isBoss && level > 10) continue;
      const ttks: number[] = [];
      const dpss: number[] = [];
      const hitCounts: number[] = [];

      for (let i = 0; i < trials; i++) {
        const result = simulateOne(balance, def.id, level, 0x5eed0000 + i * 7919 + level);
        if (!result) continue;
        ttks.push(result.ttk);
        dpss.push(result.damage / result.ttk);
        hitCounts.push(result.hits);
      }
      if (ttks.length === 0) continue;

      const ttk = median(ttks);
      const [lo, hi] = TTK_TARGETS[def.archetype] ?? [0, Infinity];
      rows.push({
        enemy: def.name,
        archetype: def.archetype,
        level,
        ttk,
        dps: median(dpss),
        hits: median(hitCounts),
        targetMin: lo,
        targetMax: hi,
        verdict: ttk < lo ? "papierowy" : ttk > hi ? "worek na ciosy" : "ok",
      });
    }
  }

  const pad = (s: string | number, n: number, right = false) => {
    const str = String(s);
    return right ? str.padStart(n) : str.padEnd(n);
  };

  console.log(`\nMonster Slayer — tabela TTK/DPS (${trials} prób na wiersz, trudność: Łowca)\n`);
  console.log(
    pad("Przeciwnik", 22) + pad("Arch.", 11) + pad("Lvl", 5, true) +
    pad("TTK", 9, true) + pad("Cel", 13, true) + pad("DPS", 9, true) +
    pad("Ciosy", 8, true) + "  Ocena",
  );
  console.log("─".repeat(96));

  let failures = 0;
  for (const r of rows) {
    if (r.verdict !== "ok") failures++;
    console.log(
      pad(r.enemy, 22) +
        pad(r.archetype, 11) +
        pad(r.level, 5, true) +
        pad(`${r.ttk.toFixed(2)}s`, 9, true) +
        pad(`${r.targetMin}–${r.targetMax}s`, 13, true) +
        pad(r.dps.toFixed(1), 9, true) +
        pad(r.hits, 8, true) +
        "  " +
        r.verdict,
    );
  }

  console.log(
    `\n${rows.length} wierszy · ${failures} poza docelowym oknem TTK.\n` +
      "Próg regresji dla CI: zmiana mediany TTK > 15% względem zapisanego artefaktu.\n",
  );

  if (process.env.SIM_STRICT === "true" && failures > 0) process.exit(1);
}

run();
