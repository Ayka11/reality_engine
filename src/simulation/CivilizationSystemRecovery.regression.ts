import { VoxelGrid } from "../core/VoxelGrid";
import { F } from "../core/CellState";
import { CivilizationSystem } from "./CivilizationSystem";

export function runCivilizationSystemRecoveryRegression(): void {
  const grid = new VoxelGrid(8, 8, 4);
  for (let z = 0; z < grid.D; z++)
    for (let y = 0; y < grid.H; y++)
      for (let x = 0; x < grid.W; x++)
        grid.buffer[grid.idx(x, y, z) + F.BIO_POTENTIAL] = 0.8;

  const system = new CivilizationSystem(grid, 13579);
  const initial = system.snapshot();
  system.seedFromGrid();
  const first = JSON.stringify(system.snapshot());
  system.restore(initial);
  system.seedFromGrid();
  const replay = JSON.stringify(system.snapshot());
  if (first !== replay) {
    throw new Error("CivilizationSystem restore did not replay seeded civilization generation");
  }

  // Public read APIs must not expose authoritative arrays or nested civilization state.
  const beforeReadViewMutation = JSON.stringify(system.snapshot());
  const exposedCivs = system.civs;
  const exposedHistory = system.historyLog;
  if (exposedCivs.length === 0) {
    throw new Error("CivilizationSystem regression fixture failed to seed a civilization");
  }
  const exposedCiv = exposedCivs[0];
  exposedCiv.name = "tampered";
  exposedCiv.color[0] = -999;
  exposedCiv.origin[0] = -999;
  exposedCiv.territory.push(grid.size + 999);
  exposedCiv.diplomacy[999] = "war";
  exposedCiv.history.push("tampered");
  exposedCivs.splice(0, 1);
  exposedHistory.push("tampered");
  if (JSON.stringify(system.snapshot()) !== beforeReadViewMutation) {
    throw new Error("CivilizationSystem public read views leaked mutable authoritative state");
  }

  const invalid = system.snapshot();
  invalid.rngState = 0;
  let rejected = false;
  try { system.restore(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error("CivilizationSystem accepted an invalid PRNG state");
}
