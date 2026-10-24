import assert from "node:assert/strict";
import { F } from "../src/core/CellState.ts";
import { SimulationEngine } from "../src/simulation/SimulationEngine.ts";

export async function runSimulationEngineCPUFrameRollbackRegression(): Promise<void> {
  const engine = new SimulationEngine(8, 8, 4);
  engine.grid.cell(3, 3, 2).set(F.ENERGY, 900);
  engine.grid.cell(3, 3, 2).set(F.DENSITY, 0.7);
  engine.agents.seed(engine.grid, 1);
  engine.grid.syncDenseToChunks();

  // Tick 500 activates the frame's chunk cleanup path before the injected failure.
  engine.restoreTick(500);
  const before = engine.captureCoreRecoveryState();

  // Fail only after world events, recorder, laws, and chunk metadata cleanup
  // have run. The wrapper lets cullInactive mutate first, then forces rollback.
  const sparseGrid = engine.grid as unknown as {
    cullInactive: (...args: Parameters<typeof engine.grid.cullInactive>) => void;
  };
  const originalCullInactive = sparseGrid.cullInactive;
  try {
    sparseGrid.cullInactive = function(...args) {
      originalCullInactive.apply(this, args);
      throw new Error("injected post-cull CPU-frame failure");
    };

    await assert.rejects(engine.step(0.016), /injected post-cull CPU-frame failure/);
  } finally {
    sparseGrid.cullInactive = originalCullInactive;
  }

  assert.deepEqual(
    engine.captureCoreRecoveryState(),
    before,
    "failed CPU frame must restore core state and sparse-grid metadata after late failure",
  );

  await engine.step(0.016);
  assert.equal(engine.tick, 501, "step queue must remain usable after a rolled-back frame");
}

await runSimulationEngineCPUFrameRollbackRegression();
console.log("SimulationEngine CPU frame rollback regression: PASS");
