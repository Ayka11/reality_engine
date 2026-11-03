import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const sculptManagerSource = await readFile(new URL("src/sculpt/SculptManager.ts", root), "utf8");
const mainSource = await readFile(new URL("src/main.ts", root), "utf8");
assert.match(
  sculptManagerSource,
  /this\.onBeforeChange\?\.\(\);\s*this\.lastStroke = await this\.brushEngine\.applyCustomStroke/,
  "custom sculpt writes must invalidate in-flight GPU readback before mutating the grid",
);
assert.match(
  sculptManagerSource,
  /this\.onBeforeChange\?\.\(\);\s*this\.lastStroke = await this\.brushEngine\.applyStroke/,
  "ordinary sculpt writes must invalidate in-flight GPU readback before mutating the grid",
);
assert.match(
  sculptManagerSource,
  /undo\(\): BrushStroke \| null \{\s*if \(this\.brushEngine\.historyLength === 0\) return null;\s*this\.onBeforeChange\?\.\(\);\s*const stroke = this\.brushEngine\.undo\(\);/,
  "sculpt undo must invalidate in-flight GPU readback before restoring history",
);
assert.match(
  sculptManagerSource,
  /redo\(\): BrushStroke \| null \{\s*if \(this\.brushEngine\.redoLength === 0\) return null;\s*this\.onBeforeChange\?\.\(\);\s*const stroke = this\.brushEngine\.redo\(\);/,
  "sculpt redo must invalidate in-flight GPU readback before restoring history",
);
assert.match(
  mainSource,
  /new SculptManager\(sim\.grid,\s*\(\) => sim\.syncToGPU\(\),\s*\(\) => sim\.invalidatePendingGPUReadback\(\)\)/,
  "the live sculpt manager must be wired to the engine invalidation boundary",
);
const cache = new Map();
async function load(path) {
  if (cache.has(path)) return cache.get(path);
  const source = await readFile(new URL(path, root), "utf8");
  let js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const imports = [...js.matchAll(/from\s+["'](\.\/?[^"']+)["']/g)];
  for (const match of imports) {
    const specifier = match[1];
    const target = specifier.endsWith(".ts") ? specifier : specifier + ".ts";
    const childPath = path.split("/").slice(0, -1).concat(target).join("/");
    const child = await load(childPath);
    js = js.replace(match[0], match[0].replace(specifier, child));
  }
  const url = "data:text/javascript;base64," + Buffer.from(js).toString("base64");
  cache.set(path, url);
  return url;
}

const { MutableWorldFieldProvider } = await import(await load("src/infinity/MutableWorldFieldProvider.ts"));
const { AuthoritativeSculptTransactionCoordinator } = await import(await load("src/infinity/AuthoritativeSculptTransactionCoordinator.ts"));
const { RuntimeProvenance } = await import(await load("src/infinity/RuntimeProvenance.ts"));

const aliasSafeProvenance = new RuntimeProvenance()
const callerPayload = {
  nested: { label: "original-input" },
  records: [{ value: 1 }],
}
const returnedEvent = aliasSafeProvenance.record("brush", callerPayload)
callerPayload.nested.label = "caller-mutated"
callerPayload.records[0].value = 99
returnedEvent.payload.nested.label = "returned-event-mutated"
returnedEvent.payload.records[0].value = 98
const returnedTrace = aliasSafeProvenance.getTrace()
returnedTrace.events[0].payload.nested.label = "trace-snapshot-mutated"
returnedTrace.events[0].payload.records[0].value = 97
assert.deepEqual(aliasSafeProvenance.getTrace().events[0].payload, {
  nested: { label: "original-input" },
  records: [{ value: 1 }],
}, "caller, returned-event and getTrace payload mutations must not alter stored provenance")

const worldStatePayload = { nested: { seed: "committed-seed" } }
const worldStateEvent = aliasSafeProvenance.record("world-state", worldStatePayload)
worldStatePayload.nested.seed = "mutated-caller-seed"
worldStateEvent.payload.nested.seed = "mutated-returned-seed"
const worldStateSnapshot = aliasSafeProvenance.getTrace()
worldStateSnapshot.latestWorldState.nested.seed = "mutated-snapshot-seed"
worldStateSnapshot.events[1].payload.nested.seed = "mutated-event-snapshot-seed"
assert.deepEqual(aliasSafeProvenance.getTrace().latestWorldState,
  { nested: { seed: "committed-seed" } },
  "latestWorldState and its source event must be isolated from caller references")

const eventsBeforeUncloneablePayload = aliasSafeProvenance.getTrace().events.length
assert.throws(
  () => aliasSafeProvenance.record("brush", { callback: () => true }),
  /clone/i,
  "non-cloneable provenance payloads must be rejected",
)
assert.equal(aliasSafeProvenance.getTrace().events.length, eventsBeforeUncloneablePayload,
  "a rejected provenance payload must not append a partial event")

const provenance = new RuntimeProvenance()
const provenanceRoot = provenance.record("preset", { name: "baseline" })
const previousWorldState = provenance.record("world-state", { seed: "stable" })
const rejectedWorldState = provenance.record("world-state", { seed: "rejected" })
assert.equal(provenance.rollbackLast(rejectedWorldState.id), true,
  "a failed last world-state event must be removable")
assert.deepEqual(provenance.getTrace().events.map(event => event.id),
  [provenanceRoot.id, previousWorldState.id])
assert.deepEqual(provenance.getTrace().latestWorldState, { seed: "stable" },
  "rolling back a world-state event must restore the previous latestWorldState")
assert.equal(provenance.rollbackLast(provenanceRoot.id), false,
  "provenance rollback must refuse to remove a non-latest event")
const rejectedBrush = provenance.record("brush", { source: "invalid-input" })
assert.equal(provenance.rollbackLast(rejectedBrush.id), true)
assert.deepEqual(provenance.getTrace().latestWorldState, { seed: "stable" },
  "rolling back a non-world-state event must preserve latestWorldState")
const nextCommittedEvent = provenance.record("brush", { source: "valid-input" })
assert.equal(nextCommittedEvent.parentId, previousWorldState.id,
  "the next committed event must not inherit a parent reference to a rejected event")
const isolatedProvenance = new RuntimeProvenance()
const onlyWorldState = isolatedProvenance.record("world-state", { seed: "temporary" })
assert.equal(isolatedProvenance.rollbackLast(onlyWorldState.id), true)
assert.equal(isolatedProvenance.getTrace().latestWorldState, undefined,
  "rolling back the only world-state event must clear latestWorldState")

const validParentTrace = new RuntimeProvenance()
const validParent = validParentTrace.record("law", { name: "parent" })
validParentTrace.record("brush", { source: "child" }, validParent.id)
assert.deepEqual(validParentTrace.validate(), { valid: true, errors: [] },
  "a parent reference to an earlier event must remain valid")

const selfParentTrace = new RuntimeProvenance()
const selfParentEvent = selfParentTrace.record("preset", { name: "self-parent-candidate" })
selfParentTrace.trace.events[0].parentId = selfParentEvent.id
const selfParentValidation = selfParentTrace.validate()
assert.equal(selfParentValidation.valid, false, "self-parent references must be rejected")
assert.ok(selfParentValidation.errors.some(error => error.includes("parent")),
  "self-parent rejection must report a parent validation error")

const missingParentTrace = new RuntimeProvenance()
missingParentTrace.record("preset", { name: "missing-parent" }, "event-that-does-not-exist")
assert.equal(missingParentTrace.validate().valid, false,
  "references to missing parent events must be rejected")

const forwardParentTrace = new RuntimeProvenance()
forwardParentTrace.record("preset", { name: "forward-child" }, "future-parent-id")
const futureParent = forwardParentTrace.record("law", { name: "future-parent" })
forwardParentTrace.trace.events[0].parentId = futureParent.id
assert.equal(forwardParentTrace.validate().valid, false,
  "references to future events must be rejected even when that ID exists later in the trace")

// Portable provenance traces must validate and restore atomically, retaining
// event identity, ordered parent references and the canonical latest world state.
const portableProvenance = new RuntimeProvenance()
portableProvenance.record("preset", { name: "portable-preset" })
portableProvenance.record("law", { name: "portable-law" })
portableProvenance.record("brush", { delta: { energy: 3 } })
portableProvenance.record("world-state", { seed: "portable-seed", revision: 4 })
const portableTrace = portableProvenance.getTrace()
const restoredProvenance = new RuntimeProvenance()
assert.deepEqual(restoredProvenance.restore(portableTrace), portableTrace,
  "valid runtime provenance trace must survive detached restore")
const portableTraceBeforeInvalidRestore = restoredProvenance.getTrace()
const invalidTraceCases = [
  { ...portableTrace, schemaVersion: "reality-runtime-provenance-v0" },
  { ...portableTrace, traceId: "" },
  { ...portableTrace, events: [{ ...portableTrace.events[0], timestamp: Number.MAX_SAFE_INTEGER + 1 }] },
  { ...portableTrace, events: [{ ...portableTrace.events[0], payload: [] }] },
  { ...portableTrace, events: [{ ...portableTrace.events[0], parentId: "missing-parent" }] },
  { ...portableTrace, events: [portableTrace.events[0], portableTrace.events[0]] },
  { ...portableTrace, latestWorldState: [] },
]
for (const invalidTrace of invalidTraceCases) {
  assert.throws(() => restoredProvenance.restore(invalidTrace),
    /Invalid runtime provenance trace/,
    "malformed provenance traces must fail closed")
  assert.deepEqual(restoredProvenance.getTrace(), portableTraceBeforeInvalidRestore,
    "failed provenance restore must not replace the existing trace")
}
const expectedPortableParent = portableTrace.events.at(-1).id
const appendedPortableEvent = restoredProvenance.record("brush", { delta: { energy: 1 } })
assert.equal(appendedPortableEvent.parentId, expectedPortableParent,
  "new events after restore must continue the imported parent chain")
assert.ok(!portableTrace.events.some(event => event.id === appendedPortableEvent.id),
  "new event IDs must not collide with IDs already present in the imported trace")

const base = {
  id: "test-base",
  version: "test-base-v1",
  sample: () => ({
    energy: 30, density: .9, information: 10, entropy: .02,
    temperature: 20, biology: .1, material: 1,
  }),
};
const field = new MutableWorldFieldProvider(base);
const coordinator = new AuthoritativeSculptTransactionCoordinator(field);

const initial = field.serialize();
const first = coordinator.commit(() => field.apply({
  kind: "brush", x: 4, y: 5, z: 6, radius: 3,
  delta: { energy: 10, information: 2 },
  metadata: { transaction: "first" },
}));
const afterFirst = field.serialize();
assert.equal(first.transactionId, 1);
assert.equal(first.mutationId, 1);
assert.equal(coordinator.historyLength, 1);
assert.equal(coordinator.redoLength, 0);
assert.equal(field.sample(4,5,6).energy, 40);

const second = coordinator.commit(() => field.apply({
  kind: "brush", x: 4, y: 5, z: 6, radius: 3,
  scale: { density: .5 },
  metadata: { transaction: "second" },
}));
const afterSecond = field.serialize();
assert.equal(second.transactionId, 2);
assert.equal(coordinator.historyLength, 2);
assert.equal(field.sample(4,5,6).density, .45);

const undone = coordinator.undo();
assert.equal(undone?.transactionId, 2);
assert.deepEqual(field.serialize(), afterFirst);
assert.equal(coordinator.historyLength, 1);
assert.equal(coordinator.redoLength, 1);

const redone = coordinator.redo();
assert.equal(redone?.transactionId, 2);
assert.deepEqual(field.serialize(), afterSecond);
assert.equal(coordinator.historyLength, 2);
assert.equal(coordinator.redoLength, 0);

const undoneAgain = coordinator.undo();
assert.equal(undoneAgain?.transactionId, 2);
const third = coordinator.commit(() => field.apply({
  kind: "brush", x: 4, y: 5, z: 6, radius: 3,
  delta: { entropy: .1 },
  metadata: { transaction: "third" },
}));
assert.equal(third.transactionId, 3);
assert.equal(coordinator.redoLength, 0);
assert.deepEqual(field.serialize().mutations.map(m => m.metadata?.transaction), ["first", "third"]);

coordinator.undo();
coordinator.undo();
assert.deepEqual(field.serialize(), initial);
assert.equal(coordinator.historyLength, 0);
assert.equal(coordinator.redoLength, 2);

// External field changes must never be overwritten by a stale undo snapshot.
const guardedField = new MutableWorldFieldProvider(base);
const guardedCoordinator = new AuthoritativeSculptTransactionCoordinator(guardedField);
guardedCoordinator.commit(() => guardedField.apply({
  kind: "brush", x: 1, y: 2, z: 3, radius: 2,
  delta: { energy: 5 }, metadata: { transaction: "coordinated" },
}));
guardedField.apply({
  kind: "brush", x: 8, y: 9, z: 10, radius: 2,
  delta: { information: 7 }, metadata: { transaction: "external" },
});
const stateBeforeConflictedUndo = guardedField.serialize();
assert.equal(guardedCoordinator.undo(), null, "undo must refuse a stale snapshot");
assert.deepEqual(guardedField.serialize(), stateBeforeConflictedUndo, "conflicted undo must preserve external mutation");
assert.equal(guardedCoordinator.historyLength, 1, "conflicted undo must keep history available");

// Failed provider restores must not consume undo/redo history.
const restoreFailureField = new MutableWorldFieldProvider(base);
const restoreFailureCoordinator = new AuthoritativeSculptTransactionCoordinator(restoreFailureField);
restoreFailureCoordinator.commit(() => restoreFailureField.apply({
  kind: "brush", x: 3, y: 4, z: 5, radius: 2,
  delta: { energy: 6 }, metadata: { transaction: "restore-failure" },
}));
const originalRestore = restoreFailureField.restore.bind(restoreFailureField);
restoreFailureField.restore = () => { throw new Error("simulated restore failure"); };
assert.throws(() => restoreFailureCoordinator.undo(), /simulated restore failure/);
assert.equal(restoreFailureCoordinator.historyLength, 1,
  "failed undo restore must retain the undo entry");
assert.equal(restoreFailureCoordinator.redoLength, 0,
  "failed undo restore must not create a redo entry");
restoreFailureField.restore = originalRestore;
assert.ok(restoreFailureCoordinator.undo(),
  "undo must remain retryable after a failed restore");

const originalRedoRestore = restoreFailureField.restore.bind(restoreFailureField);
restoreFailureField.restore = () => { throw new Error("simulated redo restore failure"); };
assert.throws(() => restoreFailureCoordinator.redo(), /simulated redo restore failure/);
assert.equal(restoreFailureCoordinator.historyLength, 0,
  "failed redo restore must not create an undo entry");
assert.equal(restoreFailureCoordinator.redoLength, 1,
  "failed redo restore must retain the redo entry");
restoreFailureField.restore = originalRedoRestore;
assert.ok(restoreFailureCoordinator.redo(),
  "redo must remain retryable after a failed restore");

// A callback that mutates the field and then throws must leave no partial mutation.
const atomicField = new MutableWorldFieldProvider(base);
const atomicCoordinator = new AuthoritativeSculptTransactionCoordinator(atomicField);
const atomicInitial = atomicField.serialize();
assert.throws(() => atomicCoordinator.commit(() => {
  atomicField.apply({
    kind: "brush", x: 1, y: 2, z: 3, radius: 2,
    delta: { energy: 11 }, metadata: { transaction: "partial-failure" },
  });
  throw new Error("simulated transaction failure");
}), /simulated transaction failure/);
assert.deepEqual(atomicField.serialize(), atomicInitial, "failed commit must roll back partial field mutation");
assert.equal(atomicCoordinator.historyLength, 0, "failed commit must not create undo history");

// Invalid callback results must roll back any synchronous field mutation.
const invalidReturnField = new MutableWorldFieldProvider(base);
const invalidReturnCoordinator = new AuthoritativeSculptTransactionCoordinator(invalidReturnField);
const invalidReturnInitial = invalidReturnField.serialize();
assert.throws(() => invalidReturnCoordinator.commit(() => {
  invalidReturnField.apply({
    kind: "brush", x: 2, y: 3, z: 4, radius: 2,
    delta: { energy: 13 }, metadata: { transaction: "invalid-return" },
  });
  return undefined;
}), /newly committed mutation/);
assert.deepEqual(invalidReturnField.serialize(), invalidReturnInitial,
  "invalid callback result must roll back its synchronous field write");
assert.equal(invalidReturnCoordinator.historyLength, 0);

// Async callbacks must be rejected before invocation, even if Symbol.toStringTag is spoofed.
const asyncContractField = new MutableWorldFieldProvider(base);
const asyncContractCoordinator = new AuthoritativeSculptTransactionCoordinator(asyncContractField);
const asyncContractInitial = asyncContractField.serialize();
let asyncContractInvoked = false;
const spoofedAsyncCallback = async () => {
  asyncContractInvoked = true;
  asyncContractField.apply({
    kind: "brush", x: 2, y: 3, z: 4, radius: 2,
    delta: { energy: 99 }, metadata: { transaction: "spoofed-async" },
  });
  await Promise.resolve();
};
Object.defineProperty(spoofedAsyncCallback, Symbol.toStringTag, { value: "Function" });
assert.throws(() => asyncContractCoordinator.commit(spoofedAsyncCallback), /must remain synchronous/);
await Promise.resolve();
assert.equal(asyncContractInvoked, false, "spoofed async callback must not be invoked");
assert.deepEqual(asyncContractField.serialize(), asyncContractInitial);

// Public commit/undo/redo results must not alias the coordinator's stored history.
const exposedField = new MutableWorldFieldProvider(base);
const exposedCoordinator = new AuthoritativeSculptTransactionCoordinator(exposedField);
const exposedInitial = exposedField.serialize();
const exposedCommit = exposedCoordinator.commit(() => exposedField.apply({
  kind: "brush", x: 4, y: 5, z: 6, radius: 3,
  delta: { energy: 7 }, metadata: { nested: { source: "history" } },
}));
const exposedCommittedState = exposedField.serialize();
exposedCommit.after.mutations[0].delta.energy = 777;
exposedCommit.mutation.metadata.nested.source = "caller-mutated";
assert.deepEqual(exposedField.serialize(), exposedCommittedState,
  "mutating commit return values must not change field state");
const exposedUndo = exposedCoordinator.undo();
assert.equal(exposedUndo?.transactionId, 1);
assert.deepEqual(exposedField.serialize(), exposedInitial);
exposedUndo.after.mutations[0].delta.energy = 888;
const exposedRedo = exposedCoordinator.redo();
assert.equal(exposedRedo?.transactionId, 1);
assert.deepEqual(exposedField.serialize(), exposedCommittedState,
  "mutating an undo result must not corrupt redo history");
exposedRedo.after.mutations[0].delta.energy = 999;
const exposedUndoAgain = exposedCoordinator.undo();
assert.equal(exposedUndoAgain?.transactionId, 1);
assert.deepEqual(exposedField.serialize(), exposedInitial,
  "mutating a redo result must not corrupt undo history");

// Redo must likewise refuse to overwrite a field changed after undo.
const redoGuardField = new MutableWorldFieldProvider(base);
const redoGuardCoordinator = new AuthoritativeSculptTransactionCoordinator(redoGuardField);
redoGuardCoordinator.commit(() => redoGuardField.apply({
  kind: "brush", x: 1, y: 2, z: 3, radius: 2,
  delta: { energy: 5 }, metadata: { transaction: "redo-candidate" },
}));
assert.ok(redoGuardCoordinator.undo());
redoGuardField.apply({
  kind: "brush", x: 8, y: 9, z: 10, radius: 2,
  delta: { information: 7 }, metadata: { transaction: "external-after-undo" },
});
const stateBeforeConflictedRedo = redoGuardField.serialize();
assert.equal(redoGuardCoordinator.redo(), null, "redo must refuse a stale before-state");
assert.deepEqual(redoGuardField.serialize(), stateBeforeConflictedRedo, "conflicted redo must preserve external mutation");
assert.equal(redoGuardCoordinator.redoLength, 1, "conflicted redo must keep redo history available");

// Paint replacement semantics: exact target at the brush center and a radial blend at the edge.
const paintField = new MutableWorldFieldProvider(base);
paintField.apply({
  kind: "brush", x: 4, y: 5, z: 6, radius: 2,
  operations: { energy: { mode: "set", value: 4, weighting: "radial" } },
  metadata: { brush: "Paint" },
});
assert.equal(paintField.sample(4,5,6).energy, 4, "Paint must replace the authoritative center value");
assert.equal(paintField.sample(5,5,6).energy, 17, "Paint must blend toward target using radial weight");

console.log("PASS: authoritative sculpt transaction coordinator");
console.log("PASS: conflicting undo/redo preserves external field mutations");
