import { VoxelGrid } from "../core/VoxelGrid";
import { F } from "../core/CellState";
import { CivilizationSystem } from "../simulation/CivilizationSystem";

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

  const invalid = system.snapshot();
  invalid.rngState = 0;
  let rejected = false;
  try { system.restore(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error("CivilizationSystem accepted an invalid PRNG state");
}
