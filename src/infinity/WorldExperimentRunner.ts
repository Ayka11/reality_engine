import { WorldGenerator } from './WorldGenerator'
import { FieldSampler } from './FieldSampler'
import { GeneratorFieldProvider } from './ScientificFieldProvider'
import { FieldModulatedPhysics } from './FieldModulatedPhysics'
import { WorldDecisionLayer, type DecisionWeights } from './WorldDecisionLayer'
import { createExperimentProtocol, type ExperimentProtocol } from './ExperimentProtocol'
import { ExperimentRunner, type ExperimentSnapshot } from './ExperimentRunner'
import type { ExperimentPlan } from './ExperimentMatrix'

export type WorldExperimentResult = {
  terrainSamples: number
  meanHeight: number
  meanMoisture: number
  meanTemperature: number
  meanEnergy: number
  meanDensity: number
  meanInformation: number
  meanEntropy: number
  meanBiology: number
  meanBuildability: number
  meanRouteCost: number
}

export type WorldExperimentRunnerOptions = {
  samplePoints?: Array<{ x: number; z: number }>
  routePairs?: Array<{ x0: number; z0: number; x1: number; z1: number }>
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

export function runWorldExperiment(
  plan: ExperimentPlan,
  options: WorldExperimentRunnerOptions = {},
): ExperimentSnapshot {
  const protocol = plan.protocol
  const generator = new WorldGenerator(protocol.world.seed)
  const sampler = new FieldSampler(generator)
  const provider = new GeneratorFieldProvider(generator)
  sampler.setProvider(provider)

  const decisionWeights: DecisionWeights = protocol.decision.weights
  const decisionLayer = new WorldDecisionLayer(sampler, decisionWeights)
  const physics = new FieldModulatedPhysics(protocol.physics.parameters)
  const runner = new ExperimentRunner()

  const experimentProtocol: ExperimentProtocol = createExperimentProtocol({
    experimentId: protocol.experimentId,
    world: {
      seed: generator.seed,
      generatorVersion: 'world-generator-v1',
    },
    field: {
      providerId: provider.id,
      providerVersion: provider.version,
    },
    decision: {
      version: decisionLayer.version,
      weights: decisionLayer.weights,
    },
    physics: {
      version: physics.version,
      parameters: physics.parameters,
    },
    metadata: protocol.metadata,
  })

  runner.start(experimentProtocol)

  const points = options.samplePoints ?? [
    { x: 0, z: 0 },
    { x: 64, z: 0 },
    { x: 0, z: 64 },
    { x: 64, z: 64 },
    { x: -64, z: 32 },
    { x: 32, z: -64 },
  ]

  const heights: number[] = []
  const moistures: number[] = []
  const temperatures: number[] = []
  const energies: number[] = []
  const densities: number[] = []
  const information: number[] = []
  const entropies: number[] = []
  const biology: number[] = []
  const buildability: number[] = []

  for (const point of points) {
    const height = generator.sampleHeight(point.x, point.z)
    const climate = generator.sampleClimate(point.x, point.z, height)
    const field = sampler.sample(point.x, height, point.z)
    const build = decisionLayer.analyzeBuildability(point.x, point.z)
    physics.modulation(field)

    heights.push(height)
    moistures.push(climate.moisture)
    temperatures.push(climate.temperature)
    energies.push(field.energy)
    densities.push(field.density)
    information.push(field.information)
    entropies.push(field.entropy)
    biology.push(field.biology)
    buildability.push(build.score)
  }

  const routeCosts = (options.routePairs ?? []).map(route =>
    decisionLayer.routeCost(route.x1, route.z1, route.x0, route.z0).cost,
  )

  const result: WorldExperimentResult = {
    terrainSamples: points.length,
    meanHeight: average(heights),
    meanMoisture: average(moistures),
    meanTemperature: average(temperatures),
    meanEnergy: average(energies),
    meanDensity: average(densities),
    meanInformation: average(information),
    meanEntropy: average(entropies),
    meanBiology: average(biology),
    meanBuildability: average(buildability),
    meanRouteCost: average(routeCosts),
  }

  runner.record('world', result)
  runner.record('physics', {
    providerId: provider.id,
    providerVersion: provider.version,
    parameters: physics.parameters,
  })

  return runner.finish('completed')
}
