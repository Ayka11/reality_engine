import type { ResearchExportPackage } from './ResearchExport'
import { studyManifestFingerprint } from './StudyManifestFingerprint'
import { validateStudyManifest, type StudyValidationResult } from './StudyValidation'

export type ResearchImportResult = {
  valid: boolean
  schemaSupported: boolean
  manifestFingerprintMatches: boolean
  structuralValidation: StudyValidationResult
  package: ResearchExportPackage
  issues: string[]
}

export function verifyResearchExportPackage(
  researchPackage: ResearchExportPackage,
): ResearchImportResult {
  const issues: string[] = []
  const schemaSupported = researchPackage.schemaVersion === 'research-export-v1'

  if (!schemaSupported) {
    issues.push(`Unsupported research export schema: ${researchPackage.schemaVersion}`)
  }

  const actualManifestFingerprint = studyManifestFingerprint(researchPackage.manifest)
  const manifestFingerprintMatches =
    actualManifestFingerprint === researchPackage.validation.manifestFingerprint

  if (!manifestFingerprintMatches) {
    issues.push('Manifest fingerprint does not match the exported validation record.')
  }

  const structuralValidation = validateStudyManifest(researchPackage.manifest)

  if (!structuralValidation.valid) {
    issues.push('Study manifest failed structural validation.')
  }

  if (researchPackage.validation.valid !== structuralValidation.valid) {
    issues.push('Stored validation status differs from freshly computed validation.')
  }

  return {
    valid: issues.length === 0,
    schemaSupported,
    manifestFingerprintMatches,
    structuralValidation,
    package: researchPackage,
    issues,
  }
}

export function parseResearchExport(
  serialized: string,
): ResearchImportResult {
  let parsed: ResearchExportPackage

  try {
    parsed = JSON.parse(serialized) as ResearchExportPackage
  } catch {
    throw new Error('Invalid research export JSON')
  }

  return verifyResearchExportPackage(parsed)
}
