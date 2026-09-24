import { InfinityScaleSpatialConstraintClosure } from "./InfinityScaleSpatialConstraintClosure";

export function runInfinityScaleSpatialConstraintClosureRegression(): void {
  const closure = new InfinityScaleSpatialConstraintClosure(4);

  const result = closure.close([
    { regionId: "A", currentLOD: 0, proposedLOD: 3, neighbors: ["B"] },
    { regionId: "B", currentLOD: 0, proposedLOD: 0, neighbors: ["A", "C"] },
    { regionId: "C", currentLOD: 0, proposedLOD: 0, neighbors: ["B"] },
  ]);

  if (!result.valid) throw new Error("Spatial closure produced an invalid topology");
  if (Math.abs(result.proposedLOD.get("A")! - result.proposedLOD.get("B")!) > 1) {
    throw new Error("A/B 2:1 balance was not restored");
  }
  if (result.proposedLOD.get("A") !== 1) {
    throw new Error("Closure did not conservatively propagate the required LOD reduction");
  }
  if (result.changedRegionIds.length === 0) {
    throw new Error("Closure failed to report changed regions");
  }

  const valid = closure.close([
    { regionId: "A", currentLOD: 1, proposedLOD: 2, neighbors: ["B"] },
    { regionId: "B", currentLOD: 1, proposedLOD: 1, neighbors: ["A"] },
  ]);

  if (!valid.valid || valid.changedRegionIds.length !== 0) {
    throw new Error("Already-valid topology was unnecessarily mutated");
  }

  const replayA = closure.close([
    { regionId: "A", currentLOD: 0, proposedLOD: 3, neighbors: ["B"] },
    { regionId: "B", currentLOD: 0, proposedLOD: 0, neighbors: ["A", "C"] },
    { regionId: "C", currentLOD: 0, proposedLOD: 0, neighbors: ["B"] },
  ]);
  const replayB = closure.close([
    { regionId: "A", currentLOD: 0, proposedLOD: 3, neighbors: ["B"] },
    { regionId: "B", currentLOD: 0, proposedLOD: 0, neighbors: ["A", "C"] },
    { regionId: "C", currentLOD: 0, proposedLOD: 0, neighbors: ["B"] },
  ]);

  if (JSON.stringify([...replayA.proposedLOD]) !== JSON.stringify([...replayB.proposedLOD])) {
    throw new Error("Spatial closure is not deterministic");
  }
}
