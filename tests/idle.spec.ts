/**
 * E2E warstwy idle. Testujemy rzeczy, które da się zepsuć po cichu i których
 * nie złapie żaden test jednostkowy, bo wymagają prawdziwej przeglądarki:
 *   • ekran powrotu pojawia się po nieobecności i pokazuje konkretne liczby,
 *   • ODBIERZ faktycznie dopisuje złoto i nie da się go kliknąć dwa razy,
 *   • panel idle kupuje ulepszenia,
 *   • kod builda przechodzi round-trip przez interfejs.
 *
 * Wymaga działającej gry (`docker compose up` albo `pnpm preview`).
 */
import { expect, test, type Page } from "@playwright/test";

/**
 * Wstrzykuje zapis z warstwą idle sprzed `awayHours` godzin.
 *
 * Zapis podkładamy PRZED wejściem na stronę — inaczej gra zdąży wystartować
 * z pustym stanem i policzyć zerową nieobecność.
 */
async function seedSave(page: Page, awayHours: number, zone = 30): Promise<void> {
  await page.addInitScript(
    ([hours, z]) => {
      const lastSeen = Date.now() - hours * 3600 * 1000;
      const idle = {
        version: 1,
        gold: "5|4",
        goldThisRun: "5|4",
        goldLifetime: "5|4",
        materials: { scrap: 0, fragment: 0, dust: 0, essence: 0 },
        upgrades: {
          damage: 220,
          attackSpeed: 90,
          critChance: 60,
          critMult: 80,
          goldFind: 100,
          areaDamage: 70,
          magicFind: 30,
        },
        zone: z,
        zoneProgress: 0,
        zoneTimer: 0,
        deepestZone: z,
        deepestZoneEver: z,
        equipment: {},
        stash: [],
        prestige: {
          points: 0,
          spent: 0,
          lifetime: 0,
          count: 0,
          nodes: {},
          sparks: 0,
          ascensions: 0,
          ascensionNodes: {},
          lastPrestigeAt: lastSeen,
        },
        skills: {},
        automation: {},
        bestiary: {},
        challenges: { activeId: null, startedAt: 0, snapshot: null, completed: [], best: {} },
        lootFilter: { enabled: false, rules: [], keepAffixes: [], keepUpgrades: true },
        uniquesFound: [],
        lastSeen,
        startedAt: lastSeen,
        playtime: 3600,
        supporter: false,
        totals: { kills: 0, bosses: 0, items: 0, salvaged: 0, rerolls: 0, offlineSeconds: 0 },
        buildName: "Test",
        notation: "short",
      };

      // Zapis idzie prosto do IndexedDB pod kluczem `idb-keyval`, bo gra czyta
      // go w `boot()` zanim cokolwiek wyrenderuje.
      const req = indexedDB.open("keyval-store", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("keyval");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("keyval", "readwrite");
        tx.objectStore("keyval").put(
          {
            save_version: 3,
            updated_at: new Date(lastSeen).toISOString(),
            seed: 1234,
            character: {
              level: 1,
              xp: 0,
              attributes: { strength: 5, dexterity: 5, vitality: 5, will: 5 },
              attributePoints: 0,
              skillPoints: 0,
              gold: 0,
              potions: 3,
              equipment: {},
              inventory: [],
              killsWithoutDrop: 0,
              totalKills: 0,
            },
            encounterIndex: 0,
            settings: undefined,
            stats: { kills: 0, playtime: 0, deaths: 0 },
            idle,
          },
          "save:slot_1",
        );
      };
    },
    [awayHours, zone] as const,
  );
}

test("ekran powrotu pokazuje konkretne liczby po nieobecności", async ({ page }) => {
  await seedSave(page, 7.7);
  await page.goto("/");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  // v4 §2.2 punkt 1: konkretne liczby, nie „zebrano nagrody".
  await expect(dialog).toContainText(/Nieobecność:\s*7\s*h/);
  await expect(dialog.getByText("Zabici")).toBeVisible();
  await expect(dialog.getByText("Złoto")).toBeVisible();
  await expect(dialog.getByText("Najgłębsza strefa")).toBeVisible();

  // Licznik zabójstw musi być niezerowy — inaczej offline nic nie policzył.
  const kills = await dialog
    .locator(".idle-stat", { hasText: "Zabici" })
    .locator(".value")
    .textContent();
  expect(kills?.replace(/\D/g, "")).not.toBe("");
  expect(Number(kills?.replace(/\D/g, ""))).toBeGreaterThan(0);

  await expect(dialog.getByRole("button", { name: "ODBIERZ" })).toBeFocused();
});

test("ODBIERZ zamyka ekran i nie da się odebrać dwa razy", async ({ page }) => {
  await seedSave(page, 6);
  await page.goto("/");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  const goldBefore = await page.evaluate(
    () => (window as unknown as { __ms: { idle: { engine: { state: { gold: unknown } } } } }).__ms
      .idle.engine.state.gold,
  );

  await dialog.getByRole("button", { name: "ODBIERZ" }).click();
  await expect(dialog).toBeHidden();

  const goldAfter = await page.evaluate(
    () => (window as unknown as { __ms: { idle: { engine: { state: { gold: { m: number; e: number } } } } } })
      .__ms.idle.engine.state.gold,
  );
  expect(goldAfter).not.toEqual(goldBefore);

  // Drugie odebranie tego samego raportu musi być no-opem (idempotencja).
  const goldTwice = await page.evaluate(() => {
    const g = (window as unknown as { __ms: { idle: { claimOffline(): void; engine: { state: { gold: unknown } } } } }).__ms;
    g.idle.claimOffline();
    return g.idle.engine.state.gold;
  });
  expect(goldTwice).toEqual(goldAfter);
});

test("krótka nieobecność nie pokazuje ekranu powrotu", async ({ page }) => {
  // Poniżej `offline.minSecondsToShow` — zysk się należy, ale ekran nie.
  await seedSave(page, 0.01);
  await page.goto("/");
  await page.waitForFunction(() => (window as unknown as { __ms?: unknown }).__ms !== undefined, {
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "ODBIERZ" })).toHaveCount(0);
});

test("panel idle kupuje ulepszenia i podnosi DPS", async ({ page }) => {
  await seedSave(page, 8);
  await page.goto("/");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "ODBIERZ" }).click();

  await page.evaluate(() =>
    (window as unknown as { __ms: { openIdlePanel(): void } }).__ms.openIdlePanel(),
  );

  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Ulepszenia")).toBeVisible();

  const dpsBefore = await page.evaluate(
    () => (window as unknown as { __ms: { idle: { engine: { rates: { dps: { m: number; e: number } } } } } })
      .__ms.idle.engine.rates.dps,
  );

  await panel.getByRole("button", { name: /Kup max/ }).first().click();

  const dpsAfter = await page.evaluate(
    () => (window as unknown as { __ms: { idle: { engine: { rates: { dps: { m: number; e: number } } } } } })
      .__ms.idle.engine.rates.dps,
  );
  const before = dpsBefore.m * Math.pow(10, dpsBefore.e);
  const after = dpsAfter.m * Math.pow(10, dpsAfter.e);
  expect(after).toBeGreaterThan(before);
});

test("kod builda przechodzi round-trip przez interfejs", async ({ page }) => {
  await seedSave(page, 8);
  await page.goto("/");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "ODBIERZ" }).click();

  await page.evaluate(() =>
    (window as unknown as { __ms: { openCharacterSheet(): void } }).__ms.openCharacterSheet(),
  );

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Kod builda")).toBeVisible();

  const code = await sheet.locator(".buildcode code").textContent();
  expect(code).toMatch(/^MS4:/);

  // Wklejenie własnego kodu musi się udać — to jest cała pętla z v4 §5.8.
  await sheet.getByLabel("Wklej kod builda").fill(code!);
  await sheet.getByRole("button", { name: "Zastosuj co się da" }).click();
  await expect(page.locator(".toasts")).toContainText(/./, { timeout: 5000 });
});
