/**
 * Testy warstwy idle. Skupione na rzeczach, które da się zepsuć po cichu
 * i które objawiają się dopiero po godzinach gry:
 *   • krzywe kosztów i ich odwrotność („kup max”),
 *   • marsz offline i reguła ściany,
 *   • idempotencja odbioru nagrody,
 *   • prestiż i warunek „powrót w 30–40% czasu”,
 *   • round-trip kodu builda i jego odporność na wklejony śmieć.
 *
 * Uruchomienie: `node --test packages/core/test/`
 */
import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { big, cmp, format, gt, gte, lte, toNumber, type Big } from "../src/core/bignum.ts";
import {
  IdleEngine,
  affordableLevels,
  applyOffline,
  buyUpgrade,
  bundledIdleConfig,
  canPrestige,
  computeOffline,
  computeRates,
  costAt,
  costRange,
  createIdleState,
  decodeBuild,
  deserializeIdleState,
  diagnose,
  doPrestige,
  emptyBonuses,
  encodeBuild,
  maxAffordable,
  prestigePoints,
  registerKills,
  serializeIdleState,
  upgradeEffects,
  walkZones,
  zoneHp,
  zoneClearSeconds,
} from "../src/idle/index.ts";

const CFG = bundledIdleConfig();
const T0 = 1_700_000_000_000;

describe("krzywe kosztów (v4 §4.1)", () => {
  test("costRange zgadza się z sumą costAt", () => {
    for (const { c0, r } of CFG.upgrades.map((u) => ({ c0: u.c0, r: u.r }))) {
      for (const n of [0, 7, 40]) {
        let manual = big(0);
        for (let i = 0; i < 12; i++) {
          const step = costAt(c0, r, n + i);
          manual = { m: manual.m, e: manual.e };
          manual = addBig(manual, step);
        }
        const formula = costRange(c0, r, n, 12);
        const rel = Math.abs(toNumber(formula) - toNumber(manual)) / toNumber(manual);
        assert.ok(rel < 1e-9, `c0=${c0} r=${r} n=${n}: ${rel}`);
      }
    }
  });

  test("affordableLevels jest odwrotnością costRange", () => {
    const cases: Big[] = [big(10), big(1000), big(1e9), big(3, 40), big(7, 120)];
    for (const gold of cases) {
      for (const { c0, r } of [
        { c0: 10, r: 1.09 },
        { c0: 200, r: 1.14 },
      ]) {
        const n = 25;
        const k = affordableLevels(c0, r, n, gold);
        if (k > 0) {
          assert.ok(lte(costRange(c0, r, n, k), gold), `k=${k} nie mieści się w budżecie`);
        }
        assert.ok(gt(costRange(c0, r, n, k + 1), gold), `k+1=${k + 1} powinno przekroczyć budżet`);
      }
    }
  });

  test("brak złota to zero poziomów, nie wyjątek", () => {
    assert.equal(affordableLevels(10, 1.09, 0, big(0)), 0);
    assert.equal(affordableLevels(10, 1.09, 0, big(-5)), 0);
  });

  test("HP stref rośnie monotonicznie i mieści się w rozsądnym rzędzie", () => {
    let prev = big(0);
    for (let z = 1; z <= 300; z++) {
      const hp = zoneHp(z, CFG.zones);
      assert.ok(gt(hp, prev), `HP strefy ${z} nie urosło`);
      prev = hp;
    }
    // Strefa 51 z przykładu w v4 §2.2 — sanity na rząd wielkości.
    const z51 = zoneHp(51, CFG.zones);
    assert.ok(z51.e >= 5 && z51.e <= 12, `HP(51) = ${format(z51)} (e=${z51.e})`);
  });

  test("zerowy DPS daje nieskończony czas czyszczenia, nie NaN", () => {
    assert.equal(zoneClearSeconds(10, CFG.zones, big(0)), Infinity);
  });
});

describe("zakupy ulepszeń", () => {
  test("kup max nigdy nie schodzi ze złotem poniżej zera", () => {
    const s = createIdleState(T0);
    s.gold = big(1, 18);
    s.deepestZoneEver = 100;

    for (const def of CFG.upgrades) {
      const result = buyUpgrade(s, CFG, def.id, "max");
      assert.ok(result.ok, `${def.id}: ${result.message}`);
      assert.ok(s.gold.m >= 0, `${def.id} zszedł na ujemne złoto`);
    }
  });

  test("kupno bez złota kończy się porażką z komunikatem", () => {
    const s = createIdleState(T0);
    const result = buyUpgrade(s, CFG, "damage", 1);
    assert.equal(result.ok, false);
    assert.ok(result.message.length > 0);
  });

  test("cap ulepszenia jest respektowany", () => {
    const s = createIdleState(T0);
    s.gold = big(1, 60);
    s.deepestZoneEver = 100;
    buyUpgrade(s, CFG, "critChance", "max");
    const eff = upgradeEffects(s, CFG);
    const def = CFG.upgrades.find((u) => u.id === "critChance")!;
    assert.ok(eff.critChance <= def.cap + 1e-9, `crit ${eff.critChance} > cap ${def.cap}`);
  });

  test("zablokowane ulepszenie nie da się kupić", () => {
    const s = createIdleState(T0);
    s.gold = big(1, 12);
    s.deepestZoneEver = 1;
    const result = buyUpgrade(s, CFG, "magicFind", 1);
    assert.equal(result.ok, false);
  });
});

describe("postęp offline (v4 §4.5)", () => {
  function seeded(): ReturnType<typeof createIdleState> {
    const s = createIdleState(T0);
    s.gold = big(50_000);
    s.deepestZoneEver = 30;
    s.zone = 12;
    s.deepestZone = 12;
    buyUpgrade(s, CFG, "damage", 60);
    buyUpgrade(s, CFG, "attackSpeed", 20);
    return s;
  }

  test("7 h 42 min daje niezerowy zysk", () => {
    const s = seeded();
    const now = T0 + (7 * 3600 + 42 * 60) * 1000;
    const report = computeOffline(s, CFG, emptyBonuses(), now);

    assert.ok(report.kills > 0, "zero zabójstw");
    assert.ok(report.gold.m > 0, "zero złota");
    assert.ok(report.worthShowing, "raport powinien zasługiwać na ekran");
    assert.equal(report.capped, false);
    assert.ok(Number.isFinite(report.awaySeconds));
  });

  test("cap przycina 30 h do 8 h dla konta darmowego", () => {
    const s = seeded();
    const report = computeOffline(s, CFG, emptyBonuses(), T0 + 30 * 3600 * 1000);
    assert.equal(report.creditedSeconds, 8 * 3600);
    assert.equal(report.capped, true);
  });

  test("supporter dostaje 24 h i wyższą efektywność", () => {
    const s = seeded();
    s.supporter = true;
    const report = computeOffline(s, CFG, emptyBonuses(), T0 + 30 * 3600 * 1000);
    assert.equal(report.creditedSeconds, 24 * 3600);
    assert.equal(report.efficiency, CFG.offline.efficiencySupporter);
  });

  test("cofnięty zegar klienta nie generuje zysku ani nie kasuje postępu", () => {
    const s = seeded();
    const report = computeOffline(s, CFG, emptyBonuses(), T0 - 5 * 3600 * 1000);
    assert.equal(report.kills, 0);
    assert.equal(report.awaySeconds, 0);
  });

  test("odbiór nagrody jest idempotentny", () => {
    const s = seeded();
    const now = T0 + 4 * 3600 * 1000;
    const report = computeOffline(s, CFG, emptyBonuses(), now);

    assert.equal(applyOffline(s, CFG, report, now), true);
    const afterFirst = format(s.gold);
    assert.equal(applyOffline(s, CFG, report, now), false);
    assert.equal(format(s.gold), afterFirst);
  });

  test("marsz zatrzymuje się na ścianie zamiast przelecieć 800 stref", () => {
    const s = seeded();
    const rates = computeRates(s, CFG, emptyBonuses());
    const walk = walkZones(s, CFG, rates, 24 * 3600);

    // Po zatrzymaniu na ścianie kolejna strefa musi być poza zasięgiem —
    // bez tej reguły gracz wraca do strefy, której nie potrafi przejść.
    if (walk.blocked) {
      assert.ok(
        zoneClearSeconds(walk.zoneTo, CFG.zones, rates.clearDps) > CFG.zones.stuckSeconds,
        "marsz stanął, choć strefa była przechodzalna",
      );
    }
    assert.ok(walk.kills > 0, "farmienie w miejscu powinno dawać zabójstwa");
  });

  test("zerowy DPS nie produkuje NaN w raporcie", () => {
    const s = createIdleState(T0);
    // Brak jakichkolwiek obrażeń bazowych → clearDps = 0.
    const cfg = { ...CFG, base: { ...CFG.base, damage: 0 } };
    const report = computeOffline(s, cfg, emptyBonuses(), T0 + 3600_000);

    assert.ok(Number.isFinite(report.kills));
    assert.ok(Number.isFinite(report.items));
    assert.ok(Number.isFinite(report.gold.m));
    assert.ok(Number.isFinite(report.gold.e));
  });
});

describe("diagnoza blokady (v4 §2.2)", () => {
  test("przy tempie w normie nie krzyczy „utknąłeś”", () => {
    const s = createIdleState(T0);
    const rates = computeRates(s, CFG, emptyBonuses());
    const d = diagnose(s, CFG, rates, emptyBonuses());
    if (rates.clearSeconds <= CFG.zones.targetClearMax) {
      assert.equal(d.stuck, false);
      assert.equal(d.reason, "none");
      assert.equal(d.action, null);
    }
  });

  test("nigdy nie sugeruje zablokowanego ulepszenia", () => {
    const s = createIdleState(T0);
    s.zone = 3;
    s.deepestZone = 3;
    s.deepestZoneEver = 3;
    s.gold = big(1, 9);

    const rates = computeRates(s, CFG, emptyBonuses());
    const d = diagnose(s, CFG, rates, emptyBonuses());

    if (d.action?.kind === "upgrade") {
      const def = CFG.upgrades.find((u) => u.id === d.action?.id);
      assert.ok(def, "sugerowane ulepszenie musi istnieć");
      assert.ok(
        s.deepestZoneEver >= def!.unlockZone,
        `sugerowano ${def!.id} zablokowane do strefy ${def!.unlockZone}`,
      );
    }
  });

  test("„utknąłeś” zapala się dopiero powyżej progu ściany", () => {
    const s = createIdleState(T0);
    s.zone = 60;
    s.deepestZone = 60;
    s.deepestZoneEver = 60;

    const rates = computeRates(s, CFG, emptyBonuses());
    const d = diagnose(s, CFG, rates, emptyBonuses());
    assert.equal(d.stuck, rates.clearSeconds > CFG.zones.stuckSeconds);
  });
});

describe("prestiż (v4 §4.3)", () => {
  test("PP rośnie jak pierwiastek — czterokrotne złoto to dwukrotne PP", () => {
    const s = createIdleState(T0);
    s.goldThisRun = big(1e12);
    const a = prestigePoints(s, CFG);
    s.goldThisRun = big(4e12);
    const b = prestigePoints(s, CFG);
    assert.ok(Math.abs(b / a - 2) < 0.01, `${a} → ${b}, oczekiwano ×2`);
  });

  test("PP liczy się poprawnie przy złocie poza zakresem number", () => {
    const s = createIdleState(T0);
    s.goldThisRun = big(1, 40);
    const pp = prestigePoints(s, CFG);
    assert.ok(Number.isFinite(pp) && pp > 0, `pp=${pp}`);
  });

  test("prestiż zablokowany przed progiem strefy", () => {
    const s = createIdleState(T0);
    s.goldThisRun = big(1e15);
    s.deepestZone = 10;
    assert.equal(canPrestige(s, CFG).ok, false);
  });

  test("reset kasuje bieg, ale zostawia ekwipunek, kodeks i PP", () => {
    const s = createIdleState(T0);
    s.goldThisRun = big(1e13);
    s.gold = big(1e10);
    s.deepestZone = 60;
    s.zone = 60;
    s.upgrades.damage = 200;
    s.uniquesFound.push("cold_steel_blade");
    s.bestiary.goblin = 5000;
    s.challenges.completed.push("naked_40");

    const result = doPrestige(s, CFG, T0 + 1000);
    assert.ok(result.ok, result.message);

    assert.equal(s.zone, 1);
    assert.equal(s.upgrades.damage, 0);
    assert.equal(s.gold.m, 0);
    assert.ok(s.prestige.points > 0);
    // Wipe własności gracza to anty-wzorzec (v4 §12) — te muszą przeżyć reset.
    assert.deepEqual(s.uniquesFound, ["cold_steel_blade"]);
    assert.equal(s.bestiary.goblin, 5000);
    assert.deepEqual(s.challenges.completed, ["naked_40"]);
  });
});

describe("kod builda (v4 §5.8)", () => {
  test("round-trip zachowuje build", () => {
    const engine = new IdleEngine({ now: T0, seed: 99 });
    engine.state.buildName = "Zimna Stal";
    engine.state.upgrades.damage = 120;
    engine.state.skills = { slaughter_root: 1, sl_edge: 5 };
    for (let i = 0; i < 9; i++) {
      const item = engine.rollDrop();
      engine.state.equipment[item.slot] = item;
    }

    const code = encodeBuild(engine.state, engine.rates, T0);
    const decoded = decodeBuild(code);

    assert.ok(decoded, "dekodowanie zwróciło null");
    assert.equal(decoded!.name, "Zimna Stal");
    assert.equal(decoded!.upgrades.damage, 120);
    assert.equal(decoded!.skills.sl_edge, 5);
  });

  test("kod mieści się w komentarzu na Reddicie", () => {
    const engine = new IdleEngine({ now: T0, seed: 5 });
    engine.state.upgrades.damage = 300;
    for (let i = 0; i < 9; i++) {
      const item = engine.rollDrop();
      engine.state.equipment[item.slot] = item;
    }
    const code = encodeBuild(engine.state, engine.rates, T0);
    assert.ok(code.length < 2000, `kod ma ${code.length} znaków`);
    assert.ok(code.startsWith("MS4:"));
  });

  test("wklejony śmieć zwraca null, nigdy wyjątku", () => {
    const engine = new IdleEngine({ now: T0, seed: 3 });
    const good = encodeBuild(engine.state, engine.rates, T0);

    const bad = [
      "",
      "   ",
      "MS4:",
      "MS4:!!!!",
      "XX:abcdef",
      good.slice(0, 12),
      good.slice(0, good.length - 3),
      good.replace("MS4:", "MS9:"),
      "MS4:" + "A".repeat(500),
    ];
    for (const input of bad) {
      assert.doesNotThrow(() => decodeBuild(input), `rzuciło na: ${input.slice(0, 20)}`);
      assert.equal(decodeBuild(input), null, `powinno być null: ${input.slice(0, 20)}`);
    }
  });
});

describe("serializacja stanu", () => {
  test("round-trip przez JSON zachowuje wielkie liczby i ekwipunek", () => {
    const engine = new IdleEngine({ now: T0, seed: 11 });
    engine.state.gold = big(1.234, 45);
    engine.state.goldLifetime = big(9.9, 120);
    const item = engine.rollDrop();
    engine.state.equipment[item.slot] = item;
    engine.state.stash.push(engine.rollDrop());

    const json = JSON.parse(JSON.stringify(serializeIdleState(engine.state))) as unknown;
    const restored = deserializeIdleState(json, T0);

    assert.equal(cmp(restored.gold, engine.state.gold), 0);
    assert.equal(cmp(restored.goldLifetime, engine.state.goldLifetime), 0);
    assert.equal(restored.equipment[item.slot]?.name, item.name);
    assert.equal(restored.stash.length, 1);
  });

  test("uszkodzony zapis nie wywala gry", () => {
    for (const bad of [null, undefined, 42, "tekst", [], { gold: "psuj", stash: "nie tablica" }]) {
      assert.doesNotThrow(() => deserializeIdleState(bad, T0));
      const s = deserializeIdleState(bad, T0);
      assert.ok(s.zone >= 1);
      assert.ok(Array.isArray(s.stash));
    }
  });

  test("przedmiot w złym slocie jest odrzucany, a nie zakładany", () => {
    const s = deserializeIdleState(
      { equipment: { helmet: { id: "x", slot: "weapon", name: "Podróba", affixes: [] } } },
      T0,
    );
    assert.equal(s.equipment.helmet, undefined);
  });
});

describe("silnik", () => {
  test("zabójstwa nabijają strefę i złoto bez pętli po wrogu", () => {
    const engine = new IdleEngine({ now: T0, seed: 8 });
    const before = engine.state.zone;
    registerKills(engine.state, engine.config, 10_000, big(1e6));
    assert.ok(engine.state.zone > before, "strefa nie urosła");
    assert.ok(gte(engine.state.gold, big(1e6)));
  });

  test("bonusy i tempo są przeliczane po unieważnieniu cache", () => {
    const engine = new IdleEngine({ now: T0, seed: 8 });
    const before = engine.rates.dps;
    engine.state.gold = big(1e9);
    engine.state.deepestZoneEver = 50;
    buyUpgrade(engine.state, engine.config, "damage", 50);
    engine.invalidate();
    assert.ok(gt(engine.rates.dps, before), "DPS nie urósł po zakupie");
  });

  test("automatyzacje odblokowują się progami z konfiguracji", () => {
    const engine = new IdleEngine({ now: T0, seed: 8 });
    assert.equal(engine.automationOn("autoAttack"), false);

    // Próg czytamy z danych, nie wpisujemy go tutaj: krzywe idle stroi się
    // co tydzień (v4 §9.3), a test, który pęka przy każdym strojeniu balansu,
    // przestaje być sygnałem i zaczyna być kosztem.
    const def = engine.config.automation.find((a) => a.id === "autoAttack");
    assert.ok(def, "auto-atak musi istnieć w konfiguracji");
    assert.ok(def!.unlockZone > 0, "auto-atak odblokowuje się strefą");

    engine.state.deepestZoneEver = def!.unlockZone - 1;
    assert.deepEqual(engine.refreshAutomation(), [], "odblokowało się przed progiem");

    engine.state.deepestZoneEver = def!.unlockZone;
    const unlocked = engine.refreshAutomation();
    assert.ok(unlocked.includes("autoAttack"), `odblokowano: ${unlocked.join(", ")}`);
    assert.equal(engine.automationOn("autoAttack"), true);
  });
});

// ── pomocnicze ────────────────────────────────────────────────────────────

function addBig(a: Big, b: Big): Big {
  if (a.m === 0) return b;
  if (b.m === 0) return a;
  const [hi, lo] = a.e >= b.e ? [a, b] : [b, a];
  const delta = hi.e - lo.e;
  if (delta > 17) return hi;
  const m = hi.m + lo.m / Math.pow(10, delta);
  const shift = Math.floor(Math.log10(Math.abs(m)));
  return shift === 0 ? { m, e: hi.e } : { m: m / Math.pow(10, shift), e: hi.e + shift };
}
