import type { ExperimentSnapshot } from './ExperimentRunner'

export type ExperimentAnalysisRow = {
  experimentId: string
  fingerprint: string
  seed: string
  providerId: string
  providerVersion: string
  physicsVersion: string
  decisionVersion: string
  status: ExperimentSnapshot['status']
  metrics: Record<string, number>
}

export type ExperimentGroup = {
  key: string
  count: number
  completed: number
  rows: ExperimentAnalysisRow[]
  means: Record<string, number>
}

export type ExperimentAnalysis = {
  rows: ExperimentAnalysisRow[]
  groups: ExperimentGroup[]
  metricNames: string[]
}

function numericMetrics(value: unknown, prefix = ''): Record<string, number> {
  if (typeof value === 'number' && Number.isFinite(value)) return { [prefix]: value }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const output: Record<string, number> = {}
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    Object.assign(output, numericMetrics(child, path))
  }
  return output
}

function mean(rows: ExperimentAnalysisRow[], metric: string) {
  const values = rows
    .map(row => row.metrics[metric])
    .filter((value): value is number => Number.isFinite(value))
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

export function analyzeExperiments(
  snapshots: Iterable<ExperimentSnapshot>,
  groupBy: 'seed' | 'provider' | 'physics' | 'decision' = 'provider',
): ExperimentAnalysis {
  const rows = [...snapshots].map(snapshot => ({
    experimentId: snapshot.protocol.experimentId,
    fingerprint: snapshot.fingerprint,
    seed: snapshot.protocol.world.seed,
    providerId: snapshot.protocol.field.providerId,
    providerVersion: snapshot.protocol.field.providerVersion,
    physicsVersion: snapshot.protocol.physics.version,
    decisionVersion: snapshot.protocol.decision.version,
    status: snapshot.status,
    metrics: numericMetrics(snapshot.results),
  }))

  const metricNames = [...new Set(rows.flatMap(row => Object.keys(row.metrics)))].sort()
  const groupsMap = new Map<string, ExperimentAnalysisRow[]>()

  for (const row of rows) {
    const key =
      groupBy === 'seed' ? row.seed :
      groupBy === 'provider' ? `${row.providerId}@${row.providerVersion}` :
      groupBy === 'physics' ? row.physicsVersion :
      row.decisionVersion
    const group = groupsMap.get(key) ?? []
    group.push(row)
    groupsMap.set(key, group)
  }

  const groups = [...groupsMap.entries()].map(([key, group]) => ({
    key,
    count: group.length,
    completed: group.filter(row => row.status === 'completed').length,
    rows: group,
    means: Object.fromEntries(metricNames.map(metric => [metric, mean(group, metric)])),
  }))

  return { rows, groups, metricNames }
}
