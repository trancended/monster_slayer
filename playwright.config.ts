import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // `shot` i `diag` to narzędzia diagnostyczne, nie testy regresji — domyślnie
  // wypadają z przebiegu. `PW_TOOLS=true` je odblokowuje (patrz `pnpm shot`).
  testIgnore: process.env.PW_TOOLS === "true" ? [] : ["**/shot.spec.ts", "**/diag.spec.ts", "**/gallery.spec.ts"],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    viewport: { width: 1280, height: 800 },
    // WebGL w headless Chromium wymaga programowego rasteryzatora.
    launchOptions: {
      args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox"],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
