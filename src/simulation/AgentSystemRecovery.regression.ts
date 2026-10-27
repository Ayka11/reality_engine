import { VoxelGrid } from "../core/VoxelGrid";
import { AgentSystem, type AgentSystemSnapshot } from "./AgentSystem";

function cloneSnapshot(snapshot: AgentSystemSnapshot): AgentSystemSnapshot {
  return {
    agents: snapshot.agents.map(agent => ({ ...agent })),
    nextAgentId: snapshot.nextAgentId,
    rngState: snapshot.rngState,
  };
}

function equal(a: unknown, b: unknown, message: string): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(message);
}

export function runAgentSystemRecoveryRegression(): void {
  // Tiny worlds are valid VoxelGrids. Seed placement must never create agents
  // whose coordinates point outside the allocated cell buffer.
  for (const [width, height, depth] of [[1, 1, 1], [4, 3, 2], [7, 7, 3]] as const) {
    const smallGrid = new VoxelGrid(width, height, depth);
    const smallAgents = new AgentSystem(0x1234abcd);
    smallAgents.seed(smallGrid, 8);
    const spawned = smallAgents.getAgents();
    if (spawned.some(agent =>
      !smallGrid.inBounds(agent.x, agent.y, agent.z) ||
      ![agent.x, agent.y, agent.z].every(Number.isSafeInteger))) {
      throw new Error(`AgentSystem.seed created out-of-bounds agent in ${width}x${height}x${depth} grid`);
    }
    smallAgents.tick(smallGrid, 1 / 60);
    if (smallGrid.buffer.some(value => !Number.isFinite(value))) {
      throw new Error(`AgentSystem.seed/tick corrupted numeric cell state in ${width}x${height}x${depth} grid`);
    }
  }

  const seedValidationGrid = new VoxelGrid(4, 3, 2);
  const seedValidationAgents = new AgentSystem(0x1234abcd);
  for (const invalidCount of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, 65]) {
    const beforeSnapshot = JSON.stringify(seedValidationAgents.snapshot());
    const beforeGrid = Array.from(seedValidationGrid.buffer);
    const beforeRevision = seedValidationGrid.mutationRevision;
    let rejected = false;
    try {
      seedValidationAgents.seed(seedValidationGrid, invalidCount);
    } catch (error) {
      rejected = error instanceof RangeError;
    }
    if (!rejected ||
        JSON.stringify(seedValidationAgents.snapshot()) !== beforeSnapshot ||
        seedValidationGrid.mutationRevision !== beforeRevision ||
        seedValidationGrid.buffer.some((value, index) => value !== beforeGrid[index])) {
      throw new Error(`AgentSystem.seed accepted invalid count or mutated state: ${invalidCount}`);
    }
  }
  const noOpRevision = seedValidationGrid.mutationRevision;
  seedValidationAgents.seed(seedValidationGrid, 0);
  if (seedValidationGrid.mutationRevision !== noOpRevision || seedValidationAgents.getAgents().length !== 0) {
    throw new Error("AgentSystem.seed(0) must be a no-op without advancing grid revision");
  }

  const grid = new VoxelGrid(24, 24, 12);
  const agents = new AgentSystem(0x1234abcd);
  agents.seed(grid, 5);
  const checkpoint = agents.snapshot();
  const checkpointGrid = grid.buffer.slice();
  const checkpointJson = JSON.stringify(checkpoint);

  // Direct tick calls must reject invalid time steps without changing either
  // the population/PRNG state or any cell value.
  for (const invalidDt of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    const beforeState = JSON.stringify(agents.snapshot());
    const beforeGrid = grid.buffer.slice();
    let rejected = false;
    try {
      agents.tick(grid, invalidDt);
    } catch (error) {
      rejected = error instanceof RangeError;
    }
    if (!rejected ||
        JSON.stringify(agents.snapshot()) !== beforeState ||
        grid.buffer.some((value, index) => value !== beforeGrid[index])) {
      throw new Error("AgentSystem accepted invalid dt or mutated state before rejecting it");
    }
  }

  if (checkpoint.agents.length !== 5 ||
      checkpoint.nextAgentId !== 6 ||
      checkpoint.rngState === 0) {
    throw new Error("AgentSystem checkpoint did not capture population, allocator, and PRNG");
  }

  // Snapshot copies must be detached from the live system.
  const detached = agents.snapshot();
  detached.agents[0].energy = -123;
  detached.agents[0].x = 999;
  if (agents.getAgents()[0].energy === -123 || agents.getAgents()[0].x === 999) {
    throw new Error("AgentSystem snapshot aliases live agent objects");
  }

  // Repeat a seeded generation branch from the same checkpoint; both agent
  // records, allocated IDs, RNG state, and grid energy injections must match.
  agents.seed(grid, 4);
  const expected = agents.snapshot();
  const expectedGrid = grid.buffer.slice();

  agents.restore(checkpoint);
  grid.buffer.set(checkpointGrid);
  agents.seed(grid, 4);
  equal(agents.snapshot(), expected, "AgentSystem recovery did not reproduce seeded agent generation");
  equal(Array.from(grid.buffer), Array.from(expectedGrid), "AgentSystem recovery did not replay grid energy injection");

  // Restore all individual agent properties, population membership and allocator.
  agents.getAgents()[0].energy = 1;
  agents.getAgents()[0].age = 999;
  agents.getAgents()[0].behavior = "destroyer";
  agents.seed(grid, 3);
  agents.restore(checkpoint);
  equal(agents.snapshot(), checkpoint, "AgentSystem restore did not recover all agent/control state");

  const external = cloneSnapshot(checkpoint);
  external.agents[0].energy = -100;
  if (agents.getAgents()[0].energy !== checkpoint.agents[0].energy) {
    throw new Error("AgentSystem restore retained aliases to caller-owned snapshot data");
  }

  const allocatorGrid = new VoxelGrid(24, 24, 12);
  const nextSystem = new AgentSystem(0x1234abcd);
  nextSystem.restore(checkpoint);
  nextSystem.seed(allocatorGrid, 1);
  if (nextSystem.getAgents().length !== checkpoint.agents.length + 1 ||
      nextSystem.getAgents()[checkpoint.agents.length].id !== checkpoint.nextAgentId) {
    throw new Error("AgentSystem restore did not restore the next-agent ID allocator");
  }

  runAgentSystemInvalidSnapshotRegression(agents);
  if (JSON.stringify(agents.snapshot()) !== checkpointJson) {
    throw new Error("Invalid-snapshot regression changed the original AgentSystem state");
  }
}

export function runAgentSystemInvalidSnapshotRegression(system = new AgentSystem(0x1234abcd)): void {
  const grid = new VoxelGrid(24, 24, 12);
  if (system.getAgents().length === 0) system.seed(grid, 4);
  const baseline = system.snapshot();

  const assertRejectedWithoutMutation = (candidate: unknown, label: string): void => {
    const before = JSON.stringify(system.snapshot());
    let rejected = false;
    try {
      system.restore(candidate as AgentSystemSnapshot);
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error(`AgentSystem accepted malformed recovery snapshot: ${label}`);
    }
    if (JSON.stringify(system.snapshot()) !== before) {
      throw new Error(`Rejected AgentSystem snapshot partially mutated live state: ${label}`);
    }
  };

  assertRejectedWithoutMutation(null, "null snapshot");
  assertRejectedWithoutMutation({ ...cloneSnapshot(baseline), agents: null }, "non-array agent collection");
  assertRejectedWithoutMutation({ ...cloneSnapshot(baseline), rngState: 0 }, "zero PRNG state");
  assertRejectedWithoutMutation({ ...cloneSnapshot(baseline), rngState: 0x100000000 }, "out-of-range PRNG state");
  assertRejectedWithoutMutation({ ...cloneSnapshot(baseline), nextAgentId: 0 }, "invalid ID allocator");

  const nullAgent = cloneSnapshot(baseline);
  (nullAgent.agents as unknown[])[0] = null;
  assertRejectedWithoutMutation(nullAgent, "null agent record");

  const duplicateId = cloneSnapshot(baseline);
  duplicateId.agents[1].id = duplicateId.agents[0].id;
  assertRejectedWithoutMutation(duplicateId, "duplicate agent ID");

  const invalidAllocator = cloneSnapshot(baseline);
  invalidAllocator.nextAgentId = Math.max(...invalidAllocator.agents.map(agent => agent.id));
  assertRejectedWithoutMutation(invalidAllocator, "allocator does not exceed restored IDs");

  const invalidCoordinate = cloneSnapshot(baseline);
  invalidCoordinate.agents[0].x = -1;
  assertRejectedWithoutMutation(invalidCoordinate, "negative coordinate");

  const unsafeCoordinate = cloneSnapshot(baseline);
  unsafeCoordinate.agents[0].z = Number.MAX_SAFE_INTEGER + 1;
  assertRejectedWithoutMutation(unsafeCoordinate, "unsafe coordinate");

  const nonFiniteEnergy = cloneSnapshot(baseline);
  nonFiniteEnergy.agents[0].energy = Number.POSITIVE_INFINITY;
  assertRejectedWithoutMutation(nonFiniteEnergy, "non-finite energy");

  const negativeEnergy = cloneSnapshot(baseline);
  negativeEnergy.agents[0].energy = -1;
  assertRejectedWithoutMutation(negativeEnergy, "negative energy");

  const invalidAge = cloneSnapshot(baseline);
  invalidAge.agents[0].age = 1.5;
  assertRejectedWithoutMutation(invalidAge, "non-integer age");

  const invalidBehavior = cloneSnapshot(baseline);
  (invalidBehavior.agents[0] as unknown as { behavior: string }).behavior = "unknown";
  assertRejectedWithoutMutation(invalidBehavior, "invalid behavior");

  const nonFiniteMemory = cloneSnapshot(baseline);
  nonFiniteMemory.agents[0].memory = Number.NaN;
  assertRejectedWithoutMutation(nonFiniteMemory, "non-finite memory");

  const invalidChildren = cloneSnapshot(baseline);
  invalidChildren.agents[0].children = -1;
  assertRejectedWithoutMutation(invalidChildren, "negative child counter");

  const tooManyAgents = cloneSnapshot(baseline);
  tooManyAgents.agents = Array.from({ length: system.maxAgents + 1 }, (_, index) => ({
    ...baseline.agents[0],
    id: index + 1,
  }));
  tooManyAgents.nextAgentId = system.maxAgents + 2;
  assertRejectedWithoutMutation(tooManyAgents, "agent population exceeds capacity");
}
