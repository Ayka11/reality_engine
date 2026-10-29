import type { ExperimentAnalysisRow } from './ExperimentAnalysis'

export type GroupEffect = {
  metric: string
  leftKey: string
  rightKey: string
  nLeft: number
  nRight: number
  meanLeft: number | null
  meanRight: number | null
  meanDifference: number | null
  pooledStandardDeviation: number | null
  cohensD: number | null
}

function metricValues(rows: ExperimentAnalysisRow[], metric: string): number[] {
  return rows
    .filter(row => row.status === 'completed')
    .map(row => row.metrics[metric])
    .filter((value): value is number => Number.isFinite(value))
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

function variance(values: number[], average: number | null): number | null {
  if (values.length < 2 || average === null) return null
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1)
}

export function compareExperimentGroups(
  leftKey: string,
  leftRows: ExperimentAnalysisRow[],
  rightKey: string,
  rightRows: ExperimentAnalysisRow[],
): GroupEffect[] {
  const metrics = new Set([
    ...leftRows.flatMap(row => Object.keys(row.metrics)),
    ...rightRows.flatMap(row => Object.keys(row.metrics)),
  ])

  return [...metrics].sort().map(metric => {
    const left = metricValues(leftRows, metric)
    const right = metricValues(rightRows, metric)
    const meanLeft = mean(left)
    const meanRight = mean(right)
    const varianceLeft = variance(left, meanLeft)
    const varianceRight = variance(right, meanRight)

    const pooledVariance =
      left.length > 1 && right.length > 1 && varianceLeft !== null && varianceRight !== null
        ? (((left.length - 1) * varianceLeft) + ((right.length - 1) * varianceRight)) /
          (left.length + right.length - 2)
        : null

    const pooledStandardDeviation =
      pooledVariance === null ? null : Math.sqrt(Math.max(0, pooledVariance))

    const meanDifference =
      meanLeft !== null && meanRight !== null ? meanRight - meanLeft : null

    const cohensD =
      meanDifference !== null &&
      pooledStandardDeviation !== null &&
      pooledStandardDeviation > 0
        ? meanDifference / pooledStandardDeviation
        : null

    return {
      metric,
      leftKey,
      rightKey,
      nLeft: left.length,
      nRight: right.length,
      meanLeft,
      meanRight,
      meanDifference,
      pooledStandardDeviation,
      cohensD,
    }
  })
}
