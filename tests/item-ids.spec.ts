/**
 * Regresja: identyfikatory przedmiotów muszą być unikalne MIĘDZY sesjami.
 * Licznik zerowany przy wczytaniu strony sprawiał, że pierwszy łup po `F5`
 * dostawał to samo id co przedmiot z zapisu. Svelte wywalał wtedy
 * `each_key_duplicate` i gasił całe poddrzewo — panel ekwipunku znikał,
 * a na ekranie zostawała goła arena.
 */
import { expect, test, type ConsoleMessage } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";

test("nowy łup po przeładowaniu nie koliduje z id z zapisu", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Graj" }).click();
  await page.waitForTimeout(500);

  // Sesja 1: zbieramy łup i zapisujemy.
  const first = (await page.evaluate(`(() => {
    const g = window.__ms, w = g.world;
    for (let i = 0; i < 5; i++) w.character.inventory.push(w.loot.generateItem(5));
    return g.save().then(() => w.character.inventory.map(i => i.id));
  })()`)) as string[];
  expect(first).toHaveLength(5);
  await page.waitForTimeout(400);

  // Sesja 2: przeładowanie i NOWY łup — tu wcześniej dochodziło do kolizji.
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Graj" }).click();
  await page.waitForTimeout(600);

  const ids = (await page.evaluate(`(() => {
    const w = window.__ms.world;
    for (let i = 0; i < 5; i++) w.character.inventory.push(w.loot.generateItem(5));
    return w.character.inventory.map(i => i.id);
  })()`)) as string[];

  expect(ids.length, "5 z zapisu + 5 nowych").toBe(10);
  expect(new Set(ids).size, `id muszą być unikalne, było: ${ids.join(", ")}`).toBe(ids.length);

  // Panel musi się otworzyć i pokazać wszystkie 10 pozycji.
  await page.keyboard.press("KeyI");
  await expect(page.getByRole("heading", { name: "Ekwipunek" })).toBeVisible();
  await expect(page.locator(".scrim .item")).toHaveCount(10);

  const real = errors.filter((e) => !/favicon|net::ERR|Failed to load resource|WebGPU/i.test(e));
  expect(real, `błędy w konsoli:\n${real.join("\n")}`).toHaveLength(0);
});

test("zapis z duplikatami id jest naprawiany przy wczytaniu", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Graj" }).click();
  await page.waitForTimeout(500);

  // Podrzucamy zapis w starym formacie: same kolizje id, tak jak w v1.
  await page.evaluate(`(() => {
    const g = window.__ms, w = g.world;
    const mk = (id) => ({ id, name: 'Stary', slot: 'belt', rarity: 'common', itemLevel: 3,
      minDamage: 0, maxDamage: 0, armor: 5, affixes: [], sellValue: 10 });
    w.character.inventory = [mk('it_1'), mk('it_1'), mk('it_2'), mk('it_2'), mk('it_2')];
    w.character.equipment = { belt: mk('it_1') };
    return g.save();
  })()`);
  await page.waitForTimeout(400);

  // Cofamy wersję zapisu do 1, żeby migracja miała co naprawiać.
  await page.evaluate(`(async () => {
    const idb = await import('/node_modules/.vite/deps/idb-keyval.js');
    const s = await idb.get('save:slot_1');
    s.save_version = 1;
    await idb.set('save:slot_1', s);
  })()`);

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Graj" }).click();
  await page.waitForTimeout(700);

  const ids = (await page.evaluate(`(() => {
    const ch = window.__ms.world.character;
    return [...Object.values(ch.equipment), ...ch.inventory].map(i => i.id);
  })()`)) as string[];

  expect(ids.length).toBe(6);
  expect(new Set(ids).size, `po migracji id muszą być unikalne: ${ids.join(", ")}`).toBe(6);

  await page.keyboard.press("KeyI");
  await expect(page.getByRole("heading", { name: "Ekwipunek" })).toBeVisible();
  await expect(page.locator(".scrim .item")).toHaveCount(5);
});
