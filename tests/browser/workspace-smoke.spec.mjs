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

test("workspace mode handler updates the active mode and label", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("#app")).toBeVisible();

  // Verify the real UI control is wired to the production handler, then invoke
  // that handler directly to isolate state-transition behavior from Chromium's
  // repeatedly hanging click/dispatch event path.
  const result = await page.evaluate(() => {
    const button = document.querySelector('.mode-btn[data-mode="science"]');
    if (!button) return { error: "science button not found" };
    if (!button.getAttribute("onclick")?.includes("selectWorkspaceMode")) {
      return { error: "science button is not wired to selectWorkspaceMode" };
    }
    if (typeof window.selectWorkspaceMode !== "function") {
      return { error: "selectWorkspaceMode is not available" };
    }

    window.selectWorkspaceMode("science", button);
    return {
      label: document.querySelector("#modeLabel")?.textContent,
      active: button.classList.contains("active"),
      createActive: document.querySelector('.mode-btn[data-mode="create"]')?.classList.contains("active"),
    };
  });

  expect(result.error, "workspace mode control wiring").toBeUndefined();
  expect(result.label).toBe("Science Mode");
  expect(result.active).toBe(true);
  expect(result.createActive).toBe(false);
  expect(pageErrors, "uncaught browser exceptions during mode switch").toEqual([]);
});

test("real keyboard activation switches mode and renders the Science panel", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  await page.goto("/", { waitUntil: "networkidle" });
  const scienceButton = page.locator('.mode-btn[data-mode="science"]');
  await expect(scienceButton).toBeVisible();
  await scienceButton.focus();
  await page.keyboard.press("Enter");

  await expect(page.locator("#modeLabel")).toHaveText("Science Mode", { timeout: 5000 });
  await expect(scienceButton).toHaveClass(/active/, { timeout: 5000 });
  await expect(page.locator("#sciLawList")).toBeVisible({ timeout: 5000 });
  expect(pageErrors, "uncaught browser exceptions during keyboard mode switch").toEqual([]);
});

test("real mouse activation switches mode and renders the Science panel", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  await page.goto("/", { waitUntil: "networkidle" });
  const scienceButton = page.locator('.mode-btn[data-mode="science"]');
  await expect(scienceButton).toBeVisible();
  await scienceButton.click();

  await expect(page.locator("#modeLabel")).toHaveText("Science Mode", { timeout: 5000 });
  await expect(scienceButton).toHaveClass(/active/, { timeout: 5000 });
  await expect(page.locator("#sciLawList")).toBeVisible({ timeout: 5000 });
  expect(pageErrors, "uncaught browser exceptions during mouse mode switch").toEqual([]);
});

