import type { ScientificFieldSample } from './FieldSampler'
import type { WorldObjectKind } from './WorldObject'

export type PhysicsInteractionType =
  | 'gravity'
  | 'entropy'
  | 'quantum'
  | 'force-field'
  | 'metalaw'

export type PhysicsInteractionRecord = {
  id: string
  timestamp: number
  type: PhysicsInteractionType
  objectKind: WorldObjectKind
  objectId: string
  particleIndex: number
  position: { x: number; y: number; z: number }
  field: ScientificFieldSample
  modulation: Record<string, number>
  magnitude: number
}

let sequence = 0

export function createPhysicsInteractionRecord(
  type: PhysicsInteractionType,
  objectKind: WorldObjectKind,
  objectId: string,
  particleIndex: number,
  position: { x: number; y: number; z: number },
  field: ScientificFieldSample,
  modulation: Record<string, number>,
  magnitude: number,
): PhysicsInteractionRecord {
  sequence += 1
  return {
    id: `physics-${Date.now().toString(36)}-${sequence.toString(36)}`,
    timestamp: Date.now(),
    type,
    objectKind,
    objectId,
    particleIndex,
    position,
    field,
    modulation,
    magnitude,
  }
}
