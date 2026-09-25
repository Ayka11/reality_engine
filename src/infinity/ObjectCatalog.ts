import type { WorldObjectKind } from './WorldObject'

export type ObjectDefinition = {
  kind: WorldObjectKind
  label: string
  category: 'nature' | 'terrain' | 'infrastructure' | 'science' | 'marker'
  defaultScale: number
  collidable: boolean
  persistent: boolean
}

export const OBJECT_CATALOG: ObjectDefinition[] = [
  { kind: 'tree', label: 'Tree', category: 'nature', defaultScale: 1, collidable: true, persistent: true },
  { kind: 'rock', label: 'Rock', category: 'nature', defaultScale: 1, collidable: true, persistent: true },
  { kind: 'crystal', label: 'Crystal', category: 'science', defaultScale: 1, collidable: true, persistent: true },
  { kind: 'water', label: 'Water Source', category: 'terrain', defaultScale: 1, collidable: false, persistent: true },
  { kind: 'building', label: 'Building', category: 'infrastructure', defaultScale: 1, collidable: true, persistent: true },
  { kind: 'road', label: 'Road', category: 'infrastructure', defaultScale: 1, collidable: true, persistent: true },
  { kind: 'bridge', label: 'Bridge', category: 'infrastructure', defaultScale: 1, collidable: true, persistent: true },
  { kind: 'spawn', label: 'Spawn Point', category: 'marker', defaultScale: 1, collidable: false, persistent: true },
  { kind: 'landmark', label: 'Landmark', category: 'marker', defaultScale: 1, collidable: false, persistent: true },
  { kind: 'custom', label: 'Custom Object', category: 'science', defaultScale: 1, collidable: true, persistent: true },
]
