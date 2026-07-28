/** Narzędzie: zrzut galerii sylwetek do oceny wizualnej. */
import { test } from "@playwright/test";

test("galeria postaci", async ({ page }) => {
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(`${process.env.E2E_BASE_URL ?? "http://localhost:5173"}/gallery.html`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(1500);
  await page.locator("#host canvas").screenshot({ path: "tests/artifacts/gallery.png" });
});
