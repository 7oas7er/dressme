import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        cognito: {
          userPoolId: null,
          clientId: null,
          region: "eu-north-1",
          authDomain: null,
          redirectUri: "http://127.0.0.1:4173/",
          logoutUrl: "http://127.0.0.1:4173/",
        },
      }),
    });
  });
});

test("home shows DressMe auth gate", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".brand")).toHaveText("DressMe");
  await expect(page.locator("h1")).toContainText("Your wardrobe");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.locator("#status")).toContainText(/Cognito is not configured/i);
});

test("imprint page loads", async ({ page }) => {
  await page.goto("/imprint.html");
  await expect(page.locator(".brand")).toHaveText("DressMe");
  await expect(page.locator("h1")).toHaveText("Imprint");
});
