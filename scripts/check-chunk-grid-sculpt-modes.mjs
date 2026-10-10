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
console.log("Chunk grid sculpt modes: PASS");
