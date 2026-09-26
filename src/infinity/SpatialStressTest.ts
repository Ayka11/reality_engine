import { WorldObjectSpatialIndex } from './WorldObjectSpatialIndex'
import type { WorldObject, WorldObjectKind } from './WorldObject'

export type StressScenario = {
  particles: number
  physicsObjects: number
  radius: number
}

export type StressResult = StressScenario & {
  indexedObjects: number
  averageQueryMs: number
  queriesPerSecond: number
}

const PHYSICS_KINDS: WorldObjectKind[] = [
  'gravity_well', 'entropy_sink', 'quantum_emitter', 'force_field', 'metalaw',
]

function syntheticObject(i: number): WorldObject {
  const kind = PHYSICS_KINDS[i % PHYSICS_KINDS.length]
  const angle = i * 2.399963
  const radius = 40 + (i % 97) * 4
  return {
    id: `stress-${i}`,
    kind,
    x: Math.cos(angle) * radius,
    y: 5 + (i % 12),
    z: Math.sin(angle) * radius,
    rotationY: 0,
    scale: 1,
    seed: i,
    properties: {},
  }
}

/**
 * Measures spatial lookup cost only. It does not emulate rendering or physics integration.
 */
export function runSpatialStressTest(scenario: StressScenario, iterations = 100): StressResult {
  const index = new WorldObjectSpatialIndex()
  const objects = Array.from({ length: Math.max(0, scenario.physicsObjects) }, (_, i) => syntheticObject(i))
  index.rebuild(objects)

  const start = performance.now()
  let queries = 0
  for (let i = 0; i < Math.max(1, iterations); i++) {
    for (let p = 0; p < Math.max(1, scenario.particles); p++) {
      const angle = (p + i * 0.37) * 2.399963
      const x = Math.cos(angle) * 110
      const z = Math.sin(angle) * 110
      index.queryRadius(x, 5, z, scenario.radius)
      queries++
    }
  }
  const elapsed = Math.max(0.001, performance.now() - start)

  return {
    ...scenario,
    indexedObjects: index.size,
    averageQueryMs: elapsed / queries,
    queriesPerSecond: queries * 1000 / elapsed,
  }
}

export function defaultStressMatrix(): StressScenario[] {
  const particles = [100, 700, 2000, 5000, 10000]
  const objects = [0, 10, 50, 100, 500, 1000]
  return particles.flatMap(p => objects.map(o => ({
    particles: p,
    physicsObjects: o,
    radius: 160,
  })))
}
