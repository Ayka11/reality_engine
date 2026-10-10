import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const source = await readFile(new URL("src/core/ChunkGrid.ts", root), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = "data:text/javascript;base64," + Buffer.from(javascript).toString("base64");
const { ChunkGrid, F } = await import(moduleUrl);
const grid = new ChunkGrid();

grid.set(12, 12, 12, F.E, 100);
grid.set(12, 12, 12, F.I, 50);
grid.paintSphere(12, 12, 12, 1, F.E, 20, "add");
assert.equal(grid.get(12, 12, 12, F.E), 120, "sphere add must preserve and increment existing field values");

grid.paintSphere(12, 12, 12, 1, F.E, 35, "set");
assert.equal(grid.get(12, 12, 12, F.E), 35, "sphere set must replace existing field values");

grid.eraseSphere(12, 12, 12, 1);
for (const field of [F.E, F.D, F.I, F.S, F.T, F.BIO]) {
  assert.equal(grid.get(12, 12, 12, field), 0, `erase must clear field ${field} at the brush center`);
}
assert.equal(grid.get(13, 12, 12, F.E), 0, "erase must clear neighboring cells inside the brush radius");

const worker = await readFile(new URL("src/core/ChunkSimWorker.ts", root), "utf8");
const page = await readFile(new URL("index.html", root), "utf8");
assert.match(worker, /mode === 'erase'[\s\S]*?grid\.eraseSphere\(x, y, z, r\)/, "worker paint protocol must dispatch erase to all-field sphere clearing");
assert.match(worker, /grid\.paintSphere\(x, y, z, r, f, v, mode === 'add' \? 'add' : 'set'\)/, "worker paint protocol must preserve add vs set semantics");
assert.match(page, /effectiveTool==='erase'\?'erase':effectiveTool==='paint'\?'set':'add'/, "active UI must send the correct worker mode for erase, paint, and inject");
assert.match(worker, /cmd\s*===\s*'undoSculpt'[\s\S]*?restoreChunks\(record\.before\)/, "worker must restore sparse chunks on sculpt undo");
assert.match(worker, /cmd\s*===\s*'redoSculpt'[\s\S]*?restoreChunks\(record\.after\)/, "worker must restore sparse chunks on sculpt redo");
assert.match(worker, /trackHistory \? captureChunks\(keys\) : null/, "worker paint history must be opt-in to avoid tracking unrelated worker edits");
assert.match(page, /window\.undoChunkSculpt\?\.\(\)/, "active UI undo must forward to sparse worker history");
assert.match(page, /window\.redoChunkSculpt\?\.\(\)/, "active UI redo must forward to sparse worker history");

// Execute the real worker handler against its real ChunkGrid to verify mixed
// SmartBrush + ordinary-paint undo/redo restores sparse chunk data, not just wiring.
const chunkGridUrl = "data:text/javascript;base64," + Buffer.from(javascript).toString("base64");
const workerSource = await readFile(new URL("src/core/ChunkSimWorker.ts", root), "utf8");
const workerJs = ts.transpileModule(workerSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace("from './ChunkGrid'", `from '${chunkGridUrl}'`);
const workerModuleUrl = "data:text/javascript;base64," + Buffer.from(workerJs).toString("base64");
const originalSelf = globalThis.self;
const workerMessages = [];
const workerSelf = { onmessage: null, postMessage: (message) => workerMessages.push(message) };
globalThis.self = workerSelf;
try {
  await import(workerModuleUrl);
  const dispatch = (cmd, data = {}) => workerSelf.onmessage({ data: { cmd, data } });
  const x = 17, y = 18, z = 19;
  const localOffset = (((z & 7) * 8 * 8) + ((y & 7) * 8) + (x & 7)) * 14;
  const cellEnergy = () => {
    dispatch("snapshot");
    const response = workerMessages.filter(message => message.cmd === "snapshot").at(-1);
    const chunkKeyValue = Math.floor(x / 8) + Math.floor(y / 8) * 16 + Math.floor(z / 8) * 256;
    const chunk = response.data.snap.find(item => item.key === chunkKeyValue);
    return chunk ? chunk.data[localOffset + F.E] : 0;
  };
  dispatch("brush", { name: "Forest", x, y, z, radius: 2, strength: 0.5 });
  const afterSmartBrush = cellEnergy();
  assert.ok(afterSmartBrush > 0, "SmartBrush must create sparse worker data");
  dispatch("paint", { x, y, z, f: F.E, v: 25, r: 0, mode: "add", trackHistory: true });
  const afterOrdinaryPaint = cellEnergy();
  assert.ok(afterOrdinaryPaint > afterSmartBrush, "ordinary paint must apply after SmartBrush");
  dispatch("undoSculpt");
  assert.equal(workerMessages.filter(message => message.cmd === "sculptHistoryApplied").at(-1)?.applied, true);
  assert.equal(cellEnergy(), afterSmartBrush, "mixed worker undo #1 must restore SmartBrush state");
  dispatch("undoSculpt");
  assert.equal(cellEnergy(), 0, "mixed worker undo #2 must restore baseline sparse state");
  dispatch("redoSculpt");
  assert.equal(cellEnergy(), afterSmartBrush, "mixed worker redo #1 must restore SmartBrush state");
  dispatch("redoSculpt");
  assert.equal(cellEnergy(), afterOrdinaryPaint, "mixed worker redo #2 must restore ordinary-paint state");
} finally {
  if (originalSelf === undefined) delete globalThis.self;
  else globalThis.self = originalSelf;
}
console.log("Chunk grid sculpt modes and sparse worker undo/redo: PASS");
