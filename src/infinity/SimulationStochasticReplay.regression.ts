import { VoxelGrid } from "../core/VoxelGrid";
import { AgentSystem } from "../simulation/AgentSystem";
import { WorldEvents } from "../world/WorldEvents";

export function runSimulationStochasticReplayRegression(): void {
  const gridA = new VoxelGrid(8, 8, 8);
  const gridB = new VoxelGrid(8, 8, 8);
  const agents = new AgentSystem(0x2468ace1);
  const agentCheckpoint = agents.snapshot();

  agents.seed(gridA, 8);
  const expectedAgents = agents.snapshot();
  agents.restore(agentCheckpoint);
  agents.seed(gridA, 8);
  const replayedAgents = agents.snapshot();
  if (JSON.stringify(replayedAgents) !== JSON.stringify(expectedAgents)) {
    throw new Error("AgentSystem did not reproduce seeded population after RNG restore");
  }

  const events = new WorldEvents(0x13579bdf);
  const eventCheckpoint = events.snapshot();
  events.trigger(gridA, "meteor_strike", 11);
  const expectedEventGrid = new Float32Array(gridA.buffer);
  const expectedEventHistory = events.snapshot();

  events.restore(eventCheckpoint);
  events.trigger(gridB, "meteor_strike", 11);
  const replayedEventState = events.snapshot();
  if (JSON.stringify(Array.from(gridB.buffer)) !== JSON.stringify(Array.from(expectedEventGrid)) ||
      JSON.stringify(replayedEventState.history) !== JSON.stringify(expectedEventHistory.history) ||
      replayedEventState.rngState !== expectedEventHistory.rngState ||
      replayedEventState.nextAuto !== expectedEventHistory.nextAuto) {
    throw new Error("WorldEvents did not reproduce the same random event after RNG restore");
  }
}
