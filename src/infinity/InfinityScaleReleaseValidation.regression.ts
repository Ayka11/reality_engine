import { runInfinityScaleReleaseValidation } from "./InfinityScaleReleaseValidation";

export function runInfinityScaleReleaseValidationRegression(): void {
  const result = runInfinityScaleReleaseValidation();
  if (result.total !== 59) throw new Error(`Expected 60 registered release regressions, got ${result.total}`);
  if (!result.allPassed || result.failed !== 0 || result.passed !== result.total) {
    throw new Error("Release validation suite did not pass completely");
  }
  if (result.validationHash.length !== 8) throw new Error("Release validation hash missing");
}
