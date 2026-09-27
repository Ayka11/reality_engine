import { chromium } from "playwright";
import { spawn } from "node:child_process";

const port = 4173;
const server = spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", String(port)], {
  stdio: ["ignore", "pipe", "pipe"],
  shell: process.platform === "win32",
  detached: process.platform !== "win32",
});

function terminateServerTree() {
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else if (server.pid) {
      process.kill(-server.pid, "SIGTERM");
    }
  } catch {
    try { server.kill("SIGTERM"); } catch {}
  }
}

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
const overallTimeout = Number(process.env.ACCEPTANCE_OVERALL_TIMEOUT || 120000);
const watchdog = setTimeout(() => {
  console.error("[acceptance] WATCHDOG TIMEOUT: acceptance exceeded overall timeout");
  terminateServerTree();
  process.exit(124);
}, overallTimeout);
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
  await page.waitForFunction(() => typeof window.infinityBuildZoneCost === "function");
  await page.waitForFunction(() => typeof window.infinityBuildZoneCost === "function");

  // Materialize a real Infinite World terrain patch before switching render modes.
  await page.evaluate(() => window.focusGeneratedWorld?.());
  await page.waitForFunction(() => {
    const patches = window.worldTerrainPatchStats?.();
    const geometry = window.worldTerrainGeometrySignature?.();
    return Number(patches?.patchCount ?? 0) > 0 && Number(geometry?.vertexCount ?? 0) > 0;
  }, undefined, { timeout: acceptanceTimeout });
  const terrainSmoke = await page.evaluate(() => ({
    patches: window.worldTerrainPatchStats?.(),
    geometry: window.worldTerrainGeometrySignature?.(),
  }));
  if (Number(terrainSmoke.geometry?.vertexCount ?? 0) <= 0) throw new Error("Infinite World terrain geometry did not materialize");

  // Phase 3 spatial chunk-address contract through the production runtime surface.
  const chunkContract = await page.evaluate(() => {
    const cases = [
      [0, 0, 0, '0,0,0'], [31.999, 0, 31.999, '0,0,0'], [32, 0, 32, '1,0,1'],
      [-0.001, 0, -0.001, '-1,0,-1'], [-32, 0, -32, '-1,0,-1'], [-32.001, 0, -32.001, '-2,0,-2'],
    ];
    const mapped = cases.map(([x,y,z,key]) => ({ input:[x,y,z], key: window.worldFieldChunkCoord?.(x,y,z), expected:key }));
    const boundariesOk = mapped.every((v) => v.key && `${v.key.cx},${v.key.cy},${v.key.cz}` === v.expected);
    for (let i = 0; i < 130; i++) window.populateWorldFieldChunk?.(i, 0, 0, 'acceptance-seed');
    const stats = window.worldFieldChunkStoreStats?.();
    const pa = window.sampleWorldFieldChunk?.(4*32+7,-2*32+9,7*32+11,'acceptance-seed');
    const pb = window.sampleWorldFieldChunk?.(4*32+7,-2*32+9,7*32+11,'acceptance-seed');
    const pc = window.sampleWorldFieldChunk?.(5*32+7,-2*32+9,7*32+11,'acceptance-seed');
    return { boundariesOk, mapped, loaded: stats?.loaded, capacity: stats?.capacity, evictions: stats?.evictions,
      deterministic: JSON.stringify(pa) === JSON.stringify(pb), finite: pa && Object.values(pa).every(Number.isFinite), differentAddress: JSON.stringify(pa) !== JSON.stringify(pc) };
  });
  if (!chunkContract.boundariesOk) throw new Error('World field chunk coordinate boundary contract failed');
  if (chunkContract.loaded > chunkContract.capacity) throw new Error('World field chunk store exceeded bounded capacity');
  const persistenceContract = await page.evaluate(() => {
    const values = [0.125, 1.5, -0.25, 7.75, 0.001];
    const saved = window.saveWorldFieldChunkSnapshot?.(4, -2, 7, values, 'acceptance-seed', 2);
    const loaded = window.loadWorldFieldChunkSnapshot?.(4, -2, 7);
    const valid = !!loaded && window.validateWorldFieldChunkSnapshot?.(loaded);
    const same = JSON.stringify(loaded?.values) === JSON.stringify(values);
    const tampered = loaded ? { ...loaded, values: [...loaded.values, 99] } : null;
    const tamperRejected = tampered ? !window.validateWorldFieldChunkSnapshot?.(tampered) : false;
    return { schemaVersion: saved?.schemaVersion, valid, same, tamperRejected };
  });
  if (persistenceContract.schemaVersion !== 1 || !persistenceContract.valid || !persistenceContract.same || !persistenceContract.tamperRejected) throw new Error('Streamed chunk persistence round-trip contract failed');
  if (chunkContract.evictions < 1) throw new Error('World field chunk store did not evict at capacity');
  const streamedSnapshot = await page.evaluate(() => {
    const saved = window.snapshotWorldFieldChunkPersistence?.(0, 0, 0, 'acceptance-seed');
    return { schemaVersion: saved?.schemaVersion, workerChunks: saved?.workerChunks?.length ?? 0, valid: saved ? window.validateWorldFieldChunkSnapshot?.(saved) : false };
  });
  if (streamedSnapshot.schemaVersion !== 2 || streamedSnapshot.workerChunks < 1 || !streamedSnapshot.valid) throw new Error('Atomic multi-worker world chunk snapshot contract failed');
  if (!chunkContract.deterministic || !chunkContract.finite || !chunkContract.differentAddress) throw new Error('Deterministic streamed field chunk replay contract failed');
  const restoreContract = await page.evaluate(() => {
    const count = 512 * 14
    const values = new Array(count).fill(42.5)
    const saved = window.saveWorldFieldChunkSnapshot?.(0, 0, 0, values, 'acceptance-seed', 2)
    for (let i = 0; i < 130; i++) window.populateWorldFieldChunk?.(i + 200, 0, 0, 'acceptance-seed')
    const restored = window.restoreWorldFieldChunkSnapshot?.(0, 0, 0)
    return { saved: !!saved, restored: !!restored }
  });
  if (!restoreContract.saved || !restoreContract.restored) throw new Error('Persisted worker chunk restore was not accepted');
  await page.waitForFunction(() => {
    const sample = window.sampleWorldFieldChunkAt?.(0, 0, 0, 0, 0, 0, 'acceptance-seed');
    return Number.isFinite(sample?.energy) && Math.abs((sample?.energy ?? 0) - 42.5) < 1e-6;
  }, undefined, { timeout: acceptanceTimeout });
  const restoredSample = await page.evaluate(() => window.sampleWorldFieldChunkAt?.(0, 0, 0, 0, 0, 0, 'acceptance-seed'));
  if (Math.abs((restoredSample?.energy ?? 0) - 42.5) > 1e-6 || Math.abs((restoredSample?.density ?? 0) - 42.5) > 1e-6) {
    throw new Error('Restored worker chunk does not match persisted payload');
  }
  const boundaryContract = await page.evaluate(() => {
    const axes = [
      ['x', [0,0,0], [1,0,0]], ['y', [0,0,0], [0,1,0]], ['z', [0,0,0], [0,0,1]],
    ];
    const results = axes.map(([axis, base, next]) => {
      window.snapshotWorldFieldBoundary?.(base[0],base[1],base[2],axis,1,8,'acceptance-seed');
      window.snapshotWorldFieldBoundary?.(next[0],next[1],next[2],axis,-1,8,'acceptance-seed');
      return { axis, ...window.validateWorldFieldBoundary?.(base[0],base[1],base[2],axis) };
    });
    return { results, allSame: results.every((v) => v.paired && v.samples === 64 && v.maxDelta === 0) };
  });

  if (!boundaryContract?.allSame) throw new Error('Cross-chunk boundary continuity contract failed');
  const restoredSeams = await page.evaluate(() => {
    const coords = [[0,0,0],[1,0,0],[0,1,0],[0,0,1]];
    const saved = coords.map(([cx,cy,cz]) => window.snapshotWorldFieldChunkPersistence?.(cx,cy,cz,'acceptance-seed'));
    const validBefore = saved.every(s => s?.schemaVersion === 2 && window.validateWorldFieldChunkSnapshot?.(s));
    coords.forEach(([cx,cy,cz]) => window.evictWorldFieldChunk?.(cx,cy,cz));
    const restored = coords.map(([cx,cy,cz]) => window.restoreWorldFieldChunkSnapshot?.(cx,cy,cz));
    const axes = [
      ['x',[0,0,0]], ['y',[0,0,0]], ['z',[0,0,0]],
    ];
    const results = axes.map(([axis, base]) => ({ axis, ...window.validateWorldFieldBoundary?.(base[0],base[1],base[2],axis) }));
    return { validBefore, savedChunks: saved.map(s => s?.workerChunks?.length ?? 0), restored, results };
  });
  await page.waitForFunction(() => {
    const state = window.worldFieldRestoreState?.();
    return !!state && state.complete === true;
  }, null, { timeout: 15000 });
  const restoreAck = await page.evaluate(() => window.worldFieldRestoreState?.());
  const expectedKeys = new Set(restoreAck?.expectedKeys ?? []);
  const acknowledgedKeys = new Set(restoreAck?.keys ?? []);
  const exactKeySet =
    expectedKeys.size > 0 &&
    expectedKeys.size === acknowledgedKeys.size &&
    [...expectedKeys].every((key) => acknowledgedKeys.has(key));
  if (
    !restoreAck ||
    !restoreAck.complete ||
    restoreAck.acknowledged !== restoreAck.expected ||
    !exactKeySet ||
    restoreAck.duplicateAcks !== 0 ||
    restoreAck.unexpectedAcks !== 0 ||
    restoreAck.staleAcks !== 0
  ) {
    throw new Error('Worker restore acknowledgement contract failed');
  }
  if (!restoredSeams.validBefore || restoredSeams.savedChunks.some(n => n < 1) || restoredSeams.restored.some(v => !v) || restoredSeams.results.some(v => !v.paired || v.samples !== 64 || v.maxDelta > 1e-6)) {
    throw new Error('Cross-chunk seam validation failed after persistence eviction/restore');
  }


  // Docked workspace regression: detachable sidebar chrome was removed.
  const workspaceChrome = await page.evaluate(() => ({
    leftToggle: !!document.getElementById("btnToggleLeft"),
    leftGrip: !!document.getElementById("leftWorkspaceGrip"),
    rightGrip: !!document.getElementById("rightWorkspaceGrip"),
    leftFloating: document.getElementById("left")?.classList.contains("workspace-floating"),
    rightFloating: document.getElementById("right")?.classList.contains("workspace-floating"),
    leftText: document.getElementById("left")?.innerText || ""
  }));
  if (workspaceChrome.leftToggle || workspaceChrome.leftGrip || workspaceChrome.rightGrip) {
    throw new Error("Obsolete detachable sidebar controls are still present");
  }
  if (workspaceChrome.leftFloating || workspaceChrome.rightFloating) {
    throw new Error("Workspace panels must remain docked");
  }
  if (/LEFT\\s*·\\s*DRAG|RIGHT\\s*·\\s*DRAG/i.test(workspaceChrome.leftText)) {
    throw new Error("Obsolete sidebar drag text is still rendered");
  }

  // Render-mode smoke matrix: each mode must own the expected canvas surface.
  const modeChecks = [
    ["3d", "#tab3d"],
    ["field3d", "#tabField3d"],
    ["2d", "#tab2d"],
    ["hybrid", "#tabHybrid"],
  ];
  for (const [mode, selector] of modeChecks) {
    await page.locator(selector).click();
    await page.waitForFunction((m) => window.currentRenderMode === m || document.querySelector("#tabs .ctab.on")?.id?.toLowerCase().includes(m === "field3d" ? "field3d" : m), mode);
    const surfaces = await page.evaluate(() => {
      const display = (id) => getComputedStyle(document.getElementById(id)).display;
      const rect = (id) => {
        const r = document.getElementById(id)?.getBoundingClientRect();
        return r ? { x:r.x, y:r.y, width:r.width, height:r.height } : null;
      };
      return {
        c3d: display("c3d"),
        field3d: display("c3dField"),
        c2d: display("c2d"),
        c3dRect: rect("c3d"),
        field3dRect: rect("c3dField"),
        c2dRect: rect("c2d"),
      };
    });
    if (mode === "3d" && !(surfaces.c3d === "block" && surfaces.c2d === "none" && surfaces.field3d === "none")) {
      throw new Error("3D Infinite World surface routing is incorrect");
    }
    if (mode === "field3d" && !(surfaces.field3d === "block" && surfaces.c3d === "none" && surfaces.c2d === "none")) {
      throw new Error("3D Volumetric Field surface routing is incorrect");
    }
    if (mode === "2d" && !(surfaces.c2d === "block" && surfaces.c3d === "none" && surfaces.field3d === "none")) {
      throw new Error("2D Multi-Slice surface routing is incorrect");
    }
    if (mode === "hybrid" && !(surfaces.c2d === "block" && surfaces.c3d === "block" && surfaces.field3d === "none")) {
      throw new Error("Hybrid surface routing is incorrect");
    }
  }
  await page.locator("#tab3d").click();

  const fieldBridge = await page.evaluate(() => ({
    sample: window.worldFieldSample?.(0, 0, 0),
    window: window.worldFieldViewWindow?.(4, 4),
  }));
  if (!fieldBridge.sample || !Number.isFinite(fieldBridge.sample.x) || !Number.isFinite(fieldBridge.sample.z)) {
    throw new Error("World-space scientific field sampling bridge is unavailable");
  }
  if (!fieldBridge.window || fieldBridge.window.samples?.length !== 16) {
    throw new Error("World-space field view window did not return the requested sample lattice");
  }

  const worldView = await page.evaluate(() => window.getWorldViewContract?.());
  if (!worldView || worldView.version !== 1 || !worldView.center || !Number.isFinite(worldView.center.x) || !Number.isFinite(worldView.center.z)) {
    throw new Error("Unified World View spatial contract is not exposed or has invalid coordinates");
  }
  if (worldView.renderMode !== "3d") {
    throw new Error("World View contract did not follow the final 3D mode selection");
  }

  // 2D Multi-Slice must consume the same world-space contract as Infinite World.
  await page.evaluate(() => {
    window.setWorldViewCenter?.(321.5, 17, -148.25);
    window.setWorldViewSliceY?.(17);
  });
  await page.locator("#tab2d").click();
  await page.waitForFunction(() => window.getWorldField2DLinked?.() === true);
  const world2d = await page.evaluate(() => ({
    state: window.getWorldField2DState?.(),
    contract: window.getWorldViewContract?.(),
  }));
  if (!world2d.state?.linked || world2d.state.sampleCount !== 96 * 72) {
    throw new Error("2D Multi-Slice did not bind to the world-space field sampler");
  }
  const sameCenter =
    Math.abs(world2d.state.view?.center?.x - world2d.contract?.center?.x) < 1e-6 &&
    Math.abs(world2d.state.view?.center?.z - world2d.contract?.center?.z) < 1e-6;
  if (!sameCenter || world2d.state.view?.sliceY !== world2d.contract?.sliceY || world2d.state.view?.seed !== world2d.contract?.seed) {
    throw new Error("2D Multi-Slice and World View contract are using different spatial state");
  }
  await page.locator("#tab3d").click();

  // Volumetric 3D uses the same World View as a spatial anchor.
  await page.evaluate(() => {
    window.setWorldViewCenter?.(321.5, 17, -148.25);
    window.setWorldViewSliceY?.(17);
  });
  await page.locator("#tabField3d").click();
  await page.waitForFunction(() => typeof window.worldFieldSample === "function");
  await page.evaluate(() => window.renderField3D?.());
  const field3dBinding = await page.evaluate(() => ({
    binding: window.getField3DWorldBinding?.(),
    contract: window.getWorldViewContract?.(),
  }));
  if (!field3dBinding.binding || !field3dBinding.contract) {
    throw new Error("Volumetric 3D world-view binding is not exposed");
  }
  if (
    Math.abs(field3dBinding.binding.center.x - field3dBinding.contract.center.x) > 1e-6 ||
    Math.abs(field3dBinding.binding.center.y - field3dBinding.contract.center.y) > 1e-6 ||
    Math.abs(field3dBinding.binding.center.z - field3dBinding.contract.center.z) > 1e-6 ||
    field3dBinding.binding.sliceY !== field3dBinding.contract.sliceY ||
    field3dBinding.binding.seed !== field3dBinding.contract.seed
  ) {
    throw new Error("Volumetric 3D and World View contract are using different spatial state");
  }

  const unifiedField = await page.evaluate(() => {
    const c = window.getWorldViewContract?.();
    const x = c.center.x, y = c.sliceY, z = c.center.z;
    return {
      source: window.getField3DSourceStats?.(),
      world: window.worldFieldSample?.(x, y, z),
      volume: window.getField3DWorldSample?.(x, y, z),
    };
  });
  if (unifiedField.source?.fieldProvider?.id !== "infinite-world-field-sampler") {
    throw new Error("Volumetric 3D is not using the authoritative Infinite World field provider");
  }
  if (!unifiedField.world || !unifiedField.volume) {
    throw new Error(`Unified world/volumetric field sample is unavailable: ${JSON.stringify(unifiedField)}`);
  }
  for (const key of ["energy","density","information","entropy","temperature","biology","material"]) {
    if (Math.abs((unifiedField.world[key] ?? 0) - (unifiedField.volume[key] ?? 0)) > 1e-9) {
      throw new Error(`World and volumetric field mismatch for ${key}`);
    }
  }

  // Mutation convergence: Brush must mutate the same authoritative field consumed by World/2D/3D.
  // The terrain renderer is anchored at Infinite World position; restore the shared spatial contract to that anchor
  // after the earlier 2D/3D routing tests moved the contract to a remote diagnostic location.
  const mutationAnchor = await page.evaluate(() => {
    const stats = window.worldTerrainPatchStats?.();
    const key = stats?.loadedChunkKeys?.[0];
    const [cx, , cz] = String(key ?? "0,0,0").split(",").map(Number);
    const x = cx * 32;
    const z = cz * 32;
    const terrain = window.worldTerrainSample?.(x, z);
    const c = window.getWorldViewContract?.();
    if (c) {
      window.setWorldViewCenter?.(x, c.center.y, z);
      window.setWorldViewSliceY?.(terrain?.height ?? c.sliceY);
    }
    return { x, y: terrain?.height ?? c?.sliceY ?? 0, z };
  });
  const mutationBaseline = await page.evaluate((anchor) => {
    return {
      point: anchor,
      sample: window.sampleAuthoritativeWorldField?.(anchor.x, anchor.y, anchor.z),
      terrainGeometry: window.worldTerrainGeometrySignature?.(),
    };
  }, mutationAnchor);
  await page.evaluate((anchor) => {
    const c = window.getWorldViewContract?.();
    window.setWorldViewCenter?.(anchor.x, c?.center.y ?? anchor.y, anchor.z);
    window.setWorldViewSliceY?.(anchor.y);
    const z = Math.max(0, Math.min(63, Math.round(anchor.y)));
    window.applyChunkBrush?.("Forest", 64, 64, z, 8, 1);
  }, mutationAnchor);
  const mutationAfter = await page.evaluate((anchor) => ({
    state: window.getAuthoritativeWorldFieldState?.(),
    world: window.sampleAuthoritativeWorldField?.(anchor.x, anchor.y, anchor.z),
    volume: window.getField3DWorldSample?.(anchor.x, anchor.y, anchor.z),
    terrainGeometry: window.worldTerrainGeometrySignature?.(),
    analyticTerrain: window.worldTerrainSample?.(anchor.x, anchor.z),
  }), mutationAnchor);
  if (!mutationAfter.state || mutationAfter.state.mutationCount < 1) {
    throw new Error("Authoritative world field did not record the Brush mutation");
  }
  if (!mutationAfter.world || !mutationAfter.volume) {
    throw new Error("Authoritative mutation sample is unavailable");
  }
  if (Math.abs((mutationAfter.world.energy ?? 0) - (mutationBaseline.sample?.energy ?? 0)) < 1e-6 &&
      Math.abs((mutationAfter.world.biology ?? 0) - (mutationBaseline.sample?.biology ?? 0)) < 1e-6) {
    throw new Error("Brush mutation did not change the authoritative world field");
  }
  for (const key of ["energy","density","information","entropy","temperature","biology","material"]) {
    if (Math.abs((mutationAfter.world[key] ?? 0) - (mutationAfter.volume[key] ?? 0)) > 1e-9) {
      throw new Error(`Authoritative world/volumetric mismatch after Brush for ${key}`);
    }
  }
  if (!mutationAfter.terrainGeometry || Number(mutationAfter.terrainGeometry.vertexCount ?? 0) <= 0 || !Number.isFinite(mutationAfter.analyticTerrain?.height)) {
    throw new Error("Rendered terrain geometry disappeared after Brush");
  }
  if (mutationAfter.terrainGeometry.heightSum === mutationBaseline.terrainGeometry.heightSum &&
      mutationAfter.terrainGeometry.heightSquareSum === mutationBaseline.terrainGeometry.heightSquareSum) {
    const fieldDelta = {
      energy: (mutationAfter.world?.energy ?? 0) - (mutationBaseline.sample?.energy ?? 0),
      density: (mutationAfter.world?.density ?? 0) - (mutationBaseline.sample?.density ?? 0),
      biology: (mutationAfter.world?.biology ?? 0) - (mutationBaseline.sample?.biology ?? 0),
    };
    const terrainDelta = (mutationAfter.analyticTerrain?.height ?? 0) - (mutationBaseline.point?.y ?? 0);
    throw new Error("Brush field→terrain convergence failed: " + JSON.stringify({ fieldDelta, terrainDelta, baselineGeometry: mutationBaseline.terrainGeometry, afterGeometry: mutationAfter.terrainGeometry }));
  }

  // Composer must mutate the same authoritative field and remain visible through the 2D world-space projection.
  const composerBaseline = await page.evaluate(() => {
    const c = window.getWorldViewContract?.();
    return window.sampleAuthoritativeWorldField?.(c.center.x, c.sliceY, c.center.z);
  });
  await page.evaluate(() => window.infinityApplyComposer?.({
    phi: "Crystalline",
    fields: "Information Dense",
    complexity: "Explosive",
    spacetime: "High Radiation",
  }));
  const composerAfter = await page.evaluate(() => {
    const c = window.getWorldViewContract?.();
    const view = window.worldFieldViewWindow?.(3, 3, c.sliceY);
    return {
      state: window.getAuthoritativeWorldFieldState?.(),
      world: window.sampleAuthoritativeWorldField?.(c.center.x, c.sliceY, c.center.z),
      volume: window.getField3DWorldSample?.(c.center.x, c.sliceY, c.center.z),
      slice: view?.samples?.[4] ?? null,
    };
  });
  if (!composerAfter.state || composerAfter.state.mutationCount < 1) {
    throw new Error("Composer did not record an authoritative world-field mutation");
  }
  if (!composerAfter.world || !composerAfter.volume || !composerAfter.slice) {
    throw new Error("Composer convergence samples are unavailable");
  }
  if (Math.abs((composerAfter.world.information ?? 0) - (composerBaseline?.information ?? 0)) < 1e-6) {
    throw new Error("Composer did not change the authoritative information field");
  }
  for (const key of ["energy","density","information","entropy","temperature","biology","material"]) {
    if (Math.abs((composerAfter.world[key] ?? 0) - (composerAfter.volume[key] ?? 0)) > 1e-9) {
      throw new Error(`Composer world/volumetric mismatch for ${key}`);
    }
    if (Math.abs((composerAfter.world[key] ?? 0) - (composerAfter.slice[key] ?? 0)) > 1e-9) {
      throw new Error(`Composer world/2D slice mismatch for ${key}`);
    }
  }
  // Global overlays are keyed: disabling a law removes its contribution rather than accumulating an inverse.
  const lawBase = await page.evaluate(() => {
    const c = window.getWorldViewContract?.();
    return window.sampleAuthoritativeWorldField?.(c.center.x, c.sliceY, c.center.z);
  });
  await page.evaluate(() => window.setRealityLaw?.("Density Gravity", true, 0.7, 0.2));
  const lawOn = await page.evaluate(() => {
    const c = window.getWorldViewContract?.();
    return window.sampleAuthoritativeWorldField?.(c.center.x, c.sliceY, c.center.z);
  });
  await page.evaluate(() => window.setRealityLaw?.("Density Gravity", false, 0.7, 0.2));
  const lawOff = await page.evaluate(() => {
    const c = window.getWorldViewContract?.();
    return window.sampleAuthoritativeWorldField?.(c.center.x, c.sliceY, c.center.z);
  });
  if (!lawOn || !lawOff || Math.abs((lawOn.energy ?? 0) - (lawBase?.energy ?? 0)) < 1e-6) {
    throw new Error("Law overlay did not affect the authoritative field");
  }
  for (const key of ["energy","density","information","entropy","temperature","biology","material"]) {
    if (Math.abs((lawOff[key] ?? 0) - (lawBase?.[key] ?? 0)) > 1e-9) {
      throw new Error("Disabled law overlay was not removed for " + key);
    }
  }
  await page.evaluate(() => window.clearAuthoritativeWorldFieldMutations?.());

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

  await page.locator("#btnToggleWorldTools").click();
  await page.waitForFunction(() => !!document.getElementById("dockTriggerOpen"));

  await page.locator("#btnToggleWorldTools").click();
  await page.waitForFunction(() => !!document.getElementById("dockCloseBtn"));

  await page.evaluate(() => window.setRealityLaw?.("Density Gravity", true, 0.4, 0.012));
  const lawBaseline = await page.evaluate(() => window.getRealityLawState?.());
  if (!lawBaseline || !Array.isArray(lawBaseline.processes)) throw new Error("Runtime law bridge is not exposed");
  if (!lawBaseline.processes.includes("gravity") || !lawBaseline.processes.includes("density")) {
    throw new Error("Density Gravity could not be established as active before the build-law test");
  }

  const lawBuildBefore = await page.evaluate(() => window.infinityBuildZoneCost?.(0, 0));
  await page.evaluate(() => window.setRealityLaw?.("Density Gravity", false, 0.4, 0.012));
  const lawDisabled = await page.evaluate(() => window.getRealityLawState?.());
  if (lawDisabled?.processes?.includes("gravity") || lawDisabled?.processes?.includes("density")) {
    throw new Error("Disabling Density Gravity did not reach the runtime process state");
  }
  const lawBuildAfter = await page.evaluate(() => window.infinityBuildZoneCost?.(0, 0));
  const beforeLawPenalty = Number(lawBuildBefore?.laws?.penalty ?? lawBuildBefore?.decisionComponents?.laws ?? lawBuildBefore?.components?.laws ?? NaN);
  const afterLawPenalty = Number(lawBuildAfter?.laws?.penalty ?? lawBuildAfter?.decisionComponents?.laws ?? lawBuildAfter?.components?.laws ?? NaN);
  const beforeCost = Number(lawBuildBefore?.cost ?? NaN);
  const afterCost = Number(lawBuildAfter?.cost ?? NaN);
  const penaltyChanged = Number.isFinite(beforeLawPenalty) && Number.isFinite(afterLawPenalty) && afterLawPenalty > beforeLawPenalty;
  const costChanged = Number.isFinite(beforeCost) && Number.isFinite(afterCost) && afterCost > beforeCost;
  if (!penaltyChanged && !costChanged) {
    throw new Error("Build decision did not change after disabling a governing law");
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

  // Runtime provenance acceptance: prove the causal chain is captured by the same trace.
  await page.evaluate(() => window.resetRuntimeProvenance?.());
  await page.evaluate(() => window.applyChunkPreset("town"));
  await page.waitForFunction(() => !!window.lastChunkPreset, undefined, { timeout: acceptanceTimeout });
  await page.evaluate(() => window.applyChunkBrush("Forest", 64, 64, 32, 5, 1));
  await page.waitForFunction(() => !!window.lastChunkBrush, undefined, { timeout: acceptanceTimeout });
  await page.evaluate(() => window.setRealityLaw?.("Density Gravity", true, 0.4, 0.012));
  const provenanceDecision = await page.evaluate(() => window.infinityBuildZoneCost?.(0, 0));
  const provenanceLawPenalty = Number(
    provenanceDecision?.laws?.penalty ??
    provenanceDecision?.decisionComponents?.laws ??
    provenanceDecision?.components?.laws ??
    NaN
  );
  if (!Number.isFinite(provenanceLawPenalty)) throw new Error("Build decision did not expose law contribution for provenance");
  const provenance = await page.evaluate(() => window.getRuntimeProvenance?.());
  const provenanceValidation = await page.evaluate(() => window.validateRuntimeProvenance?.());
  const provenanceStages = (provenance?.events ?? []).map((event) => event.stage);
  const expectedStages = ["preset", "brush", "law", "build-decision"];
  if (expectedStages.some((stage, index) => provenanceStages[index] !== stage)) {
    throw new Error(`Runtime provenance order invalid: ${JSON.stringify(provenanceStages)}`);
  }
  if (provenance?.events?.some((event, index) => index > 0 && event.parentId !== provenance.events[index - 1].id)) {
    throw new Error("Runtime provenance parent chain is broken");
  }
  if (!provenanceValidation?.valid) {
    throw new Error(`Runtime provenance validation failed: ${JSON.stringify(provenanceValidation?.errors)}`);
  }


  const before = await page.evaluate(() => window.worldGenerationHealth());
  console.log("[acceptance] Quick Generate: click");
  await page.getByRole("button", { name: /Quick Generate/ }).click({ timeout: acceptanceTimeout });
  console.log("[acceptance] Quick Generate: clicked");
  await page.waitForFunction((b) => {
    const a = window.worldGenerationHealth();
    return Number(a?.stats?.objects ?? 0) !== Number(b?.stats?.objects ?? 0)
      || Number(a?.stats?.loadedChunks ?? 0) !== Number(b?.stats?.loadedChunks ?? 0)
      || !!a?.lastGeneration;
  }, before, { timeout: acceptanceTimeout });

  await page.waitForFunction(() => Number(window.worldTerrainPatchStats?.().patchCount ?? 0) > 0, undefined, { timeout: acceptanceTimeout });
  const afterQuick = await page.evaluate(() => ({ health: window.worldGenerationHealth(), terrain: window.worldTerrainPatchStats?.() }));
  if (!afterQuick?.health?.lastGeneration) throw new Error("Quick Generate did not record a generation result");
  if (Number(afterQuick.health.lastGeneration.appliedElements ?? 0) <= 0) throw new Error("Quick Generate produced no applied world-generation elements");
  if (Number(afterQuick.health.stats?.loadedChunks ?? 0) <= 0) throw new Error("Quick Generate did not materialize loaded world chunks");
  if (Number(afterQuick.terrain?.patchCount ?? 0) <= 0) throw new Error("Quick Generate did not materialize terrain patches");

  const finalProvenance = await page.evaluate(() => window.getRuntimeProvenance?.());
  const finalStages = (finalProvenance?.events ?? []).map((event) => event.stage);
  if (!finalStages.includes("world-state")) {
    throw new Error(`World state provenance was not recorded after Quick Generate: ${JSON.stringify(finalStages)}`);
  }
  const finalValidation = await page.evaluate(() => window.validateRuntimeProvenance?.());
  if (!finalValidation?.valid) {
    throw new Error(`Final runtime provenance validation failed: ${JSON.stringify(finalValidation?.errors)}`);
  }
  console.log("[acceptance] Runtime provenance chain:", JSON.stringify(finalStages));

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

  console.log("[acceptance] Compose World: click");
  await composePage.getByRole("button", { name: /Compose World/ }).click({ timeout: acceptanceTimeout });
  console.log("[acceptance] Compose World: clicked");
  await composePage.waitForSelector("#comp.open");
  if (!(await composePage.locator("#comp").innerText()).includes("Integral Reality Composer")) {
    throw new Error("Compose World opened without the Integral Reality Composer");
  }
  for (let i = 0; i < 4; i++) await composePage.locator("#cnext").click();
  console.log("[acceptance] Generate Reality");
  console.log("[acceptance] Generate Reality: click");
  await composePage.getByRole("button", { name: /Generate Reality/ }).click({ timeout: acceptanceTimeout });
  console.log("[acceptance] Generate Reality: clicked");
  await composePage.waitForFunction(() => {
    const health = window.worldGenerationHealth();
    return !!health?.lastGeneration;
  }, undefined, { timeout: acceptanceTimeout });

  await composePage.waitForFunction(() => Number(window.worldTerrainPatchStats?.().patchCount ?? 0) > 0, undefined, { timeout: acceptanceTimeout });
  const afterCompose = await composePage.evaluate(() => ({ health: window.worldGenerationHealth(), terrain: window.worldTerrainPatchStats?.() }));
  if (!afterCompose?.health?.lastGeneration) throw new Error("Compose World did not produce a generation record");
  if (Number(afterCompose.health.lastGeneration.appliedElements ?? 0) <= 0) throw new Error("Compose World produced no applied world-generation elements");
  if (Number(afterCompose.health.stats?.objects ?? 0) <= 0) throw new Error("Compose World produced no materialized world objects");
  if (Number(afterCompose.terrain?.patchCount ?? 0) <= 0) throw new Error("Compose World produced no materialized terrain patches");
  const composeGeometry = await composePage.evaluate(() => ({
    geometry: window.worldTerrainGeometrySignature?.(),
  }));
  if (!composeGeometry.geometry || Number(composeGeometry.geometry.vertexCount ?? 0) <= 0) throw new Error("Compose World terrain geometry is not measurable");
  await composePage.close();

  await page.screenshot({ path: "artifacts/browser-acceptance.png", fullPage: true });
  console.log(JSON.stringify({
    status: "PASS",
    quickGenerateObjects: afterQuick.health?.stats?.objects ?? 0,
    composeObjects: afterCompose.health?.stats?.objects ?? 0,
    screenshot: "artifacts/browser-acceptance.png"
  }));
} finally {
  clearTimeout(watchdog);
  await browser.close();
  terminateServerTree();
}
