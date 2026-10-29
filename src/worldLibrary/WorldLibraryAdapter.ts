import { WorldLibraryEntry } from './WorldLibrary';
import { worldLibrary } from './registry';
import type { WorldObjectKind } from '../infinity/WorldObject';

const VISUAL_TO_OBJECT: Record<string, WorldObjectKind> = {
  'flora.tree': 'tree',
  'flora.cactus': 'tree',
  'flora.grass': 'custom',
  'flora.mushroom': 'custom',
  'rock.outcrop': 'rock',
  'rock.basalt': 'rock',
  'crystal.cluster': 'crystal',
  'resource.vein': 'rock',
  'resource.ore': 'rock',
  'resource.crystal': 'crystal',
  'water.river': 'water',
  'water.lake': 'water',
  'water.waterfall': 'water',
  'building.house': 'building',
  'building.tower': 'building',
  'building.temple': 'building',
  'building.station': 'building',
  road: 'road',
  bridge: 'bridge',
  harbor: 'building',
  'settlement.village': 'landmark',
  'settlement.town': 'landmark',
  'settlement.city': 'landmark',
  'settlement.megacity': 'landmark',
  'gravity.well': 'gravity_well',
  'entropy.sink': 'entropy_sink',
  'quantum.emitter': 'quantum_emitter',
  'force.field': 'force_field',
  'resonance.node': 'metalaw',
};

export type PopulationRuntimeKind = 'visual' | 'biological' | 'resource' | 'infrastructure' | 'civilization'

export function populationRuntimeKind(entry: WorldLibraryEntry): PopulationRuntimeKind {
  if (entry.category === 'fauna') return 'biological'
  if (entry.category === 'resource') return 'resource'
  if (entry.category === 'infrastructure' || entry.category === 'structure' || entry.category === 'settlement') return 'infrastructure'
  if (entry.category === 'civilization') return 'civilization'
  return 'visual'
}

export function visualKindToWorldObject(entry: WorldLibraryEntry): WorldObjectKind | null {
  return entry.visualKind ? (VISUAL_TO_OBJECT[entry.visualKind] ?? null) : null;
}

export function resourceVisualKind(entry: WorldLibraryEntry): WorldObjectKind | null {
  if (entry.id === 'resource.wood') return 'tree'
  if (entry.id === 'resource.stone' || entry.id === 'resource.iron') return 'rock'
  if (entry.id === 'resource.crystal') return 'crystal'
  return null
}

export function findWorldLibraryEntries(
  tags: string[] = [],
  category?: WorldLibraryEntry['category'],
): WorldLibraryEntry[] {
  return worldLibrary.query({
    category,
    tags: tags.length ? tags : undefined,
  });
}

export function resolveWorldLibraryEntry(id: string): WorldLibraryEntry | undefined {
  return worldLibrary.get(id);
}
