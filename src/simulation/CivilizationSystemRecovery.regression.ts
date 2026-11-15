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

  const baseline = system.snapshot();
  const malformedCases: Array<[string, (candidate: ReturnType<typeof system.snapshot>) => void]> = [
    ["out-of-bounds origin", candidate => { candidate.civs[0].origin[0] = grid.W; }],
    ["out-of-bounds territory cell", candidate => { candidate.civs[0].territory[0] = grid.size; }],
    ["overlapping civilization territory", candidate => {
      candidate.civs[1].territory[0] = candidate.civs[0].territory[0];
    }],
    ["invalid diplomatic relation", candidate => {
      candidate.civs[0].diplomacy[999] = "peace" as "neutral";
    }],
    ["invalid population ceiling", candidate => { candidate.civs[0].population = 10001; }],
    ["non-string civilization history", candidate => {
      (candidate.civs[0].history as unknown[])[0] = 42;
    }],
    ["oversized global history", candidate => {
      candidate.historyLog = Array.from({ length: 61 }, (_, index) => String(index));
    }],
  ];
  if (baseline.civs.length < 2 || baseline.civs.some(civ => civ.territory.length === 0)) {
    throw new Error("CivilizationSystem malformed-snapshot fixture did not generate enough civilizations");
  }
  for (const [label, mutate] of malformedCases) {
    const candidate = structuredClone(baseline);
    mutate(candidate);
    const before = JSON.stringify(system.snapshot());
    let rejected = false;
    try { system.restore(candidate); } catch { rejected = true; }
    if (!rejected || JSON.stringify(system.snapshot()) !== before) {
      throw new Error(`CivilizationSystem accepted malformed snapshot or changed state before rejecting: ${label}`);
    }
  }

  const invalid = system.snapshot();
  invalid.rngState = 0;
  let rejected = false;
  try { system.restore(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error("CivilizationSystem accepted an invalid PRNG state");
}
