import type { WorldGenerationPlan } from './WorldGenerationPlan';
import { visualKindToWorldObject } from './WorldLibraryAdapter';
import type { WorldObjectKind } from '../infinity/WorldObject';

type WorldRuntime = {
  scatter: (kind: WorldObjectKind, x0: number, z0: number, x1: number, z1: number, density?: number) => unknown;
  place: (kind: WorldObjectKind, x: number, z: number, scale?: number) => unknown;
  generateRiverNetwork: (x: number, z: number, radius?: number, samples?: number) => unknown;
  generateSettlementV2: (x: number, z: number, radius?: number, blocks?: number) => unknown;
  generateCityPlan: (x: number, z: number, radius?: number, samples?: number) => unknown;
};

export type AppliedWorldPlan = {
  biome?: string;
  applied: string[];
  skipped: string[];
};

export function applyWorldGenerationPlan(
  world: WorldRuntime,
  plan: WorldGenerationPlan,
  x: number,
  z: number,
): AppliedWorldPlan {
  const applied: string[] = [];
  const skipped: string[] = [];
  const radius = 110;

  for (const item of plan.elements.slice(0, 18)) {
    const entry = item.entry;
    const visual = visualKindToWorldObject(entry);

    if (!visual) {
      skipped.push(entry.id);
      continue;
    }

    const scale = Math.max(0.55, Math.min(1.8, 0.7 + item.score));
    const density = Math.max(0.012, Math.min(0.09, 0.018 + item.score * 0.045));

    if (entry.id === 'water.river') {
      world.generateRiverNetwork(x, z, Math.round(150 + item.score * 120), 31);
      applied.push(entry.id);
      continue;
    }

    if (entry.category === 'settlement') {
      if (entry.id === 'settlement.city' || entry.id === 'settlement.megacity') {
        world.generateCityPlan(x, z, entry.id === 'settlement.megacity' ? 240 : 180, 31);
      } else {
        world.generateSettlementV2(x, z, entry.id === 'settlement.town' ? 150 : 110, entry.id === 'settlement.town' ? 5 : 4);
      }
      applied.push(entry.id);
      continue;
    }

    if (visual === 'building' || visual === 'landmark' || visual === 'road' || visual === 'bridge') {
      const angle = (applied.length * 2.399963) % (Math.PI * 2);
      world.place(visual, x + Math.cos(angle) * 55, z + Math.sin(angle) * 55, scale);
      applied.push(entry.id);
      continue;
    }

    if (
      visual === 'gravity_well' ||
      visual === 'entropy_sink' ||
      visual === 'quantum_emitter' ||
      visual === 'force_field' ||
      visual === 'metalaw'
    ) {
      const angle = (applied.length * 2.399963) % (Math.PI * 2);
      world.place(visual, x + Math.cos(angle) * 70, z + Math.sin(angle) * 70, scale);
      applied.push(entry.id);
      continue;
    }

    if (visual === 'tree' || visual === 'rock' || visual === 'crystal') {
      world.scatter(visual, x - radius, z - radius, x + radius, z + radius, density);
      applied.push(entry.id);
      continue;
    }

    skipped.push(entry.id);
  }

  return { biome: plan.biome?.id, applied, skipped };
}
