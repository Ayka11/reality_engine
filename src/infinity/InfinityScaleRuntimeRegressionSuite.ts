import { runSimulationEngineInfinityScaleSelectiveCPURegression } from "../simulation/SimulationEngine.infinityScale.regression";
import { runSimulationEngineMixedLODMultiFrameRegression } from "../simulation/SimulationEngine.mixedLOD.regression";

export interface InfinityScaleRuntimeRegressionResult {
  name: string;
  passed: boolean;
}

export async function runInfinityScaleRuntimeRegressionSuite(): Promise<InfinityScaleRuntimeRegressionResult[]> {
  const tests: Array<[string, () => Promise<void>]> = [
    ["simulation-engine-selective-cpu", runSimulationEngineInfinityScaleSelectiveCPURegression],
    ["simulation-engine-mixed-lod-multi-frame", runSimulationEngineMixedLODMultiFrameRegression],
  ];

  const results: InfinityScaleRuntimeRegressionResult[] = [];
  for (const [name, test] of tests) {
    try {
      await test();
      results.push({ name, passed: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Infinity Scale runtime regression failed [${name}]: ${message}`);
    }
  }
  return results;
}
