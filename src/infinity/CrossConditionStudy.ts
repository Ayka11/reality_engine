import type { ExperimentProtocol } from './ExperimentProtocol'
import type { ExperimentSnapshot } from './ExperimentRunner'
import { buildExperimentMatrix, type ExperimentMatrix } from './ExperimentMatrix'
import { ExperimentBatchExecutor } from './ExperimentBatchExecutor'
import { runWorldExperiment } from './WorldExperimentRunner'
import { analyzeGeneralization, type GeneralizationDimension, type GeneralizationResult } from './ExperimentGeneralization'

export type CrossConditionStudyOptions = {
  matrix: ExperimentMatrix
  generalizationDimensions?: GeneralizationDimension[]
  stopOnError?: boolean
}

export type CrossConditionStudyResult = {
  plans: ExperimentProtocol[]
  snapshots: ExperimentSnapshot[]
  completed: number
  failed: number
  generalization: Partial<Record<GeneralizationDimension, GeneralizationResult>>
}

export async function runCrossConditionStudy(
  options: CrossConditionStudyOptions,
): Promise<CrossConditionStudyResult> {
  const plans = buildExperimentMatrix(options.matrix)
  const executor = new ExperimentBatchExecutor()
  const batch = await executor.execute(
    plans,
    async (plan) => {
      const snapshot = await runWorldExperiment(plan)
      return snapshot.results
    },
    {
      stopOnError: options.stopOnError ?? false,
    },
  )

  const snapshots = batch.snapshots
  const generalization: Partial<Record<GeneralizationDimension, GeneralizationResult>> = {}

  for (const dimension of options.generalizationDimensions ?? ['seed']) {
    generalization[dimension] = analyzeGeneralization(snapshots, dimension)
  }

  return {
    plans,
    snapshots,
    completed: batch.completed,
    failed: batch.failed,
    generalization,
  }
}
