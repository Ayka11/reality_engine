import { CivilizationRuntime, type CivilizationExperimentScenario, type CivilizationExperimentResult } from '../worldLibrary/CivilizationRuntime'
import { createExperimentProtocol } from './ExperimentProtocol'
import { ExperimentRunner, type ExperimentSnapshot } from './ExperimentRunner'

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
