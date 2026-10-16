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

test("switching workspace mode updates the active mode and label", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#app")).toBeVisible();

  const scienceButton = page.locator('.mode-btn[data-mode="science"]');
  await expect(scienceButton).toBeVisible();
  await scienceButton.click();

  await expect(scienceButton).toHaveClass(/active/);
  await expect(page.locator("#modeLabel")).toHaveText("Science Mode");
});
