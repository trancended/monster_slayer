/** Diagnostyka: wypisuje konsolę i błędy strony. Nie jest testem regresji. */
import { test } from "@playwright/test";

test("diagnostyka startu", async ({ page }) => {
  page.on("console", (m) => console.log(`[${m.type()}]`, m.text()));
  page.on("pageerror", (e) => console.log("[pageerror]", e.message, "\n", e.stack));

  await page.goto(process.env.E2E_BASE_URL ?? "http://localhost:5173", {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(1200);
  console.log("przycisk Graj:", await page.getByRole("button", { name: "Graj" }).count());
  await page.getByRole("button", { name: "Graj" }).click().catch(() => {});
  await page.waitForTimeout(4000);
  console.log("UI:", (await page.locator("#ui").innerHTML()).slice(0, 600));
});
