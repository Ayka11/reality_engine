import type { ExperimentPlan } from './ExperimentMatrix'
import type { ExperimentSnapshot } from './ExperimentRunner'
import { ExperimentCatalog } from './ExperimentCatalog'
import { ExperimentBatchExecutor, type BatchExecutionResult } from './ExperimentBatchExecutor'
import { runWorldExperiment, type WorldExperimentRunnerOptions } from './WorldExperimentRunner'

export type WorldBatchSummary = {
  batch: BatchExecutionResult
  aggregate: { successful:number; meanHeight:number; meanBuildability:number; meanRouteCost:number }
  experiments: Array<{
    experimentId:string; fingerprint:string; seed:string; providerId:string; providerVersion:string
    meanHeight?:number; meanBuildability?:number; meanRouteCost?:number; status:ExperimentSnapshot['status']
  }>
}

export async function runWorldExperimentBatch(plans:ExperimentPlan[], options:WorldExperimentRunnerOptions={}):Promise<WorldBatchSummary> {
  const catalog = new ExperimentCatalog()
  const executor = new ExperimentBatchExecutor(catalog)
  const batch = await executor.execute(
    plans,
    (plan, runner) => runWorldExperiment(plan, {...options, runner}),
    {stopOnError:false},
  )
  const experiments = batch.snapshots.map(snapshot => {
    const world = snapshot.results.world as Record<string, unknown> | undefined
    return {
      experimentId:snapshot.protocol.experimentId,
      fingerprint:snapshot.fingerprint,
      seed:snapshot.protocol.world.seed,
      providerId:snapshot.protocol.field.providerId,
      providerVersion:snapshot.protocol.field.providerVersion,
      meanHeight:typeof world?.meanHeight === 'number' ? world.meanHeight : undefined,
      meanBuildability:typeof world?.meanBuildability === 'number' ? world.meanBuildability : undefined,
      meanRouteCost:typeof world?.meanRouteCost === 'number' ? world.meanRouteCost : undefined,
      status:snapshot.status,
    }
  })
  const successful = experiments.filter(item => item.status === 'completed')
  const mean = (values:Array<number|undefined>) => {
    const finite = values.filter((value):value is number => typeof value === 'number' && Number.isFinite(value))
    return finite.length ? finite.reduce((sum,value)=>sum+value,0)/finite.length : 0
  }
  return {
    batch,
    aggregate:{
      successful:successful.length,
      meanHeight:mean(successful.map(item=>item.meanHeight)),
      meanBuildability:mean(successful.map(item=>item.meanBuildability)),
      meanRouteCost:mean(successful.map(item=>item.meanRouteCost)),
    },
    experiments,
  }
}
