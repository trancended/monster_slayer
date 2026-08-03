/**
 * Smoke E2E (stack §6): start gry → wejście na arenę → zabicie wroga.
 * Test celowo nie sprawdza pikseli — sprawdza, że pętla żyje i że stan
 * gry realnie się zmienia pod wpływem inputu.
 */
import { expect, test, type ConsoleMessage } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";

/**
 * Bot nie robi uników, więc bywa, że ginie. Ekran śmierci przykrywa HUD,
 * a ślepe klikanie potrafi wejść w menu opcji — wracamy wtedy na arenę.
 */
async function ensurePlaying(page: import("@playwright/test").Page): Promise<void> {
  const back = page.getByRole("button", { name: "Wróć na arenę" });
  if (await back.isVisible().catch(() => false)) await back.click();
  const resume = page.getByRole("button", { name: "Wróć do gry" });
  if (await resume.isVisible().catch(() => false)) await resume.click();
  const fromOptions = page.getByRole("button", { name: "Wróć", exact: true });
  if (await fromOptions.isVisible().catch(() => false)) {
    await fromOptions.click();
    await ensurePlaying(page);
  }
}

test("gra startuje, walczy i naprawdę zabija wrogów", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

  await page.goto(BASE, { waitUntil: "networkidle" });

  // Ekran startowy jest wymogiem polityki autoplay — bez niego brak dźwięku.
  await expect(page.getByRole("heading", { name: "Monster Slayer" })).toBeVisible();
  await page.getByRole("button", { name: "Graj" }).click();

  // Canvas Pixi musi istnieć i mieć niezerowy rozmiar.
  const canvas = page.locator("#stage canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(200);
  expect(box?.height ?? 0).toBeGreaterThan(200);

  // HUD z DOM overlay.
  await expect(page.getByRole("meter", { name: "Zdrowie" })).toBeVisible();

  // Pierwszy encounter startuje po 3 s przerwy.
  await expect
    .poll(async () => page.locator("text=/wrogów: \\d+/").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);

  // Walka: kręcimy się i młócimy przez ~25 s realnego czasu.
  const center = { x: (box?.width ?? 800) / 2, y: (box?.height ?? 600) / 2 };
  const deadline = Date.now() + 25_000;
  let angle = 0;
  while (Date.now() < deadline) {
    angle += 0.6;
    await page.mouse.move(
      center.x + Math.cos(angle) * 220,
      center.y + Math.sin(angle) * 130,
    );
    await page.mouse.down();
    await page.waitForTimeout(90);
    await page.mouse.up();
    await page.keyboard.press("Space");
    await page.waitForTimeout(120);
  }

  // Licznik zabójstw w HUD musi urosnąć — dowód, że symulacja i walka działają.
  const killsText = await page.locator("text=/Zabójstwa: \\d+/").first().innerText();
  const kills = Number(killsText.replace(/\D/g, ""));
  expect(kills, "gracz powinien kogoś zabić w 25 s").toBeGreaterThan(0);

  // Menu pod Tab (Esc kolidowałby z fullscreenem).
  await page.keyboard.press("Tab");
  await expect(page.getByRole("heading", { name: "Pauza" })).toBeVisible();

  await page.screenshot({ path: "tests/artifacts/smoke.png", fullPage: false });

  // Filtrujemy szumy niezależne od gry (brak backendu jest stanem poprawnym).
  const real = errors.filter(
    (e) => !/favicon|net::ERR|Failed to load resource|WebGPU|GPUAdapter/i.test(e),
  );
  expect(real, `błędy w konsoli:\n${real.join("\n")}`).toHaveLength(0);
});

test("F5 nie gubi postępu (IndexedDB)", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Graj" }).click();

  const box = await page.locator("#stage canvas").boundingBox();
  const cx = (box?.width ?? 1280) / 2;
  const cy = (box?.height ?? 800) / 2;

  // Zbieramy złoto — autozapis leci m.in. po wyczyszczeniu encounteru.
  // Bot chodzi WASD-em, a nie tylko klika. Od czasu przejścia na celowanie
  // kierunkiem ruchu (domyślne, patrz Opcje → Sterowanie) postać stojąca
  // w miejscu nie obraca się — bot bez ruchu bije wyłącznie przed siebie
  // i przestaje reprezentować gracza.
  const KIERUNKI = ["KeyW", "KeyD", "KeyS", "KeyA"] as const;
  const deadline = Date.now() + 22_000;
  let a = 0;
  let i = 0;
  while (Date.now() < deadline) {
    if (++i % 12 === 0) await ensurePlaying(page);
    a += 0.5;

    const kier = KIERUNKI[i % KIERUNKI.length]!;
    await page.keyboard.down(kier);
    await page.mouse.move(cx + Math.cos(a) * 200, cy + Math.sin(a) * 120);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.keyboard.up(kier);
    await page.keyboard.press("Space");
    await page.waitForTimeout(90);
  }
  await ensurePlaying(page);

  const readGold = async () =>
    Number((await page.locator(".gold").first().innerText()).replace(/\D/g, ""));
  const readKills = async () =>
    Number((await page.locator("text=/Zabójstwa: \\d+/").first().innerText()).replace(/\D/g, ""));

  /*
   * Warunek wstępny to **zabójstwa**, nie złoto.
   *
   * Ten test nazywa się „F5 nie gubi postępu" i ma sprawdzać PERSYSTENCJĘ.
   * Wcześniej wymagał, żeby bot zdążył zabić wroga ORAZ przejść po upuszczonym
   * złocie w 22 s — czyli sprawdzał przy okazji nawigację bota. Przy ~13 fps
   * w rasteryzacji programowej (headless) to bywało kwestią szczęścia i test
   * padał, mimo że zapis działał bez zarzutu.
   *
   * Licznik zabójstw jest zapisywany tak samo jak złoto, więc nadaje się do
   * tej weryfikacji równie dobrze — a rośnie niezawodnie.
   */
  expect(await readKills(), "bot powinien kogoś zabić w 22 s").toBeGreaterThan(0);

  // Odczekujemy ponad jeden cykl autosave'u (8 s), żeby stan na dysku
  // odpowiadał stanowi na ekranie. `pagehide` nie zdąży dokończyć
  // asynchronicznej transakcji IndexedDB, więc na nim nie polegamy.
  await page.waitForTimeout(10_000);
  const gold = await readGold();
  const kills = await readKills();

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Graj" }).click();
  await page.waitForTimeout(1500);
  await ensurePlaying(page);

  expect(await readKills(), "licznik zabójstw musi przeżyć F5").toBeGreaterThanOrEqual(kills);
  // Margines 10% pokrywa karę za ewentualną śmierć w trakcie oczekiwania.
  // Gdy bot nie zdążył podnieść złota, warunek jest spełniony trywialnie —
  // niosącą asercją jest wtedy licznik zabójstw powyżej.
  expect(await readGold(), "złoto musi przeżyć F5").toBeGreaterThanOrEqual(
    Math.floor(gold * 0.9),
  );
});

test("gra działa z wyłączonym backendem (tryb offline)", async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Graj" }).click();
  await expect(page.locator("#stage canvas")).toBeVisible();
  await expect(page.locator("text=/offline · balans: bundled/")).toBeVisible({ timeout: 15_000 });
});
