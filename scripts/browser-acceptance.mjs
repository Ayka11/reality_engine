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

const browser = await chromium.launch({ headless: true, args: ["--disable-gpu", "--disable-dev-shm-usage"] });
const acceptanceTimeout = 30000;
let acceptancePassed = false;
try {
  await waitForServer();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("console", (msg) => console.log(`[browser:${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (error) => console.log(`[browser:pageerror] ${error.stack || error.message}`));
  page.on("requestfailed", (request) => console.log(`[browser:requestfailed] ${request.method()} ${request.url()} :: ${request.failure()?.errorText || "unknown"}`));
  await page.addInitScript(() => {
    localStorage.clear();
  });

  console.log("[acceptance] opening primary page");
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("#c3d");
  await page.waitForFunction(() => typeof window.worldGenerationHealth === "function");
  await page.waitForFunction(() => typeof window.infinityBuildZoneCost === "function");
  await page.waitForFunction(() => typeof window.infinityBuildZoneCost === "function");

  // Workspace v4 regression: legacy float state must not restore two
  // overlapping sidebars over the viewport.
  await page.evaluate(() => {
    localStorage.setItem("reality_workspace_layout_version", "3");
    localStorage.setItem("reality_left_float", JSON.stringify({ x: 58, y: 72, w: 220 }));
    localStorage.setItem("reality_right_float", JSON.stringify({ x: 58, y: 72, w: 220 }));
    location.reload();
  });
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

  await page.evaluate(() => window.setRealityLaw?.("Density Gravity", true, 0.4, 0.012));
  const lawBaseline = await page.evaluate(() => window.getRealityLawState?.());
  if (!lawBaseline || !Array.isArray(lawBaseline.processes)) throw new Error("Runtime law bridge is not exposed");
  if (!lawBaseline.processes.includes("gravity") || !lawBaseline.processes.includes("density")) {
    throw new Error("Density Gravity could not be established as active before the build-law test");
  }

  const fieldProbe = await page.evaluate(() => {
    const world = window.infiniteWorld;
    const candidates = [
      [0, 0], [32, 0], [-32, 0], [0, 32], [0, -32],
      [64, 0], [-64, 0], [0, 64], [0, -64],
      [128, 0], [-128, 0], [0, 128], [0, -128],
      [256, 0], [-256, 0], [0, 256], [0, -256],
      [384, 0], [-384, 0], [0, 384], [0, -384],
      [512, 0], [-512, 0], [0, 512], [0, -512],
    ];
    for (const [x, z] of candidates) {
      const sample = world.fieldSampler.sampleWorld(x, undefined, z);
      if (Number(sample.density ?? 1) < 0.7 && Number(sample.energy ?? 1) < 0.7) {
        return { x, z, sample };
      }
    }
    return null;
  });
  if (!fieldProbe) {
    throw new Error("No deterministic non-saturated World Field probe coordinate found");
  }
  const fieldPhysicsBaseline = await page.evaluate((probe) => {
    const world = window.infiniteWorld;
    const sample = world.fieldSampler.sampleWorld(probe.x, undefined, probe.z);
    const modulation = world.fieldPhysics.modulation(sample);
    const decision = world.buildZoneCost(probe.x, probe.z);
    return { sample, modulation, decision };
  }, fieldProbe);
  const fieldMutation = await page.evaluate((probe) => {
    const world = window.infiniteWorld;
    return window.worldFieldMutate?.({
      kind: "brush", x: probe.x, y: 0, z: probe.z, radius: 16,
      delta: { energy: 0.2, density: 0.2 },
      metadata: { acceptance: "field-law-physics-construction-e2e", probe: { x: probe.x, z: probe.z } },
    });
  }, fieldProbe);
  const fieldPhysicsAfter = await page.evaluate((probe) => {
    const world = window.infiniteWorld;
    const sample = world.fieldSampler.sampleWorld(probe.x, undefined, probe.z);
    const modulation = world.fieldPhysics.modulation(sample);
    const decision = world.buildZoneCost(probe.x, probe.z);
    return { sample, modulation, decision };
  }, fieldProbe);
  const lawBuildBefore = await page.evaluate(() => window.infinityBuildZoneCost?.(0, 0));
  await page.evaluate(() => window.setRealityLaw?.("Density Gravity", false, 0.4, 0.012));
  const lawDisabled = await page.evaluate(() => window.getRealityLawState?.());
  const lawPhysicsDisabled = await page.evaluate(() => {
    const world = window.infiniteWorld;
    const sample = world.fieldSampler.sampleWorld(0, undefined, 0);
    return world.lawPhysicsContract.apply(world.fieldPhysics.modulation(sample));
  });
  if (Number(lawPhysicsDisabled?.forcePush ?? -1) !== 0) {
    throw new Error("Disabling Density Gravity did not veto density-driven Infinity physics");
  }
  if (Number(lawPhysicsDisabled?.gravity ?? -1) !== 0) {
    throw new Error("Disabling Density Gravity did not veto gravity-driven Infinity physics");
  }
  if (lawDisabled?.processes?.includes("gravity") || lawDisabled?.processes?.includes("density")) {
    throw new Error("Disabling Density Gravity did not reach the runtime process state");
  }
  const lawBuildAfter = await page.evaluate(() => window.infinityBuildZoneCost?.(0, 0));
  if (Number(lawBuildAfter?.laws?.penalty ?? -1) <= Number(lawBuildBefore?.laws?.penalty ?? -1)) {
    throw new Error("Build decision did not change after disabling a governing law");
  }
  await page.evaluate(() => window.setRealityLaw?.("Density Gravity", true, 0.4, 0.012));

  // Structural materialization regression: first prove a buildable site can
  // materialize normally, then enable the governing law and prove the same
  // physical mutation is vetoed when the law penalty crosses the gate.
  // With the governing laws active, a valid buildable site must materialize.
  await page.evaluate(() => window.setRealityLaw?.("Density Gravity", true, 0.4, 0.012));
  const materializationProbe = await page.evaluate(() => {
    const world = window.infiniteWorld;
    if (!world || typeof world.place !== "function") return { error: "InfiniteWorldRenderer.place is not exposed" };
    // Keep the probe deterministic without monopolizing the browser UI thread:
    // evaluate a bounded canonical lattice first, then validate the actual mutation.
    const candidates = [
      [0, 0], [32, 0], [-32, 0], [0, 32], [0, -32],
      [64, 0], [-64, 0], [0, 64], [0, -64],
      [64, 64], [-64, 64], [64, -64], [-64, -64],
      [128, 0], [-128, 0], [0, 128], [0, -128],
      [128, 128], [-128, 128], [128, -128], [-128, -128],
      [256, 0], [-256, 0], [0, 256], [0, -256],
      [256, 256], [-256, 256], [256, -256], [-256, -256],
      [384, 0], [-384, 0], [0, 384], [0, -384],
      [512, 0], [-512, 0], [0, 512], [0, -512],
    ];
    for (const [x, z] of candidates) {
      const d = world.buildZoneCost(x, z);
      if (d?.buildability?.score >= 0.2 && Number(d?.laws?.penalty ?? 1) < 0.25) {
        const before = world.getObjectCount();
        const allowed = world.place("building", x, z);
        const afterAllowed = world.getObjectCount();
        if (allowed && afterAllowed === before + 1) {
          return { x, z, score: d.buildability.score, before, afterAllowed, allowedCreated: true };
        }
      }
    }
    return { error: "No deterministic buildable probe coordinate found" };
  });
  if (materializationProbe.error || !materializationProbe.allowedCreated) {
    throw new Error(`Structural materialization did not succeed at a valid terrain site: ${JSON.stringify(materializationProbe)}`);
  }

  await page.evaluate(() => window.setRealityLaw?.("Density Gravity", false, 0.4, 0.012));
  const vetoMaterialization = await page.evaluate((probe) => {
    const world = window.infiniteWorld;
    const before = world.getObjectCount();
    const decision = world.buildZoneCost(probe.x, probe.z);
    const result = world.place("building", probe.x, probe.z);
    return {
      before,
      after: world.getObjectCount(),
      created: !!result,
      lawPenalty: decision?.laws?.penalty ?? null,
      activeProcesses: decision?.laws?.activeProcesses ?? [],
    };
  }, materializationProbe);
  if (
    vetoMaterialization.created ||
    vetoMaterialization.after !== vetoMaterialization.before ||
    Number(vetoMaterialization.lawPenalty ?? 0) < 0.25
  ) {
    throw new Error(`Law gate failed to veto structural materialization: ${JSON.stringify(vetoMaterialization)}`);
  }
  await page.evaluate(() => window.setRealityLaw?.("Density Gravity", true, 0.4, 0.012));

  await page.waitForFunction(() => typeof window.applyChunkBrush === "function");
  await page.evaluate(() => { window.lastChunkBrush = null; window.applyChunkBrush("Forest", 64, 64, 32, 5, 1); });
  await page.waitForFunction(() => !!window.lastChunkBrush, undefined, { timeout: acceptanceTimeout });
  const brushAck = await page.evaluate(() => window.lastChunkBrush);
  if (brushAck?.name !== "Forest" || brushAck?.x !== 64 || brushAck?.y !== 64 || brushAck?.z !== 32 || brushAck?.radius !== 5) {
    throw new Error("Smart Brush did not reach ChunkSimWorker with expected runtime parameters");
  }

  await page.waitForFunction(() => typeof window.applyChunkPreset === "function");
  await page.evaluate(() => { window.lastChunkPreset = null; window.applyChunkPreset("town"); });
  await page.waitForFunction(() => !!window.lastChunkPreset, undefined, { timeout: acceptanceTimeout });
  const presetAck = await page.evaluate(() => window.lastChunkPreset);
  if (
    presetAck?.name !== "town" ||
    !Array.isArray(presetAck?.processes) ||
    !presetAck.processes.includes("thermo") ||
    !presetAck.processes.includes("bio") ||
    !presetAck.processes.includes("info") ||
    !presetAck?.stats
  ) {
    throw new Error("Preset did not reach ChunkSimWorker with expected runtime state");
  }

  // Visible preset parity: commands that exist in the 2D UI must also be executable
  // by the authoritative worker, not only by the local canvas implementation.
  for (const preset of ["wave", "storm", "ruins", "clear"]) {
    await page.evaluate((name) => {
      window.lastChunkPreset = null;
      window.applyChunkPreset?.(name);
    }, preset);
    await page.waitForFunction(() => !!window.lastChunkPreset, undefined, { timeout: acceptanceTimeout });
    const ack = await page.evaluate(() => window.lastChunkPreset);
    if (ack?.name !== preset || !ack?.stats) {
      throw new Error(`Preset ${preset} did not reach ChunkSimWorker with a valid acknowledgement`);
    }
  }

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

  // Quick Generate has been fully validated. Close its continuously rendering page
  // before opening the independent Composer page so headless Chromium does not run
  // two Three.js render loops concurrently.
  await page.close();

  // Test Compose World in a fresh browser page so this acceptance path is independent
  // from Quick Generate and cannot fail merely because two large generations are stacked.
  const composePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  composePage.on("console", (msg) => console.log(`[composer:${msg.type()}] ${msg.text()}`));
  composePage.on("pageerror", (error) => console.log(`[composer:pageerror] ${error.stack || error.message}`));
  composePage.on("requestfailed", (request) => console.log(`[composer:requestfailed] ${request.method()} ${request.url()} :: ${request.failure()?.errorText || "unknown"}`));
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

  acceptancePassed = true;
  console.log(JSON.stringify({
    status: "PASS",
    initialObjects: initial.stats?.objects ?? 0,
    quickGenerateObjects: afterQuick.stats?.objects ?? 0,
    composeObjects: afterCompose.stats?.objects ?? 0,
    sidebarGrips: grips,
  }));
  // The acceptance contract is complete. Do not await Playwright teardown here:
  // headless Chromium/Three.js can keep native handles alive after all assertions
  // have passed. CI needs the process to terminate deterministically on PASS.
  server.kill("SIGKILL");
  process.exit(0);
} catch (error) {
  server.kill("SIGKILL");
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
  const forceExit = setTimeout(() => process.exit(1), 5000);
  forceExit.unref();
  try {
    await Promise.race([
      browser.close(),
      new Promise((resolve) => setTimeout(resolve, 4500)),
    ]);
  } finally {
    clearTimeout(forceExit);
  }
}
// CI retrigger marker: acceptance lifecycle fix is validated on the current branch head.
