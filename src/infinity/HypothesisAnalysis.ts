import type { StudyManifest } from './StudyManifest'
import type { StudySpecification } from './StudySpecification'
import type { StudyOperationalization } from './StudyOperationalization'

export type HypothesisAnalysisResult = {
  hypothesisId: string
  primaryMetrics: string[]
  observedMeans: Record<string, number>
  observedEffects: Record<string, number>
  observedDirections: Record<string, 'positive' | 'negative' | 'none'>
  replicationConsistency: number | null
  generalizationConsistency: number | null
  status: 'analyzable' | 'insufficient_data'
  notes: string[]
}

export type HypothesisAnalysisReport = {
  results: HypothesisAnalysisResult[]
}

function mean(values: number[]): number | null {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null
}

function direction(value: number): 'positive' | 'negative' | 'none' {
  if (value > 0) return 'positive'
  if (value < 0) return 'negative'
  return 'none'
}

export function analyzeHypotheses(
  specification: StudySpecification,
  operationalization: StudyOperationalization,
  manifest: StudyManifest,
): HypothesisAnalysisReport {
  const results = operationalization.hypotheses.map(mapping => {
    const hypothesis = specification.hypotheses.find(item => item.id === mapping.hypothesisId)
    const notes: string[] = []

    if (!hypothesis) {
      return {
        hypothesisId: mapping.hypothesisId,
        primaryMetrics: mapping.primaryMetrics,
        observedMeans: {},
        observedEffects: {},
        observedDirections: {},
        replicationConsistency: null,
        generalizationConsistency: null,
        status: 'insufficient_data' as const,
        notes: ['Hypothesis is not present in the study specification.'],
      }
    }

    const observedMeans: Record<string, number> = {}
    const observedEffects: Record<string, number> = {}
    const observedDirections: Record<string, 'positive' | 'negative' | 'none'> = {}

    for (const metric of mapping.primaryMetrics) {
      const values = manifest.runs
        .filter(run => run.status === 'completed')
        .map(run => run.results[metric])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

      const observedMean = mean(values)
      if (observedMean === null) {
        notes.push(`No numeric observations found for metric ${metric}.`)
        continue
      }

      observedMeans[metric] = observedMean
      observedEffects[metric] = observedMean
      observedDirections[metric] = direction(observedMean)
    }

    const mappedMetrics = Object.keys(observedMeans)
    if (!mappedMetrics.length) {
      return {
        hypothesisId: hypothesis.id,
        primaryMetrics: mapping.primaryMetrics,
        observedMeans,
        observedEffects,
        observedDirections,
        replicationConsistency: null,
        generalizationConsistency: null,
        status: 'insufficient_data',
        notes,
      }
    }

    const replicationConsistency = manifest.runs.length > 1
      ? mappedMetrics.reduce((sum, metric) => {
          const values = manifest.runs
            .filter(run => run.status === 'completed')
            .map(run => run.results[metric])
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
          if (values.length < 2) return sum
          const meanValue = mean(values) ?? 0
          const expected = direction(meanValue)
          const consistent = values.filter(value => direction(value) === expected).length / values.length
          return sum + consistent
        }, 0) / mappedMetrics.length
      : null

    const generalizationConsistency = Object.values(manifest.generalization).length
      ? Object.values(manifest.generalization).reduce((sum, analysis) => {
          if (!analysis || !analysis.metrics.length) return sum
          const metricResults = analysis.metrics.filter(metric => mappedMetrics.includes(metric.metric))
          if (!metricResults.length) return sum
          return sum + (
            metricResults.reduce((metricSum, metric) =>
              metricSum + (metric.directionConsistency ?? 0), 0,
            ) / metricResults.length
          )
        }, 0) / Object.values(manifest.generalization).length
      : null

    return {
      hypothesisId: hypothesis.id,
      primaryMetrics: mapping.primaryMetrics,
      observedMeans,
      observedEffects,
      observedDirections,
      replicationConsistency,
      generalizationConsistency,
      status: 'analyzable',
      notes,
    }
  })

  return { results }
}
