/** Diagnostyka: ekwipunek otwierany w trakcie walki, z trzymanym przyciskiem. */
import { test } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";

const PROBE = `(() => {
  const g = window.__ms, w = g.world, s = w.store, p = w.player;
  const panel = document.querySelector('.scrim .panel');
  return {
    screen: document.querySelector('.scrim h1')?.textContent ?? 'gra',
    panelBox: panel ? (() => { const b = panel.getBoundingClientRect();
      return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; })() : null,
    paused: g.loop.isPaused,
    playerState: s.state[p],
    intentAttackHeld: w.intent.attackHeld,
    intentMoveX: +w.intent.moveX.toFixed(2),
    elapsed: +w.elapsed.toFixed(2),
  };
})()`;

test("ekwipunek otwierany w trakcie ataku", async ({ page }) => {
  page.on("pageerror", (e) => console.log("[pageerror]", e.message, "\n", e.stack));

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Graj" }).click();
  await page.waitForTimeout(800);

  await page.evaluate(`(() => {
    const w = window.__ms.world;
    for (let i = 0; i < 6; i++) w.character.inventory.push(w.loot.generateItem(4));
  })()`);

  const probe = async (label: string) => {
    console.log(`--- ${label}:`, JSON.stringify(await page.evaluate(PROBE)));
  };

  // Symulujemy realną grę: ruch WASD + trzymany LPM, i w tym stanie „I".
  await page.keyboard.down("KeyW");
  await page.mouse.move(700, 400);
  await page.mouse.down();
  await page.waitForTimeout(400);
  await probe("walka, LPM wciśnięty");

  await page.keyboard.press("KeyI");
  await page.waitForTimeout(400);
  await probe("po I (LPM nadal wciśnięty, W nadal wciśnięte)");

  // Klik w przycisk wewnątrz panelu przy trzymanym LPM z canvasu.
  const equip = page.getByRole("button", { name: /^Załóż/ }).first();
  console.log("--- Załóż widoczny:", await equip.isVisible().catch(() => false));
  await equip.click({ force: true }).catch((e) => console.log("--- klik padł:", e.message));
  await page.waitForTimeout(300);
  await probe("po kliknięciu Załóż");

  await page.mouse.up();
  await page.keyboard.up("KeyW");

  await page.keyboard.press("KeyI");
  await page.waitForTimeout(400);
  await probe("po zamknięciu");

  await page.waitForTimeout(1500);
  await probe("1.5 s później");
  await page.screenshot({ path: "tests/artifacts/inventory.png" });
});
