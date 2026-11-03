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

const RUNTIME_PROVENANCE_STAGES = new Set<RuntimeProvenanceStage>([
  'preset', 'brush', 'law', 'build-decision', 'world-state',
])
const MAX_PROVENANCE_EVENTS = 100_000

let sequence = 0

function nextId(prefix: string, existing?: ReadonlySet<string>): string {
  let id = ''
  do {
    sequence += 1
    id = `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`
  } while (existing?.has(id))
  return id
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

/** Validate an untrusted provenance trace before it can become authoritative. */
export function validateRuntimeProvenanceTrace(
  value: unknown,
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!isRecord(value)) {
    return { valid: false, errors: ['Runtime provenance trace must be an object'] }
  }
  if (value.schemaVersion !== 'reality-runtime-provenance-v1') {
    errors.push('Unsupported runtime provenance schema')
  }
  if (typeof value.traceId !== 'string' || !value.traceId.trim()) {
    errors.push('Runtime provenance trace is missing traceId')
  }
  if (!Array.isArray(value.events)) {
    errors.push('Runtime provenance events must be an array')
    return { valid: false, errors }
  }
  if (value.events.length > MAX_PROVENANCE_EVENTS) {
    errors.push('Runtime provenance trace exceeds the supported event limit')
    return { valid: false, errors }
  }
  if (value.latestWorldState !== undefined && !isRecord(value.latestWorldState)) {
    errors.push('Runtime provenance latestWorldState must be an object')
  }

  const ids = new Set<string>()
  const stages = new Set<RuntimeProvenanceStage>()
  for (let index = 0; index < value.events.length; index++) {
    const event = value.events[index]
    if (!isRecord(event)) {
      errors.push(`Runtime provenance event ${index} must be an object`)
      continue
    }
    const id = typeof event.id === 'string' ? event.id : ''
    if (!id.trim()) errors.push(`Runtime provenance event ${index} is missing id`)
    else if (ids.has(id)) errors.push(`Duplicate provenance event id: ${id}`)

    if (typeof event.stage !== 'string' ||
        !RUNTIME_PROVENANCE_STAGES.has(event.stage as RuntimeProvenanceStage)) {
      errors.push(`Runtime provenance event ${id || index} has an invalid stage`)
    } else {
      stages.add(event.stage as RuntimeProvenanceStage)
    }
    if (!Number.isSafeInteger(event.timestamp) || (event.timestamp as number) < 0) {
      errors.push(`Runtime provenance event ${id || index} has an invalid timestamp`)
    }
    if (event.parentId !== undefined &&
        (typeof event.parentId !== 'string' || !event.parentId.trim() || !ids.has(event.parentId))) {
      errors.push(`Missing or invalid parent for event: ${id || index}`)
    }
    if (!isRecord(event.payload)) {
      errors.push(`Runtime provenance event ${id || index} has an invalid payload`)
    }
    if (id) ids.add(id)
  }

  if (stages.has('brush') && stages.has('preset') &&
      !value.events.some(event => isRecord(event) && event.stage === 'law')) {
    errors.push('Preset/Brush activity has no recorded law state')
  }
  return { valid: errors.length === 0, errors }
}

export class RuntimeProvenance {
  private trace: RuntimeProvenanceTrace = {
    schemaVersion: 'reality-runtime-provenance-v1',
    traceId: nextId('trace'),
    events: [],
  }

  reset(): RuntimeProvenanceTrace {
    this.trace = {
      schemaVersion: 'reality-runtime-provenance-v1',
      traceId: nextId('trace'),
      events: [],
    }
    return this.getTrace()
  }

  record(stage: RuntimeProvenanceStage, payload: Record<string, unknown>, parentId?: string) {
    if (!RUNTIME_PROVENANCE_STAGES.has(stage)) {
      throw new TypeError('Unsupported runtime provenance stage')
    }
    // Detach payload before allocating an ID or changing the trace. A
    // non-cloneable payload is rejected without leaving a partial event.
    const detachedPayload = structuredClone(payload)
    if (!isRecord(detachedPayload)) {
      throw new TypeError('Runtime provenance payload must be an object')
    }
    const existingIds = new Set(this.trace.events.map(event => event.id))
    if (parentId !== undefined && !existingIds.has(parentId)) {
      throw new Error('Runtime provenance parent must reference an earlier event')
    }
    const event: RuntimeProvenanceEvent = {
      id: nextId(stage, existingIds),
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

  restore(value: unknown): RuntimeProvenanceTrace {
    const validation = validateRuntimeProvenanceTrace(value)
    if (!validation.valid) {
      throw new TypeError(`Invalid runtime provenance trace: ${validation.errors.join('; ')}`)
    }
    const detached = structuredClone(value) as RuntimeProvenanceTrace
    const latestWorldEvent = [...detached.events].reverse()
      .find(event => event.stage === 'world-state')
    if (latestWorldEvent) {
      detached.latestWorldState = structuredClone(latestWorldEvent.payload)
    } else {
      delete detached.latestWorldState
    }

    // Publish only after the whole trace has validated and detached successfully.
    this.trace = detached
    return this.getTrace()
  }

  validate(): { valid: boolean; errors: string[] } {
    return validateRuntimeProvenanceTrace(this.trace)
  }
}
export const runtimeProvenance = new RuntimeProvenance()
