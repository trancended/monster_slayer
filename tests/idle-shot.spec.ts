import { test } from "@playwright/test";
import { readFileSync } from "node:fs";

const seed = readFileSync("/Users/dlubinski/Desktop/Pulpit/aa/monster_slayer/tests/idle.spec.ts", "utf8");

test("zrzuty ekranów idle", async ({ page }) => {
  await page.addInitScript(() => {
    const lastSeen = Date.now() - 7.7 * 3600 * 1000;
    const idle = {
      version: 1, gold: "5|4", goldThisRun: "5|4", goldLifetime: "5|4",
      materials: { scrap: 0, fragment: 0, dust: 0, essence: 0 },
      upgrades: { damage: 220, attackSpeed: 90, critChance: 60, critMult: 80, goldFind: 100, areaDamage: 70, magicFind: 30 },
      zone: 47, zoneProgress: 0, zoneTimer: 0, deepestZone: 47, deepestZoneEver: 47,
      equipment: {}, stash: [],
      prestige: { points: 0, spent: 0, lifetime: 0, count: 0, nodes: {}, sparks: 0, ascensions: 0, ascensionNodes: {}, lastPrestigeAt: lastSeen },
      skills: {}, automation: {}, bestiary: {},
      challenges: { activeId: null, startedAt: 0, snapshot: null, completed: [], best: {} },
      lootFilter: { enabled: false, rules: [], keepAffixes: [], keepUpgrades: true },
      uniquesFound: [], lastSeen, startedAt: lastSeen, playtime: 3600, supporter: false,
      totals: { kills: 0, bosses: 0, items: 0, salvaged: 0, rerolls: 0, offlineSeconds: 0 },
      buildName: "Zimna Stal", notation: "short",
    };
    const req = indexedDB.open("keyval-store", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("keyval");
    req.onsuccess = () => {
      const tx = req.result.transaction("keyval", "readwrite");
      tx.objectStore("keyval").put({
        save_version: 3, updated_at: new Date(lastSeen).toISOString(), seed: 1234,
        character: { level: 1, xp: 0, attributes: { strength: 5, dexterity: 5, vitality: 5, will: 5 }, attributePoints: 0, skillPoints: 0, gold: 0, potions: 3, equipment: {}, inventory: [], killsWithoutDrop: 0, totalKills: 0 },
        encounterIndex: 0, settings: undefined, stats: { kills: 0, playtime: 0, deaths: 0 }, idle,
      }, "save:slot_1");
    };
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("dialog").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "/Users/dlubinski/Desktop/Pulpit/aa/monster_slayer/tests/artifacts/idle-return.png" });

  await page.getByRole("button", { name: "ODBIERZ" }).click();
  await page.waitForTimeout(400);

  // ekran postaci — 1200 px, tak jak wymaga v4 §5.8
  await page.evaluate(() => {
    const g = (window as any).__ms;
    for (let i = 0; i < 9; i++) { const it = g.idle.engine.rollDrop(); g.idle.engine.state.equipment[it.slot] = it; }
    g.idle.engine.state.skills = { slaughter_root: 1, sl_edge: 5, sl_grip: 5, noCrit: 1 };
    g.idle.engine.invalidate();
    g.openCharacterSheet();
  });
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/Users/dlubinski/Desktop/Pulpit/aa/monster_slayer/tests/artifacts/idle-sheet.png" });

  await page.evaluate(() => (window as any).__ms.openIdlePanel());
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/Users/dlubinski/Desktop/Pulpit/aa/monster_slayer/tests/artifacts/idle-panel.png", fullPage: true });
});
