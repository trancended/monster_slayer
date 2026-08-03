/**
 * Testy combo zabójstw. System jest mały, ale wpina się wprost w nagrody,
 * więc błąd tutaj objawia się jako „złoto rośnie za szybko" i jest wtedy
 * nie do odróżnienia od źle wystrojonej krzywej.
 */
import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { KillCombo, multiplierFor } from "../src/sim/combo.ts";
import { bundledBalance } from "../src/data/bundled.ts";

const CFG = bundledBalance().combat.killCombo;
const TIERS = CFG.tiers;

function fresh(): KillCombo {
  return new KillCombo(CFG);
}

/** Podbija serię do zadanej liczby zabójstw bez upływu czasu. */
function addKills(c: KillCombo, n: number): void {
  for (let i = 0; i < n; i++) c.add();
}

describe("konfiguracja", () => {
  test("progi tierów rosną i mnożniki też", () => {
    for (let i = 1; i < TIERS.length; i++) {
      assert.ok(TIERS[i]!.at > TIERS[i - 1]!.at, `próg ${i} nie rośnie`);
      assert.ok(TIERS[i]!.mult > TIERS[i - 1]!.mult, `mnożnik ${i} nie rośnie`);
    }
  });

  test("każdy tier ma nazwę i kolor — informacja nie zależy od samej barwy", () => {
    for (const t of TIERS) {
      assert.ok(t.name.length > 0);
      assert.match(t.color, /^#[0-9a-f]{6}$/i);
    }
  });
});

describe("naliczanie", () => {
  test("świeża seria nie daje mnożnika", () => {
    const c = fresh();
    assert.equal(c.multiplier, 1);
    assert.equal(c.tierIndex, -1);
    assert.equal(c.active, false);
  });

  test("poniżej pierwszego progu mnożnik wciąż wynosi 1", () => {
    const c = fresh();
    addKills(c, TIERS[0]!.at - 1);
    assert.equal(c.multiplier, 1);
    assert.equal(c.tierIndex, -1);
    assert.ok(c.active, "seria powinna już liczyć zabójstwa");
  });

  test("wejście w tier podnosi mnożnik dokładnie na progu", () => {
    const c = fresh();
    addKills(c, TIERS[0]!.at);
    assert.equal(c.tierIndex, 0);
    assert.equal(c.multiplier, TIERS[0]!.mult);
  });

  test("add() zgłasza awans tylko na progu, nie przy każdym zabójstwie", () => {
    const c = fresh();
    let ups = 0;
    for (let i = 0; i < TIERS[TIERS.length - 1]!.at; i++) {
      if (c.add()) ups += 1;
    }
    assert.equal(ups, TIERS.length, `awansów: ${ups}, tierów: ${TIERS.length}`);
  });

  test("mnożnik nigdy nie schodzi poniżej 1", () => {
    for (const n of [0, 1, 2, 5, 999, 100000]) {
      assert.ok(multiplierFor(n, CFG) >= 1, `n=${n}`);
    }
  });

  test("multiplierFor zgadza się z instancją", () => {
    const c = fresh();
    for (let i = 1; i <= 45; i++) {
      c.add();
      assert.equal(c.multiplier, multiplierFor(i, CFG), `po ${i} zabójstwach`);
    }
  });
});

describe("okno czasowe", () => {
  test("okno kurczy się wraz z tierem", () => {
    const c = fresh();
    const base = c.window;
    addKills(c, TIERS[0]!.at);
    const afterFirst = c.window;
    addKills(c, TIERS[2]!.at - TIERS[0]!.at);
    const afterThird = c.window;

    assert.ok(afterFirst < base, `${afterFirst} nie jest krótsze od ${base}`);
    assert.ok(afterThird < afterFirst, `${afterThird} nie jest krótsze od ${afterFirst}`);
  });

  test("okno nigdy nie schodzi poniżej minimum z konfiguracji", () => {
    const c = fresh();
    addKills(c, 500);
    assert.ok(c.window >= CFG.windowMin, `${c.window} < ${CFG.windowMin}`);
  });

  test("upływ czasu poniżej okna nie zrywa serii", () => {
    const c = fresh();
    addKills(c, 5);
    assert.equal(c.tick(c.window * 0.5), 0);
    assert.equal(c.kills, 5);
  });

  test("przekroczenie okna zrywa serię i zwraca jej długość", () => {
    const c = fresh();
    addKills(c, 7);
    const broken = c.tick(c.window + 0.01);
    assert.equal(broken, 7);
    assert.equal(c.kills, 0);
    assert.equal(c.multiplier, 1);
  });

  test("zabójstwo odnawia pełne okno", () => {
    const c = fresh();
    addKills(c, 4);
    c.tick(c.window * 0.9);
    c.add();
    // Po odnowieniu prawie pełne okno musi jeszcze nie zrywać serii.
    assert.equal(c.tick(c.window * 0.95), 0);
    assert.equal(c.kills, 5);
  });

  test("tick na pustej serii nic nie robi", () => {
    const c = fresh();
    assert.equal(c.tick(100), 0);
    assert.equal(c.kills, 0);
  });
});

describe("zrywanie i rekord", () => {
  test("reset zwraca długość serii i ją zeruje", () => {
    const c = fresh();
    addKills(c, 12);
    assert.equal(c.reset(), 12);
    assert.equal(c.kills, 0);
  });

  test("rekord sesji przeżywa zerwanie serii", () => {
    const c = fresh();
    addKills(c, 12);
    c.reset();
    addKills(c, 3);
    assert.equal(c.best, 12);
  });

  test("rekord rośnie tylko przy pobiciu", () => {
    const c = fresh();
    addKills(c, 5);
    c.reset();
    addKills(c, 9);
    assert.equal(c.best, 9);
    c.reset();
    addKills(c, 2);
    assert.equal(c.best, 9);
  });
});

describe("migawka dla HUD", () => {
  test("pusta seria daje neutralną migawkę", () => {
    const snap = fresh().snapshot();
    assert.equal(snap.count, 0);
    assert.equal(snap.multiplier, 1);
    assert.equal(snap.tier, -1);
    assert.equal(snap.toNextTier, null);
  });

  test("ułamek zegara mieści się w 0–1 i maleje z czasem", () => {
    const c = fresh();
    addKills(c, 6);
    const full = c.snapshot().fraction;
    assert.ok(full > 0.99 && full <= 1, `start: ${full}`);

    c.tick(c.window * 0.5);
    const half = c.snapshot().fraction;
    assert.ok(half > 0 && half < full, `po połowie: ${half}`);
  });

  test("toNextTier odlicza do kolejnego progu i znika na szczycie", () => {
    const c = fresh();
    addKills(c, 1);
    assert.equal(c.snapshot().toNextTier, TIERS[0]!.at - 1);

    addKills(c, TIERS[TIERS.length - 1]!.at - 1);
    assert.equal(c.snapshot().toNextTier, null, "na najwyższym tierze nie ma dokąd iść");
  });

  test("migawka niesie nazwę i kolor aktualnego tieru", () => {
    const c = fresh();
    addKills(c, TIERS[1]!.at);
    const snap = c.snapshot();
    assert.equal(snap.name, TIERS[1]!.name);
    assert.equal(snap.color, TIERS[1]!.color);
    assert.equal(snap.multiplier, TIERS[1]!.mult);
  });
});
