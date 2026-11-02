import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";

const entry = `
  export { GPUBackend } from "./src/gpu/GPUBackend";
  export { DEFAULT_PARAMS } from "./src/laws/MetaLaw";
  export { buildMaterialBuffer } from "./src/materials/MaterialDef";
  export { PROC } from "./src/process/ProcessDef";
  export { MAT } from "./src/materials/MaterialDef";
  export { CELL_FIELDS, F } from "./src/core/CellState";
`;
const bundled = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), sourcefile: "gpu-runtime-entry.ts" },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  write: false,
});
const moduleUrl = "data:text/javascript;base64," +
  Buffer.from(bundled.outputFiles[0].text).toString("base64");

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end("<!doctype html><html><body>Reality Engine WebGPU runtime test</body></html>");
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("Could not resolve local WebGPU test server port");

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: [
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "--use-angle=swiftshader",
      "--disable-dev-shm-usage",
    ],
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async (url) => {
    if (!navigator.gpu) return { status: "SKIP", reason: "navigator.gpu unavailable" };
    let adapter;
    try {
      adapter = await navigator.gpu.requestAdapter();
    } catch (error) {
      return { status: "SKIP", reason: `WebGPU adapter request failed: ${error?.message || error}` };
    }
    if (!adapter) return { status: "SKIP", reason: "WebGPU adapter unavailable" };

    const {
      GPUBackend, DEFAULT_PARAMS, buildMaterialBuffer, PROC, MAT, CELL_FIELDS, F,
    } = await import(url);

    async function run(width, density, velocity, dt, activeMask) {
      const backend = new GPUBackend();
      try {
        const initialized = await backend.init(width, 1, 1);
        if (!initialized) throw new Error("WebGPU adapter disappeared during backend initialization");
        backend.uploadMaterials(buildMaterialBuffer());
        const cells = new Float32Array(width * CELL_FIELDS);
        for (let x = 0; x < width; x++) {
          cells[x * CELL_FIELDS + F.DENSITY] = density[x] ?? 0;
          cells[x * CELL_FIELDS + F.VELOCITY_X] = velocity[x] ?? 0;
        }
        backend.upload(cells);
        backend.writeParams(DEFAULT_PARAMS, activeMask, dt);
        backend.submitCompute(1);
        const output = await backend.readback();
        return Array.from({ length: width }, (_, x) => output[x * CELL_FIELDS + F.DENSITY]);
      } finally {
        backend.destroy();
      }
    }

    async function runMaterialDiffusion(materialId, field, process, parameter) {
      const width = 3, height = 3, depth = 3;
      const backend = new GPUBackend();
      try {
        const initialized = await backend.init(width, height, depth);
        if (!initialized) throw new Error("WebGPU adapter disappeared during material diffusion initialization");
        backend.uploadMaterials(buildMaterialBuffer());
        const cells = new Float32Array(width * height * depth * CELL_FIELDS);
        for (let cell = 0; cell < width * height * depth; cell++) {
          cells[cell * CELL_FIELDS + F.MATERIAL_ID] = materialId;
        }
        const center = (1 * height + 1) * width + 1;
        cells[center * CELL_FIELDS + field] = 100;
        backend.upload(cells);
        const params = {
          ...DEFAULT_PARAMS,
          energyDiffusion: 0,
          tempDiffusion: 0,
          tempEnergyCoupling: 0,
          [parameter]: 0.01,
        };
        backend.writeParams(params, 1 << process, 1 / 60);
        backend.submitCompute(1);
        const output = await backend.readback();
        return output[center * CELL_FIELDS + field];
      } finally {
        backend.destroy();
      }
    }

    async function runCoupledMaterialStep() {
      const width = 3, height = 3, depth = 3;
      const backend = new GPUBackend();
      try {
        const initialized = await backend.init(width, height, depth);
        if (!initialized) throw new Error("WebGPU adapter disappeared during coupled material initialization");
        backend.uploadMaterials(buildMaterialBuffer());
        const cells = new Float32Array(width * height * depth * CELL_FIELDS);
        for (let cell = 0; cell < width * height * depth; cell++) {
          cells[cell * CELL_FIELDS + F.MATERIAL_ID] = MAT.METAL;
        }
        const center = (1 * height + 1) * width + 1;
        cells[center * CELL_FIELDS + F.ENERGY] = 100;
        backend.upload(cells);
        backend.writeParams({
          ...DEFAULT_PARAMS,
          energyDiffusion: 0.1,
          tempDiffusion: 0,
          tempEnergyCoupling: 0.5,
        }, (1 << PROC.ENERGY_DIFFUSION) | (1 << PROC.TEMP_DIFFUSION), 0.016);
        backend.submitCompute(1);
        const output = await backend.readback();
        return {
          energy: output[center * CELL_FIELDS + F.ENERGY],
          temperature: output[center * CELL_FIELDS + F.TEMPERATURE],
        };
      } finally {
        backend.destroy();
      }
    }

    async function runCombinedDensityProcess(
      density, entropy, temperature, information, processMask, params, dt,
      fieldX = 0, materialId = MAT.VACUUM,
    ) {
      const width = 3, height = 3, depth = 3;
      const backend = new GPUBackend();
      try {
        const initialized = await backend.init(width, height, depth);
        if (!initialized) throw new Error("WebGPU adapter disappeared during combined density-process initialization");
        backend.uploadMaterials(buildMaterialBuffer());
        const cells = new Float32Array(width * height * depth * CELL_FIELDS);
        for (let cell = 0; cell < width * height * depth; cell++) {
          cells[cell * CELL_FIELDS + F.MATERIAL_ID] = MAT.VACUUM;
        }
        const center = (1 * height + 1) * width + 1;
        cells[center * CELL_FIELDS + F.MATERIAL_ID] = materialId;
        cells[center * CELL_FIELDS + F.FIELD_X] = fieldX;
        cells[center * CELL_FIELDS + F.DENSITY] = density;
        cells[center * CELL_FIELDS + F.ENTROPY] = entropy;
        cells[center * CELL_FIELDS + F.TEMPERATURE] = temperature;
        cells[center * CELL_FIELDS + F.INFORMATION] = information;
        backend.upload(cells);
        backend.writeParams({
          ...DEFAULT_PARAMS,
          energyDiffusion: 0,
          tempDiffusion: 0,
          tempEnergyCoupling: 0,
          ...params,
        }, processMask, dt);
        backend.submitCompute(1);
        const output = await backend.readback();
        return {
          density: output[center * CELL_FIELDS + F.DENSITY],
          entropy: output[center * CELL_FIELDS + F.ENTROPY],
          information: output[center * CELL_FIELDS + F.INFORMATION],
          materialId: output[center * CELL_FIELDS + F.MATERIAL_ID],
        };
      } finally {
        backend.destroy();
      }
    }

    async function runEntropyCoupledStep() {
      const width = 3, height = 3, depth = 3;
      const backend = new GPUBackend();
      try {
        const initialized = await backend.init(width, height, depth);
        if (!initialized) throw new Error("WebGPU adapter disappeared during entropy parity initialization");
        backend.uploadMaterials(buildMaterialBuffer());
        const cells = new Float32Array(width * height * depth * CELL_FIELDS);
        for (let cell = 0; cell < width * height * depth; cell++) {
          cells[cell * CELL_FIELDS + F.MATERIAL_ID] = MAT.VACUUM;
        }
        const center = (1 * height + 1) * width + 1;
        cells[center * CELL_FIELDS + F.ENERGY] = 100;
        cells[center * CELL_FIELDS + F.TEMPERATURE] = 100;
        cells[center * CELL_FIELDS + F.ENTROPY] = 0.2;
        backend.upload(cells);
        const params = {
          ...DEFAULT_PARAMS,
          energyDiffusion: 0.1,
          tempDiffusion: 0.1,
          tempEnergyCoupling: 0,
          entropyGrowthRate: 0.01,
          entropyEnergyCoupling: 0.001,
        };
        const processMask = (1 << PROC.ENERGY_DIFFUSION) |
          (1 << PROC.TEMP_DIFFUSION) |
          (1 << PROC.ENTROPY_GROWTH);
        backend.writeParams(params, processMask, 0.016);
        backend.submitCompute(1);
        const output = await backend.readback();
        return {
          energy: output[center * CELL_FIELDS + F.ENERGY],
          temperature: output[center * CELL_FIELDS + F.TEMPERATURE],
          entropy: output[center * CELL_FIELDS + F.ENTROPY],
        };
      } finally {
        backend.destroy();
      }
    }

    const adapterInfo = adapter.info?.description || adapter.info?.device || "unknown";
    const coupledMaterial = await runCoupledMaterialStep();
    const entropyCoupled = await runEntropyCoupledStep();
    const combinedPhase = await runCombinedDensityProcess(
      0.50005, 0.2, 600, 10,
      (1 << PROC.DENSITY_FLOW) | (1 << PROC.PHASE_TRANSITION),
      { densityDiffusion: 0.01, phaseTransitionRate: 0.008 },
      0.016,
    );
    const combinedCrystallization = await runCombinedDensityProcess(
      0.38005, 0.1, 0, 0,
      (1 << PROC.DENSITY_FLOW) | (1 << PROC.CRYSTALLIZATION),
      { densityDiffusion: 0.01, crystallizationRate: 0.003 },
      0.016,
    );
    const combinedErosion = await runCombinedDensityProcess(
      0.65005, 0.2, 0, 10,
      (1 << PROC.DENSITY_FLOW) | (1 << PROC.EROSION),
      { densityDiffusion: 0.01, erosionRate: 0.01 },
      0.016, 10, MAT.SAND,
    );
    const crystallizationErosion = await runCombinedDensityProcess(
      0.8, 0.1, 0, 10,
      (1 << PROC.CRYSTALLIZATION) | (1 << PROC.EROSION),
      { crystallizationRate: 0.003, erosionRate: 0.01 },
      0.016, 10, MAT.VACUUM,
    );
    const materialDiffusion = {
      energyVacuum: await runMaterialDiffusion(
        MAT.VACUUM, F.ENERGY, PROC.ENERGY_DIFFUSION, "energyDiffusion",
      ),
      energyMetal: await runMaterialDiffusion(
        MAT.METAL, F.ENERGY, PROC.ENERGY_DIFFUSION, "energyDiffusion",
      ),
      temperatureVacuum: await runMaterialDiffusion(
        MAT.VACUUM, F.TEMPERATURE, PROC.TEMP_DIFFUSION, "tempDiffusion",
      ),
      temperatureMetal: await runMaterialDiffusion(
        MAT.METAL, F.TEMPERATURE, PROC.TEMP_DIFFUSION, "tempDiffusion",
      ),
    };
    const enabled = await run(
      3, [0.5, 0, 0], [1, 1, 1], 0.25, 1 << PROC.DENSITY_ADVECTION,
    );
    const limited = await run(
      2, [0.1, 0.95], [100, 100], 1, 1 << PROC.DENSITY_ADVECTION,
    );
    const disabled = await run(3, [0.5, 0, 0], [1, 1, 1], 0.25, 0);
    return { status: "PASS", adapterInfo, enabled, limited, disabled, materialDiffusion, coupledMaterial, combinedPhase, combinedCrystallization, combinedErosion, crystallizationErosion, entropyCoupled };
  }, moduleUrl);

  if (result.status === "SKIP") {
    if (process.env.REALITY_ENGINE_REQUIRE_WEBGPU === "1") {
      throw new Error(`WebGPU runtime is required but unavailable: ${result.reason}`);
    }
    console.log(`WebGPU density-advection runtime: SKIP (${result.reason}); shader runtime remains unverified on this runner`);
  } else {
    assert.deepEqual(result.enabled.map(value => Number(value.toFixed(5))), [0.375, 0.125, 0],
      "GPU upwind transport must match the CPU reference case");
    assert.ok(Math.abs(result.enabled.reduce((sum, value) => sum + value, 0) - 0.5) < 1e-5,
      "GPU density advection must conserve mass on a closed grid");
    assert.ok(result.limited.every(value => value >= -1e-6 && value <= 1 + 1e-6),
      `GPU flux limiter must keep density in [0,1]: ${result.limited}`);
    assert.ok(Math.abs(result.limited.reduce((sum, value) => sum + value, 0) - 1.05) < 1e-5,
      "GPU flux limiter must conserve mass while respecting density bounds");
    assert.deepEqual(result.disabled, [0.5, 0, 0],
      "disabled GPU density advection must leave density unchanged");
    assert.ok(Math.abs(result.materialDiffusion.energyVacuum - 99.995) < 1e-4,
      `GPU vacuum conductivity mismatch (expected 99.995, got ${result.materialDiffusion.energyVacuum})`);
    assert.ok(Math.abs(result.materialDiffusion.energyMetal - 99.7) < 1e-4,
      `GPU metal conductivity mismatch (expected 99.7, got ${result.materialDiffusion.energyMetal})`);
    assert.ok(Math.abs(result.materialDiffusion.temperatureVacuum - 99) < 1e-4,
      `GPU vacuum heat-capacity mismatch (expected 99, got ${result.materialDiffusion.temperatureVacuum})`);
    assert.ok(Math.abs(result.materialDiffusion.temperatureMetal - 99.95) < 1e-4,
      `GPU metal heat-capacity mismatch (expected 99.95, got ${result.materialDiffusion.temperatureMetal})`);
    assert.ok(Math.abs(result.coupledMaterial.energy - 97.12) < 1e-4,
      `GPU combined energy step must apply metal conductivity (expected 97.12, got ${result.coupledMaterial.energy})`);
    assert.ok(Math.abs(result.coupledMaterial.temperature - 0.8) < 1e-4,
      `GPU thermal coupling must use pre-step energy (expected 0.8, got ${result.coupledMaterial.temperature})`);
    assert.ok(Math.abs(result.combinedPhase.density - 0.49188995) < 1e-4,
      `GPU phase transition must preserve density diffusion output (expected 0.49188995, got ${result.combinedPhase.density})`);
    assert.ok(Math.abs(result.combinedPhase.entropy - 0.20768) < 1e-4,
      `GPU boiling entropy increment mismatch (got ${result.combinedPhase.entropy})`);
    assert.ok(Math.abs(result.combinedPhase.information - 9.952) < 1e-4,
      `GPU boiling information reduction mismatch (got ${result.combinedPhase.information})`);
    assert.ok(Math.abs(result.combinedCrystallization.density - 0.37991555) < 1e-4,
      `GPU crystallization must preserve density diffusion output (expected 0.37991555, got ${result.combinedCrystallization.density})`);
    assert.ok(Math.abs(result.combinedCrystallization.entropy - 0.09856) < 1e-4,
      `GPU crystallization entropy reduction mismatch (got ${result.combinedCrystallization.entropy})`);
    assert.equal(result.combinedCrystallization.materialId, MAT.CRYSTAL,
      "GPU must crystallize a material that was eligible in the pre-step state");
    assert.ok(Math.abs(result.combinedErosion.density - 0.64174595) < 1e-4,
      `GPU erosion must compose with density diffusion using pre-step density eligibility (got ${result.combinedErosion.density})`);
    assert.ok(Math.abs(result.crystallizationErosion.density - 0.7906304) < 1e-4,
      `GPU erosion must use pre-step vacuum resistance after same-step crystallization (got ${result.crystallizationErosion.density})`);
    assert.equal(result.crystallizationErosion.materialId, MAT.CRYSTAL,
      "GPU same-step crystallization must publish the new material");
    const expectedEntropy = 0.2 + (0.01 + 99.952 * 0.001 + 90.4 * 0.00005) * 0.016;
    const expectedEntropyEnergy = 99.952 * (1 - expectedEntropy * 0.0005 * 0.016 * 60);
    assert.ok(Math.abs(result.entropyCoupled.temperature - 90.4) < 1e-4,
      `GPU thermal output must precede entropy growth (got ${result.entropyCoupled.temperature})`);
    assert.ok(Math.abs(result.entropyCoupled.entropy - expectedEntropy) < 1e-5,
      `GPU entropy growth must use post-diffusion energy and temperature (got ${result.entropyCoupled.entropy})`);
    assert.ok(Math.abs(result.entropyCoupled.energy - expectedEntropyEnergy) < 1e-4,
      `GPU entropy attenuation must use new entropy (got ${result.entropyCoupled.energy})`);
    console.log("WebGPU density-advection/material/phase runtime: PASS " + JSON.stringify(result));
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
