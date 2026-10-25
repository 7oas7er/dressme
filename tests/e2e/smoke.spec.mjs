import { test, expect } from "@playwright/test";

test("home shows DressMe brand", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".brand")).toHaveText("DressMe");
  await expect(page.locator("h1")).toContainText("Your wardrobe");
  await expect(page.locator("#status")).toContainText(/Scaffold placeholder/i);
});

test("imprint page loads", async ({ page }) => {
  await page.goto("/imprint.html");
  await expect(page.locator(".brand")).toHaveText("DressMe");
  await expect(page.locator("h1")).toHaveText("Imprint");
});
