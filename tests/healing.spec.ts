/**
 * Dwie różne reguły leczenia:
 *  - zabójstwo wroga wychodzi PONAD max HP (overheal),
 *  - pasywna regeneracja 1 HP/s kończy się dokładnie na max HP.
 * Test steruje symulacją przez dev-owy uchwyt `window.__ms`, bo wywołanie
 * konkretnego źródła leczenia w konkretnym momencie inaczej byłoby loterią.
 */
import { expect, test } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";

const STATE = `(() => {
  const w = window.__ms.world, s = w.store, p = w.player;
  return {
    hp: +s.hp[p].toFixed(2),
    maxHp: Math.round(s.maxHp[p]),
    limit: w.overhealLimit,
    hpRegen: w.balance.combat.player.hpRegen,
    killHealPct: w.balance.combat.player.killHealPct,
  };
})()`;

type State = { hp: number; maxHp: number; limit: number; hpRegen: number; killHealPct: number };

test("leczenie za zabójstwo wychodzi ponad limit HP", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Graj" }).click();
  await page.waitForTimeout(600);

  const before = (await page.evaluate(STATE)) as State;
  expect(before.killHealPct).toBeGreaterThan(0);

  // Wstawiamy grubego wroga tuż obok i zabijamy go — leczenie to 10% JEGO max HP.
  const healed = (await page.evaluate(`(() => {
    const w = window.__ms.world, s = w.store, p = w.player;
    s.hp[p] = s.maxHp[p];                       // start z pełnym HP
    const idx = w.enemyDefs.findIndex(d => d.id === 'rot_knight');
    const e = w.spawnEnemy(idx, 2.5, 0, 1, false);
    const enemyMax = s.maxHp[e];
    w.damageEnemy(e, 1e9, false, 'physical', 0, 0, 0, false);
    return { hp: s.hp[p], maxHp: s.maxHp[p], enemyMax };
  })()`)) as { hp: number; maxHp: number; enemyMax: number };

  expect(healed.hp, "HP musi przekroczyć maksimum bohatera").toBeGreaterThan(healed.maxHp);
  // 10% z max HP Rycerza Zgnilizny (1800 bazowo).
  const expected = healed.maxHp + healed.enemyMax * before.killHealPct;
  expect(healed.hp).toBeCloseTo(Math.min(expected, before.limit), 1);

  // Nadwyżka jest widoczna w HUD jako złoty segment i licznik "+N".
  await page.waitForTimeout(300);
  await expect(page.locator(".hp .over")).toBeVisible();
  await expect(page.locator(".hpnum .bonus")).toBeVisible();
});

test("pasywna regeneracja zatrzymuje się na max HP", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Graj" }).click();
  await page.waitForTimeout(600);

  const s0 = (await page.evaluate(STATE)) as State;
  expect(s0.hpRegen).toBeGreaterThan(0);

  // Ustawiamy HP tuż pod maksimum i czekamy dłużej, niż trzeba na dobicie.
  //
  // Arenę najpierw czyścimy i wstrzymujemy kolejną falę. Bez tego test mierzy
  // regenerację w trakcie walki: bohater stoi bezczynnie przez sześć sekund,
  // wróg zdąży go trafić i „regeneracja nie dobiła do maksimum" oznacza
  // wtedy tyle, że gracz oberwał. Sprawdzamy regenerację, nie przeżywalność.
  await page.evaluate(`(() => {
    const w = window.__ms.world, s = w.store, p = w.player;
    for (let i = 0; i < s.count; i++) {
      if (s.alive[i] && s.kind[i] === 2) w.damageEnemy(i, 1e12, false, 'physical', 0, 0, 0, true);
    }
    w.encounter.active = false;
    w.encounter.intermission = 9999;
    s.hp[p] = s.maxHp[p] - 3;
  })()`);
  await page.waitForTimeout(6000);

  const s1 = (await page.evaluate(STATE)) as State;
  expect(s1.hp, "regeneracja nie może wyjść ponad max HP").toBeLessThanOrEqual(s1.maxHp);
  expect(s1.hp, "regeneracja ma faktycznie dobić do maksimum").toBeGreaterThan(s1.maxHp - 1);

  // Overheal z zabójstwa nie jest zjadany przez regenerację ani jej brak.
  await page.evaluate(`(() => {
    const w = window.__ms.world, s = w.store, p = w.player;
    s.hp[p] = s.maxHp[p] * 1.5;
  })()`);
  await page.waitForTimeout(2500);
  const s2 = (await page.evaluate(STATE)) as State;
  expect(s2.hp, "nadwyżka ponad limit zostaje").toBeGreaterThan(s2.maxHp);
});
