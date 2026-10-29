import type { StudySpecification } from './StudySpecification'
import type { StudyExecutionContract } from './StudyExecutionContract'
import type { StudyManifest } from './StudyManifest'
import type { ScientificReport } from './ScientificReport'
import type { ResearchExportPackage } from './ResearchExport'
import type { ResearchImportResult } from './ResearchImport'
import type { StudyOperationalization } from './StudyOperationalization'
import type { HypothesisAnalysisReport } from './HypothesisAnalysis'

export type ResearchPipelineContract = {
  specification: StudySpecification
  executionContract: StudyExecutionContract
  operationalization: StudyOperationalization
  manifest: StudyManifest
  hypothesisAnalysis: HypothesisAnalysisReport
  scientificReport: ScientificReport
  exportPackage: ResearchExportPackage
  importResult: ResearchImportResult
}

export function assertResearchPipelineContract(
  value: ResearchPipelineContract,
): ResearchPipelineContract {
  if (value.specification.studyId !== value.executionContract.studyId) {
    throw new Error('Research pipeline contract: specification and execution contract study IDs differ.')
  }

  if (value.manifest.studyId !== value.specification.studyId) {
    throw new Error('Research pipeline contract: manifest study ID differs from specification.')
  }

  if (value.scientificReport.studyId !== value.specification.studyId) {
    throw new Error('Research pipeline contract: scientific report study ID differs from specification.')
  }

  if (value.exportPackage.manifest.studyId !== value.manifest.studyId) {
    throw new Error('Research pipeline contract: export package does not contain the expected study.')
  }

  if (value.importResult.package.manifest.studyId !== value.manifest.studyId) {
    throw new Error('Research pipeline contract: imported package does not contain the expected study.')
  }

  return value
}
