import { CivilizationRuntime, type CivilizationExperimentScenario, type CivilizationExperimentResult } from '../worldLibrary/CivilizationRuntime'
import { createExperimentProtocol } from './ExperimentProtocol'
import { ExperimentRunner, type ExperimentSnapshot } from './ExperimentRunner'
import type { ExperimentCatalog } from './ExperimentCatalog'
import { assessCivilizationReplication, type CivilizationReplicationResult } from './CivilizationExperimentReplication'

export type CivilizationInfinityExperimentOptions = {
  experimentId: string
  sourceBranch: string
  scenarios: CivilizationExperimentScenario[]
  ticks?: number
  delta?: number
  metadata?: Record<string, string | number | boolean>
}

export type CivilizationInfinityExperimentResult = {
  experiment: CivilizationExperimentResult
  snapshot: ExperimentSnapshot
}

export function runCivilizationInfinityExperiment(
  runtime: CivilizationRuntime,
  options: CivilizationInfinityExperimentOptions,
): CivilizationInfinityExperimentResult {
  const protocol = createExperimentProtocol({
    experimentId: options.experimentId,
    world: {
      seed: options.sourceBranch,
      generatorVersion: 'civilization-runtime-v1',
    },
    field: {
      providerId: 'civilization-runtime',
      providerVersion: 'civilization-runtime-v1',
    },
    decision: {
      version: 'civilization-decision-v1',
      weights: {
        slope: 0,
        water: 0,
        elevation: 0,
        entropy: 0,
        density: 0,
        biology: 0,
        information: 0,
        distance: 1,
      },
    },
    physics: {
      version: 'civilization-runtime-v1',
      parameters: {
        gravity: 0,
        entropyDamping: 0,
        quantumLift: 0,
        forcePush: 0,
        metaLawOrbit: 0,
      },
    },
    metadata: options.metadata,
  })

  const runner = new ExperimentRunner()
  runner.start(protocol)
  const experiment = runtime.runExperiment(
    options.experimentId,
    options.scenarios,
    options.ticks ?? 10,
    options.delta ?? 1,
  )

  runner.record('civilization', experiment)
  runner.record('claimGraph', runtime.buildComparativeClaimGraph(experiment.outcomes))
  return {
    experiment,
    snapshot: runner.finish('completed'),
  }
}

export type CivilizationBatchScenario = {
  experimentId: string
  sourceBranch: string
  scenarios: CivilizationExperimentScenario[]
  ticks?: number
  delta?: number
  metadata?: Record<string, string | number | boolean>
}

export type CivilizationReplicationBatch = {
  baseline: CivilizationExperimentResult
  replications: CivilizationExperimentResult[]
  assessments: CivilizationReplicationResult[]
  meanScenarioConsistency: number
  meanOutcomeConsistency: number
}

export type CivilizationBatchResult = {
  snapshots: ExperimentSnapshot[]
  experiments: CivilizationExperimentResult[]
  errors: Array<{ index: number; experimentId: string; message: string }>
  completed: number
  failed: number
}

export async function runCivilizationInfinityBatch(
  runtime: CivilizationRuntime,
  plans: CivilizationBatchScenario[],
  catalog?: ExperimentCatalog,
): Promise<CivilizationBatchResult> {
  const snapshots: ExperimentSnapshot[] = []
  const experiments: CivilizationExperimentResult[] = []
  const errors: CivilizationBatchResult['errors'] = []
  const seenExperimentIds = new Set<string>()

  for (let index = 0; index < plans.length; index++) {
    const plan = plans[index]
    if (seenExperimentIds.has(plan.experimentId)) {
      errors.push({ index, experimentId: plan.experimentId, message: 'Duplicate civilization experimentId in batch' })
      continue
    }
    seenExperimentIds.add(plan.experimentId)
    if (!plan.scenarios.length) {
      errors.push({ index, experimentId: plan.experimentId, message: 'Civilization experiment requires at least one scenario' })
      continue
    }
    const protocol = createExperimentProtocol({
      experimentId: plan.experimentId,
      world: { seed: plan.sourceBranch, generatorVersion: 'civilization-runtime-v1' },
      field: { providerId: 'civilization-runtime', providerVersion: 'civilization-runtime-v1' },
      decision: {
        version: 'civilization-decision-v1',
        weights: { slope: 0, water: 0, elevation: 0, entropy: 0, density: 0, biology: 0, information: 0, distance: 1 },
      },
      physics: {
        version: 'civilization-runtime-v1',
        parameters: { gravity: 0, entropyDamping: 0, quantumLift: 0, forcePush: 0, metaLawOrbit: 0 },
      },
      metadata: plan.metadata,
    })
    const runner = new ExperimentRunner()
    runner.start(protocol)
    try {
      const experiment = runtime.runExperiment(plan.experimentId, plan.scenarios, plan.ticks ?? 10, plan.delta ?? 1)
      runner.record('civilization', experiment)
      runner.record('claimGraph', runtime.buildComparativeClaimGraph(experiment.outcomes))
      const snapshot = runner.finish('completed')
      catalog?.add(snapshot)
      snapshots.push(snapshot)
      experiments.push(experiment)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const snapshot = runner.finish('aborted')
      catalog?.add(snapshot)
      snapshots.push(snapshot)
      errors.push({ index, experimentId: plan.experimentId, message })
    }
  }

  return {
    snapshots,
    experiments,
    errors,
    completed: snapshots.filter((snapshot) => snapshot.status === 'completed').length,
    failed: errors.length,
  }
}


export function assessCivilizationReplicationBatch(
  baseline: CivilizationExperimentResult,
  replications: CivilizationExperimentResult[],
  tolerance = 1e-6,
): CivilizationReplicationBatch {
  const assessments = replications.map((replication) =>
    assessCivilizationReplication(baseline, replication, tolerance),
  )
  const mean = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0

  return {
    baseline,
    replications,
    assessments,
    meanScenarioConsistency: mean(assessments.map((item) => item.scenarioConsistency)),
    meanOutcomeConsistency: mean(assessments.map((item) => item.outcomeConsistency)),
  }
}
