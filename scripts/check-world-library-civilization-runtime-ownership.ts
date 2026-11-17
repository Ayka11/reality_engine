import assert from "node:assert/strict";
import { CivilizationRuntime } from "../src/worldLibrary/CivilizationRuntime";
import { ProductionInfrastructureRuntime } from "../src/worldLibrary/ProductionInfrastructureRuntime";
import { WorldResourceEconomy, worldResourceEconomy } from "../src/worldLibrary/WorldResourceEconomy";
import { WorldLibrary, type WorldLibraryEntry } from "../src/worldLibrary/WorldLibrary";
import { WorldRuleGraph, type WorldRule } from "../src/worldLibrary/WorldRuleGraph";
import { worldRuleGraph } from "../src/worldLibrary/registry";
import { WorldViewContract } from "../src/infinity/WorldViewContract";
import { InfiniteChunkManager } from "../src/infinity/ChunkManager";
import { WorldGenerator } from "../src/infinity/WorldGenerator";
import { FieldModulatedPhysics } from "../src/infinity/FieldModulatedPhysics";
import { DecisionGraph } from "../src/infinity/DecisionGraph";
import { PhysicsInteractionLog } from "../src/infinity/PhysicsInteractionLog";
import { RuntimeDiagnostics } from "../src/infinity/RuntimeDiagnostics";
import { ExperimentRunner } from "../src/infinity/ExperimentRunner";
import { ExperimentCatalog } from "../src/infinity/ExperimentCatalog";
import { WorldConstructionContract } from "../src/infinity/WorldConstructionContract";
import { WorldDecisionLayer } from "../src/infinity/WorldDecisionLayer";
import { LawPhysicsContract } from "../src/infinity/LawPhysicsContract";
import { LegacySculptRuntimeAdapter } from "../src/infinity/LegacySculptRuntimeAdapter";

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
  assert.throws(() => economy.capability("resource.water", Number.NaN), /finite non-negative amount/);

  economy.set({
    semanticEntryId: "resource.iron",
    amount: 12,
    capacity: 24,
    regeneration: 0,
    quality: 1,
    accessibility: 1,
  });
  assert.equal(economy.get("resource.metal")?.amount, 12,
    "setting an alias must update the canonical resource rather than create an unreachable duplicate");

  const beforeInvalidSeed = economy.snapshot();
  worldRuleGraph.add({
    id: "ownership-test-duplicate-iron",
    from: "biome.ownership-test-invalid-seed",
    relation: "produces",
    to: "resource.iron",
    weight: 0.5,
  });
  worldRuleGraph.add({
    id: "ownership-test-duplicate-metal",
    from: "biome.ownership-test-invalid-seed",
    relation: "produces",
    to: "resource.metal",
    weight: 0.6,
  });
  assert.throws(
    () => economy.seedFromBiome("biome.ownership-test-invalid-seed"),
    /Duplicate produced resource ID/,
  );
  assert.deepEqual(economy.snapshot(), beforeInvalidSeed,
    "a duplicate canonical resource seed must not partially publish inventory changes");

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

  const productionRuntime = new ProductionInfrastructureRuntime();
  const productionSourceRuntime = new CivilizationRuntime();
  const productionInput = productionSourceRuntime.evaluate("production-ownership", "village");
  productionInput.type = "agricultural";
  const productionInitialPopulation = productionInput.settlement.population;
  const productionSnapshot = productionRuntime.evaluate(productionInput);
  productionInput.settlement.population = -1;
  productionSnapshot.civilization.settlement.population = -2;
  productionSnapshot.nodes[0]!.rate = -3;
  assert.equal(productionRuntime.get("production-ownership")?.civilization.settlement.population, productionInitialPopulation,
    "production evaluate must clone caller input and return a detached snapshot");

  const productionGet = productionRuntime.get("production-ownership")!;
  productionGet.timeline[0]!.details = "tampered";
  productionGet.civilization.settlement.population = -4;
  assert.notEqual(productionRuntime.get("production-ownership")?.timeline[0]?.details, "tampered");
  assert.equal(productionRuntime.get("production-ownership")?.civilization.settlement.population, productionInitialPopulation,
    "production get must not expose the stored state");

  const productionAll = productionRuntime.all();
  productionAll[0]!.nodes.pop();
  assert.equal(productionRuntime.all()[0]!.nodes.length, productionSnapshot.nodes.length,
    "production all must return detached nested records");

  assert.equal(productionRuntime.setTimeScale("production-ownership", "decade"), true);
  assert.equal(productionRuntime.get("production-ownership")?.worldTime.scale, "decade");
  const environmentalResult = productionRuntime.applyEnvironmentalState("production-ownership", {
    temperature: 0.5,
    moisture: 0.1,
    radiation: 0.9,
    stability: 0.1,
  })!;
  environmentalResult.events[0]!.details = "tampered";
  environmentalResult.current.moisture = -1;
  assert.notEqual(productionRuntime.timeline("production-ownership").some(event => event.details === "tampered"), true,
    "environmental state results must not share event references with the stored timeline");
  assert.equal(productionRuntime.get("production-ownership")?.environmentalState.moisture, 0.1,
    "environmental state results must not expose stored environmental records");
  assert.throws(() => productionRuntime.applyEnvironmentalState("production-ownership", {
    temperature: Number.NaN,
    moisture: 0.5,
  }), /finite numeric inputs/);
  assert.throws(() => productionRuntime.tick("production-ownership", -1), /finite and non-negative/);

  worldResourceEconomy.restore([
    { semanticEntryId: "resource.wood", amount: 100, capacity: 200, regeneration: 0, quality: 1, accessibility: 1 },
    { semanticEntryId: "resource.water", amount: 10, capacity: 200, regeneration: 0, quality: 1, accessibility: 1 },
  ]);
  const productionTick = productionRuntime.tick("production-ownership", 1)!;
  assert.ok((productionTick.produced["resource.water"] ?? 0) > 0,
    "production infrastructure must route outputs through the controlled resource produce API");
  assert.ok((worldResourceEconomy.get("resource.water")?.amount ?? 0) > 10,
    "production tick must increase the authoritative resource stock after a detached read API is used");
  const productionPopulationAfterTick = productionRuntime.get("production-ownership")!.civilization.settlement.population;
  productionTick.civilization.settlement.population = -100;
  assert.equal(productionRuntime.get("production-ownership")!.civilization.settlement.population, productionPopulationAfterTick,
    "production tick results must remain detached from authoritative state");

  const productionTimeline = productionRuntime.timeline("production-ownership");
  productionTimeline[0]!.details = "tampered-timeline";
  assert.notEqual(productionRuntime.timeline("production-ownership")[0]!.details, "tampered-timeline");
  const productionAllTimelines = productionRuntime.allTimelines();
  productionAllTimelines[0]!.details = "tampered-all-timelines";
  assert.notEqual(productionRuntime.allTimelines()[0]!.details, "tampered-all-timelines");

  const decisionGraph = new DecisionGraph();
  assert.equal("nodes" in decisionGraph, false);
  assert.equal("edges" in decisionGraph, false);
  assert.equal(Reflect.set(decisionGraph, "nodes", new Map()), false);
  const graphNode = decisionGraph.addNode({
    id: "decision-node",
    kind: "decision",
    label: "Decision",
    data: { nested: { value: 1 } },
  });
  (graphNode.data!.nested as any).value = 99;
  assert.equal((decisionGraph.getNode("decision-node")!.data!.nested as any).value, 1,
    "decision graph nodes must be detached on write and read");
  assert.ok(Object.isFrozen(decisionGraph));

  const interactionLog = new PhysicsInteractionLog(2);
  assert.equal("records" in interactionLog, false);
  assert.equal("maxRecords" in interactionLog, false);
  assert.equal(Reflect.set(interactionLog, "records", []), false);
  interactionLog.add({
    id: "interaction-1",
    timestamp: 1,
    type: "gravity",
    objectKind: "tree",
    objectId: "tree-1",
    particleIndex: 0,
    position: { x: 0, y: 0, z: 0 },
    field: { energy: 1, density: 1, information: 1, entropy: 0, temperature: 0, biology: 0, material: 0 } as any,
    modulation: { gravity: 1 },
    magnitude: 1,
  });
  const exposedInteraction = interactionLog.snapshot()[0]!;
  exposedInteraction.position.x = 999;
  assert.equal(interactionLog.snapshot()[0]!.position.x, 0,
    "physics interaction history must return detached nested records");
  assert.ok(Object.isFrozen(interactionLog));

  const diagnostics = new RuntimeDiagnostics();
  assert.equal("frames" in diagnostics, false);
  assert.equal(Reflect.set(diagnostics, "frames", 1000), false);
  assert.equal(diagnostics.snapshot(0, 0, 0).renderedFrames, 0);
  assert.ok(Object.isFrozen(diagnostics));

  const experimentRunner = new ExperimentRunner();
  assert.equal("protocol" in experimentRunner, false);
  assert.equal("results" in experimentRunner, false);
  assert.equal(Reflect.set(experimentRunner, "protocol", {}), false);
  const experimentProtocol = {
    experimentId: "ownership-test",
    field: { providerId: "test-provider", providerVersion: 1 },
    world: { seed: "ownership-seed" },
  } as any;
  const runningExperiment = experimentRunner.start(experimentProtocol);
  runningExperiment.protocol.world.seed = "tampered";
  experimentRunner.record("result", { nested: { value: 1 } });
  const completedExperiment = experimentRunner.finish();
  assert.equal(completedExperiment.protocol.world.seed, "ownership-seed");
  (completedExperiment.results.result as any).nested.value = 999;
  assert.equal((experimentRunner.finish().results.result as any).nested.value, 1,
    "experiment runner snapshots must not expose internal protocol or results");
  assert.ok(Object.isFrozen(experimentRunner));

  const experimentCatalog = new ExperimentCatalog();
  assert.equal("snapshots" in experimentCatalog, false);
  assert.equal(Reflect.set(experimentCatalog, "snapshots", new Map()), false);
  experimentCatalog.add(completedExperiment);
  const catalogSnapshot = experimentCatalog.get("ownership-test")!;
  catalogSnapshot.protocol.world.seed = "tampered-catalog";
  assert.equal(experimentCatalog.get("ownership-test")!.protocol.world.seed, "ownership-seed",
    "experiment catalogue reads must remain detached");
  assert.ok(Object.isFrozen(experimentCatalog));

  const decisionSampler = {
    surfaceProvider: {
      waterLevel: null,
      referenceBuildElevation: 0,
      seed: "decision-ownership-seed",
      sampleSurface: () => ({ height: 0, temperature: 0, moisture: 0.5, biome: "grassland", waterDepth: 0 }),
    },
    sample: () => ({ energy: 1, density: 0.1, information: 1, entropy: 0.01, temperature: 0, biology: 0.5, material: 0 }),
    sampleWorld: () => ({ x: 0, y: 0, z: 0, energy: 1, density: 0.1, information: 1, entropy: 0.01, temperature: 0, biology: 0.5, material: 0, height: 0, moisture: 0.5, biome: "grassland", waterDepth: 0 }),
  };
  const decisionLayer = new WorldDecisionLayer(decisionSampler as any, undefined, () => ({ processes: ["gravity", "density"] }), () => 0);
  assert.equal("terrainHeight" in decisionLayer, false);
  assert.equal("lawProvider" in decisionLayer, false);
  assert.equal(Reflect.set(decisionLayer, "terrainHeight", () => 999), false);
  assert.ok(Number.isFinite(decisionLayer.buildZoneCost(0, 0).cost),
    "decision layer must remain operational after its callback state is hidden and instance frozen");
  assert.ok(Object.isFrozen(decisionLayer));

  const constructionContract = new WorldConstructionContract({
    buildZoneCost: () => ({
      cost: 1,
      components: {},
      buildability: { score: 0, slope: 0, waterDepth: 0, elevation: 0, field: {} as any, components: {} },
      laws: { activeProcesses: [], penalty: 1 },
    }),
  } as any);
  assert.equal("structural" in constructionContract, false);
  assert.equal(Reflect.set(constructionContract, "structural", new Set()), false);
  assert.equal(constructionContract.authorize("tree", 0, 0).allowed, true);
  assert.equal(constructionContract.authorize("building", 0, 0).allowed, false);
  assert.ok(Object.isFrozen(constructionContract));

  const lawContract = new LawPhysicsContract(() => ({ processes: ["gravity"] }));
  assert.equal("lawProvider" in lawContract, false);
  assert.equal(Reflect.set(lawContract, "lawProvider", () => ({ processes: [] })), false);
  assert.equal(lawContract.apply({ gravity: 1, entropyDamping: 1, quantumLift: 1, forcePush: 1, metaLawOrbit: 1 }).gravity, 1);
  assert.ok(Object.isFrozen(lawContract));

  const legacyAdapter = new LegacySculptRuntimeAdapter(mutation => ({ ...mutation, id: 1 } as any));
  assert.equal("applyMutation" in legacyAdapter, false);
  assert.equal(Reflect.set(legacyAdapter, "applyMutation", () => null), false);
  assert.ok(Object.isFrozen(legacyAdapter));

  const suppliedPhysicsParameters = {
    gravity: 48,
    entropyDamping: 0.82,
    quantumLift: 35,
    forcePush: 40,
    metaLawOrbit: 22,
  };
  const fieldPhysics = new FieldModulatedPhysics(suppliedPhysicsParameters);
  suppliedPhysicsParameters.gravity = 999;
  assert.equal(fieldPhysics.parameters.gravity, 48,
    "field physics must detach caller-owned configuration");
  assert.equal(Object.isFrozen(fieldPhysics), true);
  assert.equal(Reflect.set(fieldPhysics, "parameters", suppliedPhysicsParameters), false,
    "browser code must not replace the active field physics parameter snapshot");

  const immutableGenerator = new WorldGenerator("immutable-generator-seed");
  const generatorSampleBefore = immutableGenerator.sampleHeight(137, -91);
  assert.equal(Object.hasOwn(immutableGenerator, "seed"), false,
    "WorldGenerator must expose its seed only through a read-only prototype getter");
  assert.equal(Reflect.set(immutableGenerator, "seed", "tampered-seed"), false);
  assert.equal(immutableGenerator.sampleHeight(137, -91), generatorSampleBefore,
    "public generator metadata must not be mutable through browser JavaScript");

  const chunkManager = new InfiniteChunkManager(new WorldGenerator("chunk-ownership"), {
    radius: 0,
    verticalRadius: 0,
    maxLoaded: 1,
    maxNewPerUpdate: 1,
  });
  assert.equal("loaded" in chunkManager, false,
    "chunk manager must not expose its authoritative loaded-chunk Map");
  assert.equal(Reflect.set(chunkManager, "loaded", new Map()), false);
  const chunkDelta = chunkManager.update({ cx: 0, cy: 0, cz: 0 });
  assert.equal(chunkDelta.loaded.length, 1);
  const emittedChunk = chunkDelta.loaded[0]!;
  const storedHeight = chunkManager.get(0, 0, 0)!.heights[0]!;
  emittedChunk.heights[0] = storedHeight + 1000;
  emittedChunk.biome[0] = 255;
  assert.equal(chunkManager.get(0, 0, 0)!.heights[0], storedHeight,
    "chunk update results must not expose authoritative typed arrays");
  const chunkRead = chunkManager.get(0, 0, 0)!;
  chunkRead.moisture[0] = 999;
  assert.notEqual(chunkManager.get(0, 0, 0)!.moisture[0], 999,
    "chunk get must return copied typed-array buffers");

  const viewContract = new WorldViewContract();
  assert.equal("state" in viewContract, false,
    "WorldViewContract must not expose its TypeScript-private authoritative snapshot");
  assert.equal(Reflect.set(viewContract, "state", {}), false);
  const viewSnapshot = viewContract.snapshot();
  viewSnapshot.center.x = 999;
  assert.equal(viewContract.snapshot().center.x, 0,
    "WorldViewContract snapshots must detach nested view coordinates");
  viewContract.setRenderMode("invalid-mode" as never);
  assert.equal(viewContract.snapshot().renderMode, "3d",
    "WorldViewContract must reject unsupported runtime render modes");
  const validViewState = viewContract.snapshot();
  assert.throws(() => viewContract.setSeed("   "), /non-empty string/);
  assert.throws(() => viewContract.setCenter(Number.NaN, 0, 0), /coordinates must be finite/);
  assert.throws(() => viewContract.setSliceY(Number.POSITIVE_INFINITY), /must be finite/);
  assert.throws(() => viewContract.setVisibleRadius(Number.NaN), /must be finite/);
  assert.throws(() => viewContract.setSimulationTime(Number.NaN), /must be finite/);
  assert.deepEqual(viewContract.snapshot(), validViewState,
    "invalid world view inputs must not partially mutate the authoritative view contract");

  const library = new WorldLibrary();
  assert.equal("entries" in library, false,
    "WorldLibrary must not expose its authoritative Map through a TypeScript-private property");
  const libraryInput: WorldLibraryEntry = {
    id: "ownership-test-entry",
    name: "Ownership Test",
    category: "resource",
    description: "Detached catalogue test",
    tags: ["initial"],
    scale: "small",
    rarity: "common",
    conditions: { biome: ["temperate"] },
    produces: ["resource.water"],
  };
  const registeredEntry = library.register(libraryInput);
  libraryInput.tags.push("caller-mutation");
  registeredEntry.conditions!.biome!.push("return-mutation");
  const libraryRead = library.get("ownership-test-entry")!;
  libraryRead.tags.push("read-mutation");
  libraryRead.conditions!.biome!.push("nested-read-mutation");
  const libraryAll = library.all();
  libraryAll[0]!.produces!.push("resource.exploit");
  assert.deepEqual(library.get("ownership-test-entry")?.tags, ["initial"],
    "WorldLibrary register/get/all must detach nested catalogue records");
  assert.deepEqual(library.get("ownership-test-entry")?.conditions?.biome, ["temperate"]);
  assert.deepEqual(library.get("ownership-test-entry")?.produces, ["resource.water"]);
  const libraryBeforeInvalidBatch = library.all();
  assert.throws(() => library.registerMany([
    { ...libraryInput, id: "valid-before-invalid" },
    { ...libraryInput, id: " " },
  ]), /requires an id/);
  assert.deepEqual(library.all(), libraryBeforeInvalidBatch,
    "WorldLibrary registerMany must not partially publish a batch when one entry is invalid");
  assert.throws(() => library.register({
    ...libraryInput,
    id: "invalid-library-tags",
    tags: "not-an-array" as never,
  }), /tags must be an array of strings/);
  assert.throws(() => library.registerMany([
    { ...libraryInput, id: "valid-before-invalid-tags" },
    { ...libraryInput, id: "invalid-tags-in-batch", tags: [1] as never },
  ]), /tags must be an array of strings/);
  assert.deepEqual(library.all(), libraryBeforeInvalidBatch,
    "WorldLibrary must reject malformed tag metadata without publishing a partial batch");

  const ruleGraph = new WorldRuleGraph();
  assert.equal("rules" in ruleGraph, false,
    "WorldRuleGraph must not expose its authoritative Map through a TypeScript-private property");
  const ruleInput: WorldRule = {
    id: "ownership-test-rule",
    from: "biome.test",
    relation: "produces",
    to: "resource.water",
    conditions: { season: "summer" },
  };
  const addedRule = ruleGraph.add(ruleInput);
  ruleInput.conditions!.season = "caller-mutation";
  addedRule.conditions!.season = "return-mutation";
  const ruleRead = ruleGraph.get("ownership-test-rule")!;
  ruleRead.conditions!.season = "read-mutation";
  const ruleAll = ruleGraph.all();
  ruleAll[0]!.conditions!.season = "all-mutation";
  assert.equal(ruleGraph.get("ownership-test-rule")?.conditions?.season, "summer",
    "WorldRuleGraph add/get/all must detach nested rule records");
  const rulesBeforeInvalidBatch = ruleGraph.all();
  assert.throws(() => ruleGraph.addMany([
    { ...ruleInput, id: "valid-before-invalid" },
    { ...ruleInput, id: "invalid-relation", relation: "invalid" as never },
  ]), /relation is not supported/);
  assert.deepEqual(ruleGraph.all(), rulesBeforeInvalidBatch,
    "WorldRuleGraph addMany must not partially publish a batch when one rule is invalid");
  assert.throws(() => ruleGraph.add({ ...ruleInput, weight: Number.NaN }), /weight must be finite/);

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
