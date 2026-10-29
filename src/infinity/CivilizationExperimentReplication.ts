import type { CivilizationExperimentResult, CivilizationExperimentOutcome } from '../worldLibrary/CivilizationRuntime'

export type CivilizationReplicationScenarioMetric = {
  scenarioId: string
  metric: 'populationChange' | 'stabilityChange' | 'resilienceChange' | 'scoreChange' | 'divergence'
  left: number | null
  right: number | null
  absoluteDifference: number | null
  relativeDifference: number | null
  sameDirection: boolean | null
}

export type CivilizationReplicationResult = {
  sameExperiment: boolean
  leftExperimentId: string
  rightExperimentId: string
  scenarios: string[]
  metrics: CivilizationReplicationScenarioMetric[]
  scenarioConsistency: number
  outcomeConsistency: number
}

function outcomeMap(result: CivilizationExperimentResult) {
  return new Map(result.outcomes.map((outcome) => [outcome.scenarioId, outcome]))
}

function metricValue(outcome: CivilizationExperimentOutcome | undefined, metric: CivilizationReplicationScenarioMetric['metric']) {
  return outcome ? outcome[metric] : null
}

export function assessCivilizationReplication(
  left: CivilizationExperimentResult,
  right: CivilizationExperimentResult,
  tolerance = 1e-6,
): CivilizationReplicationResult {
  const leftMap = outcomeMap(left)
  const rightMap = outcomeMap(right)
  const scenarioIds = [...new Set([...leftMap.keys(), ...rightMap.keys()])].sort()
  const metricNames: CivilizationReplicationScenarioMetric['metric'][] = [
    'populationChange',
    'stabilityChange',
    'resilienceChange',
    'scoreChange',
    'divergence',
  ]

  const metrics: CivilizationReplicationScenarioMetric[] = []
  let comparable = 0
  let consistent = 0

  for (const scenarioId of scenarioIds) {
    for (const metric of metricNames) {
      const l = metricValue(leftMap.get(scenarioId), metric)
      const r = metricValue(rightMap.get(scenarioId), metric)
      const comparableValues = l !== null && r !== null
      const absoluteDifference = comparableValues ? Math.abs(r as number - l as number) : null
      const scale = comparableValues ? Math.max(Math.abs(l as number), Math.abs(r as number), 1e-12) : 1
      const relativeDifference = comparableValues ? (absoluteDifference as number) / scale : null
      const sameDirection = comparableValues
        ? Math.abs(l) <= tolerance || Math.abs(r) <= tolerance
          ? Math.abs(r - l) <= tolerance
          : Math.sign(l) === Math.sign(r)
        : null

      if (comparableValues) {
        comparable++
        if (sameDirection) consistent++
      }

      metrics.push({
        scenarioId,
        metric,
        left: l,
        right: r,
        absoluteDifference,
        relativeDifference,
        sameDirection,
      })
    }
  }

  const scenarioConsistency = scenarioIds.length
    ? scenarioIds.filter((id) => {
        const leftOutcome = leftMap.get(id)
        const rightOutcome = rightMap.get(id)
        if (!leftOutcome || !rightOutcome) return false
        return metricNames.every((metric) => {
          const l = metricValue(leftOutcome, metric)
          const r = metricValue(rightOutcome, metric)
          if (l === null || r === null) return false
          return Math.abs(l - r) <= tolerance || Math.sign(l) === Math.sign(r)
        })
      }).length / scenarioIds.length
    : 0

  return {
    sameExperiment: left.experimentId === right.experimentId,
    leftExperimentId: left.experimentId,
    rightExperimentId: right.experimentId,
    scenarios: scenarioIds,
    metrics,
    scenarioConsistency,
    outcomeConsistency: comparable ? consistent / comparable : 0,
  }
}
