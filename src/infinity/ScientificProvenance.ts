import type { ExperimentSnapshot } from './ExperimentRunner'
import type { ReplicationStudySummary } from './ReplicationStudy'
import type { CrossDimensionGeneralizationResult } from './ExperimentGeneralization'
import type { EvidenceClaimGraphSnapshot } from './EvidenceClaimGraph'
import { experimentConfigurationFingerprint, experimentResultFingerprint } from './ExperimentFingerprint'
import type { InfinityScientificReport } from './InfinityScientificReport'

export type ScientificProvenance = {
  schemaVersion: 'infinity-provenance-v1'
  protocolFingerprint: string
  resultFingerprint: string
  experimentFingerprint: string
  replicationFingerprint?: string
  generalizationFingerprint?: string
  evidenceFingerprint?: string
  reproducibilityKey: string
  sourceExperimentIds: string[]
}

function stableSerialize(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return '[' + value.map(stableSerialize).join(',') + ']'
  const object = value as Record<string, unknown>
  return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + stableSerialize(object[key])).join(',') + '}'
}

function hashString(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function fingerprint(value: unknown): string {
  return hashString(stableSerialize(value))
}

export function createScientificProvenance(
  snapshot: ExperimentSnapshot,
  replication?: ReplicationStudySummary,
  generalization?: CrossDimensionGeneralizationResult,
  evidence?: EvidenceClaimGraphSnapshot,
): ScientificProvenance {
  const protocolFingerprint = experimentConfigurationFingerprint(snapshot.protocol)
  const resultFingerprint = experimentResultFingerprint(snapshot)
  const experimentFingerprint = fingerprint({ protocolFingerprint, resultFingerprint })
  const replicationFingerprint = replication ? fingerprint({
    protocol: replication.protocol,
    repetitionsRequested: replication.repetitionsRequested,
    repetitionsCompleted: replication.repetitionsCompleted,
    repetitionsFailed: replication.repetitionsFailed,
    snapshots: replication.snapshots.map(item => item.fingerprint),
    metricSummary: replication.metricSummary,
  }) : undefined
  const generalizationFingerprint = generalization ? fingerprint(generalization) : undefined
  const evidenceFingerprint = evidence ? fingerprint(evidence) : undefined
  const reproducibilityKey = fingerprint({
    experimentFingerprint,
    replicationFingerprint,
    generalizationFingerprint,
    evidenceFingerprint,
  })

  return {
    schemaVersion: 'infinity-provenance-v1',
    protocolFingerprint,
    resultFingerprint,
    experimentFingerprint,
    replicationFingerprint,
    generalizationFingerprint,
    evidenceFingerprint,
    reproducibilityKey,
    sourceExperimentIds: [
      snapshot.protocol.experimentId,
      ...(replication?.snapshots ?? []).map(item => item.protocol.experimentId),
    ],
  }
}

export function attachScientificProvenance(
  report: InfinityScientificReport,
  provenance: ScientificProvenance,
): InfinityScientificReport & { provenance: ScientificProvenance } {
  return { ...report, provenance }
}

export function validateScientificProvenance(report: InfinityScientificReport & { provenance?: ScientificProvenance }): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  const provenance = report.provenance
  if (!provenance) errors.push('Report has no scientific provenance')
  else {
    if (provenance.experimentFingerprint !== fingerprint({
      protocolFingerprint: provenance.protocolFingerprint,
      resultFingerprint: provenance.resultFingerprint,
    })) errors.push('Experiment provenance fingerprint is inconsistent')
    if (!provenance.reproducibilityKey) errors.push('Missing reproducibility key')
    if (!provenance.sourceExperimentIds.includes(report.experiment.experimentId)) errors.push('Primary experiment is missing from provenance')
  }
  return { valid: errors.length === 0, errors }
}
