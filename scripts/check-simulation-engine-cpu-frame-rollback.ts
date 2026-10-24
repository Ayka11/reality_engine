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

  // Fail after physics, causality detection, world-event processing, and recorder
  // updates have already mutated state. This exercises rollback of late domains,
  // not just an early physics exception.
  const lawEngine = engine.laws as unknown as {
    tick: (...args: Parameters<typeof engine.laws.tick>) => void;
  };
  const originalTick = lawEngine.tick;
  lawEngine.tick = function(...args) {
    originalTick.apply(this, args);
    throw new Error("injected late CPU-frame failure");
  };

  try {
    await assert.rejects(engine.step(0.016), /injected late CPU-frame failure/);
  } finally {
    lawEngine.tick = originalTick;
  }

  assert.deepEqual(
    engine.captureCoreRecoveryState(),
    before,
    "failed CPU frame must restore all captured core domains after a late failure",
  );

  await engine.step(0.016);
  assert.equal(engine.tick, 8, "step queue must remain usable after a rolled-back frame");
}

await runSimulationEngineCPUFrameRollbackRegression();
console.log("SimulationEngine CPU frame rollback regression: PASS");
