import type { StudySpecification, StudyHypothesis } from './StudySpecification'
import type { StudyManifest } from './StudyManifest'

export type HypothesisEvidenceStatus = 'mapped' | 'partially_mapped' | 'unmapped'

export type HypothesisEvidenceMapping = {
  hypothesisId: string
  statement: string
  variableIds: string[]
  matchedMetrics: string[]
  experimentIds: string[]
  evidenceNodeIds: string[]
  status: HypothesisEvidenceStatus
  notes: string[]
}

export type HypothesisEvidenceReport = {
  mappings: HypothesisEvidenceMapping[]
  mapped: number
  partiallyMapped: number
  unmapped: number
}

function metricNames(manifest: StudyManifest): Set<string> {
  const names = new Set<string>()
  for (const run of manifest.runs) {
    for (const [name, value] of Object.entries(run.results)) {
      if (typeof value === 'number' && Number.isFinite(value)) names.add(name)
    }
  }
  return names
}

function variableMetricCandidates(
  hypothesis: StudyHypothesis,
  specification: StudySpecification,
  metrics: Set<string>,
): string[] {
  const variables = new Map(specification.variables.map(variable => [variable.id, variable]))
  const candidates = new Set<string>()

  for (const variableId of hypothesis.variables) {
    const variable = variables.get(variableId)
    if (!variable) continue

    for (const metric of metrics) {
      const normalizedMetric = metric.toLowerCase()
      const normalizedId = variable.id.toLowerCase()
      const normalizedName = variable.name.toLowerCase()

      if (
        normalizedMetric.includes(normalizedId) ||
        normalizedMetric.includes(normalizedName) ||
        normalizedId.includes(normalizedMetric) ||
        normalizedName.includes(normalizedMetric)
      ) {
        candidates.add(metric)
      }
    }
  }

  return [...candidates].sort()
}

export function mapHypothesesToEvidence(
  specification: StudySpecification,
  manifest: StudyManifest,
): HypothesisEvidenceReport {
  const metrics = metricNames(manifest)
  const experimentIds = manifest.runs
    .filter(run => run.status === 'completed')
    .map(run => run.protocol.experimentId)

  const evidenceNodeIds = manifest.evidence?.nodes
    .filter(node => node.kind === 'experiment' || node.kind === 'replication' || node.kind === 'statistic')
    .map(node => node.id) ?? []

  const mappings = specification.hypotheses.map(hypothesis => {
    const matchedMetrics = variableMetricCandidates(hypothesis, specification, metrics)
    const notes: string[] = []

    if (!matchedMetrics.length) notes.push('No result metric could be matched automatically to the hypothesis variables.')
    if (!experimentIds.length) notes.push('No completed experiment is available.')

    const status: HypothesisEvidenceStatus =
      matchedMetrics.length && experimentIds.length && evidenceNodeIds.length
        ? 'mapped'
        : matchedMetrics.length || experimentIds.length
          ? 'partially_mapped'
          : 'unmapped'

    return {
      hypothesisId: hypothesis.id,
      statement: hypothesis.statement,
      variableIds: hypothesis.variables,
      matchedMetrics,
      experimentIds,
      evidenceNodeIds,
      status,
      notes,
    }
  })

  return {
    mappings,
    mapped: mappings.filter(mapping => mapping.status === 'mapped').length,
    partiallyMapped: mappings.filter(mapping => mapping.status === 'partially_mapped').length,
    unmapped: mappings.filter(mapping => mapping.status === 'unmapped').length,
  }
}
