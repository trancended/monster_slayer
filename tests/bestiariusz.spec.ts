import { expect, test } from "@playwright/test";

/**
 * Pokonanie bossa ma dokładać do gry nowe typy wrogów, a każdy kolejny boss
 * ma być inną walką. Test przechodzi przez to całą ścieżką przez grę — od
 * zdarzenia na szynie po realne odrodzenie nowej jednostki na arenie.
 */
test("pokonanie bossa odblokowuje nowe jednostki i stawia innego bossa", async ({ page }) => {
  await page.goto("/?quality=low", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Graj" }).click();
  await page.waitForFunction(() => (window as any).__ms?.world !== undefined, { timeout: 60000 });

  const wynik = await page.evaluate(async () => {
    const g = (window as any).__ms;
    const w = g.world;
    const s = w.store;

    const odblokowania: any[] = [];
    const bossowie: string[] = [];
    w.bus.on("bestiary:unlocked", (e: any) => odblokowania.push(e));
    w.bus.on("boss:spawned", (e: any) => bossowie.push(e.name));

    const zabijWszystkich = () => {
      for (let i = 0; i < s.count; i++) {
        if (s.alive[i] && s.kind[i] === 2) w.damageEnemy(i, 1e12, false, "physical", 0, 0, 0, true);
      }
    };

    // Przewijamy symulację ręcznie: czekanie w czasie rzeczywistym na trzy
    // walki z bossem trwałoby minuty. Gracz jest nietykalny, żeby test mierzył
    // bestiariusz, a nie to, czy bot przeżyje.
    const przed = new Set<string>();
    const po = new Set<string>();
    let widzianeTypy = przed;

    // Trzy walki z bossem to ~15 encounterów, czyli rząd 6 tys. kroków.
    // Limit jest bezpiecznikiem, nie budżetem — pętla kończy się warunkiem niżej.
    for (let krok = 0; krok < 20000; krok++) {
      w.intent.moveX = 0;
      w.intent.moveY = 0;
      s.hp[w.player] = s.maxHp[w.player];
      w.tick(1 / 60);

      for (let i = 0; i < s.count; i++) {
        if (s.alive[i] && s.kind[i] === 2) widzianeTypy.add(w.enemyDefs[s.defIdx[i]].id);
      }
      zabijWszystkich();

      if (odblokowania.length >= 1) widzianeTypy = po;
      if (bossowie.length >= 3) break;
    }

    return {
      odblokowania,
      bossowie,
      pokonanychBossow: w.character.bossesDefeated,
      typyPrzed: [...przed],
      typyPo: [...po],
    };
  });

  console.log("BOSSOWIE:", wynik.bossowie.join(" | "));
  console.log("ODBLOKOWANE:", wynik.odblokowania.map((u: any) =>
    u.units.map((j: any) => `${j.name}[${j.traits.join("+")}]`).join(", ")).join(" || "));
  console.log("TYPY PRZED:", wynik.typyPrzed.join(", "));
  console.log("TYPY PO:", wynik.typyPo.join(", "));

  // 1. Bossowie faktycznie się pojawili i każdy był inny.
  expect(wynik.bossowie.length, "za mało walk z bossem w przebiegu").toBeGreaterThanOrEqual(3);
  expect(new Set(wynik.bossowie).size, "ten sam boss dwa razy").toBe(wynik.bossowie.length);

  // 2. Każde zwycięstwo dołożyło nowe typy — z nazwą i atrybutami dla HUD-u.
  expect(wynik.pokonanychBossow).toBeGreaterThanOrEqual(3);
  expect(wynik.odblokowania.length).toBeGreaterThanOrEqual(3);
  for (const u of wynik.odblokowania) {
    expect(u.units.length, "odblokowanie bez jednostek").toBeGreaterThan(0);
    for (const jednostka of u.units) expect(jednostka.name).toBeTruthy();
  }

  // 3. Najważniejsze: nowe typy naprawdę wchodzą na arenę. Bez tego
  //    odblokowanie byłoby tylko komunikatem.
  const nowe = wynik.typyPo.filter((id) => !wynik.typyPrzed.includes(id));
  expect(nowe.length, `pula się nie zmieniła: ${wynik.typyPo.join(", ")}`).toBeGreaterThan(0);
  expect(
    nowe.some((id) => id.startsWith("unit_t")),
    `żadna wygenerowana jednostka nie weszła do walki (nowe: ${nowe.join(", ")})`,
  ).toBe(true);
});
