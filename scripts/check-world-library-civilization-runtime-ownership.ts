import assert from "node:assert/strict";
import { CivilizationRuntime } from "../src/worldLibrary/CivilizationRuntime";
import { worldResourceEconomy } from "../src/worldLibrary/WorldResourceEconomy";

const resourcesBefore = worldResourceEconomy.snapshot();
try {
  const runtime = new CivilizationRuntime();

  // Produce two source branches, including an arbitrary branch ID that
  // deliberately occupies the next deterministic fork suffix.
  const origin = runtime.evaluate("origin", "village");
  runtime.tick(origin, 1);

  const reserved = runtime.evaluate("reserved-state", "village");
  reserved.memory.branchId = "origin-cf-3";
  runtime.tick(reserved, 1);

  const fork = runtime.forkBranch("origin", {
    reason: "Verify collision-safe counterfactual branch identity",
  });
  assert.ok(fork);
  assert.equal(fork.branchId, "origin-cf-4",
    "fork allocation must skip a stable ID that is already owned by another branch");
  assert.equal(runtime.branchesList().filter(branch => branch.branchId === fork.branchId).length, 1);

  const save = runtime.serializeState();
  const originSave = save.branches.find(branch => branch.branchId === "origin");
  const forkStateSave = save.branchStates.find(entry => entry.branchId === fork.branchId);
  assert.ok(originSave?.history.length);
  assert.ok(forkStateSave);

  const savedOriginPopulation = originSave.history.at(-1).population;
  const savedForkPopulation = forkStateSave.state.settlement.population;

  // Mutating live branches after capture must not mutate the captured save.
  const liveOrigin = runtime.branchSnapshot("origin");
  const liveForkState = runtime.branchState(fork.branchId);
  assert.ok(liveOrigin);
  assert.ok(liveForkState);
  liveOrigin.population += 11;
  liveForkState.settlement.population += 17;
  assert.equal(originSave.history.at(-1).population, savedOriginPopulation,
    "serialized branch history must be detached from live history");
  assert.equal(forkStateSave.state.settlement.population, savedForkPopulation,
    "serialized branch state must be detached from the live branch state");

  // Mutating the save must not mutate the live runtime either.
  originSave.history.at(-1).population = -100;
  forkStateSave.state.settlement.population = -200;
  assert.notEqual(runtime.branchSnapshot("origin")?.population, -100);
  assert.notEqual(runtime.branchState(fork.branchId)?.settlement.population, -200);

  const restoreInput = runtime.serializeState();
  const restored = new CivilizationRuntime();
  const restoreResult = restored.restoreState(restoreInput);
  assert.equal(restoreResult.restored, true,
    "every branch state must have a corresponding branch history, even when analytical history-only branches exist");
  assert.equal(restored.branchSnapshot(fork.branchId)?.branchId, fork.branchId);

  const restoredOriginPopulation = restored.branchSnapshot("origin")?.population;
  const restoredForkPopulation = restored.branchState(fork.branchId)?.settlement.population;
  assert.notEqual(restoredOriginPopulation, undefined);
  assert.notEqual(restoredForkPopulation, undefined);

  // Mutating caller-owned restore input after commit must not mutate restored state.
  restoreInput.branches.find(branch => branch.branchId === "origin")!.history.at(-1)!.population = -300;
  restoreInput.branchStates.find(entry => entry.branchId === fork.branchId)!.state.settlement.population = -400;
  assert.equal(restored.branchSnapshot("origin")?.population, restoredOriginPopulation);
  assert.equal(restored.branchState(fork.branchId)?.settlement.population, restoredForkPopulation);

  // Duplicate branch IDs must be rejected before any of the live maps change.
  const invalidRestore = restored.serializeState();
  invalidRestore.branches.push({
    branchId: "origin",
    history: structuredClone(invalidRestore.branches.find(branch => branch.branchId === "origin")!.history),
  });
  const beforeRejectedRestore = restored.serializeState();
  assert.throws(
    () => restored.restoreState(invalidRestore),
    /invalid or duplicate branch ID/,
  );
  assert.deepEqual(restored.serializeState(), beforeRejectedRestore,
    "a rejected branch restore must leave all previously published runtime maps unchanged");

  console.log("CivilizationRuntime branch identity, snapshot isolation and atomic restore: PASS");
} finally {
  worldResourceEconomy.restore(resourcesBefore);
}
