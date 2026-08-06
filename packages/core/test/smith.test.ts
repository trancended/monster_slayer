/**
 * Testy kowala: rdzeń z bossa i przekuwanie zbędnego wyposażenia w legendę.
 *
 * Trzy rzeczy, które muszą trzymać dokładnie tak, jak obiecuje interfejs:
 * relacja **30 zwykłych = 10 epickich = jedna legenda**, warunek rdzenia z bossa
 * i to, że nieudane przekucie **nie zabiera niczego**. Ostatnie jest najważniejsze:
 * transakcja, która zjada materiał i nie daje nagrody, to utrata postępu gracza.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  FORGE_CORE_COST,
  FORGE_TARGET_POWER,
  forgePower,
  forgeQuote,
  itemsNeeded,
} from "../src/sim/smith.ts";
import { World } from "../src/sim/world.ts";
import { Kind } from "../src/sim/entities.ts";
import { normalizeCharacter } from "../src/domain/character.ts";
import type { Item, ItemRarityId } from "../src/domain/item.ts";
import { bundledBalance } from "../src/data/bundled.ts";
import { EventBus } from "../src/core/bus.ts";

const balance = bundledBalance();

function junk(rarity: ItemRarityId, i: number, itemLevel = 3): Item {
  return {
    id: `test_${rarity}_${i}`,
    name: `Złom ${i}`,
    slot: "belt",
    rarity,
    itemLevel,
    minDamage: 0,
    maxDamage: 0,
    armor: 1,
    affixes: [],
    sellValue: 5,
  };
}

function pile(rarity: ItemRarityId, count: number, itemLevel = 3): Item[] {
  return Array.from({ length: count }, (_, i) => junk(rarity, i, itemLevel));
}

describe("moc przekucia", () => {
  it("trzyma obiecaną relację: 30 zwykłych albo 10 epickich", () => {
    assert.equal(forgePower(pile("common", 30)), FORGE_TARGET_POWER);
    assert.equal(forgePower(pile("epic", 10)), FORGE_TARGET_POWER);
    assert.equal(itemsNeeded("common"), 30);
    assert.equal(itemsNeeded("epic"), 10);
  });

  it("rośnie monotonicznie z rzadkością", () => {
    const rzadkosci: ItemRarityId[] = ["common", "uncommon", "rare", "epic", "legendary"];
    for (let i = 1; i < rzadkosci.length; i++) {
      assert.ok(
        forgePower(pile(rzadkosci[i]!, 1)) > forgePower(pile(rzadkosci[i - 1]!, 1)),
        `${rzadkosci[i]} nie jest warte więcej niż ${rzadkosci[i - 1]}`,
      );
    }
  });

  it("nie gubi progu na ułamkach", () => {
    // 20 niezwykłych × 1.5 to dokładnie 30, a nie 29.999999999999996.
    const q = forgeQuote(pile("uncommon", 20), 1);
    assert.equal(q.power, FORGE_TARGET_POWER);
    assert.equal(q.ready, true);
  });

  it("mówi, czego brakuje, a nie tylko że się nie da", () => {
    const bezRdzenia = forgeQuote(pile("epic", 10), 0);
    assert.equal(bezRdzenia.ready, false);
    assert.equal(bezRdzenia.missingCores, FORGE_CORE_COST);
    assert.match(bezRdzenia.reason, /rdzenia/);

    const zaMalo = forgeQuote(pile("common", 10), 5);
    assert.equal(zaMalo.ready, false);
    assert.equal(zaMalo.missingPower, 20);
    assert.match(zaMalo.reason, /mocy/);

    const pusto = forgeQuote([], 0);
    assert.equal(pusto.ready, false);
    assert.match(pusto.reason, /mocy/);
    assert.match(pusto.reason, /rdzenia/);
  });

  it("uszkodzony licznik rdzeni nie psuje wyceny", () => {
    const q = forgeQuote(pile("epic", 10), Number.NaN);
    assert.equal(q.cores, 0);
    assert.equal(q.ready, false);
  });
});

describe("rdzeń kowala z bossa", () => {
  function makeWorld(): { w: World; bus: EventBus } {
    const bus = new EventBus();
    return { w: new World({ balance, seed: 8642, bus }), bus };
  }

  /** Stawia bossa obok gracza i dobija go. */
  function killBoss(w: World): void {
    const idx = w.enemyDefs.findIndex((d) => d.isBoss === true);
    assert.ok(idx >= 0, "brak bossa w tablicy definicji");
    const e = w.spawnEnemy(idx, 1.6, 0.6, 1, false);
    assert.ok(e >= 0, "boss się nie pojawił");
    w.store.hp[e] = 1;
    w.damageEnemy(e, 99, false, "physical", 0, 0, 0, false);
  }

  it("wypada z każdego pokonanego bossa", () => {
    const { w } = makeWorld();
    killBoss(w);
    const rdzenie = [...w.pickups.values()].filter((p) => p.type === "core");
    assert.equal(rdzenie.length, 1, "boss nie zostawił rdzenia");
  });

  it("podniesienie pierwszego rdzenia otwiera warsztat", () => {
    const { w, bus } = makeWorld();
    const events: { total: number; first: boolean }[] = [];
    bus.on("forge:core", (e) => events.push({ total: e.total, first: e.first }));

    assert.equal(w.character.smithUnlocked, false);
    killBoss(w);
    // Magnes wciąga łup leżący obok gracza w kilka klatek.
    for (let i = 0; i < 120; i++) w.tick(1 / 60);

    assert.equal(w.character.forgeCores, 1);
    assert.equal(w.character.smithUnlocked, true);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.first, true);
  });

  it("zwykli wrogowie rdzeni nie zostawiają", () => {
    const { w } = makeWorld();
    const idx = w.enemyDefs.findIndex((d) => !d.isBoss);
    const e = w.spawnEnemy(idx, 2, 0, 1, false);
    w.store.hp[e] = 1;
    w.damageEnemy(e, 99, false, "physical", 0, 0, 0, false);
    assert.equal([...w.pickups.values()].some((p) => p.type === "core"), false);
  });

  it("rdzeń nie kończy się jako wróg ani jako pusty łup", () => {
    const { w } = makeWorld();
    killBoss(w);
    const s = w.store;
    for (const [id, payload] of w.pickups) {
      if (payload.type !== "core") continue;
      assert.equal(s.kind[id], Kind.Pickup);
      assert.equal(payload.amount, 1);
    }
  });
});

describe("przekuwanie", () => {
  function worldWithStock(rarity: ItemRarityId, count: number, cores: number, itemLevel = 3): World {
    const w = new World({ balance, seed: 4711, bus: new EventBus() });
    w.character.inventory = pile(rarity, count, itemLevel);
    w.character.forgeCores = cores;
    w.character.smithUnlocked = cores > 0;
    return w;
  }

  it("zabiera materiał i rdzeń, oddaje legendę", () => {
    const w = worldWithStock("epic", 10, 1);
    const ids = w.character.inventory.map((it) => it.id);

    const wynik = w.reforge(ids);

    assert.equal(wynik.ok, true, wynik.message);
    assert.ok(wynik.item, "przekucie nic nie zwróciło");
    assert.equal(wynik.item!.rarity, "legendary");
    // Legenda musi nieść swój modyfikator — inaczej jest tylko drogim epikiem.
    assert.ok(wynik.item!.legendaryId, "legenda bez unikalnego modyfikatora");

    assert.equal(w.character.forgeCores, 0);
    assert.equal(w.character.forgedLegendaries, 1);
    assert.equal(w.character.inventory.length, 1, "materiał został w plecaku");
    assert.equal(w.character.inventory[0]!.id, wynik.item!.id);
  });

  it("legenda jest losowego typu, nie zawsze tego samego", () => {
    // Prośba brzmiała „legendarny, ale randomowego typu" — jeden slot za każdym
    // razem oznaczałby, że przekuwanie jest sposobem na wybranie przedmiotu.
    const slots = new Set<string>();
    for (let seed = 0; seed < 12; seed++) {
      const w = new World({ balance, seed: 1000 + seed, bus: new EventBus() });
      w.character.inventory = pile("epic", 10);
      w.character.forgeCores = 1;
      const wynik = w.reforge(w.character.inventory.map((it) => it.id));
      assert.equal(wynik.ok, true, wynik.message);
      slots.add(wynik.item!.slot);
    }
    assert.ok(slots.size > 1, `przekucie zawsze daje ten sam slot: ${[...slots]}`);
  });

  it("bez rdzenia nie zabiera niczego", () => {
    const w = worldWithStock("epic", 10, 0);
    const przed = w.character.inventory.length;

    const wynik = w.reforge(w.character.inventory.map((it) => it.id));

    assert.equal(wynik.ok, false);
    assert.match(wynik.message, /rdzenia/);
    assert.equal(w.character.inventory.length, przed, "nieudane przekucie zjadło materiał");
    assert.equal(w.character.forgedLegendaries, 0);
  });

  it("przy zbyt małej mocy nie zabiera niczego", () => {
    const w = worldWithStock("common", 10, 3);
    const wynik = w.reforge(w.character.inventory.map((it) => it.id));

    assert.equal(wynik.ok, false);
    assert.match(wynik.message, /mocy/);
    assert.equal(w.character.inventory.length, 10);
    assert.equal(w.character.forgeCores, 3);
  });

  it("zjada wyłącznie wskazane przedmioty", () => {
    const w = worldWithStock("epic", 14, 1);
    const oddane = w.character.inventory.slice(0, 10).map((it) => it.id);
    const zostaje = new Set(w.character.inventory.slice(10).map((it) => it.id));

    const wynik = w.reforge(oddane);

    assert.equal(wynik.ok, true, wynik.message);
    for (const id of zostaje) {
      assert.ok(
        w.character.inventory.some((it) => it.id === id),
        `przekucie zabrało nieoddany przedmiot ${id}`,
      );
    }
    assert.equal(w.character.inventory.length, 4 + 1);
  });

  it("obce identyfikatory nie robią legendy z niczego", () => {
    const w = worldWithStock("epic", 10, 1);
    const wynik = w.reforge(["nie_ma_takiego", "ani_takiego"]);
    assert.equal(wynik.ok, false);
    assert.equal(w.character.inventory.length, 10);
    assert.equal(w.character.forgeCores, 1);
  });

  it("poziom legendy nie spada poniżej oddanego materiału", () => {
    // Inaczej przekucie wysokopoziomowego łupu w niskiej strefie dawałoby
    // przedmiot słabszy od tego, z czego powstał.
    const w = worldWithStock("epic", 10, 1, 44);
    w.encounter.zoneLevel = 3;

    const wynik = w.reforge(w.character.inventory.map((it) => it.id));

    assert.equal(wynik.ok, true, wynik.message);
    assert.ok(
      wynik.item!.itemLevel >= 44 - 2,
      `poziom legendy ${wynik.item!.itemLevel} przy materiale i44`,
    );
  });

  it("ogłasza wynik zdarzeniem, z liczbą oddanych przedmiotów", () => {
    const bus = new EventBus();
    const w = new World({ balance, seed: 31, bus });
    w.character.inventory = pile("epic", 10);
    w.character.forgeCores = 2;

    const events: { consumed: number; coresLeft: number; power: number }[] = [];
    bus.on("forge:reforged", (e) =>
      events.push({ consumed: e.consumed, coresLeft: e.coresLeft, power: e.power }),
    );

    w.reforge(w.character.inventory.map((it) => it.id));

    assert.equal(events.length, 1);
    assert.equal(events[0]!.consumed, 10);
    assert.equal(events[0]!.coresLeft, 1);
    assert.equal(events[0]!.power, FORGE_TARGET_POWER);
  });
});

describe("wczytana postać", () => {
  it("dostaje brakujące pola zamiast wywalać grę", () => {
    const stary = {
      level: 12,
      gold: 500,
      inventory: [junk("rare", 1)],
    };

    const ch = normalizeCharacter(stary, balance);

    assert.equal(ch.level, 12);
    assert.equal(ch.gold, 500);
    assert.equal(ch.inventory.length, 1);
    assert.equal(ch.bossesDefeated, 0);
    assert.equal(ch.forgeCores, 0);
    assert.equal(ch.smithUnlocked, false);
    assert.equal(ch.forgedLegendaries, 0);
    assert.deepEqual(ch.attributes, { strength: 5, dexterity: 5, vitality: 5, will: 5 });
  });

  it("warsztat zostaje otwarty, jeśli gracz ma rdzenie z poprzedniej wersji", () => {
    const ch = normalizeCharacter({ forgeCores: 3 }, balance);
    assert.equal(ch.smithUnlocked, true);
  });

  it("śmieci w zapisie nie przechodzą jako liczby", () => {
    const ch = normalizeCharacter(
      { level: Number.NaN, gold: undefined, forgeCores: -5 } as never,
      balance,
    );
    assert.equal(ch.level, 1);
    assert.equal(ch.gold, 0);
    assert.equal(ch.forgeCores, 0);
  });
});
