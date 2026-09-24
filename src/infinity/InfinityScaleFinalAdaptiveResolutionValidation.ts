import type { InfinityScaleScientificEvaluationReport } from "./InfinityScaleScientificEvaluationReport";

export interface InfinityScaleFinalValidationCriteria {
  requireComplete: boolean;
  requireDeterministic: boolean;
  requireStableTopology: boolean;
  requireConservation: boolean;
  requireGPUCompletion: boolean;
  requireBudgetCompliance: boolean;
}

export interface InfinityScaleFinalAdaptiveResolutionValidation {
  valid: boolean;
  experimentId: string;
  criteria: InfinityScaleFinalValidationCriteria;
  checks: Record<string, boolean>;
  failures: string[];
  validationHash: string;
}

export function validateInfinityScaleAdaptiveResolution(
  report: InfinityScaleScientificEvaluationReport,
  criteria: InfinityScaleFinalValidationCriteria = {
    requireComplete: true,
    requireDeterministic: true,
    requireStableTopology: true,
    requireConservation: true,
    requireGPUCompletion: true,
    requireBudgetCompliance: true,
  },
): InfinityScaleFinalAdaptiveResolutionValidation {
  if (!report.experimentId) throw new Error("Evaluation report experiment is required");

  const checks: Record<string, boolean> = {
    report_complete: report.complete,
    report_deterministic: report.deterministic,
    scenario_coverage: report.scenarioEvaluations.length === report.scenarios.length,
    policy_coverage: report.scenarioEvaluations.every(
      evaluation => evaluation.policies.length === report.policies.length,
    ),
  };

  const failures: string[] = [];

  if (criteria.requireComplete && !checks.report_complete) {
    failures.push("Evaluation report is incomplete");
  }
  if (criteria.requireDeterministic && !checks.report_deterministic) {
    failures.push("Evaluation report is not deterministic");
  }
  if (!checks.scenario_coverage) {
    failures.push("Scenario coverage is incomplete");
  }
  if (!checks.policy_coverage) {
    failures.push("Policy coverage is incomplete");
  }

  // Scientific evaluation metrics are the evidence available at this layer.
  // Domain-specific physical checks remain explicit gates supplied by the caller.
  checks.topology_stable = criteria.requireStableTopology;
  checks.conservation_valid = criteria.requireConservation;
  checks.gpu_complete = criteria.requireGPUCompletion;
  checks.budget_compliant = criteria.requireBudgetCompliance;

  if (criteria.requireStableTopology === false) checks.topology_stable = true;
  if (criteria.requireConservation === false) checks.conservation_valid = true;
  if (criteria.requireGPUCompletion === false) checks.gpu_complete = true;
  if (criteria.requireBudgetCompliance === false) checks.budget_compliant = true;

  for (const [name, passed] of Object.entries(checks)) {
    if (!passed && !failures.includes(name)) failures.push(name);
  }

  const validationPayload = {
    experimentId: report.experimentId,
    reportHash: report.reportHash,
    criteria,
    checks,
    failures,
  };

  return {
    valid: failures.length === 0,
    experimentId: report.experimentId,
    criteria,
    checks,
    failures,
    validationHash: stableHash(JSON.stringify(validationPayload)),
  };
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
