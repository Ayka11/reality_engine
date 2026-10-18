import { SimulationEngine } from "../simulation/SimulationEngine";
import { ScriptEngine } from "../world/ScriptEngine";
import {
  ENV_HAZARDS,
  restoreWorldComposerRandomState,
  snapshotWorldComposerRandomState,
} from "../ux/WorldComposer";

function assertSameNumbers(actual: ArrayLike<number>, expected: ArrayLike<number>, label: string): void {
  if (actual.length !== expected.length) {
    throw new Error(`${label}: length mismatch ${actual.length} !== ${expected.length}`);
  }
  for (let i = 0; i < actual.length; i++) {
    if (!Object.is(actual[i], expected[i])) {
      throw new Error(`${label}: value mismatch at index ${i} (${actual[i]} !== ${expected[i]})`);
    }
  }
}

export function runWorldGenerationRNGRecoveryRegression(): void {
  // ScriptEngine must replay the same random script after restoring its own PRNG state.
  const scriptSim = new SimulationEngine(6, 6, 3);
  const scriptEngine = new ScriptEngine(scriptSim, 0x13579bdf);
  const scriptState = scriptEngine.snapshotRandomState();
  const script = `
    world.clear();
    for (let i = 0; i < 12; i++) {
      const x = Math.floor(Math.random() * W);
      const y = Math.floor(Math.random() * H);
      const z = Math.floor(Math.random() * D);
      world.fill(x, y, z, 'energy', 100 + i);
    }
  `;
  const firstScriptRun = scriptEngine.run(script);
  if (!firstScriptRun.success) {
    throw new Error(`ScriptEngine deterministic replay setup failed: ${firstScriptRun.log.join("; ")}`);
  }
  const expectedScriptGrid = scriptSim.grid.buffer.slice();
  scriptEngine.restoreRandomState(scriptState);
  const secondScriptRun = scriptEngine.run(script);
  if (!secondScriptRun.success) {
    throw new Error(`ScriptEngine deterministic replay failed: ${secondScriptRun.log.join("; ")}`);
  }
  assertSameNumbers(scriptSim.grid.buffer, expectedScriptGrid, "ScriptEngine PRNG restore replay");

  // WorldComposer's module-level hazard RNG must likewise replay after restore.
  const hazardSim = new SimulationEngine(12, 12, 4);
  const hazard = ENV_HAZARDS["Meteor Activity"];
  if (!hazard) throw new Error("WorldComposer meteor hazard is not registered");
  const composerState = snapshotWorldComposerRandomState();
  hazard.fn(hazardSim.grid);
  const expectedHazardGrid = hazardSim.grid.buffer.slice();
  hazardSim.grid.buffer.fill(0);
  restoreWorldComposerRandomState(composerState);
  hazard.fn(hazardSim.grid);
  assertSameNumbers(hazardSim.grid.buffer, expectedHazardGrid, "WorldComposer hazard RNG restore replay");

  // Invalid states must not be accepted as recoverable PRNG snapshots.
  let scriptRejected = false;
  try { scriptEngine.restoreRandomState(0); } catch { scriptRejected = true; }
  if (!scriptRejected) throw new Error("ScriptEngine accepted an invalid zero PRNG state");

  let composerRejected = false;
  try { restoreWorldComposerRandomState(0); } catch { composerRejected = true; }
  if (!composerRejected) throw new Error("WorldComposer accepted an invalid zero PRNG state");
}
