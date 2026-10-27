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
  const initialViewSeed = await page.evaluate(() => ({
    worldSeed: window.infiniteWorld?.generator?.seed ?? null,
    viewSeed: window.getWorldViewContract?.()?.seed ?? null,
  }));
  if (!initialViewSeed.worldSeed || initialViewSeed.viewSeed !== initialViewSeed.worldSeed) {
    throw new Error("WorldViewContract seed does not match the active WorldGenerator: " + JSON.stringify(initialViewSeed));
  }
  const noGenerationCheck = await page.evaluate((before) => window.worldVerifyGeneration?.(before), initial);
  if (noGenerationCheck?.ok !== false || noGenerationCheck?.reason !== "generation-revision-did-not-advance") {
    throw new Error("World generation verifier must reject unchanged state even when the stats object exists: " + JSON.stringify(noGenerationCheck));
  }

  // The hidden Infinite World renderer must stop drawing in 2D and resume on return to 3D.
  const renderLifecycleBaseline = await page.evaluate(() => {
    const world = window.infiniteWorld;
    const renderer = world?.renderer;
    if (!world || !renderer || typeof renderer.render !== "function" ||
        typeof world.getRuntimeDiagnostics !== "function" ||
        typeof window.setRenderMode !== "function") {
      return { error: "Infinite World render lifecycle API is unavailable" };
    }
    const diagnostics = world.getRuntimeDiagnostics();
    const pixelRatio = Number(diagnostics.pixelRatio);
    const maxPixelRatio = Number(diagnostics.maxPixelRatio);
    if (!Number.isFinite(pixelRatio) || !Number.isFinite(maxPixelRatio) ||
        pixelRatio < 1 || pixelRatio > maxPixelRatio || !Number.isFinite(Number(diagnostics.adaptiveFrameMs))) {
      return { error: "Adaptive renderer diagnostics are out of bounds", diagnostics };
    }
    const probe = { calls: 0, original: renderer.render };
    renderer.render = function (...args) {
      probe.calls += 1;
      return probe.original.apply(this, args);
    };
    window.__infiniteWorldRenderProbe = probe;
    return { enabled: world.isEnabled, mode: window.currentRenderMode, pixelRatio, maxPixelRatio };
  });
  if (renderLifecycleBaseline.error || !renderLifecycleBaseline.enabled ||
      renderLifecycleBaseline.mode !== "3d") {
    throw new Error("Infinite World did not start in a valid 3D rendering state: " + JSON.stringify(renderLifecycleBaseline));
  }

  const flyModeBaseline = await page.evaluate(() => {
    const world = window.infiniteWorld;
    if (typeof world?.setFlyMode !== "function") return { error: "Fly Camera API is unavailable" };
    world.setFlyMode(true);
    return { runtimeEnabled: world.isEnabled, controlsEnabled: world.controls?.enabled };
  });
  if (flyModeBaseline.error || !flyModeBaseline.runtimeEnabled || flyModeBaseline.controlsEnabled !== false) {
    throw new Error("Fly Camera must disable OrbitControls while Infinite World is active: " + JSON.stringify(flyModeBaseline));
  }

  const renderPausedBaseline = await page.evaluate(() => {
    window.setRenderMode("2d");
    return {
      enabled: window.infiniteWorld?.isEnabled,
      controlsEnabled: window.infiniteWorld?.controls?.enabled,
      mode: window.currentRenderMode,
      calls: window.__infiniteWorldRenderProbe?.calls ?? -1,
    };
  });
  await page.waitForTimeout(250);
  const renderPaused = await page.evaluate(() => ({
    enabled: window.infiniteWorld?.isEnabled,
    controlsEnabled: window.infiniteWorld?.controls?.enabled,
    mode: window.currentRenderMode,
    calls: window.__infiniteWorldRenderProbe?.calls ?? -1,
  }));
  if (renderPausedBaseline.enabled !== false || renderPausedBaseline.controlsEnabled !== false ||
      renderPausedBaseline.mode !== "2d" || renderPaused.enabled !== false ||
      renderPaused.controlsEnabled !== false || renderPaused.mode !== "2d" ||
      renderPaused.calls !== renderPausedBaseline.calls) {
    throw new Error("Infinite World renderer continued drawing in 2D mode: " +
      JSON.stringify({ baseline: renderPausedBaseline, paused: renderPaused }));
  }
  const pausedRenderCalls = renderPaused.calls;
  await page.evaluate(() => window.setRenderMode("3d"));
  await page.waitForFunction((before) => {
    const world = window.infiniteWorld;
    const probe = window.__infiniteWorldRenderProbe;
    return window.currentRenderMode === "3d" && world?.isEnabled === true &&
      world.controls?.enabled === false && probe && probe.calls > before;
  }, pausedRenderCalls, { timeout: 6000 });
  const renderResumed = await page.evaluate(() => {
    const world = window.infiniteWorld;
    const probe = window.__infiniteWorldRenderProbe;
    const result = {
      enabled: world?.isEnabled,
      controlsEnabled: world?.controls?.enabled,
      mode: window.currentRenderMode,
      calls: probe?.calls ?? -1,
    };
    if (world?.renderer && probe) world.renderer.render = probe.original;
    delete window.__infiniteWorldRenderProbe;
    return result;
  });
  if (renderResumed.enabled !== true || renderResumed.controlsEnabled !== false ||
      renderResumed.mode !== "3d" || renderResumed.calls <= pausedRenderCalls) {
    throw new Error("Infinite World renderer did not resume with Fly Camera controls preserved: " + JSON.stringify(renderResumed));
  }
  const orbitRestored = await page.evaluate(() => {
    window.infiniteWorld?.setFlyMode?.(false);
    return { enabled: window.infiniteWorld?.isEnabled, controlsEnabled: window.infiniteWorld?.controls?.enabled };
  });
  if (orbitRestored.enabled !== true || orbitRestored.controlsEnabled !== true) {
    throw new Error("OrbitControls did not re-enable after leaving Fly Camera: " + JSON.stringify(orbitRestored));
  }
  console.log("[acceptance] hidden renderer pause/resume, Fly Camera control preservation, adaptive DPR diagnostics PASS");

  // Bottom-bar counters must describe the selected runtime, not the unrelated legacy 2D grid.
  await page.waitForFunction(() => {
    const stats = window.infinityStats?.();
    return document.getElementById("tkLabel")?.textContent?.trim() === "World:" &&
      Number(stats?.loadedChunks) > 0 &&
      document.getElementById("chunkStats")?.textContent?.includes("loaded");
  }, null, { timeout: 15000 });
  const worldHud = await page.evaluate(() => ({
    worldLabel: document.getElementById("tkLabel")?.textContent?.trim(),
    objectLabel: document.getElementById("energyLabel")?.textContent?.trim(),
    fpsLabel: document.getElementById("entropyLabel")?.textContent?.trim(),
    chunksLabel: document.getElementById("chunksLabel")?.textContent?.trim(),
    legacyAgentsHidden: getComputedStyle(document.getElementById("agOut")).display === "none",
    stats: window.infinityStats?.() ?? null,
  }));
  if (worldHud.worldLabel !== "World:" || worldHud.objectLabel !== "Objects:" ||
      worldHud.fpsLabel !== "FPS:" || worldHud.chunksLabel !== "Chunks:" ||
      !worldHud.legacyAgentsHidden || Number(worldHud.stats?.loadedChunks) <= 0) {
    throw new Error(`Infinite World HUD is not bound to authoritative runtime stats: ${JSON.stringify(worldHud)}`);
  }

  // A real right-button pan is routed through OrbitControls; its absolute-world target
  // must stay synchronized with the world coordinate frame used for chunk streaming.
  const cameraBeforePan = await page.evaluate(() => {
    const world = window.infiniteWorld;
    const position = world?.getWorldPosition?.();
    return position ? { x: position.x, z: position.z } : null;
  });
  const worldCanvasBounds = await page.locator("#c3d").boundingBox();
  if (!cameraBeforePan || !worldCanvasBounds || worldCanvasBounds.width < 100 || worldCanvasBounds.height < 100) {
    throw new Error("Infinite World canvas/camera is unavailable for the OrbitControls regression");
  }
  const panStartX = worldCanvasBounds.x + worldCanvasBounds.width * 0.55;
  const panStartY = worldCanvasBounds.y + worldCanvasBounds.height * 0.52;
  await page.mouse.move(panStartX, panStartY);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(panStartX + 75, panStartY + 38, { steps: 6 });
  await page.mouse.up({ button: "right" });
  await page.waitForFunction((before) => {
    const position = window.infiniteWorld?.getWorldPosition?.();
    return !!position && Math.hypot(position.x - before.x, position.z - before.z) > 1;
  }, cameraBeforePan, { timeout: 6000 });
  const cameraAfterPan = await page.evaluate(() => {
    const world = window.infiniteWorld;
    const position = world?.getWorldPosition?.();
    const target = world?.controls?.target;
    const anchor = world?.worldAnchor;
    return position && target && anchor ? {
      x: position.x, z: position.z,
      targetX: target.x, targetZ: target.z,
      anchorX: anchor.x, anchorZ: anchor.z,
    } : null;
  });
  if (!cameraAfterPan ||
      Math.abs(cameraAfterPan.x - cameraAfterPan.targetX - cameraAfterPan.anchorX) > 0.5 ||
      Math.abs(cameraAfterPan.z - cameraAfterPan.targetZ - cameraAfterPan.anchorZ) > 0.5) {
    throw new Error(`OrbitControls target drifted from absolute world coordinates: ${JSON.stringify(cameraAfterPan)}`);
  }

  // Every visible camera preset must select a distinct supported runtime mode.
  // Street used to fall through to Orbit, and Fly used to be immediately disabled.
  const cameraPresets = [
    { id: "cam_orbit", name: "orbit", fly: false },
    { id: "cam_top", name: "top", fly: false },
    { id: "cam_iso", name: "iso", fly: false },
    { id: "cam_street", name: "street", fly: false },
    { id: "cam_fly", name: "fly", fly: true },
  ];
  for (const preset of cameraPresets) {
    await page.locator(`#${preset.id}`).click();
    const cameraState = await page.evaluate(() => {
      const world = window.infiniteWorld;
      const p = world?.camera?.position;
      return {
        flyMode: world?.flyMode,
        controlsEnabled: world?.controls?.enabled,
        position: p ? [p.x, p.y, p.z] : null,
      };
    });
    if (!cameraState.position?.every(Number.isFinite) ||
        cameraState.flyMode !== preset.fly ||
        cameraState.controlsEnabled === preset.fly) {
      throw new Error(`Camera preset ${preset.name} did not activate its expected controls: ${JSON.stringify(cameraState)}`);
    }
  }
  // Verify Fly is operational, not merely enabled: holding W must move the camera.
  await page.locator("#cam_fly").click();
  const flyBefore = await page.evaluate(() => {
    const p = window.infiniteWorld?.camera?.position;
    return p ? [p.x, p.y, p.z] : null;
  });
  await page.keyboard.down("w");
  await page.waitForTimeout(250);
  await page.keyboard.up("w");
  const flyAfter = await page.evaluate(() => {
    const p = window.infiniteWorld?.camera?.position;
    return p ? [p.x, p.y, p.z] : null;
  });
  if (!flyBefore || !flyAfter || Math.hypot(
    flyAfter[0] - flyBefore[0], flyAfter[1] - flyBefore[1], flyAfter[2] - flyBefore[2]
  ) < 0.1) {
    throw new Error(`Fly camera did not move while W was held: before=${JSON.stringify(flyBefore)}, after=${JSON.stringify(flyAfter)}`);
  }

  // Fly must support mouse-look as well as translation; otherwise it is just
  // a fixed-heading camera with OrbitControls disabled.
  const flyCanvasBounds = await page.locator("#c3d").boundingBox();
  if (!flyCanvasBounds || flyCanvasBounds.width < 100 || flyCanvasBounds.height < 100) {
    throw new Error("Fly camera test cannot access a visible Infinite World canvas");
  }
  const flyLookStart = {
    x: flyCanvasBounds.x + flyCanvasBounds.width / 2,
    y: flyCanvasBounds.y + flyCanvasBounds.height / 2,
  };
  const flyRotationBefore = await page.evaluate(() => {
    const r = window.infiniteWorld?.camera?.rotation;
    return r ? [r.x, r.y, r.z] : null;
  });
  await page.mouse.move(flyLookStart.x, flyLookStart.y);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(flyLookStart.x + 72, flyLookStart.y - 28, { steps: 6 });
  await page.mouse.up({ button: "left" });
  const flyRotationAfter = await page.evaluate(() => {
    const r = window.infiniteWorld?.camera?.rotation;
    return r ? [r.x, r.y, r.z] : null;
  });
  if (!flyRotationBefore || !flyRotationAfter ||
      Math.hypot(flyRotationAfter[0] - flyRotationBefore[0], flyRotationAfter[1] - flyRotationBefore[1]) < 0.01) {
    throw new Error(`Fly camera did not respond to mouse-look drag: before=${JSON.stringify(flyRotationBefore)}, after=${JSON.stringify(flyRotationAfter)}`);
  }

  // Leave the application in the normal OrbitControls mode for subsequent tests.
  await page.locator("#cam_orbit").click();

  // Adjacent terrain chunks with different LODs must share the same piecewise-linear
  // boundary heights; otherwise finer edges can leave T-junction cracks.
  await page.waitForFunction(() => {
    const world = window.infiniteWorld;
    const patches = [...(world?.patches?.values?.() ?? [])];
    if (patches.length < 13) return false;
    const byKey = new Map(patches.map(p => [`${p.chunk.cx},${p.chunk.cy},${p.chunk.cz}`, p]));
    return patches.some(p => {
      const east = byKey.get(`${p.chunk.cx + 1},${p.chunk.cy},${p.chunk.cz}`);
      const south = byKey.get(`${p.chunk.cx},${p.chunk.cy},${p.chunk.cz + 1}`);
      return (!!east && east.lod !== p.lod) || (!!south && south.lod !== p.lod);
    });
  }, null, { timeout: 15000 });
  const terrainSeam = await page.evaluate(() => {
    const world = window.infiniteWorld;
    const patches = [...(world?.patches?.values?.() ?? [])];
    const byKey = new Map(patches.map(p => [`${p.chunk.cx},${p.chunk.cy},${p.chunk.cz}`, p]));
    const edge = (patch, side) => {
      const mesh = patch.group.children.find(child => child.userData?.terrain);
      const position = mesh?.geometry?.getAttribute?.("position");
      if (!position) return null;
      const n = Math.round(Math.sqrt(position.count));
      const resolution = n - 1;
      const heights = [];
      for (let i = 0; i < n; i++) {
        const index = side === "west" ? i * n : side === "east" ? i * n + resolution
          : side === "north" ? i : resolution * n + i;
        heights.push(position.getY(index));
      }
      return { resolution, heights };
    };
    let checkedPairs = 0;
    let maxBoundaryHeightError = 0;
    const failures = [];
    for (const patch of patches) {
      const east = byKey.get(`${patch.chunk.cx + 1},${patch.chunk.cy},${patch.chunk.cz}`);
      const south = byKey.get(`${patch.chunk.cx},${patch.chunk.cy},${patch.chunk.cz + 1}`);
      for (const [neighbor, sideA, sideB, direction] of [
        [east, "east", "west", "east-west"],
        [south, "south", "north", "north-south"],
      ]) {
        if (!neighbor || neighbor.lod === patch.lod) continue;
        const a = edge(patch, sideA), b = edge(neighbor, sideB);
        if (!a || !b) {
          failures.push({ direction, reason: "missing terrain edge geometry",
            a: [patch.chunk.cx, patch.chunk.cy, patch.chunk.cz],
            b: [neighbor.chunk.cx, neighbor.chunk.cy, neighbor.chunk.cz] });
          continue;
        }
        if (a.resolution === b.resolution) continue;
        const coarse = a.resolution < b.resolution ? a : b;
        const fine = a.resolution < b.resolution ? b : a;
        const ratio = fine.resolution / coarse.resolution;
        if (!Number.isInteger(ratio)) {
          failures.push({ direction, reason: "LOD grid resolutions are not nested", ratio,
            a: [patch.chunk.cx, patch.chunk.cy, patch.chunk.cz],
            b: [neighbor.chunk.cx, neighbor.chunk.cy, neighbor.chunk.cz] });
          continue;
        }
        checkedPairs++;
        let pairMaxError = 0;
        for (let i = 0; i <= fine.resolution; i++) {
          const lo = Math.floor(i / ratio);
          const hi = Math.min(coarse.resolution, lo + 1);
          const t = hi === lo ? 0 : (i / ratio - lo);
          const expected = coarse.heights[lo] + (coarse.heights[hi] - coarse.heights[lo]) * t;
          pairMaxError = Math.max(pairMaxError, Math.abs(fine.heights[i] - expected));
        }
        maxBoundaryHeightError = Math.max(maxBoundaryHeightError, pairMaxError);
        if (pairMaxError > 0.002) {
          failures.push({ direction, lodA: patch.lod, lodB: neighbor.lod,
            coarseResolution: coarse.resolution, fineResolution: fine.resolution,
            maxBoundaryHeightError: pairMaxError,
            a: [patch.chunk.cx, patch.chunk.cy, patch.chunk.cz],
            b: [neighbor.chunk.cx, neighbor.chunk.cy, neighbor.chunk.cz] });
        }
      }
    }
    return { checkedPairs, maxBoundaryHeightError, failures };
  });
  if (!terrainSeam || terrainSeam.checkedPairs < 1 || terrainSeam.failures.length > 0) {
    throw new Error(`Mixed-LOD terrain seam validation failed: ${JSON.stringify(terrainSeam)}`);
  }

  // Validate the actual rendered terrain geometry, not only generator arrays or
  // renderer counters. Catch collapsed heightfields, non-finite vertices, invalid
  // indices, and degenerate triangles before visual defects reach release.
  const terrainGeometry = await page.evaluate(() => {
    const world = window.infiniteWorld;
    const patches = [...(world?.patches?.values?.() ?? [])];
    let minY = Infinity;
    let maxY = -Infinity;
    let vertexCount = 0;
    let triangleCount = 0;
    let degenerateTriangles = 0;
    let invalidIndices = 0;
    let nonFiniteVertices = 0;
    let invalidGeometryPatches = 0;
    let malformedIndexBuffers = 0;
    let missingNormalAttributes = 0;
    let nonFiniteNormals = 0;
    let nonUnitNormals = 0;
    const distinctHeights = new Set();

    for (const patch of patches) {
      const mesh = patch.group.children.find(child => child.userData?.terrain);
      const geometry = mesh?.geometry;
      const position = geometry?.getAttribute?.("position");
      const normal = geometry?.getAttribute?.("normal");
      const index = geometry?.index;
      if (!normal || normal.count !== position?.count) missingNormalAttributes++;
      if (!position || !index || position.count < 3 || index.count < 3) {
        invalidGeometryPatches++;
        continue;
      }
      if (index.count % 3 !== 0) malformedIndexBuffers++;

      vertexCount += position.count;
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        const y = position.getY(i);
        const z = position.getZ(i);
        if (![x, y, z].every(Number.isFinite)) {
          nonFiniteVertices++;
          continue;
        }
        if (normal && normal.count === position.count) {
          const nx = normal.getX(i), ny = normal.getY(i), nz = normal.getZ(i);
          if (![nx, ny, nz].every(Number.isFinite)) {
            nonFiniteNormals++;
          } else if (Math.abs(Math.hypot(nx, ny, nz) - 1) > 0.02) {
            nonUnitNormals++;
          }
        }
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        distinctHeights.add(Math.round(y * 1000) / 1000);
      }

      const ax = new Float64Array(3);
      const bx = new Float64Array(3);
      const cx = new Float64Array(3);
      for (let i = 0; i + 2 < index.count; i += 3) {
        const ia = index.getX(i), ib = index.getX(i + 1), ic = index.getX(i + 2);
        triangleCount++;
        if ([ia, ib, ic].some(v => !Number.isInteger(v) || v < 0 || v >= position.count)) {
          invalidIndices++;
          continue;
        }
        ax[0] = position.getX(ib) - position.getX(ia);
        ax[1] = position.getY(ib) - position.getY(ia);
        ax[2] = position.getZ(ib) - position.getZ(ia);
        bx[0] = position.getX(ic) - position.getX(ia);
        bx[1] = position.getY(ic) - position.getY(ia);
        bx[2] = position.getZ(ic) - position.getZ(ia);
        cx[0] = ax[1] * bx[2] - ax[2] * bx[1];
        cx[1] = ax[2] * bx[0] - ax[0] * bx[2];
        cx[2] = ax[0] * bx[1] - ax[1] * bx[0];
        if (Math.hypot(cx[0], cx[1], cx[2]) < 1e-6) degenerateTriangles++;
      }
    }
    return {
      loadedPatches: patches.length, vertexCount, triangleCount,
      minY, maxY, relief: maxY - minY, distinctHeightSamples: distinctHeights.size,
      degenerateTriangles, invalidIndices, nonFiniteVertices,
      invalidGeometryPatches, malformedIndexBuffers,
      missingNormalAttributes, nonFiniteNormals, nonUnitNormals,
    };
  });
  if (terrainGeometry.loadedPatches < 13 || terrainGeometry.vertexCount <= 0 ||
      terrainGeometry.triangleCount <= 0 || !Number.isFinite(terrainGeometry.relief) ||
      terrainGeometry.relief < 1 || terrainGeometry.distinctHeightSamples < 8 ||
      terrainGeometry.degenerateTriangles > 0 || terrainGeometry.invalidIndices > 0 ||
      terrainGeometry.nonFiniteVertices > 0 || terrainGeometry.invalidGeometryPatches > 0 ||
      terrainGeometry.malformedIndexBuffers > 0 || terrainGeometry.missingNormalAttributes > 0 ||
      terrainGeometry.nonFiniteNormals > 0 || terrainGeometry.nonUnitNormals > 0) {
    throw new Error(`Rendered terrain geometry contract failed: ${JSON.stringify(terrainGeometry)}`);
  }

  // The rendered sea-level mesh must cover exactly the wet cells reported by the generator,
  // not one full plane per terrain chunk.
  const waterCoverage = await page.evaluate(() =>
    window.infiniteWorld?.getTerrainWaterDiagnostics?.() ?? null
  );
  if (!waterCoverage || waterCoverage.loadedChunks < 13 ||
      waterCoverage.actualWaterQuads !== waterCoverage.expectedWaterQuads ||
      waterCoverage.actualWaterQuads > waterCoverage.maxWaterQuads) {
    throw new Error(`Terrain water mesh does not match the generator mask: ${JSON.stringify(waterCoverage)}`);
  }

  // Global Play/Pause controls 3D simulation effects without stopping rendering or streaming.
  const playPauseBaseline = await page.evaluate(() => {
    const world = window.infiniteWorld;
    if (!world || typeof window.getInfiniteWorldSimulationRunning !== "function" ||
        typeof window.setInfiniteWorldSimulationRunning !== "function") return { error: "simulation lifecycle bridge unavailable" };
    world.setShowParticles(true);
    return {
      running: window.getInfiniteWorldSimulationRunning(),
      tick: Number(window.tick) || 0,
      positions: Array.from(world.physicsParticlePositions.slice(0, 60)),
    };
  });
  if (playPauseBaseline.error || playPauseBaseline.running !== false) {
    throw new Error(`3D simulation should start paused with the global Play button: ${JSON.stringify(playPauseBaseline.error ?? playPauseBaseline.running)}`);
  }
  await page.locator("#pb").click();
  await page.waitForFunction((before) => {
    const world = window.infiniteWorld;
    const current = Array.from(world.physicsParticlePositions.slice(0, before.positions.length));
    return window.getInfiniteWorldSimulationRunning?.() === true &&
      Number(window.tick) > before.tick &&
      current.some((value, index) => Math.abs(value - before.positions[index]) > 1e-6);
  }, playPauseBaseline, { timeout: 8000 });
  await page.locator("#pb").click();
  await page.waitForFunction(() =>
    window.getInfiniteWorldSimulationRunning?.() === false &&
    document.getElementById("pb")?.textContent?.includes("Play"));
  const pausedSnapshot = await page.evaluate(() => ({
    tick: Number(window.tick) || 0,
    positions: Array.from(window.infiniteWorld.physicsParticlePositions.slice(0, 60)),
  }));
  await page.waitForTimeout(250);
  const pausedAfter = await page.evaluate(() => ({
    tick: Number(window.tick) || 0,
    positions: Array.from(window.infiniteWorld.physicsParticlePositions.slice(0, 60)),
  }));
  if (pausedAfter.tick !== pausedSnapshot.tick ||
      pausedAfter.positions.some((value, index) => Math.abs(value - pausedSnapshot.positions[index]) > 1e-6)) {
    throw new Error("Pause stopped the legacy tick but not the 3D particle simulation");
  }
  // The speed slider must change simulation work, not only its label.
  // Count real simStep invocations at two slider settings while the global
  // Play/Pause path is active; restore the original function before continuing.
  const speedProbeAvailable = await page.evaluate(() => typeof window.simStep === "function");
  if (!speedProbeAvailable) throw new Error("Simulation speed acceptance cannot access the authoritative simStep function");
  const speedProbeSetup = await page.evaluate(() => {
    const original = window.simStep;
    window.__realitySpeedProbe = { original, calls: 0 };
    window.simStep = function (...args) {
      window.__realitySpeedProbe.calls++;
      return original.apply(this, args);
    };
    return true;
  });
  if (!speedProbeSetup) throw new Error("Unable to instrument simulation step counter");
  const measureSpeed = async (speed) => {
    await page.locator("#spd").evaluate((input, value) => {
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, speed);
    await page.locator("#pb").click();
    await page.waitForTimeout(350);
    await page.locator("#pb").click();
    await page.waitForFunction(() => window.getInfiniteWorldSimulationRunning?.() === false);
    return page.evaluate(() => window.__realitySpeedProbe.calls);
  };
  let slowSpeedCalls = 0;
  let fastSpeedCalls = 0;
  try {
    slowSpeedCalls = await measureSpeed(1);
    await page.waitForTimeout(100);
    await page.evaluate(() => { window.__realitySpeedProbe.calls = 0; });
    fastSpeedCalls = await measureSpeed(12);
  } finally {
    await page.evaluate(() => {
      if (window.__realitySpeedProbe?.original) window.simStep = window.__realitySpeedProbe.original;
      delete window.__realitySpeedProbe;
      const speed = document.getElementById("spd");
      if (speed) {
        speed.value = "4";
        speed.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  }
  if (slowSpeedCalls <= 0 || fastSpeedCalls <= slowSpeedCalls) {
    throw new Error(`Simulation speed slider did not increase real simulation work: 1x=${slowSpeedCalls}, 12x=${fastSpeedCalls}`);
  }
  console.log(`[acceptance] simulation speed control: 1x=${slowSpeedCalls} steps, 12x=${fastSpeedCalls} steps`);

  // Reset is deliberately scoped to the legacy 2D field simulation. It must
  // stop playback, clear its field buffer/causal history, and reset the tick,
  // without pretending to reset the separate Infinite World terrain runtime.
  await page.evaluate(() => {
    window.buf[0] = 123;
    window.buf[1] = 0.75;
    window.tick = 17;
    // Exercise the stale-state edge case: the legacy flag is already paused
    // while the independent 3D runtime is running.
    window.realityEnginePlaying = false;
    window.setInfiniteWorldSimulationRunning?.(true);
    window.resetLegacyFieldSimulation?.();
  });
  const resetState = await page.evaluate(() => ({
    tick: window.tick,
    playing: window.realityEnginePlaying,
    infiniteWorldRunning: window.getInfiniteWorldSimulationRunning?.(),
    nonZeroFields: Array.from(window.buf).filter(value => value !== 0).length,
    buttonText: document.getElementById("pb")?.textContent?.trim(),
    hudLabel: document.getElementById("tkLabel")?.textContent?.trim(),
    tickLabel: document.getElementById("tkOut")?.textContent?.trim(),
  }));
  // The bottom HUD is bound to the selected runtime. In Infinite World mode,
  // updateHealth() intentionally renders "World: Ready" rather than the
  // unrelated legacy 2D tick counter; the legacy counter is checked above.
  const expectedHudValue = resetState.hudLabel === "World:" ? "Ready" : "0";
  if (
    resetState.tick !== 0 ||
    resetState.playing !== false ||
    resetState.infiniteWorldRunning !== false ||
    resetState.nonZeroFields !== 0 ||
    resetState.buttonText !== "▶ Play" ||
    !resetState.tickLabel ||
    resetState.tickLabel !== expectedHudValue
  ) {
    throw new Error(`2D field reset failed to restore its documented baseline: ${JSON.stringify(resetState)}`);
  }
  console.log("[acceptance] scoped 2D field reset: playback stopped, fields cleared, tick reset");

  await page.evaluate(() => window.infiniteWorld?.setShowParticles(false));

  // Deterministic scientific view-window sampling must be available to the browser runtime.
  const viewWindowContract = await page.evaluate(() => {
    const sampleWindow = window.worldFieldViewWindow;
    if (typeof sampleWindow !== "function" || typeof window.worldFieldSample !== "function" ||
        typeof window.getWorldViewContract !== "function" || typeof window.setWorldViewSliceY !== "function") {
      return { error: "World-field view-window API is not exposed" };
    }
    const first = sampleWindow(2, 2, 7);
    const second = sampleWindow(2, 2, 7);
    return {
      width: first.width, height: first.height, sliceY: first.sliceY,
      count: first.samples?.length,
      allOnSlice: first.samples?.every((sample) => sample.y === 7),
      deterministic: JSON.stringify(first) === JSON.stringify(second),
      view: window.getWorldViewContract(),
    };
  });
  if (viewWindowContract.error) throw new Error(viewWindowContract.error);
  if (viewWindowContract.width !== 2 || viewWindowContract.height !== 2 || viewWindowContract.count !== 4) {
    throw new Error("World-field view-window sampling returned an invalid grid shape");
  }
  if (viewWindowContract.sliceY !== 7 || !viewWindowContract.allOnSlice) {
    throw new Error("World-field view-window sampling ignored the requested Y slice");
  }
  if (!viewWindowContract.deterministic) throw new Error("World-field view-window sampling is not deterministic");
  await page.evaluate(() => {
    window.setWorldField2DLinked?.(true);
    window.previewRenderMode?.("2d");
  });
  await page.waitForFunction(() => {
    const state = window.getWorldField2DState?.();
    return !!state && state.linked === true && state.sampleCount > 0;
  }, { timeout: 10000 });
  const renderedWorldField = await page.evaluate(() => window.getWorldField2DState());
  if (!renderedWorldField.view || renderedWorldField.sampleCount <= 0) {
    throw new Error("2D world-field renderer did not consume sampled world-space data");
  }
  // 3D volumetric field must render actual authoritative world-field samples, not a blank tab.
  // Exercise the same click path as a user; this also verifies the tab is wired to setRenderMode.
  await page.evaluate(() => {
    if (typeof window.getWorldField3DState !== "function") throw new Error("Public Field 3D diagnostics API is missing before render");
    window.__field3dPublicGetterProbe = window.getWorldField3DState;
  });
  await page.locator("#tabField3d").click();
  const field3dCanvasCount = await page.locator("#c3dField").count();
  if (field3dCanvasCount !== 1) {
    throw new Error(`Expected exactly one authoritative #c3dField canvas, found ${field3dCanvasCount}`);
  }
  const field3dApiContract = await page.evaluate(() => ({
    authoritative: typeof window.renderField3D === "function",
    chunkRenderer: typeof window.renderChunkField3D === "function",
    sameFunction: typeof window.renderChunkField3D === "function" &&
      window.renderChunkField3D === window.renderField3D,
  }));
  if (!field3dApiContract.authoritative || field3dApiContract.sameFunction) {
    throw new Error(`Field3D renderer globals overlap or are missing: ${JSON.stringify(field3dApiContract)}`);
  }
  const field3dSwitch = await page.evaluate(() => ({
    renderAvailable: typeof window.renderField3D === "function",
    modeApiAvailable: typeof window.previewRenderMode === "function",
    canvasDisplay: document.getElementById("c3dField")?.style.display ?? null,
    canvasRect: (() => { const r = document.getElementById("c3dField")?.getBoundingClientRect(); return r ? { width: r.width, height: r.height } : null; })(),
    state: window.getWorldField3DState?.() ?? null,
  }));
  if (!field3dSwitch.renderAvailable) {
    throw new Error(`3D volumetric field renderer is not registered: ${JSON.stringify(field3dSwitch)}`);
  }
  // Rendering may be scheduled on the next animation frame after the click.
  // Wait for either a successful render or an explicit diagnostic before asserting.
  try {
    await page.waitForFunction(() => {
      const state = window.getWorldField3DState?.();
      const transientReasons = new Set([
        "authoritative-field-renderer-pending",
        "renderer-entered",
        "initializing",
      ]);
      return !!state && (state.ready ||
        (!!state.reason && !transientReasons.has(String(state.reason))));
    }, null, { timeout: 12000 });
  } catch (error) {
    const trace = await page.evaluate(() => ({
      state: window.getWorldField3DState?.() ?? null,
      trace: window.__worldField3DTrace ?? null,
      mode: window.currentRenderMode ?? null,
      inlineMode: document.getElementById("tabField3d")?.getAttribute("onclick") ?? null,
      canvas: (() => { const e = document.getElementById("c3dField"); const r = e?.getBoundingClientRect(); return e && r ? {display:getComputedStyle(e).display,width:r.width,height:r.height} : null; })(),
      apis: { sampler:typeof window.worldFieldViewWindow, view:typeof window.getWorldViewContract, setMode:typeof window.setWorldViewRenderMode },
      volumeDiagnostics: window.getWorldFieldVolumeRendererDiagnostics?.() ?? null,
    }));
    throw new Error(`3D volumetric field renderer did not publish a result: ${JSON.stringify(trace)}; ${error.message}`);
  }
  const field3dDiagnostic = await page.evaluate(() => window.getWorldField3DState?.());
  const field3dGetterStable = await page.evaluate(() => {
    const stable = window.getWorldField3DState === window.__field3dPublicGetterProbe;
    delete window.__field3dPublicGetterProbe;
    return stable;
  });
  if (!field3dGetterStable) throw new Error("Field 3D renderer replaced the connector-owned diagnostics API");
  if (!field3dDiagnostic?.ready) {
    throw new Error(`3D volumetric field renderer failed: ${JSON.stringify(field3dDiagnostic)}`);
  }
  if (field3dDiagnostic.renderedCells <= 0 || field3dDiagnostic.sampleCount <= 0) {
    throw new Error("3D volumetric field did not render sampled cells");
  }
  if (field3dDiagnostic.renderer !== "three-webgl-instanced-volume" ||
      field3dDiagnostic.true3D !== true ||
      field3dDiagnostic.meshInstances <= 0 ||
      field3dDiagnostic.drawCalls <= 0 ||
      field3dDiagnostic.triangles < field3dDiagnostic.renderedCells * 12) {
    throw new Error("3D volumetric field is not backed by rendered WebGL volume geometry: " + JSON.stringify(field3dDiagnostic));
  }
  if (field3dDiagnostic.slices < 5) {
    throw new Error("3D volume has insufficient vertical sampling depth: " + JSON.stringify(field3dDiagnostic));
  }

  // Verify that the WebGL volume canvas receives pointer input and OrbitControls
  // changes its camera. Move to a clear center point and use Playwright's pointer API.
  const volumeCanvas = page.locator("#c3dField");
  const volumeCanvasBounds = await volumeCanvas.boundingBox();
  if (!volumeCanvasBounds || volumeCanvasBounds.width < 100 || volumeCanvasBounds.height < 100) {
    throw new Error("3D volume camera test cannot access a visible canvas");
  }
  const volumeControlState = await page.evaluate(() => ({
    enabled: window.worldFieldVolumeRenderer?.controls?.enabled,
    rotating: window.worldFieldVolumeRenderer?.controls?.enableRotate,
    canvasPointerEvents: getComputedStyle(document.querySelector("#c3dField")).pointerEvents,
    canvasDisplay: getComputedStyle(document.querySelector("#c3dField")).display,
    canvasZ: getComputedStyle(document.querySelector("#c3dField")).zIndex,
  }));
  if (volumeControlState.enabled !== true || volumeControlState.rotating !== true ||
      volumeControlState.canvasPointerEvents === "none" || volumeControlState.canvasDisplay === "none") {
    throw new Error("3D volume input is disabled or canvas is not interactive: " + JSON.stringify(volumeControlState));
  }
  const volumeCameraBefore = await page.evaluate(() => {
    const p = window.worldFieldVolumeRenderer?.camera?.position;
    return p ? [p.x, p.y, p.z] : null;
  });
  const volumeLookStart = {
    x: volumeCanvasBounds.x + volumeCanvasBounds.width * 0.6,
    y: volumeCanvasBounds.y + volumeCanvasBounds.height * 0.55,
  };
  await page.mouse.move(volumeLookStart.x, volumeLookStart.y);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(volumeLookStart.x + 140, volumeLookStart.y + 70, { steps: 12 });
  await page.mouse.up({ button: "left" });
  await page.waitForTimeout(100);
  const volumeCameraAfter = await page.evaluate(() => {
    const p = window.worldFieldVolumeRenderer?.camera?.position;
    return p ? [p.x, p.y, p.z] : null;
  });
  if (!volumeCameraBefore || !volumeCameraAfter ||
      Math.hypot(volumeCameraAfter[0] - volumeCameraBefore[0],
        volumeCameraAfter[1] - volumeCameraBefore[1],
        volumeCameraAfter[2] - volumeCameraBefore[2]) < 0.1) {
    const inputDiagnostics = await page.evaluate(() => ({
      before: window.worldFieldVolumeRenderer?.camera?.position?.toArray?.(),
      after: window.worldFieldVolumeRenderer?.camera?.position?.toArray?.(),
      controls: {
        enabled: window.worldFieldVolumeRenderer?.controls?.enabled,
        rotating: window.worldFieldVolumeRenderer?.controls?.enableRotate,
        dragging: window.worldFieldVolumeRenderer?.controls?.state,
      },
      activeElement: document.activeElement?.id,
    }));
    throw new Error("3D volume camera did not respond to pointer rotation: before=" +
      JSON.stringify(volumeCameraBefore) + ", after=" + JSON.stringify(volumeCameraAfter) +
      ", input=" + JSON.stringify(inputDiagnostics));
  }

  // Rotation alone is not enough: verify OrbitControls zoom and pan affect
  // the actual camera/target, rather than only exposing enabled control flags.
  const cameraDistanceBeforeZoom = await page.evaluate(() => {
    const renderer = window.worldFieldVolumeRenderer;
    return renderer?.camera && renderer?.controls?.target
      ? renderer.camera.position.distanceTo(renderer.controls.target)
      : null;
  });
  await page.mouse.move(
    volumeCanvasBounds.x + volumeCanvasBounds.width * 0.55,
    volumeCanvasBounds.y + volumeCanvasBounds.height * 0.55,
  );
  await page.mouse.wheel(0, -420);
  await page.waitForTimeout(100);
  const cameraDistanceAfterZoom = await page.evaluate(() => {
    const renderer = window.worldFieldVolumeRenderer;
    return renderer?.camera && renderer?.controls?.target
      ? renderer.camera.position.distanceTo(renderer.controls.target)
      : null;
  });
  if (cameraDistanceBeforeZoom == null || cameraDistanceAfterZoom == null ||
      cameraDistanceBeforeZoom - cameraDistanceAfterZoom < 0.1) {
    throw new Error("3D volume camera did not zoom in on wheel input: before=" +
      JSON.stringify(cameraDistanceBeforeZoom) + ", after=" + JSON.stringify(cameraDistanceAfterZoom));
  }

  const volumeTargetBeforePan = await page.evaluate(() =>
    window.worldFieldVolumeRenderer?.controls?.target?.toArray?.() ?? null
  );
  const panStart = {
    x: volumeCanvasBounds.x + volumeCanvasBounds.width * 0.52,
    y: volumeCanvasBounds.y + volumeCanvasBounds.height * 0.52,
  };
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(panStart.x + 90, panStart.y + 35, { steps: 10 });
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(100);
  const volumeTargetAfterPan = await page.evaluate(() =>
    window.worldFieldVolumeRenderer?.controls?.target?.toArray?.() ?? null
  );
  if (!volumeTargetBeforePan || !volumeTargetAfterPan ||
      Math.hypot(volumeTargetAfterPan[0] - volumeTargetBeforePan[0],
        volumeTargetAfterPan[1] - volumeTargetBeforePan[1],
        volumeTargetAfterPan[2] - volumeTargetBeforePan[2]) < 0.05) {
    throw new Error("3D volume camera did not pan on right-button drag: before=" +
      JSON.stringify(volumeTargetBeforePan) + ", after=" + JSON.stringify(volumeTargetAfterPan));
  }

  const volumeHud = await page.evaluate(() => ({
    fieldLabel: document.getElementById("tkLabel")?.textContent?.trim(),
    cellLabel: document.getElementById("energyLabel")?.textContent?.trim(),
    sampleLabel: document.getElementById("entropyLabel")?.textContent?.trim(),
    worldLabel: document.getElementById("chunksLabel")?.textContent?.trim(),
    status: document.getElementById("tkOut")?.textContent?.trim(),
    cells: document.getElementById("eOut")?.textContent?.trim(),
    samples: document.getElementById("sOut")?.textContent?.trim(),
  }));
  if (volumeHud.fieldLabel !== "Field:" || volumeHud.cellLabel !== "Cells:" ||
      volumeHud.sampleLabel !== "Samples:" || volumeHud.worldLabel !== "World:" ||
      volumeHud.status !== "Ready" || Number(volumeHud.cells?.replaceAll(",", "")) <= 0 ||
      Number(volumeHud.samples?.replaceAll(",", "")) <= 0) {
    throw new Error(`Volumetric HUD is not bound to rendered field diagnostics: ${JSON.stringify(volumeHud)}`);
  }
  const field3dInitial = await page.evaluate(() => {
    const state = window.getWorldField3DState?.();
    const canvas = document.getElementById("c3dField");
    const rect = canvas?.getBoundingClientRect();
    return {
      state,
      canvasExists: !!canvas,
      visible: !!rect && rect.width > 10 && rect.height > 10 && getComputedStyle(canvas).display !== "none",
      backingWidth: canvas?.width ?? 0,
      backingHeight: canvas?.height ?? 0,
      rectWidth: rect?.width ?? 0,
      rectHeight: rect?.height ?? 0,
    };
  });
  if (!field3dInitial.canvasExists || !field3dInitial.visible) {
    throw new Error("3D volumetric field canvas is missing or not visible");
  }
  if (field3dInitial.state.renderedCells <= 0 || field3dInitial.state.sampleCount <= 0) {
    throw new Error("3D volumetric field did not render sampled cells");
  }
  if (field3dInitial.backingWidth < Math.round(field3dInitial.rectWidth) || field3dInitial.backingHeight < Math.round(field3dInitial.rectHeight)) {
    throw new Error("3D volumetric field canvas backing resolution was not initialized");
  }

  // The selected layer must affect the field renderer, and center/slice changes must invalidate its sampling cache.
  await page.evaluate(() => {
    if (window.getWorldField3DState?.()?.field !== "Information") window.setLayer?.(2);
  });
  await page.waitForFunction(() => window.getWorldField3DState?.()?.field === "Information", { timeout: 10000 });
  const originalView = await page.evaluate(() => window.getWorldViewContract());
  await page.evaluate((view) => {
    window.setWorldViewCenter?.(view.center.x + 3, view.center.y, view.center.z - 2);
    window.setWorldViewSliceY?.(view.sliceY + 2);
  }, originalView);
  await page.waitForFunction((view) => {
    const state = window.getWorldField3DState?.();
    return !!state?.ready && state.view.center.x === view.center.x + 3 &&
      state.view.center.z === view.center.z - 2 && state.view.sliceY === view.sliceY + 2;
  }, originalView, { timeout: 10000 });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForFunction(() => {
    const state = window.getWorldField3DState?.();
    const canvas = document.getElementById("c3dField");
    const rect = canvas?.getBoundingClientRect();
    return !!state?.ready && state.renderedCells > 0 && !!rect &&
      canvas.width >= Math.round(rect.width) && canvas.height >= Math.round(rect.height);
  }, { timeout: 10000 });

  // Re-entry must re-render after another view mode hides the field canvas.
  await page.evaluate(() => window.previewRenderMode?.("2d"));
  await page.waitForFunction(() => getComputedStyle(document.getElementById("c3dField")).display === "none");
  await page.evaluate(() => window.previewRenderMode?.("field3d"));
  await page.waitForFunction(() => {
    const state = window.getWorldField3DState?.();
    return !!state?.ready && state.renderedCells > 0 && getComputedStyle(document.getElementById("c3dField")).display !== "none";
  }, { timeout: 10000 });
  await page.evaluate((view) => {
    window.setWorldViewCenter?.(view.center.x, view.center.y, view.center.z);
    window.setWorldViewSliceY?.(view.sliceY);
    window.setLayer?.(0);
    window.previewRenderMode?.("3d");
  }, originalView);

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

  // Contract checks for legacy sculpt are covered in unit tests. Keep the
  // browser acceptance path non-destructive: the public authoritative-field
  // mutation below already exercises field propagation, provenance and refresh.
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


  // Seed a real worker chunk and persist its snapshot before a full page reload.
  // The later restore assertion intentionally uses a fresh JS runtime/empty memory Map.
  await page.waitForFunction(() =>
    typeof window.snapshotWorldFieldChunkPersistence === "function" &&
    typeof window.restoreWorldFieldChunkSnapshot === "function" &&
    typeof window.worldFieldRestoreState === "function" &&
    typeof window.flushWorldFieldChunkPersistence === "function"
  );
  const durableRestoreFixture = await page.evaluate(async () => {
    window.paintChunkAt?.(64, 29, 64, 0, 0.5, 1, "set");
    let workerReady = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      window.tickChunkWorker?.(true, 1);
      if (Number(window.worldFieldWorkerChunkStats?.() ?? 0) > 0) { workerReady = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!workerReady) return { error: "worker fixture never became dirty" };
    const view = window.getWorldViewContract?.();
    if (!view) return { error: "world view contract unavailable" };
    const coord = window.worldFieldChunkCoord?.(view.center.x, view.sliceY, view.center.z);
    if (!coord) return { error: "world chunk coordinate unavailable" };
    const snapshot = window.snapshotWorldFieldChunkPersistence?.(coord.cx, coord.cy, coord.cz);
    const durable = await window.flushWorldFieldChunkPersistence?.();
    if (!snapshot || snapshot.schemaVersion !== 2 || !snapshot.workerChunks?.length) {
      return { error: "valid worker snapshot was not produced", coord, schemaVersion: snapshot?.schemaVersion };
    }
    sessionStorage.setItem("reality-engine-worker-restore-fixture", JSON.stringify({
      coord, checksum: snapshot.checksum, workerView: snapshot.workerView,
      expectedKeys: snapshot.workerChunks.map((chunk) => chunk.key),
    }));
    return { coord, checksum: snapshot.checksum, expected: snapshot.workerChunks.length, durable };
  });
  if (durableRestoreFixture.error || !durableRestoreFixture.durable?.durable ||
      durableRestoreFixture.durable.pending || !durableRestoreFixture.expected) {
    throw new Error(`World field snapshot was not durably committed before reload: ${JSON.stringify(durableRestoreFixture)}`);
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
  await page.evaluate(() => {
    window.lastChunkBrush = null;
    window.applyChunkBrush("Forest", 64, 64, 32, 5, 1, {
      geometry: "shell", falloff: "linear", verticalExtent: "full-column", operation: "add",
    });
  });
  await page.waitForFunction(() => !!window.lastChunkBrush, undefined, { timeout: acceptanceTimeout });
  const brushAck = await page.evaluate(() => window.lastChunkBrush);
  if (
    brushAck?.name !== "Forest" || brushAck?.x !== 64 || brushAck?.y !== 64 ||
    brushAck?.z !== 32 || brushAck?.radius !== 5 ||
    brushAck?.geometry !== "shell" || brushAck?.falloff !== "linear" ||
    brushAck?.verticalExtent !== "full-column" || brushAck?.operation !== "add"
  ) {
    throw new Error("Smart Brush geometry settings did not reach ChunkSimWorker with expected runtime parameters");
  }

  // Earlier law/materialization checks switch panels; restore the Brushes panel that owns brush geometry controls.
  await page.evaluate(() => window.setIconPanel?.("brush"));
  await page.waitForFunction(() => document.querySelector('.icon-btn[data-panel="brush"]')?.classList.contains("active"));

  const brushControls = await page.evaluate(() => ({
    geometry: !!document.getElementById("brushGeometry"),
    falloff: !!document.getElementById("brushFalloff"),
    verticalExtent: !!document.getElementById("brushVerticalExtent"),
    operation: !!document.getElementById("brushOperation"),
  }));
  if (Object.values(brushControls).some(present => !present)) {
    throw new Error(`Brush geometry controls are missing from the workspace: ${JSON.stringify(brushControls)}`);
  }

  // Exercise the real UI path: selected controls -> paintAt -> connector -> worker ACK.
  await page.evaluate(() => {
    window.setRenderMode?.("2d");
    window.selectBrush?.("Forest");
    document.getElementById("brushGeometry").value = "column";
    document.getElementById("brushFalloff").value = "constant";
    document.getElementById("brushVerticalExtent").value = "full-column";
    document.getElementById("brushOperation").value = "add";
    window.lastChunkBrush = null;
  });
  const brushUiPoint = await page.evaluate(() => {
    const wrap = document.getElementById("viewWrap");
    if (!wrap) return { error: "viewWrap missing" };
    const rect = wrap.getBoundingClientRect();
    const cellSize = Math.min(rect.width / window.W, rect.height / window.H);
    const ox = (rect.width - cellSize * window.W) / 2, oy = (rect.height - cellSize * window.H) / 2;
    return { x: rect.left + ox + 20.5 * cellSize, y: rect.top + oy + 20.5 * cellSize };
  });
  if (brushUiPoint.error) throw new Error(brushUiPoint.error);
  await page.mouse.click(brushUiPoint.x, brushUiPoint.y);
  await page.waitForFunction(() => window.lastChunkBrush?.geometry === "column", undefined, { timeout: acceptanceTimeout });
  const brushUiAck = await page.evaluate(() => window.lastChunkBrush);
  if (
    brushUiAck?.falloff !== "constant" ||
    brushUiAck?.verticalExtent !== "full-column" ||
    brushUiAck?.operation !== "add"
  ) {
    throw new Error(`Brush settings from the workspace did not reach the Worker: ${JSON.stringify(brushUiAck)}`);
  }
  console.log("[acceptance] brush geometry UI -> worker contract PASS");

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
    await runtime.undo();
    const undoOneLegacy = fingerprint(legacyBuffer()), undoOneState = world.authoritativeField.serialize();
    await runtime.undo();
    const undoTwoLegacy = fingerprint(legacyBuffer()), undoTwoState = world.authoritativeField.serialize();
    await runtime.redo();
    const redoOneLegacy = fingerprint(legacyBuffer()), redoOneState = world.authoritativeField.serialize();
    await runtime.redo();
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
    await runtime.undo();
    const gestureUndoLegacy = fingerprint(legacyBuffer());
    const gestureUndoState = world.authoritativeField.serialize();
    await runtime.redo();
    const gestureRedoLegacy = fingerprint(legacyBuffer());
    const gestureRedoState = world.authoritativeField.serialize();

    // Hold the first worker ACK to simulate a rapid double-click. A second history
    // operation and a concurrent sculpt mutation must not race the pending transaction.
    const historyBusyBefore = runtime.history();
    const originalUndoChunkSculpt = window.undoChunkSculpt;
    let releaseDelayedUndo = null, delayFirstUndoAck = true;
    window.undoChunkSculpt = () => {
      if (!delayFirstUndoAck) return originalUndoChunkSculpt();
      delayFirstUndoAck = false;
      return new Promise((resolve, reject) => {
        releaseDelayedUndo = () => originalUndoChunkSculpt().then(resolve, reject);
      });
    };
    const firstHistoryOperation = runtime.undo();
    await new Promise(resolve => setTimeout(resolve, 25));
    const secondHistoryResult = await runtime.undo();
    let concurrentMutationRejected = false;
    try {
      await runtime.applyStroke("inject", { x: 20, y: 8, z: 0 }, 1, 0.25, { energy: 1 });
    } catch {
      concurrentMutationRejected = true;
    }
    let firstHistoryResult;
    try {
      if (releaseDelayedUndo) releaseDelayedUndo();
      firstHistoryResult = await firstHistoryOperation;
    } finally {
      window.undoChunkSculpt = originalUndoChunkSculpt;
    }
    const historyBusyAfter = runtime.history();
    const historyBusy = {
      secondOperationBlocked: secondHistoryResult === null,
      concurrentMutationRejected,
      oneRecordConsumed: historyBusyBefore.undo - historyBusyAfter.undo === 1,
      firstOperationCompleted: typeof firstHistoryResult === "string",
    };
    // Restore the fixture so the following persistence assertion compares the
    // same post-Redo field state that was captured before the concurrency probe.
    await runtime.redo();
    return { baselineState, afterSmartState, afterOrdinaryState, undoOneState, undoTwoState, redoOneState, redoTwoState,
      baselineSample, afterSmartSample, afterOrdinarySample, smartMutation, baselineCount, afterSmartCount, afterOrdinaryCount,
      history: mixedHistoryAfterRedo, legacyParity: { undoOne: undoOneLegacy === afterSmartLegacy, undoTwo: undoTwoLegacy === baselineLegacy,
        redoOne: redoOneLegacy === afterSmartLegacy, redoTwo: redoTwoLegacy === afterOrdinaryLegacy },
      historyBusy,
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
  if (!sculptContract.historyBusy?.secondOperationBlocked ||
      !sculptContract.historyBusy?.concurrentMutationRejected ||
      !sculptContract.historyBusy?.oneRecordConsumed ||
      !sculptContract.historyBusy?.firstOperationCompleted) {
    throw new Error(`Concurrent sculpt history was not serialized safely: ${JSON.stringify(sculptContract.historyBusy)}`);
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
  // The brush UI contract switches to 2D; restore 3D before reload because subsequent
  // worker-restore acceptance requires the primary #c3d canvas to be visible.
  await page.evaluate(() => window.setRenderMode?.("3d"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#c3d");
  await page.waitForFunction(() => typeof window.worldGenerationHealth === "function");
  const reloadedSculptState = await page.evaluate(() => window.infiniteWorld?.authoritativeField?.serialize());
  if (JSON.stringify(reloadedSculptState) !== JSON.stringify(persistedSculptState)) {
    throw new Error("Mixed authoritative sculpt persistence did not survive a page reload");
  }

  // Restore the worker snapshot from IndexedDB after reload and prove the ACK/frame
  // barrier completes without publishing partial state during an LRU eviction.
  await page.waitForFunction(() =>
    typeof window.restoreWorldFieldChunkSnapshot === "function" &&
    typeof window.worldFieldRestoreState === "function" &&
    typeof window.worldFieldChunkStoreState === "function"
  );
  const restoreDispatch = await page.evaluate(async () => {
    const raw = sessionStorage.getItem("reality-engine-worker-restore-fixture");
    if (!raw) return { started: false, error: "durable restore fixture metadata missing" };
    const fixture = JSON.parse(raw);
    const { cx, cy, cz } = fixture.coord;
    const targetKey = `${cx},${cy},${cz}`;
    window.populateWorldFieldChunk?.(cx, cy, cz);
    for (const key of window.worldFieldChunkStoreState?.().keys ?? []) {
      if (key === targetKey) continue;
      const [x, y, z] = key.split(",").map(Number);
      window.evictWorldFieldChunk?.(x, y, z);
    }
    for (let i = 0; i < 127; i++) window.populateWorldFieldChunk?.(1000 + i, 0, 0);
    const before = window.worldFieldChunkStoreState?.();
    if (!before?.keys?.includes(targetKey) || before.loaded !== before.capacity) {
      return { started: false, error: "could not establish deterministic LRU fixture", before };
    }
    const started = await window.restoreWorldFieldChunkSnapshot?.(cx, cy, cz);
    if (!started) return { started: false, error: "durable snapshot failed to load or validate" };
    // The restore target is oldest; force its eviction while the worker barrier is active.
    window.populateWorldFieldChunk?.(2000, 0, 0);
    const after = window.worldFieldChunkStoreState?.();
    return { started, targetRetained: after?.keys?.includes(targetKey) ?? true, fixture };
  });
  if (!restoreDispatch.started) {
    throw new Error(`Durable worker restore could not start after reload: ${JSON.stringify(restoreDispatch)}`);
  }
  if (restoreDispatch.targetRetained) {
    throw new Error("LRU stress did not evict the active worker restore target");
  }
  await page.waitForFunction(() => {
    const state = window.worldFieldRestoreState?.();
    return state?.workerBarrierComplete === true || state?.unexpectedAcks > 0;
  }, undefined, { timeout: acceptanceTimeout });
  const restoreBarrier = await page.evaluate(() => window.worldFieldRestoreState?.());
  const expectedFixtureKeys = [...(restoreDispatch.fixture?.expectedKeys ?? [])].sort((a, b) => a - b);
  if (JSON.stringify([...restoreBarrier.expectedKeys].sort((a, b) => a - b)) !== JSON.stringify(expectedFixtureKeys)) {
    throw new Error("Restored worker chunk keys do not match the durable pre-reload snapshot");
  }
  if (!restoreBarrier?.complete ||
      restoreBarrier.acknowledged !== restoreBarrier.expected ||
      restoreBarrier.duplicateAcks !== 0 ||
      restoreBarrier.unexpectedAcks !== 0 ||
      restoreBarrier.unexpectedFrames !== 0 ||
      Number(restoreBarrier.tombstonesApplied) <= 0 ||
      JSON.stringify([...restoreBarrier.expectedKeys].sort((a, b) => a - b)) !==
        JSON.stringify([...restoreBarrier.restoreFrameKeys].sort((a, b) => a - b))) {
    throw new Error(`Worker restore ACK/frame barrier failed after reload: ${JSON.stringify(restoreBarrier)}`);
  }
  const durableAfterReload = await page.evaluate(() => window.flushWorldFieldChunkPersistence?.());
  if (!durableAfterReload?.durable || durableAfterReload.pending) {
    throw new Error(`World field persistence was not durable after restore: ${JSON.stringify(durableAfterReload)}`);
  }

  // Restoring after an intentional LRU eviction must rehydrate both durable
  // storage and the bounded runtime chunk store without changing worker data.
  const workerRestoreRoundTrip = await page.evaluate(async () => {
    const raw = sessionStorage.getItem("reality-engine-worker-restore-fixture");
    if (!raw) return { error: "durable restore fixture metadata missing" };
    const fixture = JSON.parse(raw);
    const { cx, cy, cz } = fixture.coord;
    const storeKey = `${cx},${cy},${cz}`;
    const before = window.loadWorldFieldChunkSnapshot?.(cx, cy, cz);
    if (!before?.workerChunks?.length) return { error: "durable worker snapshot missing after restore" };
    const beforeValid = !!window.validateWorldFieldChunkSnapshot?.(before);
    const beforeChecksum = before.checksum;
    const beforeKeys = before.workerChunks.map((chunk) => chunk.key).sort((a, b) => a - b);
    const expectedKeys = [...(fixture.expectedKeys ?? [])].sort((a, b) => a - b);
    const storeBefore = window.worldFieldChunkStoreState?.();
    const storeRehydrated = !!storeBefore?.keys?.includes(storeKey);

    const after = window.snapshotWorldFieldChunkPersistence?.(cx, cy, cz, before.seed);
    const durable = await window.flushWorldFieldChunkPersistence?.();
    const afterValid = !!after && !!window.validateWorldFieldChunkSnapshot?.(after);
    const afterKeys = after?.workerChunks?.map((chunk) => chunk.key).sort((a, b) => a - b) ?? [];
    const exact = !!after &&
      before.workerChunks.length === after.workerChunks.length &&
      beforeKeys.length === afterKeys.length &&
      beforeKeys.every((key, i) => key === afterKeys[i]) &&
      before.workerChunks.every((chunk, i) => {
        const other = after.workerChunks[i];
        return !!other && chunk.key === other.key &&
          chunk.data.length === other.data.length &&
          chunk.data.every((value, j) => Math.abs(value - other.data[j]) <= 1e-6);
      });
    const storeAfter = window.worldFieldChunkStoreState?.();
    return {
      beforeValid,
      afterValid,
      beforeChecksum,
      fixtureChecksum: fixture.checksum,
      afterChecksum: after?.checksum,
      expectedKeySetMatches: JSON.stringify(beforeKeys) === JSON.stringify(expectedKeys),
      exact,
      storeRehydrated,
      storeHasTargetAfterRoundTrip: !!storeAfter?.keys?.includes(storeKey),
      storeWithinCapacity: !!storeAfter && storeAfter.loaded <= storeAfter.capacity,
      durable,
    };
  });
  if (
    workerRestoreRoundTrip.error ||
    !workerRestoreRoundTrip.beforeValid ||
    !workerRestoreRoundTrip.afterValid ||
    workerRestoreRoundTrip.beforeChecksum !== workerRestoreRoundTrip.fixtureChecksum ||
    workerRestoreRoundTrip.afterChecksum !== workerRestoreRoundTrip.beforeChecksum ||
    !workerRestoreRoundTrip.expectedKeySetMatches ||
    !workerRestoreRoundTrip.exact ||
    !workerRestoreRoundTrip.storeRehydrated ||
    !workerRestoreRoundTrip.storeHasTargetAfterRoundTrip ||
    !workerRestoreRoundTrip.storeWithinCapacity ||
    !workerRestoreRoundTrip.durable?.durable ||
    workerRestoreRoundTrip.durable.pending
  ) {
    throw new Error(`Worker restore persistence/store round-trip failed: ${JSON.stringify(workerRestoreRoundTrip)}`);
  }



  // Restore adjacent world chunks one at a time (the current restore contract
  // serializes operations) and verify that x/y/z field seams remain paired.
  const restoredChunkSeamContract = await page.evaluate(async () => {
    const raw = sessionStorage.getItem("reality-engine-worker-restore-fixture");
    if (!raw) return { error: "durable restore fixture metadata missing" };
    const fixture = JSON.parse(raw);
    const { cx, cy, cz } = fixture.coord;
    const coords = [
      [cx, cy, cz],
      [cx + 1, cy, cz],
      [cx, cy + 1, cz],
      [cx, cy, cz + 1],
    ];
    const view = window.getWorldViewContract?.();
    if (!view) return { error: "world view contract unavailable for seam fixture" };

    // Ensure each world chunk intersects a worker cell that is persisted in its snapshot.
    for (const [chunkX, chunkY, chunkZ] of coords) {
      const worldX = chunkX * 32 + 16;
      const worldY = chunkY * 32 + 16;
      const worldZ = chunkZ * 32 + 16;
      const workerX = Math.round(worldX - view.center.x + 64);
      const workerY = Math.round(worldY - view.center.y + 64 * 0.45);
      const workerZ = Math.round(worldZ - view.center.z + 64);
      window.paintChunkAt?.(workerX, workerY, workerZ, 0, 0.25, 2, "add");
      window.populateWorldFieldChunk?.(chunkX, chunkY, chunkZ);
    }

    let snapshots = [];
    for (let attempt = 0; attempt < 80; attempt++) {
      window.tickChunkWorker?.(true, 1);
      snapshots = coords.map(([chunkX, chunkY, chunkZ]) =>
        window.snapshotWorldFieldChunkPersistence?.(chunkX, chunkY, chunkZ));
      if (snapshots.every(snapshot =>
        !!snapshot &&
        snapshot.schemaVersion === 2 &&
        !!snapshot.workerChunks?.length &&
        window.validateWorldFieldChunkSnapshot?.(snapshot))) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const validSnapshots = snapshots.every(snapshot =>
      !!snapshot &&
      snapshot.schemaVersion === 2 &&
      !!snapshot.workerChunks?.length &&
      window.validateWorldFieldChunkSnapshot?.(snapshot));
    if (!validSnapshots) {
      return {
        error: "could not persist complete adjacent worker chunk snapshots",
        savedChunks: snapshots.map(snapshot => snapshot?.workerChunks?.length ?? 0),
      };
    }
    const durable = await window.flushWorldFieldChunkPersistence?.();
    if (!durable?.durable || durable.pending) {
      return { error: "adjacent worker chunk snapshots were not durably committed", durable };
    }

    const axes = [
      { axis: "x", base: coords[0], next: coords[1] },
      { axis: "y", base: coords[0], next: coords[2] },
      { axis: "z", base: coords[0], next: coords[3] },
    ];
    const validateSeams = () => axes.map(({ axis, base, next }) => {
      const left = window.snapshotWorldFieldBoundary?.(
        base[0], base[1], base[2], axis, 1, 8,
      );
      const right = window.snapshotWorldFieldBoundary?.(
        next[0], next[1], next[2], axis, -1, 8,
      );
      return {
        axis,
        leftPublished: !!left,
        rightPublished: !!right,
        ...window.validateWorldFieldBoundary?.(base[0], base[1], base[2], axis),
      };
    });
    const beforeRestore = validateSeams();
    for (const [chunkX, chunkY, chunkZ] of coords) {
      window.evictWorldFieldChunk?.(chunkX, chunkY, chunkZ);
    }

    const restored = [];
    for (const [chunkX, chunkY, chunkZ] of coords) {
      const started = await window.restoreWorldFieldChunkSnapshot?.(chunkX, chunkY, chunkZ);
      if (!started) {
        return { error: "adjacent worker chunk restore was rejected", coords, restored };
      }
      let state;
      for (let attempt = 0; attempt < 600; attempt++) {
        state = window.worldFieldRestoreState?.();
        if (state?.complete === true) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      state = window.worldFieldRestoreState?.();
      if (!state?.complete ||
          state.acknowledged !== state.expected ||
          state.duplicateAcks !== 0 ||
          state.unexpectedAcks !== 0 ||
          state.unexpectedFrames !== 0 ||
          state.staleAcks !== 0 ||
          state.staleFrames !== 0) {
        return {
          error: "adjacent worker chunk restore did not pass the ACK/frame barrier",
          coords: [chunkX, chunkY, chunkZ],
          state,
          restored,
        };
      }
      restored.push({
        coord: [chunkX, chunkY, chunkZ],
        expected: state.expected,
        acknowledged: state.acknowledged,
        complete: state.complete,
      });
    }
    const afterRestore = validateSeams();
    return {
      validSnapshots,
      savedChunks: snapshots.map(snapshot => snapshot?.workerChunks?.length ?? 0),
      durable,
      beforeRestore,
      afterRestore,
      restored,
    };
  });
  // The boundary exchange contract defines "paired" as two published faces
  // with matching sample counts. maxDelta is a diagnostic of the values across
  // separate live chunk providers, not an equality guarantee: streamed worker
  // state can differ from the analytic fallback at a chunk edge.
  const seamSetIsValid = seams => Array.isArray(seams) && seams.length === 3 &&
    seams.every(seam =>
      seam.leftPublished &&
      seam.rightPublished &&
      seam.paired === true &&
      seam.samples === 64 &&
      Number.isFinite(seam.maxDelta) &&
      seam.maxDelta >= 0);
  if (
    restoredChunkSeamContract.error ||
    !restoredChunkSeamContract.validSnapshots ||
    !restoredChunkSeamContract.durable?.durable ||
    restoredChunkSeamContract.durable.pending ||
    restoredChunkSeamContract.savedChunks?.some(count => count < 1) ||
    restoredChunkSeamContract.restored?.length !== 4 ||
    restoredChunkSeamContract.restored.some(result =>
      !result.complete || result.expected !== result.acknowledged) ||
    !seamSetIsValid(restoredChunkSeamContract.beforeRestore) ||
    !seamSetIsValid(restoredChunkSeamContract.afterRestore)
  ) {
    throw new Error("Cross-chunk seam validation failed after persistence eviction/restore: " + JSON.stringify(restoredChunkSeamContract));
  }


  // The restore lock must be acquired before awaiting IndexedDB: overlapping
  // dispatches otherwise pass the same pre-await guard and race their restore IDs.
  const overlappingRestoreGuard = await page.evaluate(async () => {
    const raw = sessionStorage.getItem("reality-engine-worker-restore-fixture");
    if (!raw) return { error: "durable restore fixture metadata missing" };
    const { coord } = JSON.parse(raw);
    const before = window.worldFieldRestoreState?.();
    const results = await Promise.all([
      window.restoreWorldFieldChunkSnapshot?.(coord.cx, coord.cy, coord.cz),
      window.restoreWorldFieldChunkSnapshot?.(coord.cx, coord.cy, coord.cz),
    ]);
    return { results, beforeRestoreId: before?.restoreId };
  });
  if (overlappingRestoreGuard.error ||
      overlappingRestoreGuard.results?.[0] !== true ||
      overlappingRestoreGuard.results?.[1] !== false) {
    throw new Error(`Overlapping worker restore requests were not serialized: ${JSON.stringify(overlappingRestoreGuard)}`);
  }
  await page.waitForFunction(() => window.worldFieldRestoreState?.()?.complete === true, undefined, { timeout: acceptanceTimeout });
  const serializedRestoreState = await page.evaluate(() => window.worldFieldRestoreState?.());
  if (!serializedRestoreState?.complete ||
      serializedRestoreState.restoreId !== overlappingRestoreGuard.beforeRestoreId + 1 ||
      serializedRestoreState.acknowledged !== serializedRestoreState.expected ||
      serializedRestoreState.staleAcks !== 0 ||
      serializedRestoreState.staleFrames !== 0 ||
      serializedRestoreState.duplicateAcks !== 0 ||
      serializedRestoreState.unexpectedAcks !== 0 ||
      serializedRestoreState.unexpectedFrames !== 0) {
    throw new Error(`Serialized worker restore corrupted ACK/frame accounting: ${JSON.stringify(serializedRestoreState)}`);
  }

  // A normal worker mutation queued during a live restore must not be counted
  // as a restore ACK/frame or invalidate the restore's expected key set.
  const mutationDuringRestoreDispatch = await page.evaluate(async () => {
    const raw = sessionStorage.getItem("reality-engine-worker-restore-fixture");
    if (!raw) return { started: false, error: "durable restore fixture metadata missing" };
    const { coord } = JSON.parse(raw);
    const started = await window.restoreWorldFieldChunkSnapshot?.(coord.cx, coord.cy, coord.cz);
    if (!started) return { started: false, error: "durable snapshot restore was rejected" };
    const restoreId = window.worldFieldRestoreState?.()?.restoreId;
    window.paintChunkAt?.(64, 29, 64, 0, 0.5, 1, "add");
    return { started, restoreId };
  });
  if (!mutationDuringRestoreDispatch.started ||
      mutationDuringRestoreDispatch.restoreId !== serializedRestoreState.restoreId + 1) {
    throw new Error(`Mutation-vs-restore setup failed: ${JSON.stringify(mutationDuringRestoreDispatch)}`);
  }
  await page.waitForFunction(() => window.worldFieldRestoreState?.()?.complete === true,
    undefined, { timeout: acceptanceTimeout });
  const restoreAccountingAfterMutation = await page.evaluate(async () => {
    const before = window.worldFieldRestoreState?.();
    window.paintChunkAt?.(64, 29, 64, 0, 1, 1, "add");
    await new Promise((resolve) => setTimeout(resolve, 250));
    const after = window.worldFieldRestoreState?.();
    return {
      restoreId: before?.restoreId,
      expected: before?.expected,
      acknowledged: before?.acknowledged,
      frameKeys: before?.restoreFrameKeys ?? [],
      complete: before?.complete,
      workerBarrierComplete: before?.workerBarrierComplete,
      afterRestoreId: after?.restoreId,
      afterExpected: after?.expected,
      afterAcknowledged: after?.acknowledged,
      afterFrameKeys: after?.restoreFrameKeys ?? [],
      afterComplete: after?.complete,
      afterWorkerBarrierComplete: after?.workerBarrierComplete,
      staleAcks: after?.staleAcks,
      staleFrames: after?.staleFrames,
      duplicateAcks: after?.duplicateAcks,
      unexpectedAcks: after?.unexpectedAcks,
      unexpectedFrames: after?.unexpectedFrames,
    };
  });
  if (
    restoreAccountingAfterMutation.restoreId !== restoreAccountingAfterMutation.afterRestoreId ||
    restoreAccountingAfterMutation.expected !== restoreAccountingAfterMutation.afterExpected ||
    restoreAccountingAfterMutation.acknowledged !== restoreAccountingAfterMutation.afterAcknowledged ||
    JSON.stringify(restoreAccountingAfterMutation.frameKeys) !== JSON.stringify(restoreAccountingAfterMutation.afterFrameKeys) ||
    restoreAccountingAfterMutation.complete !== true ||
    restoreAccountingAfterMutation.afterComplete !== true ||
    restoreAccountingAfterMutation.workerBarrierComplete !== true ||
    restoreAccountingAfterMutation.afterWorkerBarrierComplete !== true ||
    restoreAccountingAfterMutation.staleAcks !== 0 ||
    restoreAccountingAfterMutation.staleFrames !== 0 ||
    restoreAccountingAfterMutation.duplicateAcks !== 0 ||
    restoreAccountingAfterMutation.unexpectedAcks !== 0 ||
    restoreAccountingAfterMutation.unexpectedFrames !== 0
  ) {
    throw new Error(`Worker mutation contaminated restore accounting: ${JSON.stringify(restoreAccountingAfterMutation)}`);
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

  // Exercise the opt-in greedy mesher on the active sparse-chunk renderer.
  // Restore the prior view immediately so this probe does not affect generation checks.
  const greedySurfaceContract = await page.evaluate(() => {
    if (typeof window.getGreedyMeshingState !== "function" ||
        typeof window.setGreedyMeshingEnabled !== "function" ||
        typeof window.setFieldMatMode !== "function") {
      return { error: "Greedy surface renderer controls are not exposed" };
    }
    const before = window.getGreedyMeshingState();
    let result;
    try {
      window.setFieldMatMode("material");
      window.setGreedyMeshingEnabled(true);
      result = window.getGreedyMeshingState();
    } finally {
      window.setGreedyMeshingEnabled(false);
      window.setFieldMatMode(before.mode || "field");
    }
    return { before, result, restored: window.getGreedyMeshingState() };
  });
  if (greedySurfaceContract.error) throw new Error(greedySurfaceContract.error);
  if (!greedySurfaceContract.result?.enabled ||
      !greedySurfaceContract.result?.active ||
      greedySurfaceContract.result.quadCount <= 0) {
    throw new Error("Greedy surface renderer did not produce an active non-empty mesh: " + JSON.stringify(greedySurfaceContract));
  }
  if (greedySurfaceContract.restored?.enabled !== false) {
    throw new Error("Greedy surface probe did not restore the legacy instanced renderer");
  }

  // Exercise the real UI toggle, visible canvas, render loop, and return path.
  const greedyPreviewUI = await page.evaluate(() => {
    const button = document.getElementById("greedySurfaceBtn");
    const previousMode = window.currentRenderMode;
    if (!button || typeof window.toggleGreedySurfacePreview !== "function" ||
        typeof window.fieldSetMatMode !== "function") {
      return { error: "Greedy surface preview UI is not wired" };
    }
    // Start from field-color mode so the UI must explicitly select material mode.
    window.fieldSetMatMode("field");
    button.click();
    const activeState = window.getGreedyMeshingState?.();
    const active = {
      mode: window.currentRenderMode,
      buttonPressed: button.getAttribute("aria-pressed"),
      chunkCanvasDisplay: getComputedStyle(document.getElementById("c3dChunkField")).display,
      authoritativeCanvasDisplay: getComputedStyle(document.getElementById("c3dField")).display,
      activeState,
      rendererMode: window.getGreedyMeshingState?.()?.mode,
    };
    button.click();
    const restored = {
      mode: window.currentRenderMode,
      buttonPressed: button.getAttribute("aria-pressed"),
      chunkCanvasDisplay: getComputedStyle(document.getElementById("c3dChunkField")).display,
      authoritativeCanvasDisplay: getComputedStyle(document.getElementById("c3dField")).display,
      greedyState: window.getGreedyMeshingState?.(),
    };
    return { previousMode, active, restored };
  });
  if (greedyPreviewUI.error) throw new Error(greedyPreviewUI.error);
  if (greedyPreviewUI.active.mode !== "field3d" ||
      greedyPreviewUI.active.buttonPressed !== "true" ||
      greedyPreviewUI.active.chunkCanvasDisplay === "none" ||
      greedyPreviewUI.active.authoritativeCanvasDisplay !== "none" ||
      !greedyPreviewUI.active.activeState?.active ||
      greedyPreviewUI.active.rendererMode !== "material" ||
      greedyPreviewUI.active.activeState.quadCount <= 0) {
    throw new Error("Greedy preview UI did not expose the active mesh canvas: " + JSON.stringify(greedyPreviewUI));
  }
  if (greedyPreviewUI.restored.mode !== greedyPreviewUI.previousMode ||
      greedyPreviewUI.restored.buttonPressed !== "false" ||
      greedyPreviewUI.restored.chunkCanvasDisplay !== "none" ||
      greedyPreviewUI.restored.greedyState?.enabled !== false) {
    throw new Error("Greedy preview UI did not restore the previous renderer: " + JSON.stringify(greedyPreviewUI));
  }

  const before = await page.evaluate(() => window.worldGenerationHealth());
  console.log("[acceptance] Quick Generate");
  await page.getByRole("button", { name: /Quick Generate/ }).click();
  await page.waitForFunction((b) => {
    const a = window.worldGenerationHealth();
    return Number(a?.lastGeneration?.generationRevision ?? 0) > Number(b?.lastGeneration?.generationRevision ?? 0);
  }, before, { timeout: acceptanceTimeout });

  const quickResult = await page.evaluate((beforeState) => ({
    after: window.worldGenerationHealth(),
    verification: window.worldVerifyGeneration?.(beforeState),
  }), before);
  const afterQuick = quickResult.after;
  if (!quickResult.verification?.ok || !quickResult.verification?.generationAdvanced ||
      Number(afterQuick?.stats?.objects ?? 0) <= 0) {
    throw new Error("Quick Generate did not prove a new non-empty world generation: " + JSON.stringify(quickResult));
  }

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

  const beforeCompose = await composePage.evaluate(() => window.worldGenerationHealth());
  console.log("[acceptance] Compose World");
  await composePage.getByRole("button", { name: /Compose World/ }).click();
  await composePage.waitForSelector("#comp.open");
  if (!(await composePage.locator("#comp").innerText()).includes("Integral Reality Composer")) {
    throw new Error("Compose World opened without the Integral Reality Composer");
  }
  for (let i = 0; i < 4; i++) await composePage.locator("#cnext").click();
  console.log("[acceptance] Generate Reality");
  await composePage.getByRole("button", { name: /Generate Reality/ }).click({ timeout: acceptanceTimeout });
  await composePage.waitForFunction((beforeState) => {
    const health = window.worldGenerationHealth();
    return Number(health?.lastGeneration?.generationRevision ?? 0) > Number(beforeState?.lastGeneration?.generationRevision ?? 0);
  }, beforeCompose, { timeout: acceptanceTimeout });

  const composeResult = await composePage.evaluate((beforeState) => ({
    after: window.worldGenerationHealth(),
    verification: window.worldVerifyGeneration?.(beforeState),
    worldSeed: window.infiniteWorld?.generator?.seed ?? null,
    viewSeed: window.getWorldViewContract?.()?.seed ?? null,
  }), beforeCompose);
  if (!composeResult.worldSeed || composeResult.viewSeed !== composeResult.worldSeed) {
    throw new Error("Compose World did not synchronize the WorldViewContract seed: " + JSON.stringify({worldSeed:composeResult.worldSeed,viewSeed:composeResult.viewSeed}));
  }
  const afterCompose = composeResult.after;
  if (!composeResult.verification?.ok || !composeResult.verification?.generationAdvanced ||
      Number(afterCompose?.stats?.objects ?? 0) <= 0) {
    throw new Error("Compose World did not prove a new non-empty world generation: " + JSON.stringify(composeResult));
  }
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
  // Do not cancel the fallback exit timer after the browser-close grace period.
  // A failed assertion can leave nested preview/worker handles alive; those must
  // not keep CI running until the outer 180-second timeout.
  try {
    await Promise.race([
      browser.close(),
      new Promise((resolve) => setTimeout(resolve, 4500)),
    ]);
  } catch {
    // The original acceptance failure remains authoritative.
  }
}
// CI retrigger marker: acceptance lifecycle fix is validated on the current branch head.
