import { WorldGenerator } from './WorldGenerator'

const world = new WorldGenerator('test-seed')

const a = world.generateChunk(0, 0, 0)
const b = world.generateChunk(0, 0, 0)
if (a.heights[0] !== b.heights[0]) throw new Error('Determinism failure')

const left = world.generateChunk(0, 0, 0)
const right = world.generateChunk(1, 0, 0)
for (let z = 0; z < 32; z++) {
  const xLeft = world.sampleHeight(31, z)
  const xRight = world.sampleHeight(32, z)
  if (!Number.isFinite(xLeft) || !Number.isFinite(xRight)) throw new Error('Boundary sample failure')
  const i = z * 32 + 31
  if (Math.abs(left.heights[i] - xLeft) > 1e-6) throw new Error('Left chunk coordinate mismatch')
  const j = z * 32
  if (Math.abs(right.heights[j] - xRight) > 1e-6) throw new Error('Right chunk coordinate mismatch')
}

const neg = world.generateChunk(-1, 0, -1)
if (neg.cx !== -1 || neg.cz !== -1) throw new Error('Negative chunk coordinate failure')

// The default visible-world seed must create measurable relief over several
// neighboring chunks, not merely finite/repeatable heights. This guards against
// accidental coordinate scaling or normalization that flattens the heightfield.
for (const seed of ['reality-engine-infinity-v1', 'reality-harmonic-balanced-emergent-standard']) {
  const worldBySeed = new WorldGenerator(seed)
  const chunks = [
    worldBySeed.generateChunk(0, 0, 0),
    worldBySeed.generateChunk(1, 0, 0),
    worldBySeed.generateChunk(0, 0, 1),
    worldBySeed.generateChunk(-1, 0, -1),
  ]
  const heights = chunks.flatMap(chunk => Array.from(chunk.heights))
  if (!heights.every(Number.isFinite)) throw new Error(`Non-finite terrain height for seed ${seed}`)
  const minHeight = Math.min(...heights)
  const maxHeight = Math.max(...heights)
  if (maxHeight - minHeight < 1.0) {
    throw new Error(`Terrain relief collapsed for seed ${seed}: min=${minHeight}, max=${maxHeight}`)
  }
  if (new Set(chunks.flatMap(chunk => Array.from(chunk.biome))).size < 2) {
    throw new Error(`Terrain climate/biome diversity collapsed for seed ${seed}`)
  }
}

console.log('Infinite world kernel tests: PASS')
