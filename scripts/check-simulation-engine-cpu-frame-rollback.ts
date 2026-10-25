import assert from "node:assert/strict";
import { F } from "../src/core/CellState.ts";
import { SimulationEngine } from "../src/simulation/SimulationEngine.ts";

export async function runSimulationEngineCPUFrameRollbackRegression(): Promise<void> {
  const engine = new SimulationEngine(16, 16, 8);
  const fieldIndex = engine.grid.idx(7, 7, 3) + F.ENERGY;
  engine.grid.buffer[fieldIndex] = 25;
  engine.grid.backBuffer[fieldIndex] = 17;
  engine.agents.seed(engine.grid, 1);
  const initialAgent = engine.agents.getAgents()[0];
  assert.ok(initialAgent, "rollback fixture must contain one initial agent");
  initialAgent.energy = 90;
  engine.grid.syncDenseToChunks();
  engine.grid.clearDirtyChunks();

  engine.restoreTick(500);
  engine.laws.toggleProcess(27, false);
  engine.worldEvents.trigger(engine.grid, "meteor_strike", engine.tick);
  engine.causal.log(engine.tick, 1, 1, 1, 21, "energy_spike", 45);
  engine.recorder.startRecording();
  engine.grid.assignChunkOwner("0,0,0", "baseline-owner");
  engine.grid.syncDenseToChunks();
  engine.grid.clearDirtyChunks();
  const before = engine.captureCoreRecoveryState();

  // Tick 500 enters the post-frame chunk-cleanup path. Let cleanup mutate,
  // then inject late mutations in every captured domain before forcing rollback.
  const sparseGrid = engine.grid as unknown as {
    cullInactive: (...args: Parameters<typeof engine.grid.cullInactive>) => void;
  };
  const originalCullInactive = sparseGrid.cullInactive;
  try {
    sparseGrid.cullInactive = function(...args) {
      originalCullInactive.apply(this, args);

      engine.grid.buffer[fieldIndex] = 999;
      engine.grid.backBuffer[fieldIndex] = 123;
      const agent = engine.agents.getAgents()[0];
      if (agent) agent.energy = 1;
      engine.agents.seed(engine.grid, 1);

      // Consume private PRNGs explicitly so deterministic state recovery is
      // tested even if later runtime changes stop drawing from one of them.
      (engine.agents as unknown as { _random: () => number })._random();
      (engine.entityLayer as unknown as { _random: () => number })._random();
      (engine.laws as unknown as { _random: () => number })._random();
      (engine.worldEvents as unknown as { _random: () => number })._random();

      engine.laws.toggleProcess(27, true);
      engine.worldEvents.trigger(engine.grid, "meteor_strike", engine.tick);
      engine.causal.log(engine.tick, 1, 1, 1, 7, "energy_spike", 12);
      engine.recorder.stopRecording();
      engine.grid.assignChunkOwner("0,0,0", "rollback-test-owner");
      engine.grid.markChunksDirty(["0,0,0"]);
      throw new Error("injected post-cull CPU-frame failure");
    };

    await assert.rejects(engine.step(0.016), /injected post-cull CPU-frame failure/);
  } finally {
    sparseGrid.cullInactive = originalCullInactive;
  }

  assert.deepEqual(
    engine.captureCoreRecoveryState(),
    before,
    "failed CPU frame must restore grid, entity/agent/law/event/causal/recorder state and RNG",
  );

  await engine.step(0.016);
  assert.equal(engine.tick, 501, "step queue must remain usable after a rolled-back frame");

  // Invalid frame arguments must be rejected before any state mutation or queue poisoning.
  const beforeInvalidArguments = engine.captureCoreRecoveryState();
  await assert.rejects(engine.step(Number.NaN), /dt must be a finite non-negative number/);
  await assert.rejects(engine.step(-0.01), /dt must be a finite non-negative number/);
  await assert.rejects(engine.step(0.016, Number.POSITIVE_INFINITY), /nSteps must be a non-negative safe integer/);
  await assert.rejects(engine.step(0.016, 1.5), /nSteps must be a non-negative safe integer/);
  await assert.rejects(engine.step(0.016, -1), /nSteps must be a non-negative safe integer/);
  assert.deepEqual(
    engine.captureCoreRecoveryState(),
    beforeInvalidArguments,
    "invalid asynchronous step arguments must not mutate simulation state",
  );

  // Zero steps are a true no-op for both async and synchronous entry points.
  await engine.step(0.016, 0);
  assert.deepEqual(
    engine.captureCoreRecoveryState(),
    beforeInvalidArguments,
    "zero asynchronous steps must not tick subsystems or alter recovery state",
  );
  await engine.step(0, 1);
  await engine.step(0, 20);
  assert.deepEqual(
    engine.captureCoreRecoveryState(),
    beforeInvalidArguments,
    "zero elapsed time must not age entities, advance events/laws, or write recorder frames",
  );

  assert.throws(() => engine.syncTick(-1), /syncTick n must be a non-negative safe integer/);
  assert.throws(() => engine.syncTick(1.5), /syncTick n must be a non-negative safe integer/);
  assert.throws(() => engine.syncTick(Number.NaN), /syncTick n must be a non-negative safe integer/);
  assert.deepEqual(
    engine.captureCoreRecoveryState(),
    beforeInvalidArguments,
    "invalid synchronous step arguments must not mutate simulation state",
  );

  await engine.step(0.016);
  assert.equal(engine.tick, 502, "step queue must remain usable after invalid requests");
}

await runSimulationEngineCPUFrameRollbackRegression();
console.log("SimulationEngine CPU frame rollback regression: PASS");
