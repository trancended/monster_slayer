/**
 * Testy gatunków wrogów — „co dziesięć rund, po dwóch bossach, wchodzi inny
 * i mocniejszy gatunek".
 *
 * Obietnica ma trzy części i każda potrafi się cicho urwać:
 * gatunek może **nie wejść** (pula nadal losuje orki), może **nie być mocniejszy**
 * (nowa nazwa, te same statystyki) albo może **rozsypać falę** (przy koszcie
 * liczonym z HP budżet starcza na jednego wroga). Wszystkie trzy mają tu test.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  BOSSES_PER_SPECIES,
  MAX_SPECIES,
  ROUNDS_PER_SPECIES,
  UNITS_PER_SPECIES,
  UNIT_ARCHETYPES,
  generateBestiary,
  speciesNameFor,
  speciesStageForBossTier,
} from "../src/sim/enemygen.ts";
import { EnemyDefSchema } from "../src/data/schema.ts";
import { World } from "../src/sim/world.ts";
import { Kind } from "../src/sim/entities.ts";
import { bundledBalance } from "../src/data/bundled.ts";
import { EventBus } from "../src/core/bus.ts";

const balance = bundledBalance();
const bestiary = generateBestiary(31337);

describe("bestiariusz gatunków", () => {
  it("ma pełny skład na każdy etap, po jednej jednostce na archetyp", () => {
    assert.equal(bestiary.species.length, MAX_SPECIES);
    assert.equal(bestiary.speciesInfo.length, MAX_SPECIES);
    for (const units of bestiary.species) {
      assert.equal(units.length, UNITS_PER_SPECIES);
      assert.deepEqual(
        units.map((u) => u.archetype),
        [...UNIT_ARCHETYPES],
        "fala bez pełnego rytmu archetypów",
      );
    }
    const ids = bestiary.species.flat().map((d) => d.id);
    assert.equal(new Set(ids).size, ids.length, "powtórzone identyfikatory jednostek");
  });

  it("każda jednostka przechodzi walidację schematu", () => {
    for (const def of bestiary.species.flat()) {
      const wynik = EnemyDefSchema.safeParse(def);
      assert.ok(wynik.success, `${def.id} nie przechodzi schematu: ${wynik.error?.message}`);
    }
  });

  it("kolejny gatunek jest realnie mocniejszy od poprzedniego", () => {
    // Miarą jest `HP × obrażenia`: iloczyn czasu, jaki wróg przeżywa, i tempa,
    // w jakim bije. Sama suma dawałaby się oszukać gatunkiem twardym i bezzębnym.
    const power = (stage: number) => {
      const units = bestiary.species[stage - 1]!;
      return units.reduce((a, d) => a + d.hp * d.damage, 0) / units.length;
    };
    for (let stage = 2; stage <= MAX_SPECIES; stage++) {
      assert.ok(
        power(stage) > power(stage - 1) * 1.5,
        `etap ${stage} nie jest mocniejszy od ${stage - 1} (${Math.round(power(stage - 1))} → ${Math.round(power(stage))})`,
      );
    }
    // I nie tylko o włos: dziesiąty gatunek musi być inną ligą niż pierwszy.
    assert.ok(power(10) > power(1) * 100, "krzywa siły gatunków jest za płaska");
  });

  it("gatunki są rozpoznawalne: własna nazwa, paleta i sylwetka", () => {
    const nazwy = new Set(bestiary.speciesInfo.map((s) => s.name));
    assert.equal(nazwy.size, MAX_SPECIES, "powtórzona nazwa gatunku");
    for (const info of bestiary.speciesInfo) {
      assert.ok(info.tell.length > 0, `${info.name} bez zapowiedzi taktycznej`);
    }
    for (const units of bestiary.species) {
      // Cały skład dzieli barwę i akcent — to po nich gracz czyta „nowy gatunek".
      const kolory = new Set(units.map((u) => u.color));
      assert.equal(kolory.size, 1, "jednostki jednego gatunku w różnych barwach");
      for (const u of units) assert.ok(u.appearance, `${u.id} bez opisu wyglądu`);
    }
  });

  it("koszt fali jest względny, więc pakiety nie kurczą się do jednego wroga", () => {
    // Sedno: przy koszcie liczonym z HP (rośnie wykładniczo) budżet fali
    // (rośnie liniowo) starczałby w setnej rundzie na jednego przeciwnika.
    for (let slot = 0; slot < UNITS_PER_SPECIES; slot++) {
      const first = bestiary.species[0]![slot]!;
      const last = bestiary.species[MAX_SPECIES - 1]![slot]!;
      assert.ok(first.cost, `${first.id} bez kosztu`);
      assert.equal(first.cost, last.cost, `koszt ${first.archetype} zależy od etapu`);
      assert.ok(last.hp > first.hp * 10, "jednostki miały urosnąć, tylko koszt nie");
    }
  });

  it("atrybuty trafiają tylko tam, gdzie symulacja je wykona", () => {
    // Zasada 3 z `enemygen.ts`: żadnych atrybutów na niby. `poisonPool` czyta
    // wyłącznie eksplozja, `thorns` — zwarcie.
    for (const def of [...bestiary.species.flat(), ...bestiary.unlocks.flat()]) {
      if (def.traits["poisonPool"]) {
        assert.equal(def.attack.kind, "explode", `${def.id}: kałuża jadu bez eksplozji`);
      }
      if (def.traits["thorns"]) {
        assert.ok(
          def.archetype === "swarmer" || def.archetype === "bruiser",
          `${def.id}: kolce na jednostce, która nigdy nie wchodzi w zwarcie`,
        );
      }
      assert.ok(!def.traits["summon"], `${def.id}: przyzywanie jest tylko dla bossów`);
    }
  });

  it("boss należy do gatunku swojego etapu — dwie walki na gatunek", () => {
    assert.equal(speciesStageForBossTier(1), 0);
    assert.equal(speciesStageForBossTier(2), 0);
    assert.equal(speciesStageForBossTier(3), 1);
    assert.equal(speciesStageForBossTier(4), 1);
    assert.equal(speciesStageForBossTier(5), 2);

    // Od etapu 1 boss nosi barwy gatunku, żeby szczytowa walka etapu nie
    // wyglądała jak przyniesiona z poprzedniego.
    for (let tier = 3; tier <= 12; tier++) {
      const stage = speciesStageForBossTier(tier);
      const boss = bestiary.bosses[tier - 1]!;
      const units = bestiary.species[stage - 1]!;
      assert.equal(boss.color, units[0]!.color, `boss tieru ${tier} w obcej barwie`);
      assert.ok(boss.hp > units[2]!.hp * 3, `boss tieru ${tier} nie odstaje od sług`);
    }
  });

  it("nazwa gatunku jest ta sama dla tego samego etapu", () => {
    assert.equal(speciesNameFor(1), bestiary.speciesInfo[0]!.name);
    assert.notEqual(speciesNameFor(1), speciesNameFor(1 + MAX_SPECIES / 2));
  });
});

describe("wejście gatunku na arenę", () => {
  function makeWorld(): World {
    return new World({ balance, seed: 909090, bus: new EventBus() });
  }

  it("etap czeka na bossów, nie tylko na licznik rund", () => {
    const w = makeWorld();
    w.encounter.index = ROUNDS_PER_SPECIES + 1;

    w.character.bossesDefeated = 0;
    assert.equal(w.speciesStage, 0, "gatunek wszedł bez pokonanych bossów");

    w.character.bossesDefeated = BOSSES_PER_SPECIES - 1;
    assert.equal(w.speciesStage, 0, "gatunek wszedł po jednym bossie");

    w.character.bossesDefeated = BOSSES_PER_SPECIES;
    assert.equal(w.speciesStage, 1, "gatunek nie wszedł po dwóch bossach");
  });

  it("zapis bez pola o bossach nie wywala gry", () => {
    // Starszy zapis nie zna `bossesDefeated`. Wcześniej `NaN` przechodził przez
    // `Math.min` do indeksu tablicy gatunków i gra nie wstawała wcale.
    const w = makeWorld();
    w.encounter.index = ROUNDS_PER_SPECIES * 3;
    (w.character as { bossesDefeated?: number }).bossesDefeated = undefined;

    assert.equal(w.speciesStage, 0);
    assert.equal(typeof w.speciesName, "string");
    assert.ok(w.speciesName.length > 0);

    // I dalej gra: pierwszy pokonany boss ustawia licznik na 1, nie na NaN.
    for (let i = 0; i < 120; i++) w.tick(1 / 60);
    assert.ok(Number.isFinite(w.speciesStage));
  });

  it("etap nie wyprzedza rund, choćby bossów padło więcej", () => {
    const w = makeWorld();
    w.encounter.index = 4;
    w.character.bossesDefeated = 20;
    assert.equal(w.speciesStage, 0);
  });

  it("etap ma sufit na liczbie wygenerowanych gatunków", () => {
    const w = makeWorld();
    w.encounter.index = ROUNDS_PER_SPECIES * 500;
    w.character.bossesDefeated = 1000;
    assert.equal(w.speciesStage, MAX_SPECIES);
  });

  it("po zmianie etapu na arenie stają wrogowie nowego gatunku, nie orki", () => {
    const w = makeWorld();
    const s = w.store;

    // Etap 1: jedenasta runda i dwóch pokonanych bossów.
    w.encounter.index = ROUNDS_PER_SPECIES;
    w.character.bossesDefeated = BOSSES_PER_SPECIES;
    w.encounter.intermission = 0;
    w.encounter.active = false;

    for (let i = 0; i < 60 && !w.encounter.active; i++) w.tick(1 / 60);
    assert.ok(w.encounter.active, "fala nie wystartowała");

    const gatunek = new Set(w.bestiary.species[0]!.map((d) => d.id));
    const stare = new Set(balance.enemies.roster.map((d) => d.id));
    let zGatunku = 0;
    let zRostera = 0;
    for (let i = 0; i < s.count; i++) {
      if (!s.alive[i] || s.kind[i] !== Kind.Enemy) continue;
      const id = w.enemyDefs[s.defIdx[i]!]!.id;
      if (gatunek.has(id)) zGatunku++;
      if (stare.has(id)) zRostera++;
    }

    assert.ok(zGatunku > 0, "fala bez ani jednej jednostki nowego gatunku");
    assert.equal(zRostera, 0, "na arenie nadal stoją gobliny i orki z etapu 0");
  });

  it("zmiana gatunku jest ogłaszana raz i z pełnym składem", () => {
    const bus = new EventBus();
    const w = new World({ balance, seed: 2468, bus });
    const events: { stage: number; name: string; units: number }[] = [];
    bus.on("species:changed", (e) =>
      events.push({ stage: e.stage, name: e.name, units: e.units.length }),
    );

    // Pierwsze wejście do gry nie jest zmianą gatunku — nie ma z czym porównać.
    w.encounter.intermission = 0;
    for (let i = 0; i < 60 && !w.encounter.active; i++) w.tick(1 / 60);
    assert.equal(events.length, 0, "gra ogłosiła gatunek na starcie");

    // Awans etapu: kolejna fala ma go ogłosić dokładnie raz.
    w.encounter.index = ROUNDS_PER_SPECIES;
    w.character.bossesDefeated = BOSSES_PER_SPECIES;
    for (const i of [0, 1]) {
      void i;
      w.encounter.active = false;
      w.encounter.intermission = 0;
      for (let t = 0; t < 60 && !w.encounter.active; t++) w.tick(1 / 60);
    }

    assert.equal(events.length, 1, `oczekiwano jednego ogłoszenia, było ${events.length}`);
    assert.equal(events[0]!.stage, 1);
    assert.equal(events[0]!.units, UNITS_PER_SPECIES);
    assert.equal(events[0]!.name, speciesNameFor(1));
  });
});
