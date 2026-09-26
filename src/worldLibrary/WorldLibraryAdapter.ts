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

export function visualKindToWorldObject(entry: WorldLibraryEntry): WorldObjectKind | null {
  return VISUAL_TO_OBJECT[entry.visualKind] ?? null;
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
