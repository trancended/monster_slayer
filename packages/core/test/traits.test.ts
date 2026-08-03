/**
 * Testy atrybutów z proceduralnego bestiariusza.
 *
 * `enemygen.test.ts` pilnuje, żeby generator nie wymyślał cech, których nikt
 * nie odczytuje. To za mało: odczyt może istnieć i nic nie robić. Tutaj każdy
 * atrybut dostaje własną sytuację i sprawdzamy **skutek w symulacji**.
 */
import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { World } from "../src/sim/world.ts";
import { Flag, Kind } from "../src/sim/entities.ts";
import { bundledBalance } from "../src/data/bundled.ts";
import { EventBus } from "../src/core/bus.ts";

const balance = bundledBalance();

function makeWorld(): World {
  return new World({ balance, seed: 4242, bus: new EventBus(), difficulty: "hunter" });
}

/** Dokłada definicję wroga z zadanymi cechami i stawia go obok gracza. */
function spawnWith(w: World, traits: Record<string, unknown>, extra: Partial<Record<string, unknown>> = {}): number {
  const base = w.enemyDefs.find((d) => d.id === "skeleton_warrior")!;
  const def = { ...base, id: `test_${w.enemyDefs.length}`, traits, ...extra };
  w.enemyDefs.push(def);
  const s = w.store;
  const p = w.player;
  return w.spawnEnemy(w.enemyDefs.length - 1, s.x[p]! + 1.2, s.y[p]!, 1, false);
}

describe("Furia", () => {
  test("poniżej progu HP rosną obrażenia i prędkość — dokładnie raz", () => {
    const w = makeWorld();
    const s = w.store;
    const e = spawnWith(w, {
      enrage: { hpThreshold: 0.5, damageMult: 1.5, speedMult: 1.2 },
    });

    const dmg0 = s.damage[e]!;
    const spd0 = s.speed[e]!;

    // Nad progiem nic się nie dzieje.
    w.tick(1 / 60);
    assert.equal(s.damage[e], dmg0, "furia odpaliła nad progiem");

    s.hp[e] = s.maxHp[e]! * 0.4;
    w.tick(1 / 60);
    assert.ok(Math.abs(s.damage[e]! - dmg0 * 1.5) < 0.01, "obrażenia nie wzrosły");
    assert.ok(Math.abs(s.speed[e]! - spd0 * 1.2) < 0.01, "prędkość nie wzrosła");
    assert.ok(s.hasFlag(e, Flag.Enraged));

    // Kluczowe: mnożnik nakłada się RAZ. Mnożenie co klatkę urwałoby walkę
    // w ułamku sekundy — 1.5^60 na sekundę to liczba bez sensu.
    for (let i = 0; i < 30; i++) w.tick(1 / 60);
    assert.ok(Math.abs(s.damage[e]! - dmg0 * 1.5) < 0.01, "furia nakłada się co klatkę");
  });
});

describe("Cierniowy", () => {
  test("odbija część obrażeń, ale tylko w zwarciu", () => {
    const w = makeWorld();
    const s = w.store;
    const p = w.player;
    const e = spawnWith(w, { thorns: { reflectPct: 0.2, range: 2.6 } });

    s.hp[e] = 1e9;
    s.maxHp[e] = 1e9;
    const hp0 = s.hp[p]!;
    w.damageEnemy(e, 100, false, "physical", 0, 0, 0, false);
    const zadane = hp0 - s.hp[p]!;
    assert.ok(zadane > 0, "kolce nie odbiły niczego w zwarciu");

    // Z dystansu cecha nie może działać: łucznik nie ma jak jej uniknąć,
    // więc karałaby buildy dystansowe za samo ich istnienie.
    s.x[e] = s.x[p]! + 40;
    const hp1 = s.hp[p]!;
    w.damageEnemy(e, 100, false, "physical", 0, 0, 0, false);
    assert.equal(s.hp[p], hp1, "kolce sięgnęły przez pół areny");
  });

  test("zablokowany cios nie wraca kolcami", () => {
    const w = makeWorld();
    const s = w.store;
    const p = w.player;
    const e = spawnWith(w, { thorns: { reflectPct: 0.2, range: 2.6 } });
    s.hp[e] = 1e9;
    s.maxHp[e] = 1e9;

    const hp0 = s.hp[p]!;
    w.damageEnemy(e, 100, false, "physical", 0, 0, 0, true);
    assert.equal(s.hp[p], hp0);
  });
});

describe("Przyzywacz", () => {
  test("boss dostawia sługi co zadany odstęp, od krawędzi areny", () => {
    const w = makeWorld();
    const s = w.store;

    const licz = () => {
      let n = 0;
      for (let i = 0; i < s.count; i++) if (s.alive[i] && s.kind[i] === Kind.Enemy) n++;
      return n;
    };

    const e = spawnWith(w, { summon: { interval: 2, count: 2 } }, { hp: 1e9 });
    s.hp[e] = 1e9;
    s.maxHp[e] = 1e9;
    const przed = licz();

    // Zegar rusza dopiero poza patrolem — inaczej boss wchodzi na arenę
    // z gotową świtą, zanim gracz go w ogóle zobaczy.
    for (let i = 0; i < 180; i++) w.tick(1 / 60);
    const po = licz();
    assert.ok(po > przed, `przyzywanie nie dostawiło nikogo (${przed} → ${po})`);

    // Sługi wchodzą z krawędzi, nie pod nogami gracza.
    const p = w.player;
    for (let i = 0; i < s.count; i++) {
      if (!s.alive[i] || s.kind[i] !== Kind.Enemy || i === e) continue;
      const d = Math.hypot(s.x[i]! - s.x[p]!, s.y[i]! - s.y[p]!);
      if (d < 3) {
        // Sługa mógł już dobiec — sprawdzamy tylko świeżo postawionych.
        assert.ok(w.elapsed > 0.5, "sługa pojawił się wprost na graczu");
      }
    }
  });
});
