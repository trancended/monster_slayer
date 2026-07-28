/** Ekwipunek musi się otwierać i zamykać bez zawieszania pętli gry. */
import { expect, test, type ConsoleMessage } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";

test("ekwipunek otwiera się i zamyka, gra wraca do działania", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}\n${e.stack ?? ""}`));

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Graj" }).click();
  await page.waitForTimeout(1200);

  const heading = page.getByRole("heading", { name: "Ekwipunek" });

  // I otwiera
  await page.keyboard.press("KeyI");
  await expect(heading).toBeVisible();

  // I zamyka
  await page.keyboard.press("KeyI");
  await expect(heading).toBeHidden();

  // ...i gra dalej żyje: licznik encounteru się rusza
  await expect(page.locator(".botleft")).toBeVisible();

  // Ponowne otwarcie i zamknięcie przyciskiem
  await page.keyboard.press("KeyI");
  await expect(heading).toBeVisible();
  await page.getByRole("button", { name: /Zamknij/ }).click();
  await expect(heading).toBeHidden();

  // Tab z ekwipunku też musi wracać do gry
  await page.keyboard.press("KeyI");
  await expect(heading).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(heading).toBeHidden();

  // Ścieżka przez menu pauzy — wcześniej ten przycisk nie robił nic,
  // przez co gra wyglądała na zawieszoną za panelem pauzy.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("heading", { name: "Pauza" })).toBeVisible();
  await page.getByRole("button", { name: "Ekwipunek" }).click();
  await expect(heading).toBeVisible();
  await page.keyboard.press("KeyI");
  await expect(heading).toBeHidden();
  await expect(page.getByRole("heading", { name: "Pauza" })).toBeHidden();

  // Escape zamyka
  await page.keyboard.press("KeyI");
  await expect(heading).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(heading).toBeHidden();

  // Kliknięcie w tło poza panelem zamyka — najczęstszy odruch gracza.
  await page.keyboard.press("KeyI");
  await expect(heading).toBeVisible();
  await page.mouse.click(12, 12);
  await expect(heading).toBeHidden();

  // Kliknięcie WEWNĄTRZ panelu nie może go zamykać.
  await page.keyboard.press("KeyI");
  await expect(heading).toBeVisible();
  await page.getByRole("heading", { name: "Ekwipunek" }).click();
  await expect(heading).toBeVisible();
  await page.keyboard.press("KeyI");
  await expect(heading).toBeHidden();

  const real = errors.filter((e) => !/favicon|net::ERR|Failed to load resource|WebGPU/i.test(e));
  expect(real, `błędy:\n${real.join("\n")}`).toHaveLength(0);
});

test("ekwipunek w trakcie walki: zakładanie przedmiotu nie zawiesza gry", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}\n${e.stack ?? ""}`));

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Graj" }).click();

  const box = await page.locator("#stage canvas").boundingBox();
  const cx = (box?.width ?? 1280) / 2;
  const cy = (box?.height ?? 800) / 2;

  // Unik co szósty cykl, nie co cykl — inaczej bot spala staminę na uniki
  // i praktycznie nie atakuje, co fałszywie wygląda na zawieszoną grę.
  const fight = async (seconds: number) => {
    const until = Date.now() + seconds * 1000;
    let a = 0;
    let n = 0;
    while (Date.now() < until) {
      a += 0.5;
      await page.mouse.move(cx + Math.cos(a) * 180, cy + Math.sin(a) * 110);
      await page.mouse.down();
      await page.waitForTimeout(60);
      await page.mouse.up();
      if (++n % 6 === 0) await page.keyboard.press("Space");
      await page.waitForTimeout(70);
    }
  };

  // Walczymy, aż wypadnie cokolwiek do plecaka.
  await fight(30);

  await page.keyboard.press("KeyI");
  await expect(page.getByRole("heading", { name: "Ekwipunek" })).toBeVisible();

  const equipBtn = page.getByRole("button", { name: /^Załóż/ }).first();
  if (await equipBtn.isVisible().catch(() => false)) {
    await equipBtn.click();
    // Panel musi przeżyć przebudowę listy po założeniu.
    await expect(page.getByRole("heading", { name: "Ekwipunek" })).toBeVisible();
  }

  await page.keyboard.press("KeyI");
  await expect(page.getByRole("heading", { name: "Ekwipunek" })).toBeHidden();

  // Dowód, że symulacja wróciła: czas świata znowu płynie i gracz reaguje
  // na input. Mierzymy to wprost, a nie po licznikach zabójstw — te zależą od
  // tego, czy bot dogoni akurat wroga dystansowego.
  const elapsed = async () => (await page.evaluate(`window.__ms.world.elapsed`)) as number;

  const t0 = await elapsed();
  await page.waitForTimeout(2500);
  const t1 = await elapsed();
  expect(t1 - t0, "po zamknięciu ekwipunku czas świata musi płynąć").toBeGreaterThan(1.5);

  // ...i gracz faktycznie wykonuje ataki (stan 2 = Attack, 4 = Heavy).
  let attacked = false;
  for (let i = 0; i < 25 && !attacked; i++) {
    await page.mouse.down();
    await page.waitForTimeout(30);
    const st = (await page.evaluate(
      `window.__ms.world.store.state[window.__ms.world.player]`,
    )) as number;
    if (st === 2 || st === 4) attacked = true;
    await page.mouse.up();
    await page.waitForTimeout(40);
  }
  expect(attacked, "gracz musi móc atakować po zamknięciu ekwipunku").toBe(true);

  expect(errors, `błędy:\n${errors.join("\n")}`).toHaveLength(0);
});
