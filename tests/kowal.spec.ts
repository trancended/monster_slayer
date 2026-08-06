/**
 * Kowal od strony gracza: rdzeń z bossa, panel w ekwipunku, przekucie w legendę.
 *
 * Testy jednostkowe pilnują reguł (`smith.test.ts`), ale nie sprawdzą tego, co
 * najłatwiej zepsuć w interfejsie: że panel w ogóle się pokazuje, że przycisk
 * jest aktywny **dokładnie wtedy**, gdy przekucie jest możliwe, i że kliknięcie
 * naprawdę zamienia stertę złomu na legendę w plecaku.
 */
import { expect, test } from "@playwright/test";

/** Wstawia do plecaka złom zadanej rzadkości i rdzenie kowala. */
async function seedStock(
  page: import("@playwright/test").Page,
  rarity: "common" | "epic",
  count: number,
  cores: number,
) {
  await page.evaluate(
    ({ rarity, count, cores }) => {
      const g = (window as any).__ms;
      const ch = g.world.character;
      ch.inventory = Array.from({ length: count }, (_, i) => ({
        id: `seed_${rarity}_${i}`,
        name: `Złom ${i}`,
        slot: "belt",
        rarity,
        itemLevel: 5,
        minDamage: 0,
        maxDamage: 0,
        armor: 1,
        affixes: [],
        sellValue: 5,
      }));
      ch.forgeCores = cores;
      ch.smithUnlocked = cores > 0;
    },
    { rarity, count, cores },
  );
}

async function boot(page: import("@playwright/test").Page) {
  await page.goto("/?quality=minimal", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Graj" }).click();
  await page.waitForFunction(() => (window as any).__ms?.world !== undefined, { timeout: 60_000 });
}

test("boss zostawia rdzeń kowala, a pierwszy rdzeń otwiera warsztat", async ({ page }) => {
  await boot(page);

  const stan = await page.evaluate(async () => {
    const g = (window as any).__ms;
    const w = g.world;
    const idx = w.enemyDefs.findIndex((d: { isBoss?: boolean }) => d.isBoss === true);
    const e = w.spawnEnemy(idx, 1.5, 0.5, 1, false);
    w.store.hp[e] = 1;
    w.damageEnemy(e, 99, false, "physical", 0, 0, 0, false);
    const naZiemi = [...w.pickups.values()].filter((p: { type: string }) => p.type === "core").length;
    for (let i = 0; i < 150; i++) w.tick(1 / 60);
    return { naZiemi, rdzenie: w.character.forgeCores, otwarty: w.character.smithUnlocked };
  });

  expect(stan.naZiemi, "boss nie zostawił rdzenia").toBe(1);
  expect(stan.rdzenie, "rdzeń nie trafił do postaci").toBe(1);
  expect(stan.otwarty).toBe(true);

  // HUD nazywa nową walutę — inaczej gracz nie wie, co właśnie podniósł.
  await expect(page.getByText(/Rdzenie kowala:\s*1/)).toBeVisible({ timeout: 10_000 });
});

test("przekucie zamienia dziesięć epików w jedną legendę", async ({ page }) => {
  await boot(page);
  await seedStock(page, "epic", 10, 1);

  await page.evaluate(() => (window as any).__ms.toggleInventory());
  const panel = page.getByRole("dialog", { name: "Ekwipunek" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Kowal")).toBeVisible();

  const przekuj = panel.getByRole("button", { name: "Przekuj w legendę" });
  // Nic nie leży na kowadle, więc przycisk musi być zablokowany.
  await expect(przekuj).toBeDisabled();

  await panel.getByRole("button", { name: "Wybierz zbędne" }).click();
  // „Wybierz zbędne" pomija epiki — to ochrona przed oddaniem czegoś dobrego
  // jednym kliknięciem, więc próg nadal nie jest osiągnięty.
  await expect(przekuj).toBeDisabled();

  // Odkładamy materiał ręcznie: dziesięć epików to dokładnie próg.
  const na = panel.getByRole("button", { name: /na kowadło/ });
  const ile = await na.count();
  for (let i = 0; i < ile; i++) await na.nth(0).click();

  await expect(panel.getByText(/Moc 30 \/ 30/)).toBeVisible();
  await expect(przekuj).toBeEnabled();
  await przekuj.click();

  const po = await page.evaluate(() => {
    const ch = (window as any).__ms.world.character;
    return {
      przedmioty: ch.inventory.length,
      legendy: ch.inventory.filter((i: { rarity: string }) => i.rarity === "legendary").length,
      rdzenie: ch.forgeCores,
      przekute: ch.forgedLegendaries,
    };
  });

  expect(po.przedmioty, "materiał został w plecaku").toBe(1);
  expect(po.legendy).toBe(1);
  expect(po.rdzenie).toBe(0);
  expect(po.przekute).toBe(1);
});

test("bez rdzenia warsztat nie oddaje legendy i nie zabiera złomu", async ({ page }) => {
  await boot(page);
  await seedStock(page, "epic", 10, 0);

  await page.evaluate(() => {
    const g = (window as any).__ms;
    // Warsztat już odkryty (gracz kiedyś miał rdzeń), ale rdzeni nie ma.
    g.world.character.smithUnlocked = true;
    // Otwarcie ekwipunku odświeża HUD w całości, więc panel widzi świeży stan.
    g.toggleInventory();
  });

  const panel = page.getByRole("dialog", { name: "Ekwipunek" });
  const na = panel.getByRole("button", { name: /na kowadło/ });
  const ile = await na.count();
  for (let i = 0; i < ile; i++) await na.nth(0).click();

  await expect(panel.getByText(/Brakuje 1 rdzenia/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Przekuj w legendę" })).toBeDisabled();

  const po = await page.evaluate(() => {
    const ch = (window as any).__ms.world.character;
    return { przedmioty: ch.inventory.length, legendy: ch.inventory.filter((i: { rarity: string }) => i.rarity === "legendary").length };
  });
  expect(po.przedmioty).toBe(10);
  expect(po.legendy).toBe(0);
});
