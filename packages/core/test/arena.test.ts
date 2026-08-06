/**
 * Testy aren: biomy, losowe przeszkody i przejście po wygranym poziomie.
 *
 * Losowa arena może zepsuć walkę na trzy sposoby: zastawić punkt odrodzenia,
 * zamurować pierścień wejściowy wrogów albo zabrać wszystkie zasłony łucznikom.
 * Każdy z tych przypadków ma tu swój test — bo żaden nie zgłosi się sam,
 * a objawia się dopiero jako „gra się dziwnie zacięła".
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  ARENA_RADIUS,
  BIOMES,
  MIN_BLOCKERS,
  ROUNDS_PER_BIOME,
  biomeForRound,
  generateArena,
} from "../src/sim/arena.ts";
import { MAX_ZONE_LEVEL, World, zoneLevelFor } from "../src/sim/world.ts";
import { Kind } from "../src/sim/entities.ts";
import { bundledBalance } from "../src/data/bundled.ts";
import { EventBus } from "../src/core/bus.ts";

const balance = bundledBalance();

describe("biomy", () => {
  it("zmieniają się co pięć rund, a numer rośnie bez przerwy", () => {
    for (let r = 1; r <= ROUNDS_PER_BIOME; r++) {
      assert.equal(biomeForRound(r).biome.id, biomeForRound(1).biome.id, `runda ${r}`);
      assert.equal(biomeForRound(r).index, 0);
    }
    assert.notEqual(biomeForRound(ROUNDS_PER_BIOME + 1).biome.id, biomeForRound(1).biome.id);
    assert.equal(biomeForRound(ROUNDS_PER_BIOME + 1).index, 1);
    assert.equal(biomeForRound(ROUNDS_PER_BIOME * 12 + 1).index, 12);
  });

  it("każdy biom ma z czego zbudować zasłonę linii wzroku", () => {
    // Bez tego gwarancja `MIN_BLOCKERS` byłaby niewykonalna dla części biomów
    // i cicho degradowałaby się do zera zasłon.
    for (const b of BIOMES) {
      assert.ok(b.props.length > 0, `${b.id} bez rekwizytów`);
      assert.ok(b.density[0] >= MIN_BLOCKERS, `${b.id}: gęstość mniejsza od minimum zasłon`);
    }
  });

  it("identyfikatory biomów są unikalne", () => {
    assert.equal(new Set(BIOMES.map((b) => b.id)).size, BIOMES.length);
  });
});

describe("układ areny", () => {
  it("jest funkcją ziarna i rundy — po F5 wracasz na tę samą planszę", () => {
    assert.deepEqual(generateArena(9, 4242), generateArena(9, 4242));
    assert.notDeepEqual(generateArena(9, 4242).obstacles, generateArena(10, 4242).obstacles);
    assert.notDeepEqual(generateArena(9, 4242).obstacles, generateArena(9, 4243).obstacles);
  });

  it("nie zastawia środka ani pierścienia wejściowego wrogów", () => {
    // Wrogowie wchodzą na `ARENA_RADIUS − 1.5` (`World.edgePoint`), a gracz
    // odradza się w (0, 0).
    for (let round = 1; round <= 90; round++) {
      for (const o of generateArena(round, round * 31 + 7).obstacles) {
        const d = Math.hypot(o.x, o.y);
        assert.ok(d - o.r > 3.0, `runda ${round}: przeszkoda przy punkcie odrodzenia (${d})`);
        assert.ok(
          d + o.r < ARENA_RADIUS - 1.6,
          `runda ${round}: przeszkoda wchodzi w pierścień wejściowy (${d + o.r})`,
        );
      }
    }
  });

  it("zostawia prześwit między przeszkodami", () => {
    for (let round = 1; round <= 90; round++) {
      const list = generateArena(round, round * 17 + 3).obstacles;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!;
          const b = list[j]!;
          const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
          assert.ok(gap > 1.3, `runda ${round}: przeszkody ${i} i ${j} zbyt blisko (${gap})`);
        }
      }
    }
  });

  it("każda arena ma minimum dwie zasłony linii wzroku (GDD §9.3)", () => {
    for (let round = 1; round <= 90; round++) {
      const blockers = generateArena(round, round * 13 + 5).obstacles.filter((o) => o.r >= 0.9);
      assert.ok(
        blockers.length >= MIN_BLOCKERS,
        `runda ${round}: tylko ${blockers.length} zasłon — łucznicy strzelają przez całą arenę`,
      );
    }
  });

  it("omija wskazane punkty — drzewo nie wyrasta tam, gdzie stoi gracz", () => {
    const spot = { x: 8, y: -3, r: 0.42 };
    for (let round = 1; round <= 60; round++) {
      for (const o of generateArena(round, round * 29, [spot]).obstacles) {
        const gap = Math.hypot(o.x - spot.x, o.y - spot.y) - o.r - spot.r;
        assert.ok(gap > 1.3, `runda ${round}: przeszkoda na graczu (${gap})`);
      }
    }
  });

  it("rekwizyty pochodzą z puli biomu", () => {
    for (let round = 1; round <= 60; round++) {
      const layout = generateArena(round, 999);
      for (const o of layout.obstacles) {
        assert.ok(
          layout.biome.props.includes(o.kind),
          `${layout.biome.id}: obcy rekwizyt ${o.kind}`,
        );
      }
    }
  });
});

describe("przejście na nową arenę", () => {
  /** Czyści arenę z wrogów — tak, jak zrobiłby to gracz wygrywający poziom. */
  function killAll(w: World): void {
    const s = w.store;
    for (let i = 0; i < s.count; i++) {
      if (s.alive[i] && s.kind[i] === Kind.Enemy) s.despawn(i);
    }
  }

  it("wygrany poziom przenosi walkę na nowy układ i ogłasza to zdarzeniem", () => {
    const bus = new EventBus();
    const w = new World({ balance, seed: 24680, bus });

    const events: { round: number; newBiome: boolean }[] = [];
    bus.on("arena:changed", (e) => events.push({ round: e.round, newBiome: e.newBiome }));

    const before = w.arena;
    // Oddech trwa 3 s, potem wchodzi pierwsza fala.
    for (let i = 0; i < 240; i++) w.tick(1 / 60);
    assert.ok(w.encounter.active, "pierwsza fala nie wystartowała");

    killAll(w);
    w.tick(1 / 60);

    assert.equal(events.length, 1, "brak zdarzenia o zmianie areny");
    assert.equal(events[0]!.round, 2);
    assert.equal(w.arena.round, 2);
    assert.notDeepEqual(w.arena.obstacles, before.obstacles);
    // Lista przeszkód symulacji musi iść za układem — inaczej gracz widzi drzewa
    // w jednym miejscu, a odbija się od nich w innym.
    assert.deepEqual(w.obstacles, w.arena.obstacles);
  });

  it("biom zmienia się dokładnie na progu, nie co rundę", () => {
    const bus = new EventBus();
    const w = new World({ balance, seed: 1357, bus });
    const changes: number[] = [];
    bus.on("arena:changed", (e) => {
      if (e.newBiome) changes.push(e.round);
    });

    // Przelatujemy dziesięć poziomów, czyszcząc każdy natychmiast po starcie.
    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < 900 && !w.encounter.active; i++) w.tick(1 / 60);
      killAll(w);
      w.tick(1 / 60);
    }

    assert.deepEqual(changes, [ROUNDS_PER_BIOME + 1, ROUNDS_PER_BIOME * 2 + 1]);
  });

  it("wczytany zapis wraca na arenę swojej rundy, nie na pierwszą", () => {
    const w = new World({ balance, seed: 555, bus: new EventBus() });
    assert.equal(w.arena.round, 1);

    // Tak robi `game.ts` po wczytaniu zapisu.
    w.encounter.index = 23;
    w.resetArena();

    assert.equal(w.arena.round, 24);
    assert.ok(w.arena.obstacles.length > 0);
    assert.deepEqual(w.obstacles, w.arena.obstacles);
  });

  it("poziom strefy rośnie co dwie rundy i ma sufit", () => {
    assert.equal(zoneLevelFor(1), 1);
    assert.equal(zoneLevelFor(2), 1);
    assert.equal(zoneLevelFor(3), 2);
    assert.equal(zoneLevelFor(5000), MAX_ZONE_LEVEL);
  });
});
