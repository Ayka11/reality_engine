import { attributeInfinityScaleAdaptiveError } from "./InfinityScaleCausalAdaptiveAttribution";

export function runInfinityScaleCausalAdaptiveAttributionRegression(): void {
  const input = {
    physicalEvolution: 0.42,
    lodTransitionEffect: 0.18,
    transferEffect: 0.09,
    numericalResidual: 0.06,
  };
  const attribution = attributeInfinityScaleAdaptiveError(input);

  if (Math.abs(attribution.totalObservedError - 0.75) > 1e-12) throw new Error("Total attributed error is incorrect");
  if (Math.abs(attribution.predictiveError - 0.48) > 1e-12) throw new Error("Predictive error attribution is incorrect");
  if (Math.abs(attribution.attributionResidual - 0.27) > 1e-12) throw new Error("Transition attribution residual is incorrect");

  const replay = attributeInfinityScaleAdaptiveError(input);
  if (replay.deterministicHash !== attribution.deterministicHash) throw new Error("Causal attribution is not deterministic");
  for (const invalid of [
    { ...input, physicalEvolution: Number.NaN },
    { ...input, transferEffect: Number.POSITIVE_INFINITY },
    { ...input, numericalResidual: -0.01 },
  ]) {
    let rejected = false;
    try {
      attributeInfinityScaleAdaptiveError(invalid);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("Causal attribution accepted an invalid error component");
  }
}
