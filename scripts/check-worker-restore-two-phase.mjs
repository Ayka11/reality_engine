import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);
async function compile(path, replacements = []) {
  let source = await readFile(new URL(path, root), "utf8");
  let js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [pattern, replacement] of replacements) js = js.replace(pattern, replacement);
  return js;
}
const gridJs = await compile("src/core/ChunkGrid.ts");
const gridUrl = `data:text/javascript;base64,${Buffer.from(gridJs).toString("base64")}`;
const mathJs = await compile("src/brushes/BrushMath.ts");
const mathUrl = `data:text/javascript;base64,${Buffer.from(mathJs).toString("base64")}`;
const geometryJs = await compile("src/brushes/BrushGeometry.ts", [
  [/from ['"]\.\/BrushMath['"]/, `from "${mathUrl}"`],
]);
const geometryUrl = `data:text/javascript;base64,${Buffer.from(geometryJs).toString("base64")}`;
const { CHUNK_FLOATS } = await import(gridUrl);
const messages = [];
globalThis.self = {
  onmessage: null,
  postMessage(message) { messages.push(message); },
};
const workerJs = await compile("src/core/ChunkSimWorker.ts", [
  [/from ['"]\.\/ChunkGrid['"]/, `from "${gridUrl}"`],
  [/from ['"]\.\.\/brushes\/BrushGeometry['"]/, `from "${geometryUrl}"`],
  [/from ['"]\.\.\/brushes\/BrushMath['"]/, `from "${mathUrl}"`],
]);
await import(`data:text/javascript;base64,${Buffer.from(workerJs).toString("base64")}`);
assert.equal(typeof globalThis.self.onmessage, "function");

function send(cmd, data = {}) {
  const before = messages.length;
  globalThis.self.onmessage({ data: { cmd, data } });
  return messages.slice(before);
}
function last(cmd) {
  const found = [...messages].reverse().find(message => message.cmd === cmd);
  assert.ok(found, `expected worker message ${cmd}`);
  return found;
}
const initial = send("snapshot").find(message => message.cmd === "snapshot").data.snap;
const payload = new Float32Array(CHUNK_FLOATS);
payload[0] = 321;

send("restoreBegin", { restoreId: 1, expected: 1 });
send("restoreChunk", { restoreId: 1, key: 0, data: payload });
assert.equal(last("restoreChunkAck").data.accepted, true);
const prepared = send("restoreEnd", { restoreId: 1 }).find(message => message.cmd === "restoreComplete");
assert.equal(prepared.data.complete, true);
assert.equal(prepared.data.prepared, true);
assert.equal(messages.some(message => message.cmd === "restoreCommitted" && message.data.restoreId === 1), false,
  "restoreEnd must prepare, not commit or discard the rollback image");
const aborted = send("restoreAbort", { restoreId: 1 }).find(message => message.cmd === "restoreAborted");
assert.equal(aborted.data.aborted, true);
const afterAbort = send("snapshot").find(message => message.cmd === "snapshot").data.snap;
assert.deepEqual(afterAbort, initial, "abort after prepare must restore the exact pre-restore chunk set");

send("restoreBegin", { restoreId: 2, expected: 1 });
send("restoreChunk", { restoreId: 2, key: 0, data: payload });
const ready = send("restoreEnd", { restoreId: 2 }).find(message => message.cmd === "restoreComplete");
assert.equal(ready.data.prepared, true);
const committed = send("restoreCommit", { restoreId: 2 }).find(message => message.cmd === "restoreCommitted");
assert.equal(committed.data.committed, true);
const afterCommit = send("snapshot").find(message => message.cmd === "snapshot").data.snap;
assert.equal(afterCommit.length, 1);
assert.equal(afterCommit[0].key, 0);
assert.equal(afterCommit[0].data[0], 321);

send("restoreBegin", { restoreId: 3, expected: 2 });
send("restoreChunk", { restoreId: 3, key: 1, data: payload });
const rejected = send("restoreEnd", { restoreId: 3 }).find(message => message.cmd === "restoreComplete");
assert.equal(rejected.data.complete, false, "missing chunks must reject preparation");
const afterRejected = send("snapshot").find(message => message.cmd === "snapshot").data.snap;
assert.deepEqual(afterRejected, afterCommit, "failed preparation must roll back immediately");

console.log("PASS: restoreEnd prepares without committing worker state");
console.log("PASS: restoreAbort rolls back a prepared restore");
console.log("PASS: restoreCommit makes prepared chunks durable in worker state");
console.log("PASS: incomplete restore preparation rolls back atomically");
