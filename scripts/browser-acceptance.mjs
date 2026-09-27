import { chromium } from "playwright";
import { spawn } from "node:child_process";

const port = 4173;
const server = spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", String(port)], {
  stdio: ["ignore", "pipe", "pipe"],
  shell: process.platform === "win32",
});

const waitForServer = async () => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}`);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Vite preview server did not become ready");
};

const browser = await chromium.launch({ headless: true });
const acceptanceTimeout = 30000;
try {
  await waitForServer();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("console", (msg) => console.log(`[browser:${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (error) => console.log(`[browser:pageerror] ${error.stack || error.message}`));
  await page.addInitScript(() => {
    localStorage.clear();
  });

  console.log("[acceptance] opening primary page");
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("#c3d");
  await page.waitForFunction(() => typeof window.worldGenerationHealth === "function");

  // Workspace v4 regression: legacy float state must not restore two
  // overlapping sidebars over the viewport.
  const layout = await page.evaluate(() => {
    localStorage.setItem("reality_workspace_layout_version", "3");
    localStorage.setItem("reality_left_float", JSON.stringify({ x: 58, y: 72, w: 220 }));
    localStorage.setItem("reality_right_float", JSON.stringify({ x: 58, y: 72, w: 220 }));
    location.reload();
    return true;
  });
  if (!layout) throw new Error("Workspace migration setup failed");
  await page.waitForSelector("#left");
  await page.waitForSelector("#right");
  await page.waitForFunction(() => localStorage.getItem("reality_workspace_layout_version") === "4");
  const workspaceGeometry = await page.evaluate(() => {
    const left = document.getElementById("left")?.getBoundingClientRect();
    const right = document.getElementById("right")?.getBoundingClientRect();
    const canvas = document.getElementById("cw")?.getBoundingClientRect();
    return {
      left: left ? {x:left.x,width:left.width} : null,
      right: right ? {x:right.x,width:right.width} : null,
      canvas: canvas ? {x:canvas.x,width:canvas.width} : null,
      leftFloating: document.getElementById("left")?.classList.contains("workspace-floating"),
      rightFloating: document.getElementById("right")?.classList.contains("workspace-floating")
    };
  });
  if (workspaceGeometry.leftFloating || workspaceGeometry.rightFloating) {
    throw new Error("Legacy floating sidebar state was not migrated to docked layout");
  }
  if (!workspaceGeometry.left || !workspaceGeometry.right || !workspaceGeometry.canvas) {
    throw new Error("Workspace geometry is incomplete");
  }
  if (workspaceGeometry.left.x + workspaceGeometry.left.width > workspaceGeometry.canvas.x + 2) {
    throw new Error("Left sidebar overlaps the world canvas");
  }
  if (workspaceGeometry.canvas.x + workspaceGeometry.canvas.width > workspaceGeometry.right.x + 2) {
    throw new Error("Right sidebar overlaps the world canvas");
  }

  // Verify explicit detach -> move -> dock works after the migration.
  const floatGeometry = await page.evaluate(() => {
    window.setWorkspacePanelFloat?.("left", true);
    const panel = document.getElementById("left");
    if (!panel) return null;
    panel.style.left = "180px";
    panel.style.top = "90px";
    return { x: panel.getBoundingClientRect().x, y: panel.getBoundingClientRect().y };
  });
  if (!floatGeometry || floatGeometry.x < 175 || floatGeometry.y < 85) {
    throw new Error("Floating sidebar does not honor drag geometry");
  }
  await page.evaluate(() => window.setWorkspacePanelFloat?.("left", false));
  await page.waitForFunction(() => !document.getElementById("left")?.classList.contains("workspace-floating"));

  const initial = await page.evaluate(() => window.worldGenerationHealth());
  if (!initial?.ok) throw new Error("Infinite World diagnostics are not healthy on initial load");

  const grips = await page.locator(".sidebar-drag-grip").count();
  if (grips !== 2) throw new Error(`Expected 2 sidebar drag grips, found ${grips}`);

  const worldTools = page.locator("#infiniteWorldTools");
  await page.locator("#btnToggleWorldTools").click();
  await page.waitForFunction(() => {
    const el = document.getElementById("infiniteWorldTools");
    return !!el && getComputedStyle(el).display !== "none";
  });

  const worldToolsHeader = await page.locator("#infiniteWorldTools").innerText();
  if (!worldToolsHeader.includes("WORLD TOOLS")) {
    throw new Error("World Tools header/label is missing");
  }

  await page.locator("#dockCloseBtn").click();
  await page.waitForFunction(() => localStorage.getItem("infinity_dock_open") === "false");

  await page.locator("#btnToggleWorldTools").click();
  await page.waitForFunction(() => localStorage.getItem("infinity_dock_open") !== "false");

  const lawBaseline = await page.evaluate(() => window.getRealityLawState?.());
  if (!lawBaseline || !Array.isArray(lawBaseline.processes)) throw new Error("Runtime law bridge is not exposed");

  const lawBuildBefore = await page.evaluate(() => window.infinityBuildZoneCost?.(0, 0));
  await page.evaluate(() => window.setRealityLaw?.("Density Gravity", false, 0.4, 0.012));
  const lawDisabled = await page.evaluate(() => window.getRealityLawState?.());
  if (lawDisabled?.processes?.includes("gravity") || lawDisabled?.processes?.includes("density")) {
    throw new Error("Disabling Density Gravity did not reach the runtime process state");
  }
  const lawBuildAfter = await page.evaluate(() => window.infinityBuildZoneCost?.(0, 0));
  if (Number(lawBuildAfter?.laws?.penalty ?? -1) <= Number(lawBuildBefore?.laws?.penalty ?? -1)) {
    throw new Error("Build decision did not change after disabling a governing law");
  }
  await page.evaluate(() => window.setRealityLaw?.("Density Gravity", true, 0.4, 0.012));

  const before = await page.evaluate(() => window.worldGenerationHealth());
  console.log("[acceptance] Quick Generate");
  await page.getByRole("button", { name: /Quick Generate/ }).click();
  await page.waitForFunction((b) => {
    const a = window.worldGenerationHealth();
    return Number(a?.stats?.objects ?? 0) !== Number(b?.stats?.objects ?? 0)
      || Number(a?.stats?.loadedChunks ?? 0) !== Number(b?.stats?.loadedChunks ?? 0)
      || !!a?.lastGeneration;
  }, before, { timeout: acceptanceTimeout });

  const afterQuick = await page.evaluate(() => window.worldGenerationHealth());
  if (!afterQuick?.lastGeneration) throw new Error("Quick Generate did not record a generation result");

  // Test Compose World in a fresh browser page so this acceptance path is independent
  // from Quick Generate and cannot fail merely because two large generations are stacked.
  const composePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  composePage.on("console", (msg) => console.log(`[composer:${msg.type()}] ${msg.text()}`));
  composePage.on("pageerror", (error) => console.log(`[composer:pageerror] ${error.stack || error.message}`));
  await composePage.addInitScript(() => {
    localStorage.clear();
  });
  console.log("[acceptance] opening composer page");
  await composePage.goto(`http://127.0.0.1:${port}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await composePage.waitForSelector("#c3d");
  await composePage.waitForFunction(() => typeof window.worldGenerationHealth === "function");

  console.log("[acceptance] Compose World");
  await composePage.getByRole("button", { name: /Compose World/ }).click();
  await composePage.waitForSelector("#comp.open");
  if (!(await composePage.locator("#comp").innerText()).includes("Integral Reality Composer")) {
    throw new Error("Compose World opened without the Integral Reality Composer");
  }
  for (let i = 0; i < 4; i++) await composePage.locator("#cnext").click();
  console.log("[acceptance] Generate Reality");
  await composePage.getByRole("button", { name: /Generate Reality/ }).click({ timeout: acceptanceTimeout });
  await composePage.waitForFunction(() => {
    const health = window.worldGenerationHealth();
    return !!health?.lastGeneration;
  }, undefined, { timeout: acceptanceTimeout });

  const afterCompose = await composePage.evaluate(() => window.worldGenerationHealth());
  if (!afterCompose?.lastGeneration) throw new Error("Compose World did not produce a generation record");
  await composePage.close();

  await page.screenshot({ path: "artifacts/browser-acceptance.png", fullPage: true });
  console.log(JSON.stringify({
    status: "PASS",
    initialObjects: initial.stats?.objects ?? 0,
    quickGenerateObjects: afterQuick.stats?.objects ?? 0,
    composeObjects: afterCompose.stats?.objects ?? 0,
    sidebarGrips: grips,
    screenshot: "artifacts/browser-acceptance.png"
  }));
} finally {
  await browser.close();
  server.kill();
}
