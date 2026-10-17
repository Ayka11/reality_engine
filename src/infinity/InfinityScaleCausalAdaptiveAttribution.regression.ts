import { attributeInfinityScaleAdaptiveError } from "./InfinityScaleCausalAdaptiveAttribution";

export function runInfinityScaleCausalAdaptiveAttributionRegression(): void {
  const attribution = attributeInfinityScaleAdaptiveError({
    physicalEvolution: 0.42,
    lodTransitionEffect: 0.18,
    transferEffect: 0.09,
    numericalResidual: 0.06,
  });

  if (Math.abs(attribution.totalObservedError - 0.75) > 1e-12) throw new Error("Total attributed error is incorrect");
  if (Math.abs(attribution.predictiveError - 0.48) > 1e-12) throw new Error("Predictive error attribution is incorrect");
  if (Math.abs(attribution.attributionResidual - 0.27) > 1e-12) throw new Error("Transition attribution residual is incorrect");

  const replay = attributeInfinityScaleAdaptiveError({
    physicalEvolution: 0.42,
    lodTransitionEffect: 0.18,
    transferEffect: 0.09,
    numericalResidual: 0.06,
  });
  if (replay.deterministicHash !== attribution.deterministicHash) throw new Error("Causal attribution is not deterministic");
}
