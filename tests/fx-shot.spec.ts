/**
 * Narzędzie diagnostyczne (PW_TOOLS) — zrzuty nowej oprawy graficznej.
 *
 * Nie jest testem regresji: sprawdza wzrokowo to, czego asercja nie złapie —
 * czy krew, blask krytyka i licznik combo faktycznie widać na ekranie.
 * Wymusza zdarzenia przez `__ms`, zamiast liczyć na to, że bot trafi krytyka.
 */
import { test } from "@playwright/test";

const ART = "/Users/dlubinski/Desktop/Pulpit/aa/monster_slayer/tests/artifacts";

test("zrzuty efektów walki", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Graj" }).click();
  await page.waitForFunction(() => (window as any).__ms?.world !== undefined, { timeout: 30_000 });

  // Bot bije chwilę, żeby na arenie byli wrogowie i pojawiły się plamy krwi.
  const box = await page.locator("#stage canvas").boundingBox();
  const cx = (box?.width ?? 1280) / 2;
  const cy = (box?.height ?? 800) / 2;
  let a = 0;
  for (let i = 0; i < 45; i++) {
    a += 0.5;
    await page.mouse.move(cx + Math.cos(a) * 190, cy + Math.sin(a) * 110);
    await page.mouse.down();
    await page.waitForTimeout(70);
    await page.mouse.up();
    await page.waitForTimeout(70);
  }

  // Wymuszamy krytyk i serię, żeby zrzut pokazał to, co ma pokazać.
  await page.evaluate(() => {
    const g = (window as any).__ms;
    const w = g.world;
    const s = w.store;
    const px = s.x[w.player];
    const py = s.y[w.player];

    // Kilkanaście zabójstw w bus-ie podbija combo do wysokiego tieru.
    for (let i = 0; i < 12; i++) {
      w.killCombo.add();
    }
    const snap = w.killCombo.snapshot();
    w.bus.emit("combo:changed", {
      count: snap.count, tier: snap.tier, name: snap.name,
      multiplier: snap.multiplier, tierUp: true, x: px, y: py,
    });

    // Krytyk: czerwony blask ostrza, rozbłysk, zielona krew.
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2;
      g.renderer.spawnHitFx(px + Math.cos(ang) * 1.6, py + Math.sin(ang) * 1.6, ang, true, 1.2);
    }
    g.renderer.spawnSwing(px, py, s.facing[w.player], 1.6, 2.6, false, true);
  });

  await page.waitForTimeout(90);
  await page.screenshot({ path: `${ART}/fx-crit.png` });

  // Zbliżenie: mniejszy kadr = postać zajmuje więcej ekranu, bo kamera ją
  // centruje. Prostsze i pewniejsze niż `clip`, który potrafi tu zawisnąć.
  await page.setViewportSize({ width: 520, height: 380 });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const g = (window as any).__ms;
    const w = g.world;
    const s = w.store;
    const px = s.x[w.player];
    const py = s.y[w.player];
    const face = s.facing[w.player];
    g.renderer.spawnHitFx(px + Math.cos(face) * 1.4, py + Math.sin(face) * 1.4, face, true, 1.3);
    g.renderer.spawnSwing(px, py, face, 1.6, 2.6, false, true);
  });
  await page.waitForTimeout(70);
  await page.screenshot({ path: `${ART}/fx-crit-zoom.png` });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(120);

  // Druga klatka: śmierć wroga — pierścień, odłamki, trwała plama.
  await page.evaluate(() => {
    const g = (window as any).__ms;
    const w = g.world;
    const s = w.store;
    const px = s.x[w.player];
    const py = s.y[w.player];
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + 0.4;
      g.renderer.spawnDeathFx(px + Math.cos(ang) * 2.2, py + Math.sin(ang) * 2.2, 0x6fd44f, i === 0);
    }
  });
  await page.waitForTimeout(140);
  await page.screenshot({ path: `${ART}/fx-death.png` });

  // Trzecia: po opadnięciu krwi widać plamy na arenie.
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${ART}/fx-decals.png` });
});
