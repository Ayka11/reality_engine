/**
 * Deterministic Surface Nets isosurface extraction for sampled scalar fields.
 *
 * The input is a lattice of scalar samples at integer local coordinates
 * [0..sizeX-1] × [0..sizeY-1] × [0..sizeZ-1]. One ghost sample of the
 * below-isovalue exterior is expected outside the data window; the callback
 * may supply neighboring chunk samples when meshing a streamed world.
 *
 * Positions are expressed in the input grid's local coordinate system. The
 * origin offsets sampleValue coordinates, but is not added to returned vertices.
 * Each active grid cell contributes at most one averaged edge-intersection
 * vertex; quads are emitted around sign-changing lattice edges.
 */

export interface SurfaceNetsMeshInput {
  size: readonly [number, number, number]
  origin?: readonly [number, number, number]
  isoLevel: number
  /**
   * "closed" emits low-side ghost edges for a standalone closed volume.
   * "low-endpoint" assigns each lattice edge to the chunk containing its
   * low-coordinate endpoint, preventing duplicate seam quads in streamed chunks.
   */
  edgeOwnership?: 'closed' | 'low-endpoint'
  sampleValue: (x: number, y: number, z: number) => number
}

export interface SurfaceNetsMesh {
  positions: number[]
  normals: number[]
  /** Mean of the eight scalar corner samples for each surface vertex. */
  fieldValues: number[]
  indices: number[]
  quadCount: number
}

const CORNERS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
]

const EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
]

const MAX_SAMPLE_POINTS = 4_000_000
const NORMAL_EPSILON = 1e-12

/**
 * Extract a Surface Nets isosurface.
 *
 * Non-finite samples are rejected rather than propagated into geometry. The
 * additional ghost layer lets surfaces close around occupied samples at the
 * input window boundary when the sampler returns below-iso values outside it.
 */
export function buildSurfaceNetsMesh(input: SurfaceNetsMeshInput): SurfaceNetsMesh {
  const [sx, sy, sz] = input.size
  if (![sx, sy, sz].every(Number.isSafeInteger) || sx <= 0 || sy <= 0 || sz <= 0) {
    throw new RangeError('Surface Nets dimensions must be positive safe integers')
  }
  if (!Number.isFinite(input.isoLevel)) {
    throw new RangeError('Surface Nets isoLevel must be finite')
  }
  if (typeof input.sampleValue !== 'function') {
    throw new TypeError('Surface Nets sampleValue must be a function')
  }

  const origin = input.origin ?? [0, 0, 0]
  if (!origin.every(Number.isSafeInteger)) {
    throw new RangeError('Surface Nets origin must contain safe integers')
  }
  if (origin.some((value, axis) =>
    !Number.isSafeInteger(value - 1) || !Number.isSafeInteger(value + input.size[axis]))) {
    throw new RangeError('Surface Nets sample coordinates exceed the safe integer range')
  }

  const gx = sx + 2, gy = sy + 2, gz = sz + 2
  const sampleCount = gx * gy * gz
  if (!Number.isSafeInteger(sampleCount) || sampleCount > MAX_SAMPLE_POINTS) {
    throw new RangeError(`Surface Nets sample grid exceeds ${MAX_SAMPLE_POINTS} points`)
  }

  const sampleGrid = new Float64Array(sampleCount)
  const sampleIndex = (x: number, y: number, z: number) =>
    ((z + 1) * gy + (y + 1)) * gx + (x + 1)

  for (let z = -1; z <= sz; z++) {
    for (let y = -1; y <= sy; y++) {
      for (let x = -1; x <= sx; x++) {
        const value = input.sampleValue(origin[0] + x, origin[1] + y, origin[2] + z)
        if (!Number.isFinite(value)) {
          throw new RangeError(`Surface Nets received a non-finite sample at (${origin[0] + x}, ${origin[1] + y}, ${origin[2] + z})`)
        }
        sampleGrid[sampleIndex(x, y, z)] = value
      }
    }
  }

  // Cubes are indexed from -1 through size-1 on every axis, adding a ghost
  // cube layer around the input sample lattice.
  const cxCount = sx + 1, cyCount = sy + 1, czCount = sz + 1
  const cubeCount = cxCount * cyCount * czCount
  if (!Number.isSafeInteger(cubeCount) || cubeCount > MAX_SAMPLE_POINTS) {
    throw new RangeError(`Surface Nets cube grid exceeds ${MAX_SAMPLE_POINTS} cells`)
  }
  const vertexForCube = new Int32Array(cubeCount)
  vertexForCube.fill(-1)
  const cubeIndex = (x: number, y: number, z: number) =>
    ((z + 1) * cyCount + (y + 1)) * cxCount + (x + 1)

  const positions: number[] = []
  const normals: number[] = []
  const fieldValues: number[] = []
  const indices: number[] = []
  const cornerValues = new Float64Array(8)
  const iso = input.isoLevel
  const inside = (value: number) => value >= iso
  let quadCount = 0

  const normalize = (x: number, y: number, z: number): readonly [number, number, number] => {
    const length = Math.hypot(x, y, z)
    if (length <= NORMAL_EPSILON || !Number.isFinite(length)) return [0, 1, 0]
    return [x / length, y / length, z / length]
  }

  for (let z = -1; z < sz; z++) {
    for (let y = -1; y < sy; y++) {
      for (let x = -1; x < sx; x++) {
        let insideCount = 0
        let scalarSum = 0
        let insideX = 0, insideY = 0, insideZ = 0
        for (let corner = 0; corner < 8; corner++) {
          const offset = CORNERS[corner]
          const value = sampleGrid[sampleIndex(x + offset[0], y + offset[1], z + offset[2])]
          cornerValues[corner] = value
          scalarSum += value
          if (inside(value)) {
            insideCount++
            insideX += x + offset[0]
            insideY += y + offset[1]
            insideZ += z + offset[2]
          }
        }
        if (insideCount === 0 || insideCount === 8) continue

        let pointX = 0, pointY = 0, pointZ = 0, crossingCount = 0
        for (const [a, b] of EDGES) {
          const valueA = cornerValues[a], valueB = cornerValues[b]
          if (inside(valueA) === inside(valueB)) continue
          const denominator = valueB - valueA
          const t = denominator === 0 ? 0.5 : Math.max(0, Math.min(1, (iso - valueA) / denominator))
          const pa = CORNERS[a], pb = CORNERS[b]
          pointX += x + pa[0] + (pb[0] - pa[0]) * t
          pointY += y + pa[1] + (pb[1] - pa[1]) * t
          pointZ += z + pa[2] + (pb[2] - pa[2]) * t
          crossingCount++
        }
        if (crossingCount === 0) continue

        pointX /= crossingCount
        pointY /= crossingCount
        pointZ /= crossingCount
        const u = pointX - x, v = pointY - y, w = pointZ - z
        const values = cornerValues
        // Analytic gradient of the cube's trilinear interpolant. Since high
        // values are considered inside, the outward normal is -gradient.
        const dx =
          (values[1] - values[0]) * (1 - v) * (1 - w) +
          (values[2] - values[3]) * v * (1 - w) +
          (values[5] - values[4]) * (1 - v) * w +
          (values[6] - values[7]) * v * w
        const dy =
          (values[3] - values[0]) * (1 - u) * (1 - w) +
          (values[2] - values[1]) * u * (1 - w) +
          (values[7] - values[4]) * (1 - u) * w +
          (values[6] - values[5]) * u * w
        const dz =
          (values[4] - values[0]) * (1 - u) * (1 - v) +
          (values[5] - values[1]) * u * (1 - v) +
          (values[7] - values[3]) * (1 - u) * v +
          (values[6] - values[2]) * u * v
        let normal = normalize(-dx, -dy, -dz)
        if (Math.hypot(dx, dy, dz) <= NORMAL_EPSILON) {
          normal = normalize(
            pointX - insideX / insideCount,
            pointY - insideY / insideCount,
            pointZ - insideZ / insideCount,
          )
        }

        const vertexId = positions.length / 3
        positions.push(pointX, pointY, pointZ)
        normals.push(normal[0], normal[1], normal[2])
        fieldValues.push(scalarSum / 8)
        vertexForCube[cubeIndex(x, y, z)] = vertexId
      }
    }
  }

  const emitQuad = (
    cubeCoords: readonly (readonly [number, number, number])[],
    axis: 0 | 1 | 2,
    startInside: boolean,
  ) => {
    const ids = cubeCoords.map(([x, y, z]) => vertexForCube[cubeIndex(x, y, z)])
    if (ids.some(id => id < 0)) return
    const order = axis === 1
      ? (startInside ? [ids[0], ids[3], ids[2], ids[1]] : ids)
      : (startInside ? ids : [ids[0], ids[3], ids[2], ids[1]])
    indices.push(order[0], order[1], order[2], order[0], order[2], order[3])
    quadCount++
  }

  // X-oriented lattice edges; cross-sectional cube ordering is +X when the
  // low-coordinate endpoint is inside and -X otherwise. In low-endpoint mode,
  // only edges anchored inside this chunk are emitted; ghost cubes still
  // supply neighboring topology for the quad vertices.
  const edgeStartX = input.edgeOwnership === 'low-endpoint' ? 0 : -1
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = edgeStartX; x < sx; x++) {
    const a = sampleGrid[sampleIndex(x, y, z)]
    const b = sampleGrid[sampleIndex(x + 1, y, z)]
    if (inside(a) === inside(b)) continue
    emitQuad([
      [x, y - 1, z - 1], [x, y, z - 1], [x, y, z], [x, y - 1, z],
    ], 0, inside(a))
  }

  // Y-oriented edges have the opposite base winding because x × z = -y.
  const edgeStartY = input.edgeOwnership === 'low-endpoint' ? 0 : -1
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) for (let y = edgeStartY; y < sy; y++) {
    const a = sampleGrid[sampleIndex(x, y, z)]
    const b = sampleGrid[sampleIndex(x, y + 1, z)]
    if (inside(a) === inside(b)) continue
    emitQuad([
      [x - 1, y, z - 1], [x, y, z - 1], [x, y, z], [x - 1, y, z],
    ], 1, inside(a))
  }

  // Z-oriented lattice edges; cross-sectional cube ordering is +Z when the
  // low-coordinate endpoint is inside and -Z otherwise.
  const edgeStartZ = input.edgeOwnership === 'low-endpoint' ? 0 : -1
  for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) for (let z = edgeStartZ; z < sz; z++) {
    const a = sampleGrid[sampleIndex(x, y, z)]
    const b = sampleGrid[sampleIndex(x, y, z + 1)]
    if (inside(a) === inside(b)) continue
    emitQuad([
      [x - 1, y - 1, z], [x, y - 1, z], [x, y, z], [x - 1, y, z],
    ], 2, inside(a))
  }

  return { positions, normals, fieldValues, indices, quadCount }
}
