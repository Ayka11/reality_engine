import {
  validateInfinityScaleAdaptiveResolution,
} from "./InfinityScaleFinalAdaptiveResolutionValidation";
import type { InfinityScaleScientificEvaluationReport } from "./InfinityScaleScientificEvaluationReport";

export function runInfinityScaleFinalAdaptiveResolutionValidationRegression(): void {
  const report: InfinityScaleScientificEvaluationReport = {
    reportVersion: "1.0",
    experimentId: "validation-001",
    scenarios: ["scenario-a"],
    policies: ["REACTIVE", "PREDICTIVE"],
    runs: 2,
    complete: true,
    deterministic: true,
    scenarioEvaluations: [{
      scenarioId: "scenario-a",
      policies: ["REACTIVE", "PREDICTIVE"],
      metrics: [],
      comparisonHash: "comparison",
      deterministic: true,
    }],
    manifestHash: "manifest",
    reportHash: "report",
  };

  const valid = validateInfinityScaleAdaptiveResolution(report, {
    requireComplete: true,
    requireDeterministic: true,
    requireStableTopology: false,
    requireConservation: false,
    requireGPUCompletion: false,
    requireBudgetCompliance: false,
  });

  if (!valid.valid) throw new Error("Final validation should pass when optional gates are disabled");
  if (!valid.validationHash) throw new Error("Validation hash missing");

  const invalid = validateInfinityScaleAdaptiveResolution({
    ...report,
    complete: false,
  });

  if (invalid.valid) throw new Error("Incomplete report must fail final validation");
  if (!invalid.failures.includes("Evaluation report is incomplete")) {
    throw new Error("Incomplete report failure was not recorded");
  }
}
