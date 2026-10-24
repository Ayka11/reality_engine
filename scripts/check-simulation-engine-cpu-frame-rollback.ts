import assert from "node:assert/strict";
import { F } from "../src/core/CellState.ts";
import { SimulationEngine } from "../src/simulation/SimulationEngine.ts";

export async function runSimulationEngineCPUFrameRollbackRegression(): Promise<void> {
  const engine = new SimulationEngine(8, 8, 4);
  engine.grid.cell(3, 3, 2).set(F.ENERGY, 900);
  engine.grid.cell(3, 3, 2).set(F.DENSITY, 0.7);
  engine.agents.seed(engine.grid, 1);
  engine.grid.syncDenseToChunks();
  engine.restoreTick(7);
  const before = engine.captureCoreRecoveryState();

  const agentSystem = engine.agents as unknown as {
    tick: (grid: typeof engine.grid, dt: number) => void;
  };
  const originalTick = agentSystem.tick;
  agentSystem.tick = function(grid, dt) {
    originalTick.call(this, grid, dt);
    throw new Error("injected late CPU-frame failure");
  };

  await assert.rejects(engine.step(0.016), /injected late CPU-frame failure/);
  agentSystem.tick = originalTick;

  assert.deepEqual(
    engine.captureCoreRecoveryState(),
    before,
    "failed CPU frame must restore all captured core domains",
  );

  await engine.step(0.016);
  assert.equal(engine.tick, 8, "step queue must remain usable after a rolled-back frame");
}

await runSimulationEngineCPUFrameRollbackRegression();
console.log("SimulationEngine CPU frame rollback regression: PASS");
