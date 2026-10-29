import type { StudyManifest } from './StudyManifest'
import { studyManifestFingerprint } from './StudyManifestFingerprint'

export type StudyValidationIssue = {
  code: string
  severity: 'error' | 'warning'
  message: string
}

export type StudyValidationResult = {
  valid: boolean
  manifestFingerprint: string
  issues: StudyValidationIssue[]
  checks: {
    plansHaveRuns: boolean
    runIdsUnique: boolean
    protocolsConsistent: boolean
    generalizationReferencesValid: boolean
    evidenceReferencesValid: boolean
  }
}

export function validateStudyManifest(manifest: StudyManifest): StudyValidationResult {
  const issues: StudyValidationIssue[] = []

  const planIds = new Set(manifest.plans.map(plan => plan.experimentId))
  const runIds = manifest.runs.map(run => run.protocol.experimentId)
  const uniqueRunIds = new Set(runIds)

  const plansHaveRuns = manifest.plans.every(plan => runIds.includes(plan.experimentId))
  const runIdsUnique = uniqueRunIds.size === runIds.length

  if (!plansHaveRuns) {
    issues.push({
      code: 'PLAN_WITHOUT_RUN',
      severity: 'error',
      message: 'At least one planned experiment has no corresponding run.',
    })
  }

  if (!runIdsUnique) {
    issues.push({
      code: 'DUPLICATE_RUN_ID',
      severity: 'error',
      message: 'Multiple run snapshots use the same experimentId.',
    })
  }

  const protocolsConsistent = manifest.plans.every(plan => {
    const run = manifest.runs.find(candidate => candidate.protocol.experimentId === plan.experimentId)
    return !run || JSON.stringify(run.protocol) === JSON.stringify(plan.protocol)
  })

  if (!protocolsConsistent) {
    issues.push({
      code: 'PROTOCOL_MISMATCH',
      severity: 'error',
      message: 'A run protocol differs from its declared experiment plan.',
    })
  }

  const validExperimentIds = new Set(manifest.runs.map(run => `experiment:${run.protocol.experimentId}`))
  const validReplicationIds = new Set(
    manifest.runs.map(run => `replication:${run.protocol.experimentId}`),
  )

  const generalizationReferencesValid = Object.values(manifest.generalization).every(result =>
    Boolean(result) &&
    result!.completedExperiments <= manifest.runs.filter(run => run.status === 'completed').length,
  )

  if (!generalizationReferencesValid) {
    issues.push({
      code: 'GENERALIZATION_MISMATCH',
      severity: 'error',
      message: 'Generalization analysis references more completed experiments than the manifest contains.',
    })
  }

  const evidenceReferencesValid = manifest.evidence
    ? manifest.evidence.edges.every(edge =>
        manifest.evidence!.nodes.some(node => node.id === edge.from) &&
        manifest.evidence!.nodes.some(node => node.id === edge.to) &&
        (!edge.from.startsWith('experiment:') || validExperimentIds.has(edge.from)) &&
        (!edge.from.startsWith('replication:') || validReplicationIds.has(edge.from)),
      )
    : true

  if (!evidenceReferencesValid) {
    issues.push({
      code: 'BROKEN_EVIDENCE_REFERENCE',
      severity: 'error',
      message: 'Evidence graph contains an edge pointing to a missing experiment or replication reference.',
    })
  }

  if (manifest.runs.length === 0) {
    issues.push({
      code: 'NO_RUNS',
      severity: 'warning',
      message: 'Study manifest contains no experiment runs.',
    })
  }

  if (!manifest.evidence) {
    issues.push({
      code: 'NO_EVIDENCE_GRAPH',
      severity: 'warning',
      message: 'Study manifest contains no evidence graph.',
    })
  }

  void planIds

  return {
    valid: issues.every(issue => issue.severity !== 'error'),
    manifestFingerprint: studyManifestFingerprint(manifest),
    issues,
    checks: {
      plansHaveRuns,
      runIdsUnique,
      protocolsConsistent,
      generalizationReferencesValid,
      evidenceReferencesValid,
    },
  }
}
