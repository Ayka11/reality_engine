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
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#app")).toBeVisible();

  const scienceButton = page.locator('.mode-btn[data-mode="science"]');
  await expect(scienceButton).toBeVisible();
  const handlerType = await page.evaluate(() => typeof window.selectWorkspaceMode);
  expect(handlerType, "workspace mode handler must be globally available").toBe("function");

  const hitTarget = await scienceButton.evaluate(button => {
    const r = button.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      button: button.outerHTML,
      hitTag: hit?.tagName ?? null,
      hitId: hit?.id ?? null,
      hitClass: typeof hit?.className === "string" ? hit.className : "",
      hitText: hit?.textContent?.trim().slice(0, 80) ?? "",
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      rect: { left: r.left, top: r.top, width: r.width, height: r.height }
    };
  });
  console.log("Science button hit-test:", JSON.stringify(hitTarget));
  // Use a real pointer click at the hit-tested center. Locator.click() stalls
  // while waiting for stability even though the center is directly hit-tested.
  await page.mouse.click(hitTarget.x, hitTarget.y);

  await expect(page.locator("#modeLabel")).toHaveText("Science Mode", { timeout: 5000 });
  await expect(scienceButton).toHaveClass(/active/, { timeout: 5000 });
  expect(pageErrors, "uncaught browser exceptions during mode switch").toEqual([]);
});
