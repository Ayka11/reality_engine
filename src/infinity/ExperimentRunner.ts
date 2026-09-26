import type { ExperimentProtocol } from './ExperimentProtocol'

export type ExperimentSnapshot = {
  protocol: ExperimentProtocol
  startedAt: number
  finishedAt: number
  durationMs: number
  status: 'running' | 'completed' | 'aborted'
  fingerprint: string
  results: Record<string, unknown>
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
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

export class ExperimentRunner {
  private startedAt = 0
  private protocol: ExperimentProtocol | null = null
  private results: Record<string, unknown> = {}

  start(protocol: ExperimentProtocol) {
    this.startedAt = Date.now()
    this.protocol = protocol
    this.results = {}
    return this.snapshot('running')
  }

  record(name: string, value: unknown) {
    if (!this.protocol) throw new Error('Experiment has not started')
    this.results[name] = value
  }

  finish(status: 'completed' | 'aborted' = 'completed') {
    if (!this.protocol) throw new Error('Experiment has not started')
    return this.snapshot(status)
  }

  private snapshot(status: ExperimentSnapshot['status']): ExperimentSnapshot {
    if (!this.protocol) throw new Error('Experiment has not started')
    const finishedAt = status === 'running' ? this.startedAt : Date.now()
    const payload = {
      protocol: this.protocol,
      results: this.results,
    }
    const fingerprint = hashString(stableSerialize(payload))
    return {
      protocol: this.protocol,
      startedAt: this.startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - this.startedAt),
      status,
      fingerprint,
      results: { ...this.results },
    }
  }

  get active() {
    return this.protocol !== null
  }
}
