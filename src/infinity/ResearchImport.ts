import type { ResearchExportPackage } from './ResearchExport'
import { studyManifestFingerprint } from './StudyManifestFingerprint'
import { validateStudyManifest, type StudyValidationResult } from './StudyValidation'

function stableSerialize(value:unknown):string {
  if(value===undefined)return 'undefined'
  if(value===null||typeof value!=='object')return JSON.stringify(value)??'undefined'
  if(Array.isArray(value))return '['+value.map(stableSerialize).join(',')+']'
  const object=value as Record<string,unknown>
  return '{'+Object.keys(object).sort().map(key=>JSON.stringify(key)+':'+stableSerialize(object[key])).join(',')+'}'
}
function hashString(input:string):string {
  let hash=2166136261
  for(let i=0;i<input.length;i++){hash^=input.charCodeAt(i);hash=Math.imul(hash,16777619)}
  return (hash>>>0).toString(16).padStart(8,'0')
}
function expectedPackageFingerprint(researchPackage:ResearchExportPackage):string {
  return hashString(stableSerialize({
    schemaVersion:researchPackage.schemaVersion,
    manifestFingerprint:studyManifestFingerprint(researchPackage.manifest),
    manifest:researchPackage.manifest,
    validation:{valid:researchPackage.validation.valid,checks:researchPackage.validation.checks,issues:researchPackage.validation.issues},
  }))
}

export type ResearchImportResult={
  valid:boolean
  schemaSupported:boolean
  manifestFingerprintMatches:boolean
  packageFingerprintMatches:boolean
  structuralValidation:StudyValidationResult
  package:ResearchExportPackage
  issues:string[]
}

export function verifyResearchExportPackage(researchPackage:ResearchExportPackage):ResearchImportResult {
  const issues:string[]=[]
  const schemaSupported=researchPackage.schemaVersion==='research-export-v1'
  if(!schemaSupported)issues.push('Unsupported research export schema: '+researchPackage.schemaVersion)
  const actualManifestFingerprint=studyManifestFingerprint(researchPackage.manifest)
  const manifestFingerprintMatches=actualManifestFingerprint===researchPackage.validation.manifestFingerprint
  if(!manifestFingerprintMatches)issues.push('Manifest fingerprint does not match the exported validation record.')
  const packageFingerprintMatches=expectedPackageFingerprint(researchPackage)===researchPackage.packageFingerprint
  if(!packageFingerprintMatches)issues.push('Research package fingerprint does not match package contents.')
  const structuralValidation=validateStudyManifest(researchPackage.manifest)
  if(!structuralValidation.valid)issues.push('Study manifest failed structural validation.')
  if(researchPackage.validation.valid!==structuralValidation.valid)issues.push('Stored validation status differs from freshly computed validation.')
  return {valid:issues.length===0,schemaSupported,manifestFingerprintMatches,packageFingerprintMatches,structuralValidation,package:researchPackage,issues}
}

export function parseResearchExport(serialized:string):ResearchImportResult {
  let parsed:ResearchExportPackage
  try{parsed=JSON.parse(serialized) as ResearchExportPackage}catch{throw new Error('Invalid research export JSON')}
  return verifyResearchExportPackage(parsed)
}
