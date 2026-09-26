import type { ExperimentSnapshot } from './ExperimentRunner'
import { experimentConfigurationFingerprint, experimentResultFingerprint } from './ExperimentFingerprint'

export type ReplicationMetric = {
  name: string
  left: number | null
  right: number | null
  absoluteDifference: number | null
  relativeDifference: number | null
  withinTolerance: boolean | null
}

export type ReplicationResult = {
  sameConfiguration: boolean
  configurationFingerprintLeft: string
  configurationFingerprintRight: string
  exactResultMatch: boolean
  tolerance: number
  metrics: ReplicationMetric[]
}

export function assessReplication(
  left: ExperimentSnapshot,
  right: ExperimentSnapshot,
  tolerance = 1e-9,
): ReplicationResult {
  const configurationFingerprintLeft = experimentConfigurationFingerprint(left.protocol)
  const configurationFingerprintRight = experimentConfigurationFingerprint(right.protocol)
  const sameConfiguration = configurationFingerprintLeft === configurationFingerprintRight

  const keys = new Set([
    ...Object.keys(left.results).filter(key => typeof left.results[key] === 'number'),
    ...Object.keys(right.results).filter(key => typeof right.results[key] === 'number'),
  ])

  const metrics = [...keys].sort().map(name => {
    const l = typeof left.results[name] === 'number' ? left.results[name] as number : null
    const r = typeof right.results[name] === 'number' ? right.results[name] as number : null
    if (l === null || r === null) {
      return {
        name,
        left: l,
        right: r,
        absoluteDifference: null,
        relativeDifference: null,
        withinTolerance: null,
      }
    }

    const absoluteDifference = Math.abs(r - l)
    const scale = Math.max(Math.abs(l), Math.abs(r), 1e-12)
    const relativeDifference = absoluteDifference / scale

    return {
      name,
      left: l,
      right: r,
      absoluteDifference,
      relativeDifference,
      withinTolerance: absoluteDifference <= tolerance,
    }
  })

  return {
    sameConfiguration,
    configurationFingerprintLeft,
    configurationFingerprintRight,
    exactResultMatch: experimentResultFingerprint(left) === experimentResultFingerprint(right),
    tolerance,
    metrics,
  }
}
