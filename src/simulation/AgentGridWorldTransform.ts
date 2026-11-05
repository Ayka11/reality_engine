/**
 * Explicit affine transform between the finite agent voxel grid and Infinite World.
 *
 * The origin is the world-space center of grid cell (0, 0, 0). Each basis
 * vector is the world-space displacement produced by advancing one cell along
 * the corresponding grid axis. No axis orientation or world scale is assumed.
 */
export type AgentGridCoordinates = {
  x: number
  y: number
  z: number
}

export type AgentGridDimensions = {
  width: number
  height: number
  depth: number
}

export type AgentGridWorldTransform = {
  schemaVersion: 'agent-grid-world-transform-v1'
  gridDimensions: AgentGridDimensions
  worldOrigin: AgentGridCoordinates
  gridBasis: {
    x: AgentGridCoordinates
    y: AgentGridCoordinates
    z: AgentGridCoordinates
  }
}

export type AgentGridWorldTransformValidation = {
  valid: boolean
  errors: string[]
  transform: AgentGridWorldTransform | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isVector(value: unknown): value is AgentGridCoordinates {
  if (!isRecord(value)) return false
  return ['x', 'y', 'z'].every(key =>
    typeof value[key] === 'number' && Number.isFinite(value[key]))
}

function dot(a: AgentGridCoordinates, b: AgentGridCoordinates): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function cross(a: AgentGridCoordinates, b: AgentGridCoordinates): AgentGridCoordinates {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function subtract(a: AgentGridCoordinates, b: AgentGridCoordinates): AgentGridCoordinates {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function norm(value: AgentGridCoordinates): number {
  return Math.hypot(value.x, value.y, value.z)
}

function assertFinitePosition(position: AgentGridCoordinates, label: string): void {
  if (!isVector(position)) throw new TypeError(`${label} must contain finite x, y and z coordinates`)
}

function determinant(transform: AgentGridWorldTransform): number {
  const { x, y, z } = transform.gridBasis
  return dot(x, cross(y, z))
}

/** Validate and detach an untrusted transform configuration. */
export function validateAgentGridWorldTransform(
  value: unknown,
): AgentGridWorldTransformValidation {
  const errors: string[] = []
  if (!isRecord(value)) {
    return { valid: false, errors: ['Agent grid/world transform must be an object'], transform: null }
  }

  if (value.schemaVersion !== 'agent-grid-world-transform-v1') {
    errors.push('Unsupported agent grid/world transform schemaVersion')
  }

  const dimensions = value.gridDimensions
  if (!isRecord(dimensions) ||
      !Number.isSafeInteger(dimensions.width) || (dimensions.width as number) <= 0 ||
      !Number.isSafeInteger(dimensions.height) || (dimensions.height as number) <= 0 ||
      !Number.isSafeInteger(dimensions.depth) || (dimensions.depth as number) <= 0) {
    errors.push('Agent grid/world transform dimensions must be positive safe integers')
  }

  if (!isVector(value.worldOrigin)) {
    errors.push('Agent grid/world transform worldOrigin is invalid')
  }

  const basis = value.gridBasis
  if (!isRecord(basis) ||
      !isVector(basis.x) || !isVector(basis.y) || !isVector(basis.z)) {
    errors.push('Agent grid/world transform requires three finite basis vectors')
  }

  if (errors.length > 0) return { valid: false, errors, transform: null }

  const candidate: AgentGridWorldTransform = {
    schemaVersion: 'agent-grid-world-transform-v1',
    gridDimensions: {
      width: (dimensions as Record<string, number>).width,
      height: (dimensions as Record<string, number>).height,
      depth: (dimensions as Record<string, number>).depth,
    },
    worldOrigin: { ...(value.worldOrigin as AgentGridCoordinates) },
    gridBasis: {
      x: { ...(basis as Record<string, AgentGridCoordinates>).x },
      y: { ...(basis as Record<string, AgentGridCoordinates>).y },
      z: { ...(basis as Record<string, AgentGridCoordinates>).z },
    },
  }

  const { x, y, z } = candidate.gridBasis
  const scaleProduct = norm(x) * norm(y) * norm(z)
  const relativeDeterminant = Math.abs(determinant(candidate)) / scaleProduct
  if (![norm(x), norm(y), norm(z), scaleProduct, relativeDeterminant].every(Number.isFinite) ||
      Math.min(norm(x), norm(y), norm(z)) <= 1e-9 ||
      Math.max(norm(x), norm(y), norm(z)) > 1_000_000 ||
      relativeDeterminant <= 1e-8) {
    return {
      valid: false,
      errors: ['Agent grid/world transform basis must be finite, bounded and non-degenerate'],
      transform: null,
    }
  }

  return { valid: true, errors: [], transform: candidate }
}

function assertValidTransform(value: AgentGridWorldTransform): void {
  const validation = validateAgentGridWorldTransform(value)
  if (!validation.valid || !validation.transform) {
    throw new TypeError(`Invalid agent grid/world transform: ${validation.errors.join('; ')}`)
  }
}

/** Map continuous grid coordinates to world coordinates using the configured basis. */
export function agentGridToWorld(
  transform: AgentGridWorldTransform,
  grid: AgentGridCoordinates,
): AgentGridCoordinates {
  assertValidTransform(transform)
  assertFinitePosition(grid, 'Grid position')
  const { width, height, depth } = transform.gridDimensions
  if (grid.x < 0 || grid.x > width - 1 ||
      grid.y < 0 || grid.y > height - 1 ||
      grid.z < 0 || grid.z > depth - 1) {
    throw new RangeError('Grid position is outside the configured agent grid')
  }

  const { x, y, z } = transform.gridBasis
  return {
    x: transform.worldOrigin.x + x.x * grid.x + y.x * grid.y + z.x * grid.z,
    y: transform.worldOrigin.y + x.y * grid.x + y.y * grid.y + z.y * grid.z,
    z: transform.worldOrigin.z + x.z * grid.x + y.z * grid.y + z.z * grid.z,
  }
}

/** Invert world coordinates back to continuous grid coordinates. */
export function agentWorldToGrid(
  transform: AgentGridWorldTransform,
  world: AgentGridCoordinates,
): AgentGridCoordinates {
  assertValidTransform(transform)
  assertFinitePosition(world, 'World position')
  const delta = subtract(world, transform.worldOrigin)
  const { x, y, z } = transform.gridBasis
  const det = determinant(transform)
  return {
    x: dot(delta, cross(y, z)) / det,
    y: dot(delta, cross(z, x)) / det,
    z: dot(delta, cross(x, y)) / det,
  }
}

/** Resolve a world position to the nearest in-bounds agent cell, or null. */
export function agentWorldToGridCell(
  transform: AgentGridWorldTransform,
  world: AgentGridCoordinates,
): { x: number; y: number; z: number } | null {
  const grid = agentWorldToGrid(transform, world)
  const cell = { x: Math.round(grid.x), y: Math.round(grid.y), z: Math.round(grid.z) }
  const { width, height, depth } = transform.gridDimensions
  if (cell.x < 0 || cell.x >= width ||
      cell.y < 0 || cell.y >= height ||
      cell.z < 0 || cell.z >= depth) return null
  return cell
}
