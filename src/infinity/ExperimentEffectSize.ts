import type { ExperimentSnapshot } from './ExperimentRunner'

export type PairwiseMetricEffect = {
  metric: string
  nLeft: number
  nRight: number
  meanLeft: number | null
  meanRight: number | null
  meanDifference: number | null
  pooledStandardDeviation: number | null
  cohensD: number | null
}

export type PairwiseExperimentComparison = {
  leftFingerprint: string
  rightFingerprint: string
  metrics: PairwiseMetricEffect[]
}

function values(snapshot: ExperimentSnapshot, metric: string): number[] {
  const value = snapshot.results[metric]
  return typeof value === 'number' && Number.isFinite(value) ? [value] : []
}

function summarize(values: number[]) {
  if (!values.length) return { mean: null, variance: null }
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.length > 1
    ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
    : 0
  return { mean, variance }
}

export function compareExperimentEffects(
  left: ExperimentSnapshot,
  right: ExperimentSnapshot,
): PairwiseExperimentComparison {
  const metrics = new Set([
    ...Object.keys(left.results).filter(key => typeof left.results[key] === 'number'),
    ...Object.keys(right.results).filter(key => typeof right.results[key] === 'number'),
  ])

  return {
    leftFingerprint: left.fingerprint,
    rightFingerprint: right.fingerprint,
    metrics: [...metrics].sort().map(metric => {
      const leftValues = values(left, metric)
      const rightValues = values(right, metric)
      const leftSummary = summarize(leftValues)
      const rightSummary = summarize(rightValues)
      const meanDifference =
        leftSummary.mean !== null && rightSummary.mean !== null
          ? rightSummary.mean - leftSummary.mean
          : null

      const pooledVariance =
        leftValues.length > 1 && rightValues.length > 1
          ? (((leftValues.length - 1) * (leftSummary.variance ?? 0)) +
              ((rightValues.length - 1) * (rightSummary.variance ?? 0))) /
            (leftValues.length + rightValues.length - 2)
          : null

      const pooledStandardDeviation =
        pooledVariance !== null ? Math.sqrt(Math.max(0, pooledVariance)) : null

      const cohensD =
        meanDifference !== null &&
        pooledStandardDeviation !== null &&
        pooledStandardDeviation > 0
          ? meanDifference / pooledStandardDeviation
          : null

      return {
        metric,
        nLeft: leftValues.length,
        nRight: rightValues.length,
        meanLeft: leftSummary.mean,
        meanRight: rightSummary.mean,
        meanDifference,
        pooledStandardDeviation,
        cohensD,
      }
    }),
  }
}
