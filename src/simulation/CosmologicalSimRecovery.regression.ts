import { CosmologicalSim } from "./CosmologicalSim";

export function runCosmologicalSimRecoveryRegression(): void {
  const sim = new CosmologicalSim(97531);
  const initial = sim.snapshot();
  sim.bigBang();
  sim.seedGalaxies(2);
  const first = sim.snapshot();
  sim.restore(initial);
  sim.bigBang();
  sim.seedGalaxies(2);
  const replay = sim.snapshot();

  if (JSON.stringify(first.galaxies) !== JSON.stringify(replay.galaxies) ||
      JSON.stringify(first.cells) !== JSON.stringify(replay.cells) ||
      JSON.stringify(first.dirtyKeys) !== JSON.stringify(replay.dirtyKeys) ||
      first.rngState !== replay.rngState) {
    throw new Error("CosmologicalSim restore did not replay big-bang and galaxy seeding");
  }

  const invalid = sim.snapshot();
  invalid.rngState = 0;
  let rejected = false;
  try { sim.restore(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error("CosmologicalSim accepted an invalid PRNG state");
}
