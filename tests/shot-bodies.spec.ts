/** Podgląd brył postaci z bliska (PW_TOOLS). */
import { test } from "@playwright/test";
const ART = "/Users/dlubinski/Desktop/Pulpit/aa/monster_slayer/tests/artifacts";

test("bryły postaci z bliska", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 560, height: 420 });
  await page.goto("/?quality=high", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Graj" }).click();
  await page.waitForFunction(() => (window as any).__ms?.renderer?.scene !== undefined, { timeout: 60000 });
  await page.waitForTimeout(3500);
  await page.evaluate(() => { (document.getElementById("ui") as HTMLElement).style.display = "none"; });

  // Ustawiamy wrogów w rzędzie wokół gracza, żeby było widać wszystkie typy.
  await page.evaluate(() => {
    const g = (window as any).__ms, w = g.world, s = w.store;
    const px = s.x[w.player], py = s.y[w.player];
    let n = 0;
    for (let i = 0; i < s.count; i++) {
      if (!s.alive[i] || s.kind[i] !== 2) continue;
      const a = (n / 6) * Math.PI * 2;
      s.x[i] = px + Math.cos(a) * 3.2; s.y[i] = py + Math.sin(a) * 3.2;
      s.prevX[i] = s.x[i]; s.prevY[i] = s.y[i];
      n++;
    }
  });
  // Kamera ortograficzna nie zbliża się przy mniejszym oknie — zoom trzeba
  // ustawić wprost, zmieniając wysokość kadru w metrach.
  await page.evaluate(() => {
    const c = (window as any).__ms.renderer.scene.activeCamera;
    const aspect = window.innerWidth / window.innerHeight;
    const half = 3.4;
    c.orthoTop = half; c.orthoBottom = -half;
    c.orthoLeft = -half * aspect; c.orthoRight = half * aspect;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${ART}/3d-bodies.png` });
});
