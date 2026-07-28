/** Diagnostyka: czy panel ekwipunku przeżywa niskie/wąskie okno i skalę UI. */
import { test } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";

const CASES = [
  { w: 1440, h: 789, scale: 1, opis: "MacBook Air, okno pełne" },
  { w: 1440, h: 620, scale: 1, opis: "niskie okno" },
  { w: 1280, h: 500, scale: 1, opis: "bardzo niskie okno" },
  { w: 1024, h: 640, scale: 1, opis: "wąskie okno" },
  { w: 1440, h: 700, scale: 1.5, opis: "skala UI 150%" },
  { w: 900, h: 560, scale: 1.25, opis: "małe okno + skala 125%" },
];

test("panel ekwipunku w różnych oknach", async ({ page }) => {
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));

  for (const c of CASES) {
    await page.setViewportSize({ width: c.w, height: c.h });
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Graj" }).click();
    await page.waitForTimeout(400);

    await page.evaluate(
      `(() => {
        const g = window.__ms, w = g.world;
        for (let i = 0; i < 8; i++) w.character.inventory.push(w.loot.generateItem(5));
        w.character.attributePoints = 5;
        g.applySettings({ ...g.constructor && window.__ms.world ? window.__hudSettings ?? {} : {} });
      })()`,
    ).catch(() => {});

    await page.evaluate(`document.documentElement.style.setProperty('--ui-scale', '${c.scale}')`);
    await page.keyboard.press("KeyI");
    await page.waitForTimeout(400);

    const r = await page.evaluate(`(() => {
      const box = (s) => { const el = document.querySelector(s); if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
      const panel = box('.scrim .panel');
      const vis = panel ? (panel.w > 40 && panel.h > 40 && panel.y < window.innerHeight && panel.y + panel.h > 0) : false;
      return {
        scrim: box('.scrim'),
        panel,
        naEkranie: vis,
        naglowekWidoczny: !!document.querySelector('.scrim header h1'),
        atrybuty: document.querySelectorAll('.scrim .attr').length,
        przedmioty: document.querySelectorAll('.scrim .item').length,
        gridH: (() => { const g = document.querySelector('.scrim .grid'); return g ? Math.round(g.getBoundingClientRect().height) : null; })(),
      };
    })()`);
    console.log(`--- ${c.opis} (${c.w}x${c.h}, skala ${c.scale}):`, JSON.stringify(r));
  }
});
