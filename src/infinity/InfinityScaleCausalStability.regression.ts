import { InfinityScaleAdaptiveStability } from "./InfinityScaleAdaptiveStability";

export function runInfinityScaleCausalStabilityRegression(): void {
  const stability = new InfinityScaleAdaptiveStability({
    refineEvidenceEpochs: 1,
    coarsenEvidenceEpochs: 1,
    minResidenceEpochs: 0,
    cooldownEpochs: 0,
  });

  const decision = stability.decide("front", 1, {
    score: 0.95,
    estimatedError: 0.95,
    causalAttribution: {
      physicalEvolution: 0.3,
      numericalResidual: 0.05,
      lodTransitionEffect: 0.55,
      transferEffect: 0.05,
    },
  }, 0);

  if (decision.decision !== "KEEP") throw new Error("Transition-only disturbance incorrectly triggered refinement");
  if (!decision.reason.includes("transition disturbance excluded")) throw new Error("Causal stability reason missing");

  const physical = stability.decide("physical", 1, {
    score: 0.8,
    estimatedError: 0.8,
    causalAttribution: {
      physicalEvolution: 0.8,
      numericalResidual: 0,
      lodTransitionEffect: 0.05,
      transferEffect: 0.02,
    },
  }, 0);

  if (physical.decision !== "REFINE") throw new Error("Physical adaptive evidence did not trigger refinement");
}
