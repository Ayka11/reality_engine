import { InfinityScaleTopologyMutationBridge } from "./InfinityScaleTopologyMutationBridge";
import { InfinityScaleSpatialConstraintClosure } from "./InfinityScaleSpatialConstraintClosure";

export function runInfinityScaleTopologyMutationBridgeRegression(): void {
  const closureEngine = new InfinityScaleSpatialConstraintClosure(4);
  const bridge = new InfinityScaleTopologyMutationBridge();

  const regions = [
    { regionId: "A", currentLOD: 1, proposedLOD: 3, neighbors: ["B"] },
    { regionId: "B", currentLOD: 1, proposedLOD: 1, neighbors: ["A"] },
  ];

  const closure = closureEngine.close(regions);
  const accepted = bridge.evaluate(regions, closure);

  if (!accepted.accepted || !accepted.topologyValid) {
    throw new Error("Valid closed adaptive plan was rejected");
  }
  if (!accepted.requiresTransfer || !accepted.requiresConservationValidation || !accepted.requiresGPUExecution) {
    throw new Error("Topology mutation bridge did not activate required execution barriers");
  }
  if (accepted.mutationSet.length !== 1 || accepted.mutationSet[0].regionId !== "A") {
    throw new Error("Topology mutation set was not deterministic");
  }

  const invalid = bridge.evaluate(
    regions,
    {
      proposedLOD: new Map([["A", 3], ["B", 1]]),
      changedRegionIds: ["A"],
      iterations: 1,
      valid: false,
    },
  );

  if (invalid.accepted || invalid.topologyValid) {
    throw new Error("Invalid spatial topology was accepted");
  }

  const unchangedClosure = closureEngine.close([
    { regionId: "A", currentLOD: 1, proposedLOD: 1, neighbors: ["B"] },
    { regionId: "B", currentLOD: 1, proposedLOD: 1, neighbors: ["A"] },
  ]);
  const unchanged = bridge.evaluate(
    [
      { regionId: "A", currentLOD: 1, proposedLOD: 1 },
      { regionId: "B", currentLOD: 1, proposedLOD: 1 },
    ],
    unchangedClosure,
  );

  if (!unchanged.accepted || unchanged.requiresTransfer || unchanged.mutationSet.length !== 0) {
    throw new Error("No-op adaptive plan incorrectly requested execution");
  }
}
