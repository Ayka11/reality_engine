import type { StudyManifest } from './StudyManifest'
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
export type ResearchExportPackage={schemaVersion:'research-export-v1';exportedAt:number;packageFingerprint:string;manifest:StudyManifest;validation:StudyValidationResult}

export function createResearchExportPackage(manifest:StudyManifest):ResearchExportPackage {
  const validation=validateStudyManifest(manifest)
  const packageContent={schemaVersion:'research-export-v1' as const,manifestFingerprint:studyManifestFingerprint(manifest),manifest,validation:{valid:validation.valid,checks:validation.checks,issues:validation.issues}}
  return {schemaVersion:'research-export-v1',exportedAt:Date.now(),packageFingerprint:hashString(stableSerialize(packageContent)),manifest,validation}
}
export function serializeResearchExport(researchPackage:ResearchExportPackage):string{return JSON.stringify(researchPackage,null,2)}
