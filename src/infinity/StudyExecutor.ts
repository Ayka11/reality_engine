import type { StudySpecification } from './StudySpecification'
import type { StudyExecutionContract } from './StudyExecutionContract'
import { ExperimentBatchExecutor } from './ExperimentBatchExecutor'
import { runWorldExperiment } from './WorldExperimentRunner'
import { analyzeExperiments } from './ExperimentAnalysis'
import { calculateStatisticalAnalysis } from './ExperimentStatistics'
import { analyzeGeneralization, type GeneralizationDimension } from './ExperimentGeneralization'
import { createStudyManifest, type StudyManifest } from './StudyManifest'
import { EvidenceClaimGraph } from './EvidenceClaimGraph'
import { validateStudyManifest, type StudyValidationResult } from './StudyValidation'

export type StudyExecutionOptions={generalizationDimensions?:GeneralizationDimension[];stopOnError?:boolean;onProgress?:(completed:number,total:number)=>void}
export type StudyExecutionResult={manifest:StudyManifest;completed:number;failed:number;warnings:string[];validation:StudyValidationResult}

export async function executeStudy(specification:StudySpecification,contract:StudyExecutionContract,options:StudyExecutionOptions={}):Promise<StudyExecutionResult>{
 if(contract.studyId!==specification.studyId) throw new Error('Execution contract does not belong to the supplied study specification')
 const executor=new ExperimentBatchExecutor()
 const batch=await executor.execute(contract.plans,async (plan,runner)=>{ const snapshot=runWorldExperiment(plan,{runner}); return snapshot.results },{stopOnError:options.stopOnError??false,onProgress:(completed,total)=>options.onProgress?.(completed,total)})
 const analysis=analyzeExperiments(batch.snapshots,'provider')
 const statistics=calculateStatisticalAnalysis(analysis)
 const dimensions=options.generalizationDimensions??specification.generalizationDimensions
 const generalization=Object.fromEntries(dimensions.map(dimension=>[dimension,analyzeGeneralization(batch.snapshots,dimension)])) as StudyManifest['generalization']
 const evidenceGraph=new EvidenceClaimGraph()
 for(const snapshot of batch.snapshots) evidenceGraph.addExperiment(snapshot)
 const manifest=createStudyManifest({studyId:specification.studyId,matrix:specification.matrix,plans:contract.plans.map(plan=>({experimentId:plan.protocol.experimentId,protocol:plan.protocol})),runs:batch.snapshots,statistics,generalization,evidence:evidenceGraph.snapshot()})
 const validation=validateStudyManifest(manifest)
 const warnings:string[]=[]
 if(batch.failed>0) warnings.push('Some experiments failed during execution.')
 if(batch.completed===0) warnings.push('No experiments completed successfully.')
 if(!validation.valid) warnings.push('Study manifest failed structural validation.')
 return {manifest,completed:batch.completed,failed:batch.failed,warnings,validation}
}