import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, "..");
const webDir = path.join(repoRoot, "web");
const viteBin = path.join(webDir, "node_modules", ".bin", "vite");

export default defineConfig({
  testDir: path.join(testsDir, "e2e"),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  webServer: {
    // Host the Vite build (`../dressme`) with the same vite already installed under
    // `../web/` — avoids transitive `serve` → `minimatch` <11.0.1 (GHSA-g3hv-75wg-m249).
    // `pretest` runs `web` ci+build first so this binary and outDir exist.
    command: `"${viteBin}" preview --host 127.0.0.1 --port 4173`,
    cwd: webDir,
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
