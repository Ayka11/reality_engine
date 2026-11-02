import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";

const entry = `
  export { GPUBackend } from "./src/gpu/GPUBackend";
  export { DEFAULT_PARAMS } from "./src/laws/MetaLaw";
  export { buildMaterialBuffer } from "./src/materials/MaterialDef";
  export { PROC } from "./src/process/ProcessDef";
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
      GPUBackend, DEFAULT_PARAMS, buildMaterialBuffer, PROC, CELL_FIELDS, F,
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

    const adapterInfo = adapter.info?.description || adapter.info?.device || "unknown";
    const enabled = await run(
      3, [0.5, 0, 0], [1, 1, 1], 0.25, 1 << PROC.DENSITY_ADVECTION,
    );
    const limited = await run(
      2, [0.1, 0.95], [100, 100], 1, 1 << PROC.DENSITY_ADVECTION,
    );
    const disabled = await run(3, [0.5, 0, 0], [1, 1, 1], 0.25, 0);
    return { status: "PASS", adapterInfo, enabled, limited, disabled };
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
    console.log("WebGPU density-advection runtime: PASS " + JSON.stringify(result));
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
