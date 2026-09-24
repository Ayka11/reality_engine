export interface InfinityScaleCausalAdaptiveAttributionInput {
  physicalEvolution: number;
  lodTransitionEffect: number;
  transferEffect: number;
  numericalResidual: number;
}

export interface InfinityScaleCausalAdaptiveAttribution {
  physicalEvolution: number;
  lodTransitionEffect: number;
  transferEffect: number;
  numericalResidual: number;
  totalObservedError: number;
  predictiveError: number;
  attributionResidual: number;
  deterministicHash: string;
}

export function attributeInfinityScaleAdaptiveError(
  input: InfinityScaleCausalAdaptiveAttributionInput,
): InfinityScaleCausalAdaptiveAttribution {
  const values = [
    input.physicalEvolution,
    input.lodTransitionEffect,
    input.transferEffect,
    input.numericalResidual,
  ];
  if (values.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error("Causal adaptive attribution values must be finite and non-negative");
  }

  const totalObservedError = values.reduce((sum, value) => sum + value, 0);
  const predictiveError = input.physicalEvolution + input.numericalResidual;
  const attributionResidual = totalObservedError - predictiveError;
  const deterministicHash = hash({
    physicalEvolution: input.physicalEvolution,
    lodTransitionEffect: input.lodTransitionEffect,
    transferEffect: input.transferEffect,
    numericalResidual: input.numericalResidual,
  });

  return {
    ...input,
    totalObservedError,
    predictiveError,
    attributionResidual,
    deterministicHash,
  };
}

function hash(value: unknown): string {
  const payload = JSON.stringify(value);
  let result = 2166136261;
  for (let i = 0; i < payload.length; i++) result = Math.imul(result ^ payload.charCodeAt(i), 16777619);
  return (result >>> 0).toString(16).padStart(8, "0");
}
