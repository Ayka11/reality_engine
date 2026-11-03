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
    // Detach payload before allocating an ID or changing the trace. A
    // non-cloneable payload is rejected without leaving a partial event.
    const detachedPayload = structuredClone(payload)
    const event: RuntimeProvenanceEvent = {
      id: nextId(stage),
      stage,
      timestamp: Date.now(),
      parentId: parentId ?? this.trace.events.at(-1)?.id,
      payload: detachedPayload,
    }
    this.trace.events.push(event)
    if (stage === 'world-state') {
      this.trace.latestWorldState = structuredClone(detachedPayload)
    }
    return structuredClone(event)
  }

  rollbackLast(eventId: string): boolean {
    const last = this.trace.events[this.trace.events.length - 1]
    if (!last || last.id !== eventId) return false

    this.trace.events.pop()
    if (last.stage === 'world-state') {
      const previousWorldState = [...this.trace.events].reverse()
        .find(event => event.stage === 'world-state')
      if (previousWorldState) {
        this.trace.latestWorldState = structuredClone(previousWorldState.payload)
      } else {
        delete this.trace.latestWorldState
      }
    }
    return true
  }

  getTrace(): RuntimeProvenanceTrace {
    return structuredClone(this.trace)
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
