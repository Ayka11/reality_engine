import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const source = await readFile(new URL("src/world/ScriptEngine.ts", root), "utf8");
const presetsSource = await readFile(new URL("src/world/Presets.ts", root), "utf8");
assert.match(source, /Presets\.apply\(grid, name as PresetName, random\)/, "ScriptEngine must inject its seeded RNG into presets");
assert.match(presetsSource, /static apply\(grid: VoxelGrid, name: PresetName, random: \(\) => number = Math\.random\)/, "Presets must accept an injectable RNG while preserving backward compatibility");
assert.doesNotMatch(presetsSource, /Math\.random\(\)/, "preset implementations must not bypass the injected RNG");
assert.match(source, /this\.sim\.mutateAuthoritativeState\(\(\) => \{/,
  "script world mutations must execute inside the authoritative simulation transaction");
assert.match(source, /this\._rngState = rngBefore/,
  "a failed script must restore its private RNG to permit deterministic retries");
const cellModule = `export const CELL_FIELDS=24;
export function validateGridDimensions(width,height,depth,gridName) {
  if (![width,height,depth].every(Number.isSafeInteger) || width<=0 || height<=0 || depth<=0)
    throw new RangeError(\`\${gridName} dimensions must be positive safe integers\`);
  const size=width*height*depth, bufferLength=size*CELL_FIELDS;
  if (!Number.isSafeInteger(size) || size<=0 || !Number.isSafeInteger(bufferLength) || bufferLength<=0)
    throw new RangeError(\`\${gridName} dimensions exceed the supported typed-buffer index range\`);
  return size;
}
export const F={ENERGY:0,DENSITY:1,INFORMATION:2,ENTROPY:3,TEMPERATURE:4,BIO_POTENTIAL:11,SIGNAL:17,MEM_FIELD:18,FIELD_X:20,FIELD_Y:21,CHEM_STATE:22};
export class CellState { constructor(buffer,base){this.buffer=buffer;this.base=base;} get energy(){return this.buffer[this.base+F.ENERGY]} set energy(v){this.buffer[this.base+F.ENERGY]=v} get density(){return this.buffer[this.base+F.DENSITY]} set density(v){this.buffer[this.base+F.DENSITY]=v} get information(){return this.buffer[this.base+F.INFORMATION]} set information(v){this.buffer[this.base+F.INFORMATION]=v} get entropy(){return this.buffer[this.base+F.ENTROPY]} set entropy(v){this.buffer[this.base+F.ENTROPY]=v} get temperature(){return this.buffer[this.base+F.TEMPERATURE]} set temperature(v){this.buffer[this.base+F.TEMPERATURE]=v} get bioPotential(){return this.buffer[this.base+F.BIO_POTENTIAL]} set bioPotential(v){this.buffer[this.base+F.BIO_POTENTIAL]=v} set(field,v){this.buffer[this.base+field]=v} }`;
const materialModule = `export const MAT={VACUUM:0,STONE:1,SAND:2,CRYSTAL:3,METAL:4,MAGMA:5,ICE:6,ORGANIC_TISSUE:7,SPORES:8,MEMBRANE:9,BIOMASS:10,PLASMA:11,SUPERCONDUCTIVE_MATTER:12,INFORMATION_SUBSTRATE:13};`;
const chemModule = `export const CHEM={GAS:0,LIQUID:1,SOLID:2,ORGANIC:3,REACTIVE:4};`;
const trackedModule = `
export const INTERNAL_MUTABLE_BUFFER = Symbol("test-internal-mutable-buffer");
export function getMutableBuffer(owner, side = "front") { return owner[INTERNAL_MUTABLE_BUFFER](side); }
export function createTrackedFloat32Array(target, onMutation) {
  let proxy;
  proxy = new Proxy(target, {
    get(array, property) {
      if (property === "buffer") return array.slice().buffer;
      if (property === "byteOffset") return 0;
      if (property === "subarray") return (begin, end) => createTrackedFloat32Array(array.subarray(begin, end), onMutation);
      if (property === "valueOf") return () => proxy;
      const value = Reflect.get(array, property, array);
      if (typeof value !== "function") return value;
      if (["set", "fill", "copyWithin", "reverse", "sort"].includes(property)) return (...args) => { const result = Reflect.apply(value, array, args); onMutation(); return result === array ? proxy : result; };
      return value.bind(array);
    },
    set(array, property, value) { const ok = Reflect.set(array, property, value, array); if (ok && typeof property === "string" && /^(0|[1-9]\\d*)$/.test(property)) onMutation(); return ok; },
    defineProperty(array, property, descriptor) { const ok = Reflect.defineProperty(array, property, descriptor); if (ok && typeof property === "string" && /^(0|[1-9]\\d*)$/.test(property)) onMutation(); return ok; }
  });
  return proxy;
}`;
const cellUrl = `data:text/javascript;base64,${Buffer.from(cellModule).toString("base64")}`;
const trackedUrl = `data:text/javascript;base64,${Buffer.from(trackedModule).toString("base64")}`;
const materialUrl = `data:text/javascript;base64,${Buffer.from(materialModule).toString("base64")}`;
const chemUrl = `data:text/javascript;base64,${Buffer.from(chemModule).toString("base64")}`;

const gridSource = await readFile(new URL("src/core/VoxelGrid.ts", root), "utf8");
let gridJs = ts.transpileModule(gridSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
gridJs = gridJs.replace(/from ['"]\.\/CellState['"]/, `from "${cellUrl}"`);
gridJs = gridJs.replace(/from ['"]\.\/TrackedFloat32Array['"]/, `from "${trackedUrl}"`);
const gridUrl = `data:text/javascript;base64,${Buffer.from(gridJs).toString("base64")}`;

let presetsJs = ts.transpileModule(presetsSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
presetsJs = presetsJs.replace(/from ['"]\.\.\/core\/VoxelGrid['"]/, `from "${gridUrl}"`);
presetsJs = presetsJs.replace(/from ['"]\.\.\/core\/CellState['"]/, `from "${cellUrl}"`);
presetsJs = presetsJs.replace(/from ['"]\.\.\/materials\/MaterialDef['"]/, `from "${materialUrl}"`);
presetsJs = presetsJs.replace(/from ['"]\.\.\/chemistry\/ChemLayer['"]/, `from "${chemUrl}"`);
const presetUrl = `data:text/javascript;base64,${Buffer.from(presetsJs).toString("base64")}`;

let js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
js = js.replace(/from ['"]\.\.\/core\/CellState['"]/, `from "${cellUrl}"`);
js = js.replace(/from ['"]\.\/Presets['"]/, `from "${presetUrl}"`);
const { ScriptEngine } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const { VoxelGrid } = await import(gridUrl);

function makeSimulation() {
  const W=16,H=16,D=12;
  const grid = new VoxelGrid(W,H,D);
  return {
    grid,
    laws:{},
    syncToGPU(){},
    mutateAuthoritativeState(mutation) {
      const before = grid.buffer.slice();
      try {
        const result = mutation();
        this.syncToGPU();
        return result;
      } catch (error) {
        grid.buffer.set(before);
        throw error;
      }
    },
  };
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

// A failed script may have changed multiple cells and consumed random values.
// The simulation transaction must undo the writes and ScriptEngine must rewind
// its local RNG so a retry starts from the same deterministic checkpoint.
const beforeFailureBuffer = sim.grid.buffer.slice();
const beforeFailureRng = engine.snapshotRandomState();
const failedScript = engine.run(`
  world.fill(1, 2, 3, 'energy', 987);
  world.fill(2, 2, 3, 'density', 0.9);
  Math.random();
  Math.random();
  throw new Error('injected script failure');
`);
assert.equal(failedScript.success, false, 'a throwing script must fail');
assert.match(failedScript.log.join('; '), /injected script failure/);
assert.deepEqual([...sim.grid.buffer], [...beforeFailureBuffer],
  'failed script must restore every grid field');
assert.equal(engine.snapshotRandomState(), beforeFailureRng,
  'failed script must restore its PRNG state');
assert.equal(sim.grid.buffer[sim.grid.idx(1,2,3)], beforeFailureBuffer[sim.grid.idx(1,2,3)],
  'the first mutated cell must be rolled back');

const asyncResult = engine.run('return Promise.resolve("not synchronous")');
assert.equal(asyncResult.success, false, 'async script result must be rejected inside synchronous transaction');
assert.match(asyncResult.log.join('; '), /must remain synchronous/);
assert.deepEqual([...sim.grid.buffer], [...beforeFailureBuffer],
  'rejected asynchronous result must not leave grid mutations behind');
assert.equal(engine.snapshotRandomState(), beforeFailureRng,
  'rejected asynchronous script must restore RNG state');
console.log("ScriptEngine transactional mutation and RNG recovery: PASS");
