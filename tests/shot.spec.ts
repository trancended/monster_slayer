/** Pomocniczy zrzut ekranu do oceny wizualnej — nie jest testem regresji. */
import { test } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";

test("zrzut z walki", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Graj" }).click();

  const box = await page.locator("#stage canvas").boundingBox();
  const cx = (box?.width ?? 1280) / 2;
  const cy = (box?.height ?? 800) / 2;

  const deadline = Date.now() + Number(process.env.SHOT_SECONDS ?? 14) * 1000;
  let a = 0;
  let i = 0;
  while (Date.now() < deadline) {
    // Bez uników bot ginie — co samo w sobie jest dobrym sygnałem o trudności.
    if (++i % 4 === 0) {
      await page.keyboard.down("KeyW");
      await page.keyboard.press("Space");
      await page.waitForTimeout(120);
      await page.keyboard.up("KeyW");
      await page.keyboard.press("Digit1");
    }
    a += 0.5;
    await page.mouse.move(cx + Math.cos(a) * 200, cy + Math.sin(a) * 120);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.waitForTimeout(100);
  }
  await page.screenshot({ path: "tests/artifacts/combat.png" });
  // Zbliżenie na okolicę gracza — do oceny czytelności sylwetek.
  await page.screenshot({
    path: "tests/artifacts/combat-zoom.png",
    clip: { x: cx - 260, y: cy - 200, width: 520, height: 300 },
    scale: "css",
  });
});
