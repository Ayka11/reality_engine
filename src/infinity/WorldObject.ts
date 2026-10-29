export type WorldObjectKind =
  | 'tree' | 'rock' | 'crystal' | 'water' | 'building'
  | 'road' | 'bridge' | 'spawn' | 'landmark' | 'custom'
  | 'metalaw' | 'gravity_well' | 'entropy_sink' | 'quantum_emitter' | 'force_field'

export type WorldObject = {
  id: string
  kind: WorldObjectKind
  x: number
  y: number
  z: number
  rotationY: number
  scale: number
  seed: number
  properties: Record<string, string | number | boolean>
}

export type ObjectPlacement = Omit<WorldObject, 'id'>

export function objectId(kind: WorldObjectKind, x: number, y: number, z: number): string {
  return kind + ':' + x + ':' + y + ':' + z
}
