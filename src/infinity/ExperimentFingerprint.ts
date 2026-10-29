import type { ExperimentProtocol } from './ExperimentProtocol'
import type { ExperimentSnapshot } from './ExperimentRunner'

function stableSerialize(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return '[' + value.map(stableSerialize).join(',') + ']'
  const object = value as Record<string, unknown>
  return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + stableSerialize(object[key])).join(',') + '}'
}

function hashString(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function experimentConfigurationFingerprint(protocol: ExperimentProtocol): string {
  const { timestamp: _timestamp, ...configuration } = protocol
  return hashString(stableSerialize(configuration))
}

export function experimentResultFingerprint(snapshot: ExperimentSnapshot): string {
  return hashString(stableSerialize(snapshot.results))
}

export function experimentReproducibilityKey(protocol: ExperimentProtocol): string {
  return experimentConfigurationFingerprint(protocol)
}
