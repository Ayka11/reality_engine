import type { ExperimentSnapshot } from './ExperimentRunner'

export type ReplicationMetricStatistics = {
  n: number
  mean: number
  variance: number
  standardDeviation: number
  standardError: number
  min: number
  max: number
  confidence95: { lower: number | null; upper: number | null }
  directionConsistency: number | null
}

export type ReplicationStatisticalSummary = {
  experimentIds: string[]
  completedExperiments: number
  metrics: Record<string, ReplicationMetricStatistics>
}

const Z95 = 1.96

function summarize(values: number[], center = 0): ReplicationMetricStatistics {
  const n = values.length
  if (!n) return {
    n: 0, mean: 0, variance: 0, standardDeviation: 0, standardError: 0,
    min: 0, max: 0, confidence95: { lower: null, upper: null }, directionConsistency: null,
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / n
  const variance = n > 1
    ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1)
    : 0
  const standardDeviation = Math.sqrt(variance)
  const standardError = n > 1 ? standardDeviation / Math.sqrt(n) : 0
  const sign = center === 0 ? Math.sign(mean) : Math.sign(center)
  const directionConsistency = n
    ? values.filter(value => sign === 0 || Math.sign(value) === sign).length / n
    : null

  return {
    n,
    mean,
    variance,
    standardDeviation,
    standardError,
    min: Math.min(...values),
    max: Math.max(...values),
    confidence95: n > 1
      ? { lower: mean - Z95 * standardError, upper: mean + Z95 * standardError }
      : { lower: null, upper: null },
    directionConsistency,
  }
}

export function summarizeReplicationSnapshots(
  snapshots: ExperimentSnapshot[],
): ReplicationStatisticalSummary {
  const completed = snapshots.filter(snapshot => snapshot.status === 'completed')
  const metricNames = new Set<string>()

  for (const snapshot of completed) {
    for (const [name, value] of Object.entries(snapshot.results)) {
      if (typeof value === 'number' && Number.isFinite(value)) metricNames.add(name)
    }
  }

  const metrics = Object.fromEntries(
    [...metricNames].sort().map(metric => {
      const values = completed
        .map(snapshot => snapshot.results[metric])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      return [metric, summarize(values)]
    }),
  )

  return {
    experimentIds: completed.map(snapshot => snapshot.protocol.experimentId),
    completedExperiments: completed.length,
    metrics,
  }
}
