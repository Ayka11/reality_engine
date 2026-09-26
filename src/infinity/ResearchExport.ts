import type { StudyManifest } from './StudyManifest'
import { studyManifestFingerprint } from './StudyManifestFingerprint'
import { validateStudyManifest, type StudyValidationResult } from './StudyValidation'

export type ResearchExportPackage = {
  schemaVersion: 'research-export-v1'
  exportedAt: number
  packageFingerprint: string
  manifest: StudyManifest
  validation: StudyValidationResult
}

export function createResearchExportPackage(
  manifest: StudyManifest,
): ResearchExportPackage {
  const validation = validateStudyManifest(manifest)
  const packageContent = {
    schemaVersion: 'research-export-v1' as const,
    manifestFingerprint: studyManifestFingerprint(manifest),
    manifest,
    validation: {
      valid: validation.valid,
      checks: validation.checks,
      issues: validation.issues,
    },
  }

  const serialized = JSON.stringify(packageContent)
  let hash = 2166136261
  for (let i = 0; i < serialized.length; i++) {
    hash ^= serialized.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  return {
    schemaVersion: 'research-export-v1',
    exportedAt: Date.now(),
    packageFingerprint: (hash >>> 0).toString(16).padStart(8, '0'),
    manifest,
    validation,
  }
}

export function serializeResearchExport(
  researchPackage: ResearchExportPackage,
): string {
  return JSON.stringify(researchPackage, null, 2)
}
