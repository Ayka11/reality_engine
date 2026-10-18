import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const source = await readFile(new URL("src/world/ScriptEngine.ts", root), "utf8");
const presetsSource = await readFile(new URL("src/world/Presets.ts", root), "utf8");
assert.match(source, /Presets\.apply\(grid, name as PresetName, random\)/, "ScriptEngine must inject its seeded RNG into presets");
assert.match(presetsSource, /static apply\(grid: VoxelGrid, name: PresetName, random: \(\) => number = Math\.random\)/, "Presets must accept an injectable RNG while preserving backward compatibility");
assert.doesNotMatch(presetsSource, /Math\.random\(\)/, "preset implementations must not bypass the injected RNG");
const cellModule = `export const CELL_FIELDS=24; export const F={ENERGY:0,DENSITY:1,INFORMATION:2,ENTROPY:3,TEMPERATURE:4,BIO_POTENTIAL:11,SIGNAL:17,MEM_FIELD:18,FIELD_X:20,FIELD_Y:21,CHEM_STATE:22};`;
const materialModule = `export const MAT={VACUUM:0,STONE:1,SAND:2,CRYSTAL:3,METAL:4,MAGMA:5,ICE:6,ORGANIC_TISSUE:7,SPORES:8,MEMBRANE:9,BIOMASS:10,PLASMA:11,SUPERCONDUCTIVE_MATTER:12,INFORMATION_SUBSTRATE:13};`;
const chemModule = `export const CHEM={GAS:0,LIQUID:1,SOLID:2,ORGANIC:3,REACTIVE:4};`;
const cellUrl = `data:text/javascript;base64,${Buffer.from(cellModule).toString("base64")}`;
const materialUrl = `data:text/javascript;base64,${Buffer.from(materialModule).toString("base64")}`;
const chemUrl = `data:text/javascript;base64,${Buffer.from(chemModule).toString("base64")}`;

const gridSource = await readFile(new URL("src/core/VoxelGrid.ts", root), "utf8");
let gridJs = ts.transpileModule(gridSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
gridJs = gridJs.replace(/from ['"]\.\/CellState['"]/, `from "${cellUrl}"`);
const gridUrl = `data:text/javascript;base64,${Buffer.from(gridJs).toString("base64")}`;

let presetsJs = ts.transpileModule(presetsSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
presetsJs = presetsJs.replace(/from ['"]\.\.\/core\/VoxelGrid['"]/, `from "${gridUrl}"`);
presetsJs = presetsJs.replace(/from ['"]\.\.\/core\/CellState['"]/, `from "${cellUrl}"`);
presetsJs = presetsJs.replace(/from ['"]\.\.\/materials\/MaterialDef['"]/, `from "${materialUrl}"`);
presetsJs = presetsJs.replace(/from ['"]\.\.\/chemistry\/ChemLayer['"]/, `from "${chemUrl}"`);
const presetUrl = `data:text/javascript;base64,${Buffer.from(presetsJs).toString("base64")}`;

js = js.replace(/from ['"]\\.\\/Presets['"]/, `from "${presetUrl}"`);
const { ScriptEngine } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const { VoxelGrid } = await import(gridUrl);

const gridModuleSource = await readFile(new URL("src/core/CellState.ts", root), "utf8");

function makeSimulation() {
  const W=16,H=16,D=12;
  const GridModule = { VoxelGrid: null };
  return {grid:new VoxelGrid(W,H,D),laws:{},syncToGPU(){}};
}
function runScenario(engine) {
  const result=engine.run(`
    world.clear();
    world.preset('life');
    for (let i=0;i<20;i++) {
      const x=Math.floor(Math.random()*W);
      const y=Math.floor(Math.random()*H);
      const z=Math.floor(Math.random()*D);
      world.fill(x,y,z,'energy',100+i);
    }
  `);
  assert.equal(result.success,true,result.log.join("; "));
  return engine.sim.grid.buffer.slice();
}

const sim=makeSimulation();
const engine=new ScriptEngine(sim,0x13579bdf);
const checkpoint=engine.snapshotRandomState();
const expected=runScenario(engine);
engine.restoreRandomState(checkpoint);
const replayed=runScenario(engine);
assert.deepEqual([...replayed],[...expected],"script RNG replay must reproduce identical grid");
assert.throws(()=>engine.restoreRandomState(0),/Invalid ScriptEngine PRNG state/);
assert.throws(()=>engine.restoreRandomState(-1),/Invalid ScriptEngine PRNG state/);
assert.throws(()=>engine.restoreRandomState(0x100000000),/Invalid ScriptEngine PRNG state/);
console.log("ScriptEngine RNG recovery: PASS");
