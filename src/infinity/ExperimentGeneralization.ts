import type { ExperimentSnapshot } from './ExperimentRunner'

export type GeneralizationDimension = 'seed' | 'provider' | 'physics' | 'decision'

export type GeneralizationMetric = {
  metric: string
  groups: number
  observations: number
  mean: number
  standardDeviation: number
  min: number
  max: number
  coefficientOfVariation: number | null
  directionConsistency: number | null
}

export type GeneralizationResult = {
  dimension: GeneralizationDimension
  groupKeys: string[]
  completedExperiments: number
  metrics: GeneralizationMetric[]
}

function dimensionKey(
  snapshot: ExperimentSnapshot,
  dimension: GeneralizationDimension,
): string {
  const protocol = snapshot.protocol
  switch (dimension) {
    case 'seed':
      return protocol.world.seed
    case 'provider':
      return `${protocol.field.providerId}@${protocol.field.providerVersion}`
    case 'physics':
      return protocol.physics.version
    case 'decision':
      return protocol.decision.version
  }
}

function summarize(values: number[]) {
  const n = values.length
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

export function analyzeGeneralization(
  snapshots: ExperimentSnapshot[],
  dimension: GeneralizationDimension = 'seed',
): GeneralizationResult {
  const completed = snapshots.filter(snapshot => snapshot.status === 'completed')
  const groups = new Map<string, ExperimentSnapshot[]>()

  for (const snapshot of completed) {
    const key = dimensionKey(snapshot, dimension)
    const group = groups.get(key) ?? []
    group.push(snapshot)
    groups.set(key, group)
  }

  const metricNames = new Set<string>()
  for (const snapshot of completed) {
    for (const [name, value] of Object.entries(snapshot.results)) {
      if (typeof value === 'number' && Number.isFinite(value)) metricNames.add(name)
    }
  }

  const metrics: GeneralizationMetric[] = []

  for (const metric of [...metricNames].sort()) {
    const values = completed
      .map(snapshot => snapshot.results[metric])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

    if (!values.length) continue

    const summary = summarize(values)
    const groupMeans = [...groups.values()]
      .map(group =>
        group
          .map(snapshot => snapshot.results[metric])
          .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
      )
      .filter(group => group.length > 0)
      .map(group => summarize(group).mean)

    const meanSign = summary.mean === 0 ? 0 : Math.sign(summary.mean)
    const directionConsistency = groupMeans.length
      ? groupMeans.filter(value => meanSign === 0 || Math.sign(value) === meanSign).length / groupMeans.length
      : null

    metrics.push({
      metric,
      groups: groupMeans.length,
      observations: values.length,
      mean: summary.mean,
      standardDeviation: summary.standardDeviation,
      min: summary.min,
      max: summary.max,
      coefficientOfVariation:
        summary.mean !== 0 ? summary.standardDeviation / Math.abs(summary.mean) : null,
      directionConsistency,
    })
  }

  return {
    dimension,
    groupKeys: [...groups.keys()].sort(),
    completedExperiments: completed.length,
    metrics,
  }
}
