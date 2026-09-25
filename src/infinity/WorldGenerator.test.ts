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

console.log('Infinite world kernel tests: PASS')
