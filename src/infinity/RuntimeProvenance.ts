export type RuntimeProvenanceStage =
  | 'preset'
  | 'brush'
  | 'law'
  | 'build-decision'
  | 'world-state'

export type RuntimeProvenanceEvent = {
  id: string
  stage: RuntimeProvenanceStage
  timestamp: number
  parentId?: string
  payload: Record<string, unknown>
}

export type RuntimeProvenanceTrace = {
  schemaVersion: 'reality-runtime-provenance-v1'
  traceId: string
  events: RuntimeProvenanceEvent[]
  latestWorldState?: Record<string, unknown>
}

let sequence = 0

function nextId(prefix: string) {
  sequence += 1
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`
}

export class RuntimeProvenance {
  private trace: RuntimeProvenanceTrace = {
    schemaVersion: 'reality-runtime-provenance-v1',
    traceId: nextId('trace'),
    events: [],
  }

  reset() {
    this.trace = {
      schemaVersion: 'reality-runtime-provenance-v1',
      traceId: nextId('trace'),
      events: [],
    }
    return this.getTrace()
  }

  record(stage: RuntimeProvenanceStage, payload: Record<string, unknown>, parentId?: string) {
    const event: RuntimeProvenanceEvent = {
      id: nextId(stage),
      stage,
      timestamp: Date.now(),
      parentId: parentId ?? this.trace.events.at(-1)?.id,
      payload,
    }
    this.trace.events.push(event)
    if (stage === 'world-state') this.trace.latestWorldState = { ...payload }
    return event
  }

  getTrace(): RuntimeProvenanceTrace {
    return {
      schemaVersion: this.trace.schemaVersion,
      traceId: this.trace.traceId,
      events: this.trace.events.map(event => ({ ...event, payload: { ...event.payload } })),
      latestWorldState: this.trace.latestWorldState ? { ...this.trace.latestWorldState } : undefined,
    }
  }

  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    const events = this.trace.events
    const ids = new Set<string>()

    for (const event of events) {
      if (ids.has(event.id)) errors.push(`Duplicate provenance event id: ${event.id}`)
      ids.add(event.id)
      if (event.parentId && !ids.has(event.parentId)) errors.push(`Missing parent for event: ${event.id}`)
    }

    const stages = new Set(events.map(event => event.stage))
    if (stages.has('brush') && stages.has('preset') && !events.some(event => event.stage === 'law')) {
      errors.push('Preset/Brush activity has no recorded law state')
    }

    return { valid: errors.length === 0, errors }
  }
}

export const runtimeProvenance = new RuntimeProvenance()
