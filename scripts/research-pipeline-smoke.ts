import { buildExperimentMatrix } from '../src/infinity/ExperimentMatrix'
import { createStudyExecutionContract } from '../src/infinity/StudyExecutionContract'
import { createDefaultOperationalization } from '../src/infinity/StudyOperationalization'
import { createStudyManifest } from '../src/infinity/StudyManifest'
import { createResearchExportPackage } from '../src/infinity/ResearchExport'
import { verifyResearchExportPackage } from '../src/infinity/ResearchImport'

const specification = {
  schemaVersion: 'study-specification-v1' as const,
  studyId: 'smoke-study',
  researchQuestion: 'Can the configured world model be reproduced across identical conditions?',
  hypotheses: [{
    id: 'H1',
    statement: 'The configured world model produces a measurable terrain metric.',
    variables: ['terrain'],
    expectedDirection: 'exploratory' as const,
  }],
  variables: [{
    id: 'terrain',
    name: 'Terrain',
    role: 'dependent' as const,
    unit: 'model-units',
  }],
  matrix: {
    seeds: ['smoke-seed'],
    fields: [{ id: 'world-generator', version: 'world-generator-v1' }],
    maxPlans: 2,
  },
  replicationCount: 1,
  tolerance: 1e-9,
  generalizationDimensions: ['seed' as const],
  analysisPlan: {
    descriptiveStatistics: true,
    effectSize: true,
    replication: true,
    generalization: true,
  },
  acceptanceCriteria: {
    requireCompletedRuns: true,
    requireReplication: false,
    requireGeneralization: false,
  },
}

const contract = createStudyExecutionContract(specification)
const operationalization = createDefaultOperationalization(specification)
const plans = buildExperimentMatrix(specification.matrix)

const manifest = createStudyManifest({
  studyId: specification.studyId,
  matrix: specification.matrix,
  plans: plans.map(plan => ({
    experimentId: plan.protocol.experimentId,
    protocol: plan.protocol,
  })),
  runs: [],
  generalization: {},
  operationalization,
})

const exported = createResearchExportPackage(manifest)
const imported = verifyResearchExportPackage(exported)

if (!contract.executable) throw new Error('Smoke test: execution contract is not executable')
if (!plans.length) throw new Error('Smoke test: experiment matrix produced no plans')
if (!imported.packageFingerprintMatches) throw new Error('Smoke test: package fingerprint mismatch')
if (!imported.manifestFingerprintMatches) throw new Error('Smoke test: manifest fingerprint mismatch')

console.log(JSON.stringify({
  status: 'PASS',
  studyId: specification.studyId,
  plans: plans.length,
  packageFingerprint: exported.packageFingerprint,
  manifestFingerprint: imported.structuralValidation.manifestFingerprint,
}))
