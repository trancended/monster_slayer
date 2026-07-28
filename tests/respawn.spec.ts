/**
 * Śmierć nie resetuje areny — wraca tylko gracz.
 * Test steruje symulacją przez dev-owy uchwyt `window.__ms`, bo doprowadzenie
 * bota do zgonu w konkretnym momencie byłoby loterią.
 */
import { expect, test } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";

const SNAPSHOT = `(() => {
  const w = window.__ms.world, s = w.store;
  const enemies = [];
  for (let i = 0; i < s.count; i++) {
    if (s.alive[i] && s.kind[i] === 2) enemies.push({ i, hp: Math.round(s.hp[i]) });
  }
  return {
    encounter: w.encounter.index,
    enemies,
    hp: Math.round(s.hp[w.player]),
    maxHp: Math.round(s.maxHp[w.player]),
    gold: w.character.gold,
    invulnerable: w.playerInvulnerable,
  };
})()`;

test("po śmierci arena zostaje, wraca tylko gracz", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Graj" }).click();

  // Czekamy na pierwszy encounter i nadgryzamy wrogom HP, żeby było widać,
  // czy ich stan przetrwa naszą śmierć.
  await expect
    .poll(async () => ((await page.evaluate(SNAPSHOT)) as { enemies: unknown[] }).enemies.length, {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);

  await page.evaluate(`(() => {
    const w = window.__ms.world, s = w.store;
    for (let i = 0; i < s.count; i++) {
      if (s.alive[i] && s.kind[i] === 2) s.hp[i] = Math.max(1, s.maxHp[i] * 0.5);
    }
    w.character.gold = 100;
  })()`);

  const before = (await page.evaluate(SNAPSHOT)) as {
    encounter: number;
    enemies: { i: number; hp: number }[];
    maxHp: number;
  };
  expect(before.maxHp, "3x bazowe HP: 300 + bonus z Wytrzymałości").toBeGreaterThan(300);

  // Zabijamy gracza wprost w symulacji.
  await page.evaluate(`window.__ms.world.damagePlayer(1e9, 0, "test", 0, 0)`);
  await expect(page.getByRole("heading", { name: "Poległeś" })).toBeVisible();

  await page.getByRole("button", { name: "Wróć na arenę" }).click();
  await page.waitForTimeout(300);

  const after = (await page.evaluate(SNAPSHOT)) as typeof before & {
    hp: number;
    gold: number;
    invulnerable: boolean;
  };

  expect(after.encounter, "encounter nie cofa się po śmierci").toBe(before.encounter);
  expect(after.enemies.length, "wrogowie zostają na arenie").toBe(before.enemies.length);
  expect(
    after.enemies.map((e) => e.hp),
    "wrogowie zachowują nadgryzione HP",
  ).toEqual(before.enemies.map((e) => e.hp));
  expect(after.hp, "gracz wraca z pełnym HP").toBe(after.maxHp);
  expect(after.gold, "kara 10% złota").toBe(90);
  expect(after.invulnerable, "krótka nietykalność po odrodzeniu").toBe(true);
});
