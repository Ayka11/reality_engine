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
    if (sessionStorage.getItem("reality-engine-acceptance-cleaned") !== "1") {
      localStorage.clear();
      sessionStorage.setItem("reality-engine-acceptance-cleaned", "1");
    }
  });

  console.log("[acceptance] opening primary page");
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("#c3d");
  await page.waitForFunction(() => typeof window.worldGenerationHealth === "function");

  await page.waitForFunction(() =>
    typeof window.getRealityLawState === "function" &&
    typeof window.setRealityLaw === "function" &&
    !!window.realityLawBridge
  );
  const lawBridgeContract = await page.evaluate(() => {
    const getter = window.getRealityLawState;
    const setter = window.setRealityLaw;
    if (!window.realityLawBridge || typeof getter !== "function" || typeof setter !== "function") {
      return {
        error: "Active connector law bridge is not exposed",
        hasBridge: !!window.realityLawBridge,
        hasGetter: typeof getter === "function",
        hasSetter: typeof setter === "function",
      };
    }
    const before = getter();
    setter("Density Gravity", false, 0.4, 0.012);
    const afterOff = getter();
    setter("Density Gravity", true, 0.4, 0.012);
    const afterOn = getter();
    return { before, afterOff, afterOn };
  });
  if (lawBridgeContract.error) throw new Error(lawBridgeContract.error);
  if (!lawBridgeContract.before.processes.includes("gravity")) throw new Error("Infinite World law bridge missing default gravity process");
  if (lawBridgeContract.afterOff.processes.includes("gravity")) throw new Error("Infinite World law bridge ignored gravity disable");
  if (!lawBridgeContract.afterOn.processes.includes("gravity")) throw new Error("Infinite World law bridge ignored gravity restore");
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
      const density = Number(sample.density);
      if (Number.isFinite(density) && density > 0.05 && density < 1) {
        return { x, y: Number(sample.y), z, sample };
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
      kind: "brush",
      x: probe.x,
      y: probe.y,
      z: probe.z,
      radius: 16,
      delta: { energy: 0.2, density: 0.2 },
      metadata: {
        acceptance: "field-law-physics-construction-e2e",
        probe: { x: probe.x, y: probe.y, z: probe.z },
      },
    });
  }, fieldProbe);
  const fieldPhysicsAfter = await page.evaluate((probe) => {
    const world = window.infiniteWorld;
    const sample = world.fieldSampler.sampleWorld(probe.x, undefined, probe.z);
    const modulation = world.fieldPhysics.modulation(sample);
    const decision = world.buildZoneCost(probe.x, probe.z);
    return { sample, modulation, decision };
  }, fieldProbe);

  const beforeDensity = Number(fieldPhysicsBaseline?.sample?.density ?? NaN);
  const afterDensity = Number(fieldPhysicsAfter?.sample?.density ?? NaN);
  if (
    !Number.isFinite(beforeDensity) ||
    !Number.isFinite(afterDensity) ||
    !(afterDensity > beforeDensity)
  ) {
    throw new Error(
      `Authoritative field mutation did not increase sampled density: before=${beforeDensity}, after=${afterDensity}`
    );
  }

  const beforeForcePush = Number(fieldPhysicsBaseline?.modulation?.forcePush ?? NaN);
  const afterForcePush = Number(fieldPhysicsAfter?.modulation?.forcePush ?? NaN);
  if (
    !Number.isFinite(beforeForcePush) ||
    !Number.isFinite(afterForcePush) ||
    !(afterForcePush > beforeForcePush)
  ) {
    throw new Error(
      `Density mutation did not reach field physics: before=${beforeForcePush}, after=${afterForcePush}`
    );
  }

  const beforeDensityCost = Number(fieldPhysicsBaseline?.decision?.decisionComponents?.density ?? NaN);
  const afterDensityCost = Number(fieldPhysicsAfter?.decision?.decisionComponents?.density ?? NaN);
  if (
    !Number.isFinite(beforeDensityCost) ||
    !Number.isFinite(afterDensityCost) ||
    !(afterDensityCost > beforeDensityCost)
  ) {
    throw new Error(
      `Field density mutation did not reach construction decision scoring: before=${beforeDensityCost}, after=${afterDensityCost}`
    );
  }

  if (!fieldMutation?.metadata?.provenanceEventId) {
    throw new Error("Field mutation did not receive runtime provenance");
  }

  // Persistence regression: authoritative field edits must survive Save -> Load,
  // not only the object layer. Save a known mutation, perturb it, then restore.
  const fieldPersistenceBaseline = await page.evaluate((probe) => {
    const world = window.infiniteWorld;
    world.saveWorld();
    return {
      sample: world.fieldSampler.sampleWorld(probe.x, undefined, probe.z),
      state: world.getAuthoritativeFieldState().field,
    };
  }, fieldProbe);
  await page.evaluate((probe) => window.worldFieldMutate?.({
    kind: "brush",
    x: probe.x,
    y: probe.y,
    z: probe.z,
    radius: 16,
    delta: { energy: 5 },
    metadata: { acceptance: "field-persistence-perturbation" },
  }), fieldProbe);
  const fieldPersistencePerturbed = await page.evaluate((probe) => {
    const world = window.infiniteWorld;
    return world.fieldSampler.sampleWorld(probe.x, undefined, probe.z);
  }, fieldProbe);
  if (!(Number(fieldPersistencePerturbed?.energy ?? NaN) > Number(fieldPersistenceBaseline?.sample?.energy ?? NaN))) {
    throw new Error("Field persistence perturbation did not change the authoritative sample");
  }
  const restoredFieldPersistence = await page.evaluate((probe) => {
    const world = window.infiniteWorld;
    world.loadWorld();
    return {
      sample: world.fieldSampler.sampleWorld(probe.x, undefined, probe.z),
      state: world.getAuthoritativeFieldState().field,
    };
  }, fieldProbe);
  if (
    !Number.isFinite(Number(restoredFieldPersistence?.sample?.density ?? NaN)) ||
    Math.abs(Number(restoredFieldPersistence.sample.energy) - Number(fieldPersistenceBaseline.sample.energy)) > 1e-9
  ) {
    throw new Error(
      `Authoritative field did not restore from Save -> Load: saved=${fieldPersistenceBaseline.sample.energy}, restored=${restoredFieldPersistence.sample.energy}`
    );
  }
  if (Number(restoredFieldPersistence?.state?.mutationCount ?? -1) !== Number(fieldPersistenceBaseline?.state?.mutationCount ?? -2)) {
    throw new Error(
      `Authoritative field mutation count did not restore: saved=${fieldPersistenceBaseline.state.mutationCount}, restored=${restoredFieldPersistence.state.mutationCount}`
    );
  }


  // Frontend parity regression: the visible Scientific Field tab must mutate the same
  // authoritative provider used by the direct runtime API.
  await page.evaluate(() => {
    window.setInfinityDockPosition?.("right");
    window.toggleWorldToolbar?.(true);
  });
  await page.waitForSelector("#vTabField");
  await page.locator("#vTabField").click();
  await page.waitForSelector("#vFieldEnergy");
  const uiFieldBaseline = await page.evaluate(() => {
    const world = window.infiniteWorld;
    const p = world.getWorldPosition();
    const y = world.getWorldEnvironment().worldPosition.y;
    return {
      position: { x: p.x, y, z: p.z },
      sample: world.fieldSampler.sample(p.x, y, p.z),
      state: world.getAuthoritativeFieldState().field,
    };
  });
  await page.locator("#vFieldEnergy").click();
  const uiFieldAfter = await page.evaluate(() => {
    const world = window.infiniteWorld;
    const p = world.getWorldPosition();
    const y = world.getWorldEnvironment().worldPosition.y;
    return {
      sample: world.fieldSampler.sample(p.x, y, p.z),
      state: world.getAuthoritativeFieldState().field,
    };
  });
  if (!(Number(uiFieldAfter?.sample?.energy ?? NaN) > Number(uiFieldBaseline?.sample?.energy ?? NaN))) {
    throw new Error("Scientific Field UI brush did not mutate the authoritative energy field");
  }
  if (Number(uiFieldAfter?.state?.mutationCount ?? 0) !== Number(uiFieldBaseline?.state?.mutationCount ?? 0) + 1) {
    throw new Error("Scientific Field UI brush did not create exactly one authoritative mutation");
  }
  if (uiFieldAfter?.state?.lastMutation?.metadata?.source !== "infinity-world-ui") {
    throw new Error("Scientific Field UI brush mutation lost its frontend provenance metadata");
  }

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

  // Exercise the active inline UI's actual Float32Array grid and the authoritative world field.
  // The active page uses index.html's legacy grid (window.buf), not the dormant src/main.ts canvas.
  await page.waitForFunction(() =>
    !!window.infiniteWorld?.authoritativeField &&
    typeof window.realitySculptTransactionRuntime?.applySmartBrush === "function" &&
    typeof window.realitySculptTransactionRuntime?.applyStroke === "function" &&
    typeof window.realitySculptTransactionRuntime?.undo === "function" &&
    typeof window.realitySculptTransactionRuntime?.redo === "function",
    undefined,
    { timeout: acceptanceTimeout },
  );
  const sculptContract = await page.evaluate(async () => {
    const world = window.infiniteWorld, runtime = window.realitySculptTransactionRuntime;
    if (!world || !world.authoritativeField || !runtime || !window.buf) {
      return { error: "Active legacy-grid sculpt runtime is not exposed", hasWorld: !!world,
        hasField: !!world?.authoritativeField, hasRuntime: !!runtime, hasLegacyGrid: !!window.buf };
    }
    const fingerprint = (buffer) => {
      const bits = new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.length);
      let a = 2166136261, b = 2246822519;
      for (let i = 0; i < bits.length; i++) {
        a = Math.imul(a ^ bits[i], 16777619) >>> 0;
        b = Math.imul(b ^ (bits[i] + i), 3266489917) >>> 0;
      }
      return `${bits.length}:${a}:${b}`;
    };
    const legacyBuffer = () => window.buf;
    const samplePoint = { x: 14, y: 0, z: 23 }; // legacy (4,5,0) mapped to world (x,z,y)
    const baselineLegacy = fingerprint(legacyBuffer());
    const baselineState = world.authoritativeField.serialize();
    const baselineSample = world.authoritativeField.sample(samplePoint.x, samplePoint.y, samplePoint.z);
    const baselineCount = world.authoritativeField.getMutationCount();
    await runtime.applySmartBrush("Forest", 4, 5, 3, 0, 0.5);
    const afterSmartLegacy = fingerprint(legacyBuffer());
    const afterSmartState = world.authoritativeField.serialize();
    const smartMutation = afterSmartState.mutations[afterSmartState.mutations.length - 1];
    const afterSmartSample = world.authoritativeField.sample(samplePoint.x, samplePoint.y, samplePoint.z);
    const afterSmartCount = world.authoritativeField.getMutationCount();
    await runtime.applyStroke("inject", { x: 4, y: 5, z: 0 }, 2, 1, { energy: 1 });
    const afterOrdinaryLegacy = fingerprint(legacyBuffer());
    const afterOrdinaryState = world.authoritativeField.serialize();
    const afterOrdinarySample = world.authoritativeField.sample(samplePoint.x, samplePoint.y, samplePoint.z);
    const afterOrdinaryCount = world.authoritativeField.getMutationCount();
    const mixedWorkerAckStart = window.lastChunkSculptHistory?.seq ?? 0;
    runtime.undo();
    const undoOneLegacy = fingerprint(legacyBuffer()), undoOneState = world.authoritativeField.serialize();
    runtime.undo();
    const undoTwoLegacy = fingerprint(legacyBuffer()), undoTwoState = world.authoritativeField.serialize();
    runtime.redo();
    const redoOneLegacy = fingerprint(legacyBuffer()), redoOneState = world.authoritativeField.serialize();
    runtime.redo();
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const check = () => {
        if ((window.lastChunkSculptHistory?.seq ?? 0) >= mixedWorkerAckStart + 4) resolve();
        else if (Date.now() > deadline) reject(new Error("Sparse worker did not acknowledge mixed sculpt undo/redo"));
        else setTimeout(check, 10);
      };
      check();
    });
    const redoTwoLegacy = fingerprint(legacyBuffer()), redoTwoState = world.authoritativeField.serialize();
    const mixedHistoryAfterRedo = runtime.history();

    // A drag with multiple paint samples is one user-visible undo transaction,
    // while the worker records each sample so the grouped undo can replay them all.
    const gestureBaselineLegacy = fingerprint(legacyBuffer());
    const gestureBaselineState = world.authoritativeField.serialize();
    const gestureHistoryBefore = runtime.history().undo;
    const workerAckStart = window.lastChunkSculptHistory?.seq ?? 0;
    runtime.beginGesture();
    await runtime.applyStroke("inject", { x: 10, y: 8, z: 0 }, 1, 0.5, { energy: 1 });
    await runtime.applyStroke("inject", { x: 11, y: 8, z: 0 }, 1, 0.5, { energy: 1 });
    runtime.endGesture();
    const gestureAfterLegacy = fingerprint(legacyBuffer());
    const gestureAfterState = world.authoritativeField.serialize();
    const gestureHistoryAfterCommit = runtime.history();
    runtime.undo();
    const gestureUndoLegacy = fingerprint(legacyBuffer());
    const gestureUndoState = world.authoritativeField.serialize();
    runtime.redo();
    const gestureRedoLegacy = fingerprint(legacyBuffer());
    const gestureRedoState = world.authoritativeField.serialize();
    return { baselineState, afterSmartState, afterOrdinaryState, undoOneState, undoTwoState, redoOneState, redoTwoState,
      baselineSample, afterSmartSample, afterOrdinarySample, smartMutation, baselineCount, afterSmartCount, afterOrdinaryCount,
      history: mixedHistoryAfterRedo, legacyParity: { undoOne: undoOneLegacy === afterSmartLegacy, undoTwo: undoTwoLegacy === baselineLegacy,
        redoOne: redoOneLegacy === afterSmartLegacy, redoTwo: redoTwoLegacy === afterOrdinaryLegacy },
      gesture: { workerAckStart, baselineLegacy: gestureBaselineLegacy, baselineState: gestureBaselineState,
        afterLegacy: gestureAfterLegacy, afterState: gestureAfterState, undoLegacy: gestureUndoLegacy, undoState: gestureUndoState,
        redoLegacy: gestureRedoLegacy, redoState: gestureRedoState, historyBefore: gestureHistoryBefore,
        historyAfterCommit: gestureHistoryAfterCommit, historyAfterRedo: runtime.history() } };
  });
  if (sculptContract.error) throw new Error(`${sculptContract.error}: ${JSON.stringify(sculptContract)}`);
  if (!sculptContract.legacyParity?.undoOne || !sculptContract.legacyParity?.undoTwo || !sculptContract.legacyParity?.redoOne || !sculptContract.legacyParity?.redoTwo) {
    throw new Error(`Unified sculpt history diverged between legacy and authoritative models: ${JSON.stringify(sculptContract.legacyParity)}`);
  }
  if (sculptContract.afterSmartCount !== sculptContract.baselineCount + 1) {
    throw new Error(`SmartBrush did not create exactly one authoritative mutation: ${JSON.stringify(sculptContract)}`);
  }
  if (sculptContract.afterOrdinaryCount !== sculptContract.afterSmartCount + 1) {
    throw new Error(`Ordinary sculpt did not create exactly one authoritative mutation: ${JSON.stringify(sculptContract)}`);
  }
  if (!(Number(sculptContract.afterSmartSample?.information) > Number(sculptContract.baselineSample?.information))) {
    throw new Error(`SmartBrush did not change the expected information field: ${JSON.stringify(sculptContract)}`);
  }
  if (sculptContract.smartMutation?.metadata?.strength !== 0.5 || sculptContract.smartMutation?.delta?.information !== 9) {
    throw new Error(`SmartBrush UI strength was not propagated into the authoritative mutation: ${JSON.stringify(sculptContract.smartMutation)}`);
  }
  if (!(Number(sculptContract.afterOrdinarySample?.energy) > Number(sculptContract.afterSmartSample?.energy))) {
    throw new Error(`Ordinary sculpt did not apply after SmartBrush: ${JSON.stringify(sculptContract)}`);
  }
  if (JSON.stringify(sculptContract.undoOneState) !== JSON.stringify(sculptContract.afterSmartState)) {
    throw new Error("Mixed sculpt undo #1 did not restore the SmartBrush state");
  }
  if (JSON.stringify(sculptContract.undoTwoState) !== JSON.stringify(sculptContract.baselineState)) {
    throw new Error("Mixed sculpt undo #2 did not restore the baseline state");
  }
  if (JSON.stringify(sculptContract.redoOneState) !== JSON.stringify(sculptContract.afterSmartState)) {
    throw new Error("Mixed sculpt redo #1 did not restore the SmartBrush state");
  }
  if (JSON.stringify(sculptContract.redoTwoState) !== JSON.stringify(sculptContract.afterOrdinaryState)) {
    throw new Error("Mixed sculpt redo #2 did not restore the ordinary sculpt state");
  }
  if (sculptContract.history?.undo !== 2 || sculptContract.history?.redo !== 0) {
    throw new Error(`Mixed sculpt history lengths are incorrect after redo x2: ${JSON.stringify(sculptContract.history)}`);
  }
  const gesture = sculptContract.gesture;
  if (gesture.historyAfterCommit?.undo !== gesture.historyBefore + 1 || gesture.historyAfterCommit?.redo !== 0) {
    throw new Error(`Pointer-drag samples were not grouped into one undo transaction: ${JSON.stringify(gesture.historyAfterCommit)}`);
  }
  if (gesture.undoLegacy !== gesture.baselineLegacy || JSON.stringify(gesture.undoState) !== JSON.stringify(gesture.baselineState)) {
    throw new Error("Grouped sculpt gesture undo did not restore both legacy grid and authoritative field");
  }
  if (gesture.redoLegacy !== gesture.afterLegacy || JSON.stringify(gesture.redoState) !== JSON.stringify(gesture.afterState)) {
    throw new Error("Grouped sculpt gesture redo did not restore both legacy grid and authoritative field");
  }
  await page.waitForFunction((start) => (window.lastChunkSculptHistory?.seq ?? 0) >= start + 4,
    gesture.workerAckStart, { timeout: acceptanceTimeout });

  const persistedSculptState = sculptContract.gesture.redoState;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#c3d");
  await page.waitForFunction(() => typeof window.worldGenerationHealth === "function");
  const reloadedSculptState = await page.evaluate(() => window.infiniteWorld?.authoritativeField?.serialize());
  if (JSON.stringify(reloadedSculptState) !== JSON.stringify(persistedSculptState)) {
    throw new Error("Mixed authoritative sculpt persistence did not survive a page reload");
  }

  // Exercise actual pointerdown -> pointermove* -> pointerup, not only the helper.
  console.log("[acceptance] literal pointer-drag sculpt undo/redo");
  const dragSetup = await page.evaluate(() => {
    window.setRenderMode?.("2d");
    window.setTool?.("inject", null);
    window.selectBrush?.(null);
    window.setLayer?.(0);
    const size = document.getElementById("bsize"); if (size) size.value = "1";
    const strength = document.getElementById("bstr"); if (strength) strength.value = "200";
    const wrap = document.getElementById("viewWrap");
    if (!wrap) return { error: "viewWrap missing" };
    const rect = wrap.getBoundingClientRect();
    const cellSize = Math.min(rect.width / window.W, rect.height / window.H);
    const ox = (rect.width - cellSize * window.W) / 2, oy = (rect.height - cellSize * window.H) / 2;
    const point = (x, y) => ({ x: rect.left + ox + (x + 0.5) * cellSize, y: rect.top + oy + (y + 0.5) * cellSize });
    return { start: point(8, 8), end: point(13, 8),
      beforeLegacy: window.realitySculptTransactionRuntime.fingerprint(),
      beforeField: window.infiniteWorld.authoritativeField.serialize(),
      beforeMutationCount: window.infiniteWorld.authoritativeField.getMutationCount() };
  });
  if (dragSetup.error) throw new Error(dragSetup.error);
  await page.mouse.move(dragSetup.start.x, dragSetup.start.y);
  await page.mouse.down();
  await page.mouse.move(dragSetup.end.x, dragSetup.end.y, { steps: 4 });
  await page.mouse.up();
  const dragAfter = await page.evaluate(() => ({
    legacy: window.realitySculptTransactionRuntime.fingerprint(),
    field: window.infiniteWorld.authoritativeField.serialize(),
    mutationCount: window.infiniteWorld.authoritativeField.getMutationCount(),
    history: window.realitySculptTransactionRuntime.history(),
  }));
  const dragOperations = dragAfter.mutationCount - dragSetup.beforeMutationCount;
  if (dragAfter.legacy === dragSetup.beforeLegacy || dragOperations < 2) {
    throw new Error(`Actual pointer drag did not produce multiple sculpt samples: ${JSON.stringify({ dragAfter, dragOperations })}`);
  }
  if (dragAfter.history.undo !== 1 || dragAfter.history.redo !== 0) {
    throw new Error(`Actual pointer drag must create exactly one undo record: ${JSON.stringify(dragAfter.history)}`);
  }
  const dragUndoAckStart = await page.evaluate(() => window.lastChunkSculptHistory?.seq ?? 0);
  await page.evaluate(() => window.undo());
  await page.waitForFunction(({ start, count }) => (window.lastChunkSculptHistory?.seq ?? 0) >= start + count,
    { start: dragUndoAckStart, count: dragOperations }, { timeout: acceptanceTimeout });
  const dragUndone = await page.evaluate(() => ({
    legacy: window.realitySculptTransactionRuntime.fingerprint(),
    field: window.infiniteWorld.authoritativeField.serialize(),
    history: window.realitySculptTransactionRuntime.history(),
    workerApplied: window.lastChunkSculptHistory?.applied,
  }));
  if (dragUndone.legacy !== dragSetup.beforeLegacy || JSON.stringify(dragUndone.field) !== JSON.stringify(dragSetup.beforeField)) {
    throw new Error("Literal pointer-drag undo did not restore the legacy grid and authoritative field");
  }
  if (dragUndone.history.undo !== 0 || dragUndone.history.redo !== 1 || dragUndone.workerApplied !== true) {
    throw new Error(`Literal pointer-drag undo history/worker parity failed: ${JSON.stringify(dragUndone)}`);
  }
  const dragRedoAckStart = await page.evaluate(() => window.lastChunkSculptHistory?.seq ?? 0);
  await page.evaluate(() => window.redo());
  await page.waitForFunction(({ start, count }) => (window.lastChunkSculptHistory?.seq ?? 0) >= start + count,
    { start: dragRedoAckStart, count: dragOperations }, { timeout: acceptanceTimeout });
  const dragRedone = await page.evaluate(() => ({
    legacy: window.realitySculptTransactionRuntime.fingerprint(),
    field: window.infiniteWorld.authoritativeField.serialize(),
    history: window.realitySculptTransactionRuntime.history(),
    workerApplied: window.lastChunkSculptHistory?.applied,
  }));
  if (dragRedone.legacy !== dragAfter.legacy || JSON.stringify(dragRedone.field) !== JSON.stringify(dragAfter.field)) {
    throw new Error("Literal pointer-drag redo did not restore the post-gesture models");
  }
  if (dragRedone.history.undo !== 1 || dragRedone.history.redo !== 0 || dragRedone.workerApplied !== true) {
    throw new Error(`Literal pointer-drag redo history/worker parity failed: ${JSON.stringify(dragRedone)}`);
  }

  // Failure injection: if a multi-sample undo fails after one authoritative
  // operation, roll that operation forward and retain the original history.
  const partialUndoBaseline = await page.evaluate(() => ({
    legacy: window.realitySculptTransactionRuntime.fingerprint(),
    field: window.infiniteWorld.authoritativeField.serialize(),
    history: window.realitySculptTransactionRuntime.history(),
  }));
  await page.evaluate(async () => {
    const runtime = window.realitySculptTransactionRuntime;
    runtime.beginGesture();
    await runtime.applyStroke("inject", { x: 20, y: 20, z: 0 }, 1, 0.25, { energy: 1 });
    await runtime.applyStroke("inject", { x: 21, y: 20, z: 0 }, 1, 0.25, { energy: 1 });
    runtime.endGesture();
  });
  const partialUndoBeforeFailure = await page.evaluate(() => ({
    legacy: window.realitySculptTransactionRuntime.fingerprint(),
    field: window.infiniteWorld.authoritativeField.serialize(),
    history: window.realitySculptTransactionRuntime.history(),
  }));
  const workerUndoFailure = await page.evaluate(async () => {
    const original = window.undoChunkSculpt;
    window.undoChunkSculpt = () => Promise.resolve({
      action: "undo",
      applied: false,
      seq: (window.lastChunkSculptHistory?.seq ?? 0) + 1,
    });
    let message = "";
    try { await window.undo(); } catch (error) { message = String(error?.message || error); }
    finally { window.undoChunkSculpt = original; }
    return {
      message,
      legacy: window.realitySculptTransactionRuntime.fingerprint(),
      field: window.infiniteWorld.authoritativeField.serialize(),
      history: window.realitySculptTransactionRuntime.history(),
    };
  });
  if (!workerUndoFailure.message.includes("sculpt undo rejected") ||
      workerUndoFailure.legacy !== partialUndoBeforeFailure.legacy ||
      JSON.stringify(workerUndoFailure.field) !== JSON.stringify(partialUndoBeforeFailure.field) ||
      workerUndoFailure.history.undo !== partialUndoBeforeFailure.history.undo ||
      workerUndoFailure.history.redo !== partialUndoBeforeFailure.history.redo) {
    throw new Error("Rejected sparse-worker Undo did not preserve the pre-undo transaction state: " + JSON.stringify(workerUndoFailure));
  }
  const workerAckBeforePartialUndo = await page.evaluate(() => window.lastChunkSculptHistory?.seq ?? 0);
  const injectedUndo = await page.evaluate(async () => {
    const original = window.infinityUndoLegacySculptAuthoritative;
    let calls = 0;
    window.infinityUndoLegacySculptAuthoritative = (...args) => {
      calls++;
      if (calls === 2) return false;
      return original?.(...args);
    };
    let message = "";
    try { await window.undo(); } catch (error) { message = String(error?.message || error); }
    finally { window.infinityUndoLegacySculptAuthoritative = original; }
    return { calls, message };
  });
  const partialUndoAfterFailure = await page.evaluate(() => ({
    legacy: window.realitySculptTransactionRuntime.fingerprint(),
    field: window.infiniteWorld.authoritativeField.serialize(),
    history: window.realitySculptTransactionRuntime.history(),
  }));
  if (injectedUndo.calls !== 2 || !injectedUndo.message.includes("undo rejected")) {
    throw new Error(`Partial undo failure was not injected as expected: ${JSON.stringify(injectedUndo)}`);
  }
  await page.waitForFunction(
    (seq) => (window.lastChunkSculptHistory?.seq ?? 0) >= seq + 2,
    workerAckBeforePartialUndo,
    { timeout: acceptanceTimeout },
  );
  const partialUndoWorkerAck = await page.evaluate(() => window.lastChunkSculptHistory);
  if (partialUndoWorkerAck?.action !== "redo" || partialUndoWorkerAck?.applied !== true) {
    throw new Error("Sparse worker did not acknowledge rollback after partial undo: " + JSON.stringify(partialUndoWorkerAck));
  }
  if (partialUndoAfterFailure.legacy !== partialUndoBeforeFailure.legacy ||
      JSON.stringify(partialUndoAfterFailure.field) !== JSON.stringify(partialUndoBeforeFailure.field) ||
      partialUndoAfterFailure.history.undo !== partialUndoBeforeFailure.history.undo ||
      partialUndoAfterFailure.history.redo !== partialUndoBeforeFailure.history.redo) {
    throw new Error("Failed multi-sample undo did not roll back to the exact pre-undo state");
  }
  await page.evaluate(() => window.undo());
  const partialUndoRecovered = await page.evaluate(() => ({
    legacy: window.realitySculptTransactionRuntime.fingerprint(),
    field: window.infiniteWorld.authoritativeField.serialize(),
    history: window.realitySculptTransactionRuntime.history(),
  }));
  if (partialUndoRecovered.legacy !== partialUndoBaseline.legacy ||
      JSON.stringify(partialUndoRecovered.field) !== JSON.stringify(partialUndoBaseline.field) ||
      partialUndoRecovered.history.undo !== partialUndoBaseline.history.undo ||
      partialUndoRecovered.history.redo !== partialUndoBaseline.history.redo + 1) {
    throw new Error("Undo history was not usable after a failed partial undo");
  }
  const workerRedoBaseline = await page.evaluate(() => ({
    legacy: window.realitySculptTransactionRuntime.fingerprint(),
    field: window.infiniteWorld.authoritativeField.serialize(),
    history: window.realitySculptTransactionRuntime.history(),
  }));
  const workerRedoFailure = await page.evaluate(async () => {
    const original = window.redoChunkSculpt;
    window.redoChunkSculpt = () => Promise.resolve({
      action: "redo",
      applied: false,
      seq: (window.lastChunkSculptHistory?.seq ?? 0) + 1,
    });
    let message = "";
    try { await window.redo(); } catch (error) { message = String(error?.message || error); }
    finally { window.redoChunkSculpt = original; }
    return {
      message,
      legacy: window.realitySculptTransactionRuntime.fingerprint(),
      field: window.infiniteWorld.authoritativeField.serialize(),
      history: window.realitySculptTransactionRuntime.history(),
    };
  });
  if (!workerRedoFailure.message.includes("sculpt redo rejected") ||
      workerRedoFailure.legacy !== workerRedoBaseline.legacy ||
      JSON.stringify(workerRedoFailure.field) !== JSON.stringify(workerRedoBaseline.field) ||
      workerRedoFailure.history.undo !== workerRedoBaseline.history.undo ||
      workerRedoFailure.history.redo !== workerRedoBaseline.history.redo) {
    throw new Error("Rejected sparse-worker Redo did not preserve the pre-redo transaction state: " + JSON.stringify(workerRedoFailure));
  }
  await page.evaluate(() => window.redo());

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
