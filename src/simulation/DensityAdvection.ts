import { F } from '../core/CellState';

export type DensityFieldReader = (x: number, y: number, z: number, field: number) => number;

type Direction = readonly [dx: number, dy: number, dz: number];

const DIRECTIONS: readonly Direction[] = [
  [-1, 0, 0], [1, 0, 0],
  [0, -1, 0], [0, 1, 0],
  [0, 0, -1], [0, 0, 1],
];

function inside(x: number, y: number, z: number, W: number, H: number, D: number): boolean {
  return x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D;
}

/** Density after the optional conservative six-neighbor diffusion substep. */
function densityAt(
  read: DensityFieldReader,
  x: number, y: number, z: number,
  W: number, H: number, D: number,
  dt: number, diffusion: number,
): number {
  const density = read(x, y, z, F.DENSITY);
  if (diffusion === 0 || dt === 0) return Math.max(0, Math.min(1, density));
  let laplacian = 0;
  for (const [dx, dy, dz] of DIRECTIONS) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    if (inside(nx, ny, nz, W, H, D)) {
      laplacian += read(nx, ny, nz, F.DENSITY) - density;
    }
  }
  return Math.max(0, Math.min(1, density + diffusion * dt * laplacian));
}

function axisVelocity(
  read: DensityFieldReader,
  x: number, y: number, z: number,
  dx: number, dy: number, dz: number,
): number {
  if (dx !== 0) return read(x, y, z, F.VELOCITY_X);
  if (dy !== 0) return read(x, y, z, F.VELOCITY_Y);
  return read(x, y, z, F.VELOCITY_Z);
}

function cellLimiter(
  read: DensityFieldReader,
  x: number, y: number, z: number,
  W: number, H: number, D: number,
  dt: number, diffusion: number,
): readonly [outgoing: number, incoming: number] {
  const density = densityAt(read, x, y, z, W, H, D, dt, diffusion);
  let proposedOutgoing = 0;
  let proposedIncoming = 0;
  for (const [dx, dy, dz] of DIRECTIONS) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    if (!inside(nx, ny, nz, W, H, D)) continue;
    const faceVelocity = 0.5 * (
      axisVelocity(read, x, y, z, dx, dy, dz) +
      axisVelocity(read, nx, ny, nz, dx, dy, dz)
    ) * (dx + dy + dz);
    if (faceVelocity > 0) {
      proposedOutgoing += faceVelocity * dt * density;
    } else if (faceVelocity < 0) {
      proposedIncoming += -faceVelocity * dt *
        densityAt(read, nx, ny, nz, W, H, D, dt, diffusion);
    }
  }
  const outgoingScale = proposedOutgoing > density && proposedOutgoing > 0
    ? density / proposedOutgoing : 1;
  const freeCapacity = 1 - density;
  const incomingScale = proposedIncoming > freeCapacity && proposedIncoming > 0
    ? freeCapacity / proposedIncoming : 1;
  return [outgoingScale, incomingScale];
}

/**
 * First-order finite-volume upwind transport on cell-centered velocity.
 * Each face is evaluated symmetrically by both adjacent cells. Per-cell
 * outgoing/incoming limiters guarantee 0 <= density <= 1 without losing mass.
 * World boundaries are closed (zero normal flux); chunk boundaries are not
 * boundaries because the reader addresses global coordinates.
 */
export function densityAdvectionDelta(
  read: DensityFieldReader,
  x: number, y: number, z: number,
  W: number, H: number, D: number,
  dt: number,
  diffusion = 0,
): number {
  if (!(dt > 0) || !Number.isFinite(dt)) return 0;
  const [outgoingScale, incomingScale] =
    cellLimiter(read, x, y, z, W, H, D, dt, diffusion);
  let delta = 0;
  for (const [dx, dy, dz] of DIRECTIONS) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    if (!inside(nx, ny, nz, W, H, D)) continue;
    const faceVelocity = 0.5 * (
      axisVelocity(read, x, y, z, dx, dy, dz) +
      axisVelocity(read, nx, ny, nz, dx, dy, dz)
    ) * (dx + dy + dz);
    if (faceVelocity === 0) continue;

    const neighborScales = cellLimiter(
      read, nx, ny, nz, W, H, D, dt, diffusion,
    );
    if (faceVelocity > 0) {
      const flux = faceVelocity * dt *
        densityAt(read, x, y, z, W, H, D, dt, diffusion) *
        Math.min(outgoingScale, neighborScales[1]);
      delta -= flux;
    } else {
      const flux = -faceVelocity * dt *
        densityAt(read, nx, ny, nz, W, H, D, dt, diffusion) *
        Math.min(neighborScales[0], incomingScale);
      delta += flux;
    }
  }
  return delta;
}
