import type { ExperimentProtocol } from './ExperimentProtocol'
import type { ExperimentSnapshot } from './ExperimentRunner'
import { ExperimentRunner } from './ExperimentRunner'
import { assessReplication, type ReplicationResult } from './ExperimentReplication'

export type ReplicationStudyOptions = {
  repetitions: number
  tolerance?: number
  run: (protocol: ExperimentProtocol, runner: ExperimentRunner, repetition: number) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void
}

export type ReplicationStudySummary = {
  protocol: ExperimentProtocol
  repetitionsRequested: number
  repetitionsCompleted: number
  repetitionsFailed: number
  tolerance: number
  snapshots: ExperimentSnapshot[]
  pairwise: ReplicationResult[]
  metricSummary: Record<string, {
    n: number
    mean: number
    standardDeviation: number
    min: number
    max: number
    withinToleranceRate: number | null
  }>
}

function summarize(values: number[]) {
  const n = values.length
  if (!n) return { mean: 0, standardDeviation: 0, min: 0, max: 0 }
  const mean = values.reduce((sum, value) => sum + value, 0) / n
  const variance = n > 1
    ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1)
    : 0
  return {
    mean,
    standardDeviation: Math.sqrt(variance),
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

export async function runReplicationStudy(
  protocol: ExperimentProtocol,
  options: ReplicationStudyOptions,
): Promise<ReplicationStudySummary> {
  if (!Number.isInteger(options.repetitions) || options.repetitions < 1) {
    throw new Error('Replication repetitions must be a positive integer')
  }

  const tolerance = options.tolerance ?? 1e-9
  const snapshots: ExperimentSnapshot[] = []
  let repetitionsFailed = 0

  for (let repetition = 1; repetition <= options.repetitions; repetition++) {
    const runner = new ExperimentRunner()
    runner.start({
      ...protocol,
      experimentId: `${protocol.experimentId}-r${String(repetition).padStart(3, '0')}`,
    })

    try {
      const result = await options.run(protocol, runner, repetition)
      if (result) {
        for (const [name, value] of Object.entries(result)) {
          runner.record(name, value)
        }
      }
      snapshots.push(runner.finish('completed'))
    } catch {
      repetitionsFailed++
      snapshots.push(runner.finish('aborted'))
    }
  }

  const completed = snapshots.filter(snapshot => snapshot.status === 'completed')
  const pairwise: ReplicationResult[] = []

  for (let i = 1; i < completed.length; i++) {
    pairwise.push(assessReplication(completed[0], completed[i], tolerance))
  }

  const metricNames = new Set<string>()
  for (const snapshot of completed) {
    for (const [name, value] of Object.entries(snapshot.results)) {
      if (typeof value === 'number' && Number.isFinite(value)) metricNames.add(name)
    }
  }

  const metricSummary: ReplicationStudySummary['metricSummary'] = {}

  for (const metric of [...metricNames].sort()) {
    const values = completed
      .map(snapshot => snapshot.results[metric])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

    const summary = summarize(values)
    const comparisons = pairwise
      .map(result => result.metrics.find(metricResult => metricResult.name === metric))
      .filter((result): result is NonNullable<typeof result> => Boolean(result))

    const validComparisons = comparisons.filter(
      result => result.withinTolerance !== null,
    )

    metricSummary[metric] = {
      n: values.length,
      ...summary,
      withinToleranceRate: validComparisons.length
        ? validComparisons.filter(result => result.withinTolerance).length / validComparisons.length
        : null,
    }
  }

  return {
    protocol,
    repetitionsRequested: options.repetitions,
    repetitionsCompleted: completed.length,
    repetitionsFailed,
    tolerance,
    snapshots,
    pairwise,
    metricSummary,
  }
}
