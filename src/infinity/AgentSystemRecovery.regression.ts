import { AgentSystem } from "../simulation/AgentSystem";
import { VoxelGrid } from "../core/VoxelGrid";

export function runAgentSystemRecoveryRegression(): void {
  const randomReplay = new AgentSystem(8675309);
  const randomStart = randomReplay.snapshot();
  const seedGridA = new VoxelGrid(20, 20, 10);
  randomReplay.seed(seedGridA, 5);
  const generatedA = randomReplay.getAgents().map(agent => ({ ...agent }));
  const rngAfterA = randomReplay.snapshot().rngState;
  randomReplay.restore(randomStart);
  const seedGridB = new VoxelGrid(20, 20, 10);
  randomReplay.seed(seedGridB, 5);
  const generatedB = randomReplay.getAgents().map(agent => ({ ...agent }));
  if (JSON.stringify(generatedA) !== JSON.stringify(generatedB) ||
      randomReplay.snapshot().rngState !== rngAfterA) {
    throw new Error("AgentSystem restore did not replay seeded agent generation");
  }

  const agents = new AgentSystem();
  const id = agents.spawnAt(2, 3, 1, "explorer", 240);
  agents.queueMigrationRequest({
    agentId: id,
    from: [2, 3, 1],
    to: [3, 3, 1],
    behavior: "explorer",
    energy: 240,
  });

  const snapshot = agents.snapshot();
  if (snapshot.agents.length !== 1 || snapshot.pendingMigrations.length !== 1) {
    throw new Error("AgentSystem snapshot omitted agents or pending migrations");
  }

  agents.getAgents()[0].energy = 1;
  agents.getAgents()[0].x = 99;
  agents.queueMigrationRequest({
    agentId: id,
    from: [99, 3, 1],
    to: [4, 3, 1],
    behavior: "explorer",
    energy: 1,
  });
  const transientId = agents.spawnAt(5, 5, 1, "builder", 80);
  if (transientId === id) throw new Error("AgentSystem reused an agent ID before restore");

  agents.restore(snapshot);
  const restored = agents.getAgents();
  if (restored.length !== 1 || restored[0].id !== id) {
    throw new Error("AgentSystem restore did not recover agent membership");
  }
  if (restored[0].x !== 2 || restored[0].energy !== 240) {
    throw new Error("AgentSystem restore did not recover agent values");
  }
  const migrations = agents.peekMigrationRequests();
  if (migrations.length !== 1 || migrations[0].to[0] !== 3) {
    throw new Error("AgentSystem restore did not recover the pending migration queue");
  }

  snapshot.agents[0].energy = -100;
  snapshot.pendingMigrations[0].to[0] = 20;
  if (agents.getAgents()[0].energy !== 240 || agents.peekMigrationRequests()[0].to[0] !== 3) {
    throw new Error("AgentSystem restore retained aliases to snapshot data");
  }

  const nextId = agents.spawnAt(6, 6, 1, "signaler", 90);
  if (nextId !== id + 1) throw new Error("AgentSystem restore did not recover the ID allocator");

  const invalid = agents.snapshot();
  invalid.nextAgentId = 1;
  let rejected = false;
  try {
    agents.restore(invalid);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("AgentSystem restore accepted an invalid ID allocator");
}
