import assert from 'node:assert/strict'
import { applyWorldGenerationPlan } from '../src/worldLibrary/WorldPlanRuntimeAdapter'
import type { WorldGenerationPlan } from '../src/worldLibrary/WorldGenerationPlan'
import type { WorldLibraryEntry } from '../src/worldLibrary/WorldLibrary'
import type { WorldObjectKind } from '../src/infinity/WorldObject'

type Placement = { kind: WorldObjectKind; x: number; z: number; scale: number }

const placements: Placement[] = []
const scatterCalls: Array<{ kind: WorldObjectKind; x0: number; z0: number; x1: number; z1: number; density: number }> = []
let legacyPlaceCalls = 0

const world = {
  placeScaled(kind: WorldObjectKind, x: number, z: number, scale = 1) {
    placements.push({ kind, x, z, scale })
    return placements[placements.length - 1]
  },
  // Keep the legacy signature present as a trap: the plan adapter must never
  // route scale through the renderer's fourth argument (which means height).
  place(_kind: WorldObjectKind, _x: number, _z: number, _height?: number, _scale = 1) {
    legacyPlaceCalls++
    return null
  },
  scatter(kind: WorldObjectKind, x0: number, z0: number, x1: number, z1: number, density = 0.15) {
    scatterCalls.push({ kind, x0, z0, x1, z1, density })
  },
  generateRiverNetwork() {},
  generateSettlementV2() {},
  generateCityPlan() {},
}

function entry(
  id: string,
  category: WorldLibraryEntry['category'],
  visualKind: string,
): WorldLibraryEntry {
  return {
    id,
    name: id,
    category,
    description: 'adapter regression fixture',
    tags: [],
    scale: 'medium',
    rarity: 'common',
    visualKind,
  }
}

const elements = [
  { entry: entry('water.river', 'water', 'water.river'), score: 0.6 },
  { entry: entry('settlement.city', 'settlement', 'settlement.city'), score: 0.8 },
  { entry: entry('building.tower', 'structure', 'building.tower'), score: 0.4 },
  { entry: entry('gravity.well', 'anomaly', 'gravity.well'), score: 0.9 },
  { entry: entry('flora.tree', 'flora', 'flora.tree'), score: 0.5 },
]

const plan = {
  elements,
  biome: undefined,
} as unknown as WorldGenerationPlan

const origin = { x: 120, z: -64 }
const result = applyWorldGenerationPlan(world, plan, origin.x, origin.z)

assert.deepEqual(result.applied, elements.map(item => item.entry.id))
assert.deepEqual(result.skipped, [])
assert.equal(legacyPlaceCalls, 0,
  'semantic plan generation must use placeScaled, never the legacy place(kind, x, z, y, scale) signature')

assert.equal(placements.length, 4)
assert.deepEqual(placements[0], {
  kind: 'water', x: origin.x + 42, z: origin.z - 18, scale: 1.3,
})
assert.deepEqual(placements[1], {
  kind: 'building', x: origin.x - 38, z: origin.z + 24, scale: 1.5,
})
const buildingAngle = 2 * 2.399963
assert.equal(placements[2].kind, 'building')
assert.ok(Math.abs(placements[2].x - (origin.x + Math.cos(buildingAngle) * 55)) < 1e-10)
assert.ok(Math.abs(placements[2].z - (origin.z + Math.sin(buildingAngle) * 55)) < 1e-10)
assert.equal(placements[2].scale, 1.1)

const gravityAngle = 3 * 2.399963
assert.equal(placements[3].kind, 'gravity_well')
assert.ok(Math.abs(placements[3].x - (origin.x + Math.cos(gravityAngle) * 70)) < 1e-10)
assert.ok(Math.abs(placements[3].z - (origin.z + Math.sin(gravityAngle) * 70)) < 1e-10)
assert.equal(placements[3].scale, 1.6)

assert.deepEqual(scatterCalls, [{
  kind: 'tree',
  x0: origin.x - 110,
  z0: origin.z - 110,
  x1: origin.x + 110,
  z1: origin.z + 110,
  density: 0.0405,
}])

console.log('World plan runtime placement-scale contract: PASS')
