import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const terrainSource = await readFile(new URL("src/world/TerrainGenerator.ts", root), "utf8");
const composerSource = await readFile(new URL("src/ux/WorldComposer.ts", root), "utf8");

const cellModule = "export const CELL_FIELDS=24; export const F={ENERGY:0,DENSITY:1,INFORMATION:2,ENTROPY:3,TEMPERATURE:4,PRESSURE:5,FIELD_X:6,FIELD_Y:7,FIELD_Z:8,LOCAL_TIME:9,CAUSALITY_ID:10,BIO_POTENTIAL:11,WAVE_PHASE:12,WAVE_AMP:13,GRAVITY_POT:14,MATERIAL_ID:15,CHEM_STATE:16,SIGNAL:17,MEM_FIELD:18,AGENT_MARK:19,ENTITY_ID:20,SPARE_1:21,SPARE_2:22,SPARE_3:23};";
const cellUrl = "data:text/javascript;base64," + Buffer.from(cellModule).toString("base64");
const gridModule = "import {CELL_FIELDS} from '" + cellUrl + "'; export class VoxelGrid { constructor(W,H,D){this.W=W;this.H=H;this.D=D;this.size=W*H*D;this.buffer=new Float32Array(this.size*CELL_FIELDS);this.backBuffer=new Float32Array(this.buffer.length)} inBounds(x,y,z){return x>=0&&x<this.W&&y>=0&&y<this.H&&z>=0&&z<this.D} idx(x,y,z){return (z*this.H*this.W+y*this.W+x)*CELL_FIELDS} }";
const gridUrl = "data:text/javascript;base64," + Buffer.from(gridModule).toString("base64");
const simModule = "export class SimulationEngine {}";
const simUrl = "data:text/javascript;base64," + Buffer.from(simModule).toString("base64");
const civModule = "export class CivilizationSystem {}";
const civUrl = "data:text/javascript;base64," + Buffer.from(civModule).toString("base64");

async function compile(source, replacements) {
  let js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [pattern, url] of replacements) js = js.replace(pattern, "from '" + url + "'");
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
}
const { VoxelGrid } = await import(gridUrl);
const { TerrainGenerator, BIOME_LIST } = await compile(terrainSource, [
  [/from ['"]\.\.\/core\/VoxelGrid['"]/, gridUrl],
  [/from ['"]\.\.\/core\/CellState['"]/, cellUrl],
]);
const { WorldComposer } = await compile(composerSource, [
  [/from ['"]\.\.\/simulation\/SimulationEngine['"]/, simUrl],
  [/from ['"]\.\.\/simulation\/CivilizationSystem['"]/, civUrl],
  [/from ['"]\.\.\/core\/CellState['"]/, cellUrl],
]);

assert.match(composerSource, /sim\.mutateAuthoritativeState\(\(\) => \{/,
  "world generation and periodic hazards must use the authoritative simulation mutation boundary");
assert.match(composerSource, /this\._rngState = rngBefore/,
  "failed periodic hazards must restore the composer RNG");
function makeGrid(W = 32, H = 32, D = 8) {
  return new VoxelGrid(W, H, D);
}
function generate(biome, seed) {
  const grid = makeGrid();
  new TerrainGenerator(grid).generate(biome, seed);
  return Array.from(grid.buffer);
}
for (const biome of BIOME_LIST) {
  assert.deepEqual(generate(biome, 321), generate(biome, 321), biome + " terrain must replay for the same seed");
}
assert.notDeepEqual(generate("volcanic", 321), generate("volcanic", 322), "volcanic hotspots must vary with the seed");
assert.deepEqual(generate("volcanic"), generate("volcanic"), "default terrain generation must be deterministic");

const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
let intervalCallback = null;
globalThis.setInterval = (callback) => { intervalCallback = callback; return 123; };
globalThis.clearInterval = () => { intervalCallback = null; };
try {
  const grid = makeGrid(8, 8, 4);
  const sim = {
    grid,
    agents: { seed() {} },
    transactionCount: 0,
    failNextMutation: false,
    syncToGPU() {},
    mutateAuthoritativeState(mutation) {
      const before = grid.buffer.slice();
      try {
        const result = mutation();
        if (this.failNextMutation) {
          this.failNextMutation = false;
          throw new Error("injected mutation publication failure");
        }
        this.transactionCount++;
        this.syncToGPU();
        return result;
      } catch (error) {
        grid.buffer.set(before);
        throw error;
      }
    },
  };
  const composer = new WorldComposer(sim, null, 0x12345678);
  composer.selection.phi = "Harmonic";
  composer.selection.spacetime = "High Radiation";
  composer.generate();
  assert.equal(sim.transactionCount, 1, "world generation must publish through one mutation transaction");
  assert.equal(typeof intervalCallback, "function", "hazard interval should be configured");
  const checkpoint = composer.snapshotRandomState();
  const baseline = grid.buffer.slice();
  intervalCallback();
  const expectedGrid = Array.from(grid.buffer);
  const expectedState = composer.snapshotRandomState();
  grid.buffer.set(baseline);
  composer.restoreRandomState(checkpoint);
  intervalCallback();
  assert.deepEqual(Array.from(grid.buffer), expectedGrid, "world hazard effects must replay after RNG restore");
  assert.equal(composer.snapshotRandomState(), expectedState, "world hazard RNG state must replay");
  assert.equal(sim.transactionCount, 3, "each periodic hazard batch must commit through one mutation transaction");

  const beforeFailedHazard = grid.buffer.slice();
  const hazardRngBeforeFailure = composer.snapshotRandomState();
  sim.failNextMutation = true;
  intervalCallback();
  assert.deepEqual(Array.from(grid.buffer), Array.from(beforeFailedHazard),
    "failed hazard publication must roll back its grid writes");
  assert.equal(composer.snapshotRandomState(), hazardRngBeforeFailure,
    "failed hazard publication must rewind the composer RNG for deterministic retry");
  assert.throws(() => composer.restoreRandomState(0), /Invalid WorldComposer PRNG state/);
  composer._clearHazards();
} finally {
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
}
console.log("TerrainGenerator + WorldComposer deterministic RNG recovery: PASS");
