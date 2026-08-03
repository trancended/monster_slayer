/**
 * Narzędzie diagnostyczne (PW_TOOLS) — zrzuty oprawy 3D.
 * Wymusza `?quality=high`, bo headless wykryłby rasteryzację programową
 * i pokazał wersję bez post-processingu, czyli nie tę, którą widzi gracz.
 */
import { test } from "@playwright/test";
const ART = "/Users/dlubinski/Desktop/Pulpit/aa/monster_slayer/tests/artifacts";

test("zrzuty sceny 3D", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?quality=high", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Graj" }).click();
  await page.waitForFunction(() => (window as any).__ms?.renderer?.scene !== undefined, { timeout: 60000 });
  await page.waitForTimeout(5000);

  await page.screenshot({ path: `${ART}/3d-arena.png` });

  // Walka: bot bije, żeby na arenie pojawiła się krew i wrogowie w akcji.
  const box = await page.locator("#stage canvas").boundingBox();
  const cx = (box?.width ?? 1280) / 2, cy = (box?.height ?? 800) / 2;
  let a = 0;
  for (let i = 0; i < 26; i++) {
    a += 0.5;
    await page.mouse.move(cx + Math.cos(a) * 170, cy + Math.sin(a) * 100);
    await page.mouse.down(); await page.waitForTimeout(110); await page.mouse.up();
    await page.waitForTimeout(110);
  }
  await page.screenshot({ path: `${ART}/3d-combat.png` });

  // Wymuszony krytyk + combo — pełna oprawa efektów.
  await page.evaluate(() => {
    const g = (window as any).__ms;
    const w = g.world, s = w.store, p = w.player;
    for (let i = 0; i < 10; i++) w.killCombo.add();
    const snap = w.killCombo.snapshot();
    w.bus.emit("combo:changed", { count: snap.count, tier: snap.tier, name: snap.name, multiplier: snap.multiplier, tierUp: true, x: s.x[p], y: s.y[p] });
    const face = s.facing[p];
    for (let i = 0; i < 3; i++) {
      const ang = face + (i - 1) * 0.5;
      g.renderer.spawnHitFx(s.x[p] + Math.cos(ang) * 1.5, s.y[p] + Math.sin(ang) * 1.5, ang, true, 1.3);
    }
    g.renderer.spawnSwing(s.x[p], s.y[p], face, 1.6, 2.6, false, true);
  });
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${ART}/3d-crit.png` });
});
