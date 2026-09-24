import { InfinityScaleAdaptiveStability } from "./InfinityScaleAdaptiveStability";
import { runInfinityScaleGPUBoundaryTransferContractRegression } from "./InfinityScaleGPUBoundaryTransferContract.regression";
import { runInfinityScaleUnifiedTransactionRegression } from "./InfinityScaleUnifiedTransaction.regression";

function runScenario(): string[] {
  const scheduler = new InfinityScaleAdaptiveStability({
    refineEvidenceEpochs: 2,
    coarsenEvidenceEpochs: 3,
    minResidenceEpochs: 2,
    cooldownEpochs: 2,
    oscillationTransitions: 3,
    freezeEpochs: 4,
  });

  const decisions: string[] = [];
  let lod = 0;

  const scores = [0.20, 0.78, 0.84, 0.79, 0.76, 0.40, 0.18, 0.20, 0.19, 0.18, 0.18, 0.18];
  for (let epoch = 0; epoch < scores.length; epoch++) {
    const result = scheduler.decide("E2E-1", epoch, { score: scores[epoch] }, lod);
    if (result.decision === "REFINE") lod++;
    if (result.decision === "COARSEN") lod--;
    decisions.push(`${epoch}:${result.decision}:LOD${lod}`);
  }

  return decisions;
}

export function runInfinityScaleAdaptiveEndToEndRegression(): void {
  const first = runScenario();
  const second = runScenario();

  if (first.join("|") !== second.join("|")) {
    throw new Error("Adaptive end-to-end scenario is not deterministic");
  }

  const mutations = first.filter(entry => entry.includes(":REFINE:") || entry.includes(":COARSEN:"));
  const reversals = mutations.slice(1).filter((entry, index) => {
    const previous = mutations[index];
    return previous.includes(":REFINE:") !== entry.includes(":REFINE:");
  });

  if (mutations.length > 3) {
    throw new Error(`Adaptive scenario exceeded expected topology mutation bound: ${mutations.length}`);
  }
  if (reversals.length > 1) {
    throw new Error(`Adaptive scenario thrashed: ${reversals.length} reversals`);
  }

  // The end-to-end gate must retain the already validated GPU boundary and
  // global transaction invariants. It does not bypass their existing contracts.
  runInfinityScaleGPUBoundaryTransferContractRegression();
  runInfinityScaleUnifiedTransactionRegression();
}
