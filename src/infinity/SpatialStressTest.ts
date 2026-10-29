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
  bruteForceAverageQueryMs: number
  bruteForceQueriesPerSecond: number
  candidateObjects: number
  speedup: number
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

function bruteForceQuery(objects: WorldObject[], x: number, y: number, z: number, radius: number) {
  const r2 = Math.max(0, radius) ** 2
  const result: WorldObject[] = []
  for (const object of objects) {
    if (!PHYSICS_KINDS.includes(object.kind)) continue
    const dx = object.x - x
    const dy = object.y - y
    const dz = object.z - z
    if (dx * dx + dy * dy + dz * dz <= r2) result.push(object)
  }
  return result
}

/**
 * Synthetic lookup benchmark. It compares spatial-index lookup with a brute-force scan.
 * It does not emulate rendering, GPU work, or the complete physics integration loop.
 */
export function runSpatialStressTest(scenario: StressScenario, iterations = 100): StressResult {
  const index = new WorldObjectSpatialIndex()
  const objects = Array.from(
    { length: Math.max(0, scenario.physicsObjects) },
    (_, i) => syntheticObject(i),
  )
  index.rebuild(objects)

  const particleCount = Math.max(1, scenario.particles)
  const iterationCount = Math.max(1, iterations)
  const queries = particleCount * iterationCount
  const points = Array.from({ length: queries }, (_, q) => {
    const particle = q % particleCount
    const iteration = Math.floor(q / particleCount)
    const angle = (particle + iteration * 0.37) * 2.399963
    return { x: Math.cos(angle) * 110, y: 5, z: Math.sin(angle) * 110 }
  })

  const indexedStart = performance.now()
  let indexedCandidates = 0
  for (const point of points) {
    indexedCandidates += index.queryRadius(
      point.x, point.y, point.z, scenario.radius,
    ).length
  }
  const indexedElapsed = Math.max(0.001, performance.now() - indexedStart)

  const bruteStart = performance.now()
  for (const point of points) {
    bruteForceQuery(objects, point.x, point.y, point.z, scenario.radius)
  }
  const bruteElapsed = Math.max(0.001, performance.now() - bruteStart)

  return {
    ...scenario,
    indexedObjects: index.size,
    averageQueryMs: indexedElapsed / queries,
    queriesPerSecond: queries * 1000 / indexedElapsed,
    bruteForceAverageQueryMs: bruteElapsed / queries,
    bruteForceQueriesPerSecond: queries * 1000 / bruteElapsed,
    candidateObjects: indexedCandidates / queries,
    speedup: bruteElapsed / indexedElapsed,
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
