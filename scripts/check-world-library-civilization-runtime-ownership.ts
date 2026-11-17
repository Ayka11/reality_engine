import assert from "node:assert/strict";
import { CivilizationRuntime } from "../src/worldLibrary/CivilizationRuntime";
import { WorldResourceEconomy, worldResourceEconomy } from "../src/worldLibrary/WorldResourceEconomy";

const resourcesBefore = worldResourceEconomy.snapshot();
try {
  // The browser bootstrap publishes this economy object as a supported API.
  // Its backing Map and every read/write result must remain detached.
  const economy = new WorldResourceEconomy();
  assert.equal("resources" in economy, false,
    "resource records must not be reachable through a TypeScript-private Map property");
  assert.equal(Reflect.set(economy, "resources", new Map()), false,
    "resource economy must reject ordinary JavaScript shadow properties");
  assert.throws(() => Object.defineProperty(economy, "resources", { value: new Map() }), TypeError);

  const resourceInput = {
    semanticEntryId: "resource.ownership-test",
    amount: 60,
    capacity: 100,
    regeneration: 1,
    quality: 0.8,
    accessibility: 0.9,
  };
  const setResult = economy.set(resourceInput);
  resourceInput.amount = -10;
  setResult.amount = -20;
  assert.equal(economy.get("resource.ownership-test")?.amount, 60,
    "set must detach caller input and its returned state");

  const getResult = economy.get("resource.ownership-test")!;
  getResult.amount = -30;
  assert.equal(economy.get("resource.ownership-test")?.amount, 60,
    "get must return a detached resource record");

  const allResult = economy.all();
  allResult[0]!.amount = -40;
  allResult.pop();
  assert.equal(economy.all().length, 1);
  assert.equal(economy.all()[0]!.amount, 60,
    "all must return detached records and collection storage");

  const statsResult = economy.stats();
  statsResult.resources[0]!.amount = -50;
  assert.equal(economy.get("resource.ownership-test")?.amount, 60,
    "stats must not leak internal resource records");

  const resourceRestoreResult = economy.restore([{
    semanticEntryId: "resource.restored-test",
    amount: 25,
    capacity: 50,
    regeneration: 0.5,
    quality: 0.7,
    accessibility: 0.6,
  }]);
  resourceRestoreResult[0]!.amount = -60;
  assert.equal(economy.get("resource.restored-test")?.amount, 25,
    "restore must return detached resource records");

  economy.set({
    semanticEntryId: "resource.metal",
    amount: 10,
    capacity: 20,
    regeneration: 1,
    quality: 0.9,
    accessibility: 0.8,
  });
  assert.equal(economy.consume("resource.iron", 3), true,
    "consume must resolve canonical aliases consistently with reads and capability checks");
  assert.equal(economy.get("resource.metal")?.amount, 7);
  assert.equal(economy.consume("resource.metal", Number.NaN), false);
  assert.equal(economy.consume("resource.metal", -2), false);
  assert.equal(economy.produce("resource.iron", 4), true,
    "produce must resolve canonical aliases and mutate only through the economy API");
  assert.equal(economy.get("resource.metal")?.amount, 11);
  assert.equal(economy.produce("resource.metal", Number.NaN), false);
  assert.equal(economy.produce("resource.metal", -1), false);
  assert.throws(() => economy.tick(-1), /finite and non-negative/);
  assert.throws(() => economy.seedFromBiome("temperate-forest", Number.NaN), /finite non-negative multiplier/);

  const beforeInvalidResourceRestore = economy.snapshot();
  assert.throws(() => economy.restore([
    {
      semanticEntryId: "resource.valid-candidate",
      amount: 1,
      capacity: 2,
      regeneration: 0.1,
      quality: 1,
      accessibility: 1,
    },
    {
      semanticEntryId: "",
      amount: Number.NaN,
      capacity: 2,
      regeneration: 0.1,
      quality: 1,
      accessibility: 1,
    },
  ]), /stable ID and valid finite resource bounds/);
  assert.deepEqual(economy.snapshot(), beforeInvalidResourceRestore,
    "invalid resource restore must leave the previous inventory unchanged");

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

  // Public branch readers must not expose authoritative Map values or nested
  // history/state objects. Mutating any returned value must be a local edit.
  const forkPopulation = runtime.branchSnapshot(fork.branchId)!.population;
  fork.population = -1;
  assert.equal(runtime.branchSnapshot(fork.branchId)?.population, forkPopulation,
    "forkBranch must return a detached branch snapshot");

  const exposedSnapshot = runtime.branchSnapshot(fork.branchId)!;
  exposedSnapshot.population = -2;
  assert.equal(runtime.branchSnapshot(fork.branchId)?.population, forkPopulation,
    "branchSnapshot must not expose the stored history record");

  const exposedHistory = runtime.branchHistory(fork.branchId);
  exposedHistory[0]!.branchId = "tampered-history-owner";
  exposedHistory.push({ ...exposedHistory[0]!, branchId: "tampered-history-owner" });
  assert.equal(runtime.branchHistory(fork.branchId).length, 1,
    "branchHistory must return a detached array");
  assert.equal(runtime.branchHistory(fork.branchId)[0]!.branchId, fork.branchId,
    "branchHistory records must be detached from stored ownership keys");

  const exposedBranchList = runtime.branchesList();
  const listedBranch = exposedBranchList.find(branch => branch.branchId === fork.branchId)!;
  listedBranch.latest!.population = -3;
  assert.equal(runtime.branchSnapshot(fork.branchId)?.population, forkPopulation,
    "branchesList latest records must be detached");

  const exposedBranchState = runtime.branchState(fork.branchId)!;
  const storedForkPopulation = runtime.branchState(fork.branchId)!.settlement.population;
  exposedBranchState.settlement.population = -4;
  exposedBranchState.memory.trajectory.push({
    tick: 999,
    type: "agricultural",
    score: -1,
    stability: -1,
    evolutionPressure: -1,
  });
  assert.equal(runtime.branchState(fork.branchId)?.settlement.population, storedForkPopulation,
    "branchState must deep-clone nested state");
  assert.notEqual(runtime.branchState(fork.branchId)?.memory.trajectory.some(item => item.tick === 999), true,
    "branchState trajectory arrays must be detached");

  const exposedEnvironment = runtime.branchEnvironment(fork.branchId)!;
  exposedEnvironment.moisture = -5;
  assert.notEqual(runtime.branchEnvironment(fork.branchId)?.moisture, -5,
    "branchEnvironment must be detached");

  const exposedCausalEvents = runtime.branchCausalEvents(fork.branchId);
  const originalCausalEventCount = runtime.branchCausalEvents(fork.branchId).length;
  exposedCausalEvents.push({ id: "external-mutation", year: 0 } as never);
  assert.equal(runtime.branchCausalEvents(fork.branchId).length, originalCausalEventCount,
    "branchCausalEvents must return a detached array");

  const branchSnapshotTickBefore = runtime.branchSnapshot(fork.branchId)!.tick;
  const branchMemoryTickBefore = runtime.branchState(fork.branchId)!.memory.ticks;
  assert.equal(branchMemoryTickBefore, branchSnapshotTickBefore,
    "a forked branch's state clock must start at the tick represented by its initial branch snapshot");

  const tickResult = runtime.tickBranch(fork.branchId, 1);
  assert.ok(tickResult);
  const branchSnapshotTickAfter = runtime.branchSnapshot(fork.branchId)!.tick;
  const branchMemoryTickAfter = runtime.branchState(fork.branchId)!.memory.ticks;
  assert.equal(branchSnapshotTickAfter, branchSnapshotTickBefore + 1,
    "tickBranch must advance the branch-history snapshot beyond the fork's source tick");
  assert.equal(branchMemoryTickAfter, branchSnapshotTickAfter,
    "branch-state memory clock and branch-history snapshot clock must remain aligned after tick");
  const postTickPopulation = runtime.branchState(fork.branchId)!.settlement.population;
  tickResult.state.settlement.population = -6;
  tickResult.state.memory.trajectory.push({
    tick: 1000,
    type: "agricultural",
    score: -1,
    stability: -1,
    evolutionPressure: -1,
  });
  assert.equal(runtime.branchState(fork.branchId)?.settlement.population, postTickPopulation,
    "tickBranch must return a detached result rather than its committed branch state");
  assert.notEqual(runtime.branchState(fork.branchId)?.memory.trajectory.some(item => item.tick === 1000), true,
    "tickBranch result must not share nested trajectory arrays with branch state");

  const experimentResult = runtime.runExperiment("civilization-read-ownership", [
    {
      id: "baseline",
      sourceBranch: "origin",
      baseline: true,
      override: { reason: "Verify detached experiment results" },
    },
  ], 1);
  const experimentBranch = experimentResult.branches[0]!;
  const storedExperimentBranch = runtime.experiment("civilization-read-ownership")!.branches[0]!;
  experimentBranch.history[0]!.population = -7;
  experimentBranch.final!.population = -8;
  assert.equal(
    runtime.experiment("civilization-read-ownership")!.branches[0]!.history[0]!.population,
    storedExperimentBranch.history[0]!.population,
    "runExperiment must not return the internally stored experiment object",
  );
  const exposedExperiment = runtime.experiment("civilization-read-ownership")!;
  exposedExperiment.branches[0]!.history[0]!.population = -9;
  assert.equal(
    runtime.experiment("civilization-read-ownership")!.branches[0]!.history[0]!.population,
    storedExperimentBranch.history[0]!.population,
    "experiment getter must return a detached result",
  );

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
