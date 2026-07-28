/** Diagnostyka: czy po ekwipunku gracz nadal potrafi atakować. */
import { test } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";

const PROBE = `(() => {
  const g = window.__ms;
  const w = g.world, s = w.store, p = w.player;
  let enemies = 0;
  for (let i = 0; i < s.count; i++) if (s.alive[i] && s.kind[i] === 2) enemies++;
  return {
    screen: document.querySelector('.scrim') ? 'overlay' : 'gra',
    paused: g.loop.isPaused,
    playerState: s.state[p],
    stateTime: +s.stateTime[p].toFixed(3),
    stateDuration: +s.stateDuration[p].toFixed(3),
    hp: Math.round(s.hp[p]),
    stamina: Math.round(w.stamina),
    attackSpeed: +w.derived.attackSpeed.toFixed(3),
    weapon: [Math.round(w.derived.weaponMin), Math.round(w.derived.weaponMax)],
    moveSpeed: +w.derived.moveSpeed.toFixed(2),
    comboIndex: w.comboIndex,
    buffered: w.bufferedAction,
    enemies,
    kills: w.character.totalKills,
    elapsed: +w.elapsed.toFixed(1),
  };
})()`;

test("diagnostyka ekwipunku", async ({ page }) => {
  page.on("pageerror", (e) => console.log("[pageerror]", e.message, "\n", e.stack));

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Graj" }).click();

  const box = await page.locator("#stage canvas").boundingBox();
  const cx = (box?.width ?? 1280) / 2;
  const cy = (box?.height ?? 800) / 2;

  const attack = async (seconds: number) => {
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

  const probe = async (label: string) => {
    const v = await page.evaluate(PROBE);
    console.log(`--- ${label}:`, JSON.stringify(v));
    return v as Record<string, unknown>;
  };

  await attack(14);
  await probe("po walce (przed ekwipunkiem)");

  await page.keyboard.press("KeyI");
  await page.waitForTimeout(400);
  await probe("ekwipunek otwarty");

  const equip = page.getByRole("button", { name: /^Załóż/ }).first();
  if (await equip.isVisible().catch(() => false)) {
    await equip.click();
    await page.waitForTimeout(300);
    await probe("po założeniu przedmiotu");
  } else {
    console.log("--- brak przedmiotu do założenia");
  }

  await page.keyboard.press("KeyI");
  await page.waitForTimeout(400);
  await probe("ekwipunek zamknięty");

  await attack(14);
  await probe("po walce (po ekwipunku)");
});
