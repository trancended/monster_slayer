/**
 * Straż przed czarnym ekranem.
 *
 * Ta klasa błędu nie miała żadnego zabezpieczenia: scena mogła nie narysować
 * niczego, a wszystkie pozostałe testy przechodziły — bo HUD, zapis, walka
 * i warstwa idle działają niezależnie od renderera. Objaw zgłosił dopiero
 * człowiek: „widzę menu i liczby obrażeń, reszta czarna".
 *
 * Test sprawdza to, czego nie sprawdza żaden inny: że w canvasie 3D **są
 * niezerowe piksele** i że scena ma aktywne siatki.
 */
import { expect, test } from "@playwright/test";

/** Średnia jasność kadru w grze, która jest z założenia mroczna. */
const MIN_BRIGHTNESS = 4;

async function measure(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const g = (window as any).__ms;
    const cv = document.querySelector("#stage canvas") as HTMLCanvasElement | null;
    if (!cv) return { blad: "brak canvasu 3D" };

    const probe = document.createElement("canvas");
    probe.width = 64;
    probe.height = 48;
    const ctx = probe.getContext("2d")!;
    ctx.drawImage(cv, 0, 0, 64, 48);
    const d = ctx.getImageData(0, 0, 64, 48).data;
    let sum = 0;
    let max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const lum = d[i]! + d[i + 1]! + d[i + 2]!;
      sum += lum;
      if (lum > max) max = lum;
    }
    return {
      jasnosc: sum / (d.length / 4) / 3,
      maks: max / 3,
      aktywneSiatki: g?.renderer?.scene?.getActiveMeshes?.().length ?? -1,
      silnik: g?.renderer?.engine?.constructor?.name ?? "?",
      jakosc: g?.renderer?.qualityLevel ?? "?",
      panelAwarii: !!document.querySelector("[data-render-failure]"),
    };
  });
}

for (const quality of ["minimal", "low", "high"] as const) {
  test(`scena 3D rysuje niezerowe piksele — jakość ${quality}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 900, height: 600 });
    await page.goto(`/?quality=${quality}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Graj" }).click();
    await page.waitForFunction(() => (window as any).__ms?.renderer?.scene !== undefined, {
      timeout: 60_000,
    });
    // Poza czasem na kilka klatek dajemy też czas samokontroli renderera (2 s).
    await page.waitForTimeout(4000);

    const m = await measure(page);
    expect(m.blad, "canvas 3D musi istnieć").toBeUndefined();
    expect(m.aktywneSiatki, `scena bez aktywnych siatek (${JSON.stringify(m)})`).toBeGreaterThan(0);
    expect(m.jasnosc, `kadr jest czarny (${JSON.stringify(m)})`).toBeGreaterThan(
      MIN_BRIGHTNESS,
    );
    expect(m.panelAwarii, "renderer zgłosił awarię rysowania").toBe(false);
  });
}
