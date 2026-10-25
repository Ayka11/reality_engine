/**
 * Deterministic greedy surface extraction for axis-aligned voxel chunks.
 *
 * Material 0 is empty. The sampler is queried in global integer voxel coordinates,
 * allowing callers to cull faces against neighboring chunks without copying borders.
 * Returned positions are chunk-local voxel-space coordinates; callers may scale axes.
 */
export interface GreedyChunkMeshInput {
  size: readonly [number, number, number]
  origin?: readonly [number, number, number]
  sampleMaterial: (x: number, y: number, z: number) => number
  /** When false, suppress internal faces between any two occupied voxels. */
  emitMaterialInterfaces?: boolean
}

export interface GreedyChunkMesh {
  positions: number[]
  normals: number[]
  materialIds: number[]
  indices: number[]
  quadCount: number
}

type FaceMaskCell = { material: number; sign: 1 | -1 } | null

const AXES = [
  { u: 1, v: 2 },
  { u: 0, v: 2 },
  { u: 0, v: 1 },
] as const

/** Merge coplanar faces only when both material and orientation match. */
export function buildGreedyChunkMesh(input: GreedyChunkMeshInput): GreedyChunkMesh {
  const [sx, sy, sz] = input.size
  if (![sx, sy, sz].every(n => Number.isInteger(n) && n > 0)) {
    throw new RangeError('Greedy mesher dimensions must be positive integers')
  }
  const origin = input.origin ?? [0, 0, 0]
  const dims = [sx, sy, sz] as const
  const positions: number[] = []
  const normals: number[] = []
  const materialIds: number[] = []
  const indices: number[] = []
  let quadCount = 0

  const sample = (p: number[]) => input.sampleMaterial(
    p[0] + origin[0], p[1] + origin[1], p[2] + origin[2],
  )
  const emit = (axis: number, slice: number, uAxis: number, vAxis: number,
                u: number, v: number, width: number, height: number,
                face: Exclude<FaceMaskCell, null>) => {
    const p = [0, 0, 0]
    p[axis] = slice
    p[uAxis] = u
    p[vAxis] = v
    const p1 = [...p], p2 = [...p], p3 = [...p]
    p1[uAxis] += width
    p2[uAxis] += width
    p2[vAxis] += height
    p3[vAxis] += height
    // Reverse winding for negative faces so front-face orientation follows the normal.
    const windingSign = face.sign * (axis === 1 ? -1 : 1)
    const corners = windingSign > 0 ? [p, p1, p2, p3] : [p, p3, p2, p1]
    const base = positions.length / 3
    for (const corner of corners) {
      positions.push(corner[0], corner[1], corner[2])
      normals.push(...[0, 0, 0].map((_, i) => i === axis ? face.sign : 0))
    }
    materialIds.push(face.material)
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    quadCount++
  }

  // Sweep each principal axis. Each mask cell represents the boundary between
  // the two adjacent voxels and carries the visible side's material/orientation.
  for (let axis = 0; axis < 3; axis++) {
    const { u: uAxis, v: vAxis } = AXES[axis]
    const uSize = dims[uAxis], vSize = dims[vAxis], axisSize = dims[axis]
    for (let slice = 0; slice <= axisSize; slice++) {
      const mask: FaceMaskCell[] = new Array(uSize * vSize).fill(null)
      for (let v = 0; v < vSize; v++) for (let u = 0; u < uSize; u++) {
        const a = [0, 0, 0], b = [0, 0, 0]
        a[axis] = slice - 1; b[axis] = slice
        a[uAxis] = b[uAxis] = u
        a[vAxis] = b[vAxis] = v
        const ma = slice > 0 ? sample(a) : sample(a)
        const mb = slice < axisSize ? sample(b) : sample(b)
        // At chunk boundaries, the outside sample remains global and can cull
        // the face when a neighboring chunk contains the same solid material.
        if (ma === mb) continue
        // Opaque surface meshes do not render interfaces between occupied cells.
        // Keep the legacy double-sided interface policy available for specialized callers.
        if (ma !== 0 && mb !== 0 && input.emitMaterialInterfaces === false) continue
        // A material boundary has two visible sides when both voxels are solid.
        // Keep each material's face rather than arbitrarily hiding one side.
        if (ma !== 0 && mb !== 0) {
          if (slice > 0 && slice < axisSize) {
            emit(axis, slice, uAxis, vAxis, u, v, 1, 1, { material: ma, sign: -1 })
            emit(axis, slice, uAxis, vAxis, u, v, 1, 1, { material: mb, sign: 1 })
          } else if (slice === 0) {
            emit(axis, slice, uAxis, vAxis, u, v, 1, 1, { material: mb, sign: 1 })
          } else {
            emit(axis, slice, uAxis, vAxis, u, v, 1, 1, { material: ma, sign: -1 })
          }
          continue
        }
        const visible = ma !== 0 ? { material: ma, sign: -1 as const } :
                        mb !== 0 ? { material: mb, sign: 1 as const } : null
        if (visible) mask[v * uSize + u] = visible
      }

      // Greedily merge rectangles in the 2D mask.
      for (let v = 0; v < vSize; v++) for (let u = 0; u < uSize;) {
        const face = mask[v * uSize + u]
        if (!face) { u++; continue }
        let width = 1
        while (u + width < uSize) {
          const next = mask[v * uSize + u + width]
          if (!next || next.material !== face.material || next.sign !== face.sign) break
          width++
        }
        let height = 1
        outer: while (v + height < vSize) {
          for (let k = 0; k < width; k++) {
            const next = mask[(v + height) * uSize + u + k]
            if (!next || next.material !== face.material || next.sign !== face.sign) break outer
          }
          height++
        }
        for (let dv = 0; dv < height; dv++) for (let du = 0; du < width; du++) {
          mask[(v + dv) * uSize + u + du] = null
        }
        emit(axis, slice, uAxis, vAxis, u, v, width, height, face)
        u += width
      }
    }
  }

  return { positions, normals, materialIds, indices, quadCount }
}
