import type { ExperimentAnalysis, ExperimentAnalysisRow } from './ExperimentAnalysis'

export type MetricStatistics = {
  n: number
  mean: number
  variance: number
  standardDeviation: number
  min: number
  max: number
  standardError: number
  confidence95: {
    lower: number | null
    upper: number | null
  }
}

export type StatisticalExperimentGroup = {
  key: string
  count: number
  completed: number
  metrics: Record<string, MetricStatistics>
}

export type StatisticalExperimentAnalysis = {
  groups: StatisticalExperimentGroup[]
}

const Z95 = 1.96

function statistics(rows: ExperimentAnalysisRow[], metric: string): MetricStatistics {
  const values = rows
    .filter(row => row.status === 'completed')
    .map(row => row.metrics[metric])
    .filter((value): value is number => Number.isFinite(value))

  const n = values.length
  if (n === 0) {
    return {
      n: 0, mean: 0, variance: 0, standardDeviation: 0,
      min: 0, max: 0, standardError: 0,
      confidence95: { lower: null, upper: null },
    }
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / n
  const variance = n > 1
    ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1)
    : 0
  const standardDeviation = Math.sqrt(variance)
  const standardError = n > 1 ? standardDeviation / Math.sqrt(n) : 0

  return {
    n,
    mean,
    variance,
    standardDeviation,
    min: Math.min(...values),
    max: Math.max(...values),
    standardError,
    confidence95: n > 1
      ? {
          lower: mean - Z95 * standardError,
          upper: mean + Z95 * standardError,
        }
      : { lower: null, upper: null },
  }
}

export function calculateStatisticalAnalysis(
  analysis: ExperimentAnalysis,
): StatisticalExperimentAnalysis {
  return {
    groups: analysis.groups.map(group => ({
      key: group.key,
      count: group.count,
      completed: group.completed,
      metrics: Object.fromEntries(
        analysis.metricNames.map(metric => [
          metric,
          statistics(group.rows, metric),
        ]),
      ),
    })),
  }
}
