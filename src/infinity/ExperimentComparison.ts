import type { ExperimentSnapshot } from './ExperimentRunner'

export type ExperimentDifference = {
  path: string
  left: unknown
  right: unknown
}

export type NumericDelta = {
  path: string
  left: number
  right: number
  delta: number
  relativeDelta: number | null
}

export type ExperimentComparison = {
  leftFingerprint: string
  rightFingerprint: string
  sameProtocol: boolean
  sameWorld: boolean
  sameField: boolean
  sameDecision: boolean
  samePhysics: boolean
  configurationDifferences: ExperimentDifference[]
  numericDeltas: NumericDelta[]
}

function getPath(value: unknown, path: string): unknown {
  if (!path) return value
  return path.split('.').reduce<unknown>((current, key) => {
    if (current === null || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[key]
  }, value)
}

function flattenNumbers(value: unknown, prefix = ''): NumericDelta[] {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return [{ path: prefix, left: value, right: value, delta: 0, relativeDelta: 0 }]
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []

  const output: NumericDelta[] = []
  for (const [key, child] of Object.entries(value)) {
    output.push(...flattenNumbers(child, prefix ? `${prefix}.${key}` : key))
  }
  return output
}

function collectDifferences(left: unknown, right: unknown, path = ''): ExperimentDifference[] {
  if (Object.is(left, right)) return []

  if (
    left === null || right === null ||
    typeof left !== 'object' || typeof right !== 'object' ||
    Array.isArray(left) || Array.isArray(right)
  ) {
    return [{ path, left, right }]
  }

  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  const output: ExperimentDifference[] = []
  for (const key of keys) {
    const next = path ? `${path}.${key}` : key
    output.push(...collectDifferences(
      (left as Record<string, unknown>)[key],
      (right as Record<string, unknown>)[key],
      next,
    ))
  }
  return output
}

export function compareExperiments(left: ExperimentSnapshot, right: ExperimentSnapshot): ExperimentComparison {
  const configurationLeft = {
    protocolVersion: left.protocol.protocolVersion,
    world: left.protocol.world,
    field: left.protocol.field,
    decision: left.protocol.decision,
    physics: left.protocol.physics,
  }
  const configurationRight = {
    protocolVersion: right.protocol.protocolVersion,
    world: right.protocol.world,
    field: right.protocol.field,
    decision: right.protocol.decision,
    physics: right.protocol.physics,
  }

  const configurationDifferences = collectDifferences(configurationLeft, configurationRight)

  const leftNumbers = flattenNumbers({
    durationMs: left.durationMs,
    results: left.results,
  }).map(item => ({ ...item, left: getPath({ durationMs: left.durationMs, results: left.results }, item.path) as number }))

  const rightNumericMap = new Map(
    flattenNumbers({
      durationMs: right.durationMs,
      results: right.results,
    }).map(item => [item.path, getPath({ durationMs: right.durationMs, results: right.results }, item.path)]),
  )

  const numericDeltas: NumericDelta[] = []
  for (const item of leftNumbers) {
    const rightValue = rightNumericMap.get(item.path)
    if (typeof rightValue !== 'number') continue
    const delta = rightValue - item.left
    numericDeltas.push({
      path: item.path,
      left: item.left,
      right: rightValue,
      delta,
      relativeDelta: item.left === 0 ? null : delta / Math.abs(item.left),
    })
  }

  return {
    leftFingerprint: left.fingerprint,
    rightFingerprint: right.fingerprint,
    sameProtocol: left.protocol.protocolVersion === right.protocol.protocolVersion,
    sameWorld: JSON.stringify(left.protocol.world) === JSON.stringify(right.protocol.world),
    sameField: JSON.stringify(left.protocol.field) === JSON.stringify(right.protocol.field),
    sameDecision: JSON.stringify(left.protocol.decision) === JSON.stringify(right.protocol.decision),
    samePhysics: JSON.stringify(left.protocol.physics) === JSON.stringify(right.protocol.physics),
    configurationDifferences,
    numericDeltas,
  }
}
