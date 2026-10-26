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
const processJs = await compile("src/process/ProcessDef.ts");
const processUrl = `data:text/javascript;base64,${Buffer.from(processJs).toString("base64")}`;
const lawJs = await compile("src/laws/MetaLaw.ts");
const lawUrl = `data:text/javascript;base64,${Buffer.from(lawJs).toString("base64")}`;
const materialJs = await compile("src/materials/MaterialDef.ts");
const materialUrl = `data:text/javascript;base64,${Buffer.from(materialJs).toString("base64")}`;
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
  [/from ['"]\.\.\/process\/ProcessDef['"]/, `from "${processUrl}"`],
  [/from ['"]\.\.\/laws\/MetaLaw['"]/, `from "${lawUrl}"`],
  [/from ['"]\.\.\/materials\/MaterialDef['"]/, `from "${materialUrl}"`],
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
function frameKeys(frame) {
  assert.ok(frame?.ab instanceof ArrayBuffer, "expected a worker frame payload");
  const view = new DataView(frame.ab);
  const count = view.getUint32(0, true);
  const keys = [];
  let offset = 4;
  for (let i = 0; i < count; i++) {
    keys.push(view.getUint32(offset, true));
    offset += 4 + CHUNK_FLOATS * 4;
  }
  assert.equal(offset, frame.ab.byteLength, "frame payload must have exact declared length");
  return keys;
}
const initial = send("snapshot").find(message => message.cmd === "snapshot").data.snap;
const payload = new Float32Array(CHUNK_FLOATS);
payload[0] = 321;

send("restoreBegin", { restoreId: 1, expected: 1 });
const firstChunkMessages = send("restoreChunk", { restoreId: 1, key: 0, data: payload });
assert.equal(last("restoreChunkAck").data.accepted, true);
assert.equal(firstChunkMessages.some(message => message.cmd === "frame"), false,
  "restore preparation must not publish uncommitted chunk state");
const prepared = send("restoreEnd", { restoreId: 1 }).find(message => message.cmd === "restoreComplete");
assert.equal(prepared.data.complete, true);
assert.equal(prepared.data.prepared, true);
assert.equal(messages.some(message => message.cmd === "restoreCommitted" && message.data.restoreId === 1), false,
  "restoreEnd must prepare, not commit or discard the rollback image");
const abortMessages = send("restoreAbort", { restoreId: 1 });
const aborted = abortMessages.find(message => message.cmd === "restoreAborted");
assert.equal(aborted.data.aborted, true);
assert.ok(abortMessages.some(message => message.cmd === "frame"),
  "abort must publish the rolled-back state to the main thread");
const afterAbort = send("snapshot").find(message => message.cmd === "snapshot").data.snap;
assert.deepEqual(afterAbort, initial, "abort after prepare must restore the exact pre-restore chunk set");

send("restoreBegin", { restoreId: 2, expected: 1 });
send("restoreChunk", { restoreId: 2, key: 0, data: payload });
const ready = send("restoreEnd", { restoreId: 2 }).find(message => message.cmd === "restoreComplete");
assert.equal(ready.data.prepared, true);
const commitMessages = send("restoreCommit", { restoreId: 2 });
const committed = commitMessages.find(message => message.cmd === "restoreCommitted");
assert.equal(committed.data.committed, true);
const committedFrame = commitMessages.find(message => message.cmd === "frame");
assert.ok(committedFrame, "commit must publish the authoritative restored state immediately");
assert.ok(frameKeys(committedFrame).includes(0));
const afterCommit = send("snapshot").find(message => message.cmd === "snapshot").data.snap;
assert.equal(afterCommit.length, 1);
assert.equal(afterCommit[0].key, 0);
assert.equal(afterCommit[0].data[0], 321);

send("restoreBegin", { restoreId: 3, expected: 2 });
send("restoreChunk", { restoreId: 3, key: 1, data: payload });
const rejectedMessages = send("restoreEnd", { restoreId: 3 });
const rejected = rejectedMessages.find(message => message.cmd === "restoreComplete");
assert.equal(rejected.data.complete, false, "missing chunks must reject preparation");
assert.ok(rejectedMessages.some(message => message.cmd === "frame"),
  "failed preparation must publish the rolled-back state");
const afterRejected = send("snapshot").find(message => message.cmd === "snapshot").data.snap;
assert.deepEqual(afterRejected, afterCommit, "failed preparation must roll back immediately");


send("restoreBegin", { restoreId: 4, expected: 1 });
send("restoreChunk", { restoreId: 4, key: 1, data: payload });
const replacementReady = send("restoreEnd", { restoreId: 4 }).find(message => message.cmd === "restoreComplete");
assert.equal(replacementReady.data.prepared, true);
const replacementMessages = send("restoreCommit", { restoreId: 4 });
const replacementCommit = replacementMessages.find(message => message.cmd === "restoreCommitted");
assert.equal(replacementCommit.data.committed, true);
const replacementFrame = replacementMessages.find(message => message.cmd === "frame");
assert.ok(replacementFrame, "replacement commit must publish its final frame immediately");
assert.ok(frameKeys(replacementFrame).includes(0),
  "replacement commit frame must include a tombstone for the omitted old chunk");
const afterReplacement = send("snapshot").find(message => message.cmd === "snapshot").data.snap;
assert.equal(afterReplacement.length, 1, "committed restore must replace, not merge with, the previous chunk set");
assert.equal(afterReplacement[0].key, 1, "chunk omitted from replacement snapshot must be removed");
const nextFrame = send("tick", { speed: 1 }).find(message => message.cmd === "frame");
assert.ok(nextFrame, "worker should continue publishing simulation frames after restore commit");


send("restoreBegin", { restoreId: 5, expected: 0 });
const emptyReady = send("restoreEnd", { restoreId: 5 }).find(message => message.cmd === "restoreComplete");
assert.equal(emptyReady.data.complete, true, "empty snapshots should be valid atomic restore targets");
assert.equal(emptyReady.data.prepared, true);
const emptyCommitMessages = send("restoreCommit", { restoreId: 5 });
const emptyCommit = emptyCommitMessages.find(message => message.cmd === "restoreCommitted");
assert.equal(emptyCommit.data.committed, true);
const emptyCommitFrame = emptyCommitMessages.find(message => message.cmd === "frame");
assert.ok(emptyCommitFrame, "empty restore commit must publish cleanup immediately");
assert.ok(frameKeys(emptyCommitFrame).includes(1),
  "empty restore frame must tombstone every previously existing chunk");
assert.deepEqual(send("snapshot").find(message => message.cmd === "snapshot").data.snap, [],
  "committing an empty snapshot must clear the entire prior chunk set");
const emptyFrame = send("tick", { speed: 1 }).find(message => message.cmd === "frame");
assert.ok(emptyFrame, "worker should continue ticking after empty restore");

console.log("PASS: restoreEnd prepares without committing worker state");
console.log("PASS: restoreAbort rolls back a prepared restore");
console.log("PASS: restoreCommit makes prepared chunks durable in worker state");
console.log("PASS: incomplete restore preparation rolls back atomically");
