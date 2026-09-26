import type { ExperimentMatrix } from './ExperimentMatrix'
import type { ExperimentSnapshot } from './ExperimentRunner'
import type { GeneralizationDimension, GeneralizationResult } from './ExperimentGeneralization'
import type { EvidenceClaimGraphSnapshot } from './EvidenceClaimGraph'
import type { StatisticalExperimentAnalysis } from './ExperimentStatistics'

export type StudyManifest = {
  manifestVersion: 'study-manifest-v1'
  studyId: string
  createdAt: number
  matrix: ExperimentMatrix
  plans: Array<{
    experimentId: string
    protocol: ExperimentSnapshot['protocol']
  }>
  runs: ExperimentSnapshot[]
  statistics?: StatisticalExperimentAnalysis
  generalization: Partial<Record<GeneralizationDimension, GeneralizationResult>>
  evidence?: EvidenceClaimGraphSnapshot
}

export function createStudyManifest(input: Omit<StudyManifest, 'manifestVersion' | 'createdAt'>): StudyManifest {
  return {
    manifestVersion: 'study-manifest-v1',
    createdAt: Date.now(),
    ...input,
  }
}

export function studyManifestSummary(manifest: StudyManifest) {
  const completed = manifest.runs.filter(run => run.status === 'completed').length
  const aborted = manifest.runs.filter(run => run.status === 'aborted').length

  return {
    studyId: manifest.studyId,
    manifestVersion: manifest.manifestVersion,
    experiments: manifest.runs.length,
    completed,
    aborted,
    planned: manifest.plans.length,
    generalizationDimensions: Object.keys(manifest.generalization),
    evidenceNodes: manifest.evidence?.nodes.length ?? 0,
    evidenceEdges: manifest.evidence?.edges.length ?? 0,
  }
}
