import { VoxelGrid } from "../core/VoxelGrid";
import { AgentSystem } from "../simulation/AgentSystem";
import { WorldEvents } from "../world/WorldEvents";

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function runSimulationStochasticReplayRegression(): void {
  const gridA = new VoxelGrid(8, 8, 8);
  const gridB = new VoxelGrid(8, 8, 8);
  const agents = new AgentSystem(0x2468ace1);
  const agentCheckpoint = agents.snapshot();
  const initialGrid = new Float32Array(gridA.buffer);

  agents.seed(gridA, 8);
  const expectedAgents = agents.snapshot();
  const expectedSeededGrid = new Float32Array(gridA.buffer);

  agents.restore(agentCheckpoint);
  gridA.buffer.set(initialGrid);
  agents.seed(gridA, 8);
  const replayedAgents = agents.snapshot();

  if (!equalJson(replayedAgents, expectedAgents)) {
    throw new Error("AgentSystem did not reproduce seeded population after RNG restore");
  }
  if (!equalJson(Array.from(gridA.buffer), Array.from(expectedSeededGrid))) {
    throw new Error("AgentSystem did not reproduce grid mutations after RNG restore");
  }

  const events = new WorldEvents(0x13579bdf);
  const eventCheckpoint = events.snapshot();
  const eventInitialGrid = new Float32Array(gridA.buffer);

  events.trigger(gridA, "meteor_strike", 11);
  const expectedEventGrid = new Float32Array(gridA.buffer);
  const expectedEventState = events.snapshot();

  events.restore(eventCheckpoint);
  gridB.buffer.set(eventInitialGrid);
  events.trigger(gridB, "meteor_strike", 11);
  const replayedEventState = events.snapshot();

  if (!equalJson(Array.from(gridB.buffer), Array.from(expectedEventGrid))) {
    throw new Error("WorldEvents did not reproduce identical grid mutations after RNG restore");
  }
  if (!equalJson(replayedEventState.history, expectedEventState.history)) {
    throw new Error("WorldEvents did not reproduce event history after RNG restore");
  }
  if (replayedEventState.rngState !== expectedEventState.rngState) {
    throw new Error("WorldEvents RNG state diverged after replay");
  }
  if (replayedEventState.nextAuto !== expectedEventState.nextAuto) {
    throw new Error("WorldEvents auto-event timer diverged after replay");
  }

  // The next independently random event must also be identical. This detects
  // hidden RNG consumers or a one-step offset after restoring a snapshot.
  const nextGridA = new VoxelGrid(8, 8, 8);
  const nextGridB = new VoxelGrid(8, 8, 8);
  const checkpointAfterEvent = events.snapshot();
  const replayEvents = new WorldEvents(0x13579bdf);
  replayEvents.restore(checkpointAfterEvent);

  events.trigger(nextGridA, "tectonic_shift", 12);
  replayEvents.trigger(nextGridB, "tectonic_shift", 12);
  if (!equalJson(Array.from(nextGridA.buffer), Array.from(nextGridB.buffer)) ||
      !equalJson(events.snapshot(), replayEvents.snapshot())) {
    throw new Error("WorldEvents did not preserve the next stochastic event sequence after restore");
  }
}
