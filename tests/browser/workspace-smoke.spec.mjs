import { test, expect } from "@playwright/test";

test("production app mounts the main workspace without uncaught exceptions", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator("#viewWrap")).toBeVisible();
  await expect(page.locator("#c2d")).toBeAttached();
  expect(pageErrors, "uncaught browser exceptions").toEqual([]);
});

test("workspace exposes a usable mode control", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#app")).toBeVisible();

  const modeButton = page.locator(".mode-btn").first();
  await expect(modeButton).toBeVisible();
  await modeButton.click();
  await expect(modeButton).toHaveClass(/mode-btn/);
});
