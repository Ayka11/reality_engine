import type { ExperimentPlan } from './ExperimentMatrix'
import type { ExperimentSnapshot } from './ExperimentRunner'
import { ExperimentCatalog } from './ExperimentCatalog'
import { ExperimentBatchExecutor, type BatchExecutionResult } from './ExperimentBatchExecutor'
import { runWorldExperiment, type WorldExperimentRunnerOptions } from './WorldExperimentRunner'

export type WorldBatchSummary = {
  batch: BatchExecutionResult
  experiments: Array<{
    experimentId: string
    fingerprint: string
    seed: string
    providerId: string
    providerVersion: string
    meanHeight?: number
    meanBuildability?: number
    meanRouteCost?: number
    status: ExperimentSnapshot['status']
  }>
}

export async function runWorldExperimentBatch(
  plans: ExperimentPlan[],
  options: WorldExperimentRunnerOptions = {},
): Promise<WorldBatchSummary> {
  const catalog = new ExperimentCatalog()
  const executor = new ExperimentBatchExecutor(catalog)

  const batch = await executor.execute(
    plans,
    plan => runWorldExperiment(plan, options).results,
    { stopOnError: false },
  )

  const experiments = batch.snapshots.map(snapshot => {
    const world = snapshot.results.world as Record<string, unknown> | undefined
    return {
      experimentId: snapshot.protocol.experimentId,
      fingerprint: snapshot.fingerprint,
      seed: snapshot.protocol.world.seed,
      providerId: snapshot.protocol.field.providerId,
      providerVersion: snapshot.protocol.field.providerVersion,
      meanHeight: typeof world?.meanHeight === 'number' ? world.meanHeight : undefined,
      meanBuildability: typeof world?.meanBuildability === 'number' ? world.meanBuildability : undefined,
      meanRouteCost: typeof world?.meanRouteCost === 'number' ? world.meanRouteCost : undefined,
      status: snapshot.status,
    }
  })

  return { batch, experiments }
}
