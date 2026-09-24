import { runInfinityScaleRegressionSuite } from "./InfinityScaleRegressionSuite";

export interface InfinityScaleReleaseValidationResult {
  total: number;
  passed: number;
  failed: number;
  allPassed: boolean;
  validationHash: string;
}

export function runInfinityScaleReleaseValidation(): InfinityScaleReleaseValidationResult {
  const results = runInfinityScaleRegressionSuite();
  const failed = results.filter(result => !result.passed).length;
  const passed = results.length - failed;
  return {
    total: results.length,
    passed,
    failed,
    allPassed: failed === 0,
    validationHash: stableHash(JSON.stringify(results)),
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
