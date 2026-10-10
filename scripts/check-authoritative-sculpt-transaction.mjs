import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);
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

console.log("PASS: authoritative sculpt transaction coordinator");
console.log("PASS: conflicting undo/redo preserves external field mutations");
