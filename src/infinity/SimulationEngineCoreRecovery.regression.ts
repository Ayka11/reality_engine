import { F } from "../core/CellState";
import { SimulationEngine } from "../simulation/SimulationEngine";

export function runSimulationEngineCoreRecoveryRegression(): void {
  const engine = new SimulationEngine(4, 4, 2);
  const fieldIndex = engine.grid.idx(1, 1, 1) + F.ENERGY;
  engine.grid.buffer[fieldIndex] = 125;
  engine.grid.backBuffer[fieldIndex] = 87;
  const agentId = engine.agents.spawnAt(1, 1, 1, "explorer", 210);
  engine.restoreTick(12);
  engine.laws.setLawOverride("law_radiation", "on");
  engine.laws.toggleProcess(27, false);
  engine.recorder.startRecording();
  engine.causal.log(12, 1, 1, 1, 21, "energy_spike", 45);
  const expectedLawMask = engine.laws.activeProcessMask;

  const snapshot = engine.captureCoreRecoveryState();
  engine.grid.buffer[fieldIndex] = -10;
  engine.grid.backBuffer[fieldIndex] = -20;
  engine.agents.getAgents()[0].energy = 1;
  engine.agents.spawnAt(2, 2, 1, "builder", 80);
  engine.restoreTick(99);
  engine.laws.setLawOverride("law_radiation", "off");
  engine.laws.toggleProcess(27, true);
  engine.recorder.stopRecording();
  engine.causal.clear();

  engine.restoreCoreRecoveryState(snapshot);
  if (engine.tick !== 12 ||
      engine.grid.buffer[fieldIndex] !== 125 ||
      engine.grid.backBuffer[fieldIndex] !== 87) {
    throw new Error("SimulationEngine core recovery did not restore tick or grid buffers");
  }
  if (engine.laws.getLawOverride("law_radiation") !== "on" ||
      engine.laws.activeProcessMask !== expectedLawMask ||
      !engine.recorder.recording ||
      engine.causal.recent(1)[0]?.tick !== 12) {
    throw new Error("SimulationEngine core recovery did not restore law, recorder, or causal state");
  }
  const agents = engine.agents.getAgents();
  if (agents.length !== 1 || agents[0].id !== agentId || agents[0].energy !== 210) {
    throw new Error("SimulationEngine core recovery did not restore agent state");
  }

  snapshot.grid.width += 1;
  let rejected = false;
  try {
    engine.restoreCoreRecoveryState(snapshot);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("SimulationEngine core recovery accepted an invalid nested grid snapshot");
  if (engine.tick !== 12 ||
      engine.grid.buffer[fieldIndex] !== 125 ||
      engine.agents.getAgents().length !== 1 ||
      engine.agents.getAgents()[0].energy !== 210) {
    throw new Error("SimulationEngine core recovery did not roll back after rejecting an invalid snapshot");
  }

  const invalidEnergySnapshot = engine.captureCoreRecoveryState();
  invalidEnergySnapshot.prevEnergy[0] = Number.NaN;
  let invalidEnergyRejected = false;
  try {
    engine.restoreCoreRecoveryState(invalidEnergySnapshot);
  } catch {
    invalidEnergyRejected = true;
  }
  if (!invalidEnergyRejected ||
      engine.tick !== 12 ||
      engine.grid.buffer[fieldIndex] !== 125 ||
      engine.grid.backBuffer[fieldIndex] !== 87) {
    throw new Error("SimulationEngine core recovery accepted non-finite previous-energy state");
  }

  const detached = engine.captureCoreRecoveryState();
  detached.grid.buffer[fieldIndex] = -999;
  detached.prevEnergy.fill(-1);
  if (engine.grid.buffer[fieldIndex] !== 125) {
    throw new Error("SimulationEngine core recovery snapshot aliases live grid buffers");
  }
}
