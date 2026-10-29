import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const agentSource = await readFile(new URL("src/simulation/AgentSystem.ts", root), "utf8");
const eventsSource = await readFile(new URL("src/world/WorldEvents.ts", root), "utf8");

const cellModule = "export const CELL_FIELDS=24; export const F={ENERGY:0,DENSITY:1,INFORMATION:2,ENTROPY:3,TEMPERATURE:4,PRESSURE:5,FIELD_X:6,FIELD_Y:7,FIELD_Z:8,LOCAL_TIME:9,CAUSALITY_ID:10,BIO_POTENTIAL:11,WAVE_PHASE:12,WAVE_AMP:13,GRAVITY_POT:14,MATERIAL_ID:15,CHEM_STATE:16,SIGNAL:17,MEM_FIELD:18,AGENT_MARK:19,ENTITY_ID:20,SPARE_1:21,SPARE_2:22,SPARE_3:23}; export class CellState { constructor(buffer,offset){this.buffer=buffer;this.offset=offset;} get(field){return this.buffer[this.offset+field]} set(field,value){this.buffer[this.offset+field]=value} get energy(){return this.get(F.ENERGY)} set energy(v){this.set(F.ENERGY,v)} get density(){return this.get(F.DENSITY)} set density(v){this.set(F.DENSITY,v)} get information(){return this.get(F.INFORMATION)} set information(v){this.set(F.INFORMATION,v)} get entropy(){return this.get(F.ENTROPY)} set entropy(v){this.set(F.ENTROPY,v)} get temperature(){return this.get(F.TEMPERATURE)} set temperature(v){this.set(F.TEMPERATURE,v)} get bioPotential(){return this.get(F.BIO_POTENTIAL)} set bioPotential(v){this.set(F.BIO_POTENTIAL,v)} get materialId(){return this.get(F.MATERIAL_ID)} set materialId(v){this.set(F.MATERIAL_ID,v)} }";
const cellUrl = "data:text/javascript;base64," + Buffer.from(cellModule).toString("base64");
const trackedModule = "export const INTERNAL_MUTABLE_BUFFER=Symbol('test-internal-mutable-buffer'); export function getMutableBuffer(owner,side='front'){return owner[INTERNAL_MUTABLE_BUFFER](side)}; export function withMutableBuffers(owner,mutation){if(typeof mutation!=='function')throw new TypeError('withMutableBuffers requires a synchronous callback');const end=typeof owner.beginMutation==='function'?owner.beginMutation():()=>{};try{const front=owner[INTERNAL_MUTABLE_BUFFER]('front');const back=owner[INTERNAL_MUTABLE_BUFFER]('back');const result=mutation(front,back);if(result&&typeof result.then==='function')throw new TypeError('withMutableBuffers callback must be synchronous');if(result!==undefined)throw new TypeError('withMutableBuffers callback must not return a value or buffer alias')}finally{end()}}";
const trackedUrl = "data:text/javascript;base64," + Buffer.from(trackedModule).toString("base64");
const gridModule = "import {CellState,CELL_FIELDS} from '" + cellUrl + "'; import {INTERNAL_MUTABLE_BUFFER} from '" + trackedUrl + "'; export class VoxelGrid { constructor(W,H,D){this.W=W;this.H=H;this.D=D;this.size=W*H*D;this.buffer=new Float32Array(this.size*CELL_FIELDS);this.backBuffer=new Float32Array(this.buffer.length)} [INTERNAL_MUTABLE_BUFFER](side='front'){return side==='back'?this.backBuffer:this.buffer} inBounds(x,y,z){return x>=0&&x<this.W&&y>=0&&y<this.H&&z>=0&&z<this.D} idx(x,y,z){return (z*this.H*this.W+y*this.W+x)*CELL_FIELDS} cell(x,y,z){return new CellState(this.buffer,this.idx(x,y,z))} cellAt(i){return new CellState(this.buffer,i*CELL_FIELDS)} clear(){this.buffer.fill(0);this.backBuffer.fill(0)} }";
const gridUrl = "data:text/javascript;base64," + Buffer.from(gridModule).toString("base64");
const materialModule = "export const MAT={VACUUM:0,STONE:1,SAND:2,CRYSTAL:3,METAL:4,MAGMA:5,ICE:6,ORGANIC_TISSUE:7,SPORES:8,MEMBRANE:9,BIOMASS:10,PLASMA:11,SUPERCONDUCTIVE_MATTER:12,INFORMATION_SUBSTRATE:13};";
const chemModule = "export const CHEM={GAS:0,LIQUID:1,SOLID:2,ORGANIC:3,REACTIVE:4};";
const materialUrl = "data:text/javascript;base64," + Buffer.from(materialModule).toString("base64");
const chemUrl = "data:text/javascript;base64," + Buffer.from(chemModule).toString("base64");

function compile(source, replacements) {
  let js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [pattern, url] of replacements) {
    js = js.replace(pattern, "from '" + url + "'");
  }
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
}
const { VoxelGrid } = await import(gridUrl);
const { AgentSystem } = await compile(agentSource, [
  [/from ['"]\.\.\/core\/VoxelGrid['"]/, gridUrl],
  [/from ['"]\.\.\/core\/CellState['"]/, cellUrl],
  [/from ['"]\.\.\/core\/TrackedFloat32Array['"]/, trackedUrl],
]);
const { WorldEvents } = await compile(eventsSource, [
  [/from ['"]\.\.\/core\/VoxelGrid['"]/, gridUrl],
  [/from ['"]\.\.\/core\/CellState['"]/, cellUrl],
  [/from ['"]\.\.\/materials\/MaterialDef['"]/, materialUrl],
  [/from ['"]\.\.\/chemistry\/ChemLayer['"]/, chemUrl],
  [/from ['"]\.\.\/core\/TrackedFloat32Array['"]/, trackedUrl],
]);

function makeGrid() {
  const grid = new VoxelGrid(16, 16, 12);
  for (let i = 0; i < grid.size; i++) {
    const base = i * 24;
    grid.buffer[base] = (i * 17) % 101;
    grid.buffer[base + 1] = ((i * 7) % 100) / 100;
    grid.buffer[base + 2] = (i * 3) % 97;
    grid.buffer[base + 3] = ((i * 11) % 100) / 100;
    grid.buffer[base + 4] = (i * 13) % 400;
    grid.buffer[base + 11] = ((i * 5) % 100) / 100;
  }
  return grid;
}
function runAgentScenario(system, grid) {
  system.seed(grid, 8);
  for (let i = 0; i < 18; i++) system.tick(grid, 1 / 60);
  return {
    grid: Array.from(grid.buffer),
    agents: system.getAgents(),
    rngState: system.snapshotRandomState(),
  };
}
function runEventScenario(events, grid) {
  events.trigger(grid, "solar_flare", 7);
  events.trigger(grid, "tectonic_shift", 8);
  events.trigger(grid, "entropy_collapse", 9);
  return {
    grid: Array.from(grid.buffer),
    events: events.snapshotRandomState(),
  };
}

const agents = new AgentSystem(0x1234abcd);
const agentGrid = makeGrid();
const agentGridBaseline = agentGrid.buffer.slice();
const agentCheckpoint = agents.snapshotRandomState();
const agentExpected = runAgentScenario(agents, agentGrid);
agents.clear();
agentGrid.buffer.set(agentGridBaseline);
agentGrid.backBuffer.fill(0);
agents.restoreRandomState(agentCheckpoint);
const agentReplay = runAgentScenario(agents, agentGrid);
assert.deepEqual(agentReplay, agentExpected, "AgentSystem replay must reproduce agents and grid after RNG restore");

const isolatedA = new AgentSystem(0x1111);
const isolatedB = new AgentSystem(0x2222);
const isolatedGridA = makeGrid();
const isolatedGridB = makeGrid();
isolatedA.seed(isolatedGridA, 1);
isolatedB.seed(isolatedGridB, 1);
assert.deepEqual(isolatedA.getAgents().map(agent => agent.id), [1]);
assert.deepEqual(isolatedB.getAgents().map(agent => agent.id), [1], "agent IDs must be scoped to each AgentSystem instance");
isolatedB.clear();
isolatedA.seed(isolatedGridA, 1);
assert.deepEqual(isolatedA.getAgents().map(agent => agent.id), [1, 2], "clearing another AgentSystem must not reset this instance's ID sequence");
isolatedB.seed(isolatedGridB, 1);
assert.deepEqual(isolatedB.getAgents().map(agent => agent.id), [1], "cleared AgentSystem must restart its own ID sequence");
for (const invalid of [0, -1, 0x100000000]) {
  assert.throws(() => agents.restoreRandomState(invalid), /Invalid AgentSystem PRNG state/);
}

const events = new WorldEvents(0x7654321);
const eventGrid = makeGrid();
const eventCheckpoint = events.snapshotRandomState();
const eventExpected = runEventScenario(events, eventGrid);
eventGrid.buffer.set(makeGrid().buffer);
events.restoreRandomState(eventCheckpoint);
const eventReplay = runEventScenario(events, eventGrid);
assert.deepEqual(eventReplay, eventExpected, "WorldEvents replay must reproduce triggered effects and history");

const autoEvents = new WorldEvents(0x2468ace);
const autoGrid = makeGrid();
autoEvents.restoreRandomState({ ...autoEvents.snapshotRandomState(), nextAuto: 1 });
const autoCheckpoint = autoEvents.snapshotRandomState();
const autoBuffer = autoGrid.buffer.slice();
const autoExpected = autoEvents.autoTick(autoGrid, 100);
const autoStateExpected = autoEvents.snapshotRandomState();
const autoGridExpected = Array.from(autoGrid.buffer);
autoGrid.buffer.set(autoBuffer);
autoEvents.restoreRandomState(autoCheckpoint);
const autoReplay = autoEvents.autoTick(autoGrid, 100);
assert.deepEqual(autoReplay, autoExpected, "automatic event selection must replay");
assert.deepEqual(Array.from(autoGrid.buffer), autoGridExpected, "automatic event effects must replay");
assert.deepEqual(autoEvents.snapshotRandomState(), autoStateExpected, "automatic interval and event history must replay");
assert.throws(() => events.restoreRandomState({ rngState: 0, nextAuto: -1, history: [] }), /Invalid WorldEvents snapshot/);
events.reset();
assert.deepEqual(events.snapshot(), eventCheckpoint,
  "reset must clear event history/interval and restore the constructor seed");

console.log("AgentSystem + WorldEvents deterministic RNG recovery: PASS");
