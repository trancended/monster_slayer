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
    if (++i % 6 === 0) await page.keyboard.press("Space");
    a += 0.5;
    await page.mouse.move(cx + Math.cos(a) * 180, cy + Math.sin(a) * 110);
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.up();
    await page.waitForTimeout(70);
  }

  if (process.env.SHOT_OVERHEAL === "true") {
    // Wymuszamy nadwyżkę HP, żeby zobaczyć złoty segment paska.
    await page.evaluate(`(() => {
      const w = window.__ms.world, s = w.store, p = w.player;
      s.hp[p] = s.maxHp[p] * 1.75;
    })()`);
    await page.waitForTimeout(300);
  }

  await page.screenshot({ path: "tests/artifacts/combat.png" });
  await page.screenshot({
    path: "tests/artifacts/combat-zoom.png",
    clip: { x: 0, y: cy + 120, width: 560, height: 260 },
    scale: "css",
  });
});
