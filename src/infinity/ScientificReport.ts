import type { StudySpecification } from './StudySpecification'
import type { StudyManifest } from './StudyManifest'
import type { StudyValidationResult } from './StudyValidation'
import type { StudyOperationalization } from './StudyOperationalization'
import { analyzeHypotheses, type HypothesisAnalysisReport } from './HypothesisAnalysis'
import { studyManifestFingerprint } from './StudyManifestFingerprint'

export type ScientificReport = {
  schemaVersion: 'scientific-report-v1'
  studyId: string
  manifestFingerprint: string
  researchQuestion: string
  hypotheses: HypothesisAnalysisReport
  validation: StudyValidationResult
  summary: {
    experiments: number
    completed: number
    failed: number
    analyzableHypotheses: number
    insufficientHypotheses: number
  }
  limitations: string[]
}

export function createScientificReport(
  specification: StudySpecification,
  operationalization: StudyOperationalization,
  manifest: StudyManifest,
  validation: StudyValidationResult,
): ScientificReport {
  const hypotheses = analyzeHypotheses(specification, operationalization, manifest)
  const completed = manifest.runs.filter(run => run.status === 'completed').length
  const failed = manifest.runs.filter(run => run.status === 'aborted').length

  const limitations: string[] = [
    'Observed effects are descriptive computational results and are not, by themselves, causal evidence.',
    'Generalization metrics describe consistency across configured conditions only.',
    'Automatic hypothesis-to-metric mapping must not replace domain-specific methodological review.',
  ]

  if (!validation.valid) {
    limitations.push('The study manifest did not pass structural validation.')
  }

  return {
    schemaVersion: 'scientific-report-v1',
    studyId: specification.studyId,
    manifestFingerprint: studyManifestFingerprint(manifest),
    researchQuestion: specification.researchQuestion,
    hypotheses,
    validation,
    summary: {
      experiments: manifest.runs.length,
      completed,
      failed,
      analyzableHypotheses: hypotheses.results.filter(result => result.status === 'analyzable').length,
      insufficientHypotheses: hypotheses.results.filter(result => result.status === 'insufficient_data').length,
    },
    limitations,
  }
}

export function serializeScientificReport(report: ScientificReport): string {
  return JSON.stringify(report, null, 2)
}
