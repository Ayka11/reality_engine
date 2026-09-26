import type { ExperimentPlan } from './ExperimentMatrix'
import type { ExperimentSnapshot } from './ExperimentRunner'
import { ExperimentRunner } from './ExperimentRunner'
import { ExperimentCatalog } from './ExperimentCatalog'

export type BatchExecutionResult = {
  total: number
  completed: number
  aborted: number
  failed: number
  snapshots: ExperimentSnapshot[]
  errors: Array<{ index: number; experimentId: string; message: string }>
}

export type BatchExecutorOptions = {
  stopOnError?: boolean
  onProgress?: (completed: number, total: number, plan: ExperimentPlan) => void
}

export class ExperimentBatchExecutor {
  constructor(private readonly catalog: ExperimentCatalog = new ExperimentCatalog()) {}

  async execute(
    plans: ExperimentPlan[],
    run: (
      plan: ExperimentPlan,
      runner: ExperimentRunner,
    ) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void,
    options: BatchExecutorOptions = {},
  ): Promise<BatchExecutionResult> {
    const snapshots: ExperimentSnapshot[] = []
    const errors: BatchExecutionResult['errors'] = []
    let completed = 0
    let aborted = 0
    let failed = 0

    for (const plan of plans) {
      const runner = new ExperimentRunner()
      runner.start(plan.protocol)

      try {
        const result = await run(plan, runner)
        if (result) {
          for (const [name, value] of Object.entries(result)) {
            runner.record(name, value)
          }
        }
        const snapshot = runner.finish('completed')
        this.catalog.add(snapshot)
        snapshots.push(snapshot)
        completed++
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const snapshot = runner.finish('aborted')
        this.catalog.add(snapshot)
        snapshots.push(snapshot)
        aborted++
        failed++
        errors.push({
          index: plan.index,
          experimentId: plan.protocol.experimentId,
          message,
        })
        options.onProgress?.(completed + aborted, plans.length, plan)
        if (options.stopOnError) break
        continue
      }

      options.onProgress?.(completed + aborted, plans.length, plan)
    }

    return {
      total: plans.length,
      completed,
      aborted,
      failed,
      snapshots,
      errors,
    }
  }

  getCatalog() {
    return this.catalog
  }
}
