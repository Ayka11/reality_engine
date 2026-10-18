import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const source = await readFile(new URL("src/world/ScriptEngine.ts", root), "utf8");
const cellModule = `export const CELL_FIELDS=24; export const F={ENERGY:0,DENSITY:1,INFORMATION:2,ENTROPY:3,TEMPERATURE:4,BIO_POTENTIAL:11,SIGNAL:17,MEM_FIELD:18};`;
const presetModule = `export const Presets={apply(){}};`;
const cellUrl = `data:text/javascript;base64,${Buffer.from(cellModule).toString("base64")}`;
const presetUrl = `data:text/javascript;base64,${Buffer.from(presetModule).toString("base64")}`;
let js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
js = js.replace(/from ['"]\.\.\/core\/CellState['"]/, `from "${cellUrl}"`);
js = js.replace(/from ['"]\.\/Presets['"]/, `from "${presetUrl}"`);
const { ScriptEngine } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

function makeSimulation() {
  const W=8,H=8,D=4,CELL_FIELDS=24;
  const grid = {
    W,H,D,buffer:new Float32Array(W*H*D*CELL_FIELDS),
    inBounds(x,y,z){return x>=0&&x<W&&y>=0&&y<H&&z>=0&&z<D;},
    clear(){this.buffer.fill(0);},
    idx(x,y,z){return (z*H*W+y*W+x)*CELL_FIELDS;},
    snapshot(){},
  };
  return {grid,laws:{},syncToGPU(){}};
}
function runScenario(engine) {
  const result=engine.run(`
    world.clear();
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
