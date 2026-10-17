import { AgentSystem } from "../simulation/AgentSystem";
import { EntityLayer } from "../simulation/EntityLayer";

/**
 * Clearing simulation populations is a deterministic reset boundary: the next
 * seeded run must begin from the same PRNG state, not continue the old stream.
 */
export function runSimulationRNGResetRegression(): void {
  const seed = 0x12345678;
  const advancedState = 0x76543210;

  const agents = new AgentSystem(seed);
  const agentSnapshot = agents.snapshot();
  agents.restore({ ...agentSnapshot, rngState: advancedState });
  agents.clear();
  if (agents.snapshot().rngState !== seed) {
    throw new Error("AgentSystem.clear did not restore the constructor RNG seed");
  }
  if (agents.snapshot().nextAgentId !== 1 || agents.snapshot().agents.length !== 0) {
    throw new Error("AgentSystem.clear did not restore empty population allocator state");
  }

  const entities = new EntityLayer(seed);
  const entitySnapshot = entities.snapshot();
  entities.restore({ ...entitySnapshot, rngState: advancedState });
  entities.clear();
  const resetEntities = entities.snapshot();
  if (resetEntities.rngState !== seed) {
    throw new Error("EntityLayer.clear did not restore the constructor RNG seed");
  }
  if (resetEntities.nextId !== 1 || resetEntities.entities.length !== 0) {
    throw new Error("EntityLayer.clear did not restore empty population allocator state");
  }
  if (resetEntities.pendingBoundaryComponents.length !== 0) {
    throw new Error("EntityLayer.clear retained pending boundary components");
  }
}
