import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  generateBestiary,
  GENERATED_TRAITS,
  MAX_BOSS_TIERS,
  UNLOCKS_PER_BOSS,
  traitLabels,
} from "../src/sim/enemygen.ts";
import { EnemyDefSchema } from "../src/data/schema.ts";

const bestiary = generateBestiary(12345);

describe("proceduralny bestiariusz", () => {
  it("jest funkcją ziarna — to samo ziarno daje ten sam bestiariusz", () => {
    const a = generateBestiary(777);
    const b = generateBestiary(777);
    assert.deepEqual(a, b);

    // …a inne ziarno daje inny. Bez tego „proceduralny" byłby ozdobnikiem.
    const c = generateBestiary(778);
    assert.notDeepEqual(a.bosses[0], c.bosses[0]);
  });

  it("dokładanie tierów nie przesuwa wcześniejszych — zapisy zostają zgodne", () => {
    // `defIdx` encji to indeks w tablicy definicji. Gdyby wpis tieru 1 zależał
    // od tego, ile tierów wygenerowano, wczytany zapis pokazywałby innego wroga.
    const krotki = generateBestiary(999, 3);
    const dlugi = generateBestiary(999, 30);
    assert.deepEqual(krotki.bosses, dlugi.bosses.slice(0, 3));
    assert.deepEqual(krotki.unlocks, dlugi.unlocks.slice(0, 3));
  });

  it("każdy wygenerowany wpis przechodzi walidację schematu", () => {
    for (const def of [...bestiary.bosses, ...bestiary.unlocks.flat()]) {
      const wynik = EnemyDefSchema.safeParse(def);
      assert.ok(wynik.success, `${def.id} nie przechodzi schematu: ${wynik.error?.message}`);
    }
  });

  it("kolejni bossowie mają różne zestawy ataków", () => {
    // Sedno prośby: „każdy boss inny". Porównujemy po identyfikatorze zestawu,
    // nie po parze (rodzaj, kształt): „szerokie cięcia" i „szybkie pchnięcia"
    // to oba `combo` w stożku, a jako walki nie mają ze sobą nic wspólnego.
    //
    // Gwarantowane jest okno czterech, nie siedmiu: przy siedmiu zestawach
    // i oknie równym całej talii dobór potrafiłby się zapętlić na styku tasowań.
    const podpis = (t: number) => bestiary.bosses[t]!.kit!;
    for (let start = 0; start + 4 <= MAX_BOSS_TIERS; start++) {
      const okno = new Set<string>();
      for (let i = start; i < start + 4; i++) okno.add(podpis(i));
      assert.equal(okno.size, 4, `powtórzony zestaw ataku w oknie od tieru ${start + 1}`);
    }
    // Wszystkie zestawy muszą wejść do gry — inaczej część kodu jest martwa.
    assert.equal(new Set(bestiary.bosses.map((b) => b.kit!)).size, 7);
  });

  it("bossowie różnią się też nazwą i atrybutami, nie tylko atakiem", () => {
    const nazwy = new Set(bestiary.bosses.map((b) => b.name));
    assert.ok(nazwy.size > MAX_BOSS_TIERS * 0.7, `za mało różnych nazw: ${nazwy.size}`);

    for (const boss of bestiary.bosses) {
      const cechy = Object.keys(boss.traits);
      assert.ok(cechy.length >= 2, `${boss.name} ma tylko ${cechy.length} atrybutów`);
      assert.ok(cechy.length <= 3, `${boss.name} ma aż ${cechy.length} atrybutów`);
      assert.equal(new Set(cechy).size, cechy.length, "atrybut powtórzony u jednego bossa");
    }
  });

  /**
   * Najważniejszy test w tym pliku. Atrybut, którego nikt nie odczytuje, to
   * obietnica bez pokrycia: boss opisany jako „Furia" nie wpada w furię.
   * Sprawdzamy więc, że każda generowana cecha ma miejsce odczytu w kodzie.
   */
  it("każdy generowany atrybut jest naprawdę wykonywany przez symulację", () => {
    const zrodla = ["../src/sim/ai.ts", "../src/sim/world.ts"]
      .map((rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"))
      .join("\n");

    for (const cecha of GENERATED_TRAITS) {
      assert.ok(
        zrodla.includes(`traits?.["${cecha}"]`) || zrodla.includes(`traits["${cecha}"]`),
        `cecha "${cecha}" jest generowana, ale nikt jej nie odczytuje`,
      );
    }

    // I w drugą stronę: wszystko, co generator wkłada do `traits`, musi być
    // na liście — inaczej lista przestaje cokolwiek gwarantować.
    const dozwolone = new Set<string>(GENERATED_TRAITS);
    for (const def of [...bestiary.bosses, ...bestiary.unlocks.flat()]) {
      for (const cecha of Object.keys(def.traits)) {
        assert.ok(dozwolone.has(cecha), `nieznana cecha "${cecha}" u ${def.name}`);
      }
    }
  });

  it("ataki używają wyłącznie pól, które symulacja wykonuje", () => {
    for (const def of [...bestiary.bosses, ...bestiary.unlocks.flat()]) {
      const a = def.attack;
      if (a.kind === "projectile") {
        assert.ok(a.projectile, `${def.name}: pocisk bez opisu pocisku nigdy nie wystartuje`);
      }
      if (a.kind === "charge") {
        assert.ok(a.chargeSpeed, `${def.name}: szarża bez prędkości stoi w miejscu`);
      }
      if (a.kind === "combo") {
        assert.ok((a.hits ?? 0) > 1, `${def.name}: combo z jednym ciosem to zwykły melee`);
        assert.ok(a.hitInterval, `${def.name}: combo bez odstępu trafia wszystkim naraz`);
      }
      if (a.kind === "explode") {
        assert.ok(a.radiusMeters, `${def.name}: eksplozja bez promienia`);
      }
      // Telegraf musi zapowiadać rzeczywisty kształt ataku (GDD §10.3).
      if (a.shape === "circle") {
        assert.ok(
          a.kind === "explode" || a.kind === "melee",
          `${def.name}: okrągły telegraf przy ataku ${a.kind} kłamie`,
        );
      }
    }
  });

  it("każdy boss odblokowuje nowe jednostki, a te rosną w siłę", () => {
    assert.equal(bestiary.unlocks.length, MAX_BOSS_TIERS);
    for (const batch of bestiary.unlocks) assert.equal(batch.length, UNLOCKS_PER_BOSS);

    const idy = new Set([...bestiary.bosses, ...bestiary.unlocks.flat()].map((d) => d.id));
    assert.equal(idy.size, MAX_BOSS_TIERS * (1 + UNLOCKS_PER_BOSS), "powtórzone identyfikatory");

    const hp = (t: number) =>
      bestiary.unlocks[t]!.reduce((a, d) => a + d.hp, 0) / UNLOCKS_PER_BOSS;
    assert.ok(hp(9) > hp(0) * 3, "jednostki z dziesiątego tieru muszą być realnie twardsze");
  });

  it("bossowie są wyraźnie groźniejsi od sług tego samego tieru", () => {
    for (let t = 0; t < MAX_BOSS_TIERS; t++) {
      const boss = bestiary.bosses[t]!;
      const najtwardszy = Math.max(...bestiary.unlocks[t]!.map((d) => d.hp));
      assert.ok(boss.hp > najtwardszy * 3, `boss tieru ${t + 1} nie odstaje od sług`);
      assert.equal(boss.isBoss, true);
      assert.ok(boss.breakBar, "boss bez paska przełamania nie ma swojej mechaniki");
    }
  });

  it("etykiety atrybutów opisują to, co wróg naprawdę ma", () => {
    const boss = bestiary.bosses[0]!;
    const etykiety = traitLabels(boss.traits);
    assert.equal(etykiety.length, Object.keys(boss.traits).length);
    assert.deepEqual(traitLabels({}), []);
  });

  it("wygląd jest opisany dla każdego generowanego potwora", () => {
    for (const def of [...bestiary.bosses, ...bestiary.unlocks.flat()]) {
      assert.ok(def.appearance, `${def.name} bez opisu wyglądu spadnie na sylwetkę gracza`);
    }
  });
});
