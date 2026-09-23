/**
 * Reality Engine — Infinity Scale v2.0
 *
 * Logical planetary-scale coordinate space with bounded local residency.
 * This layer intentionally does NOT allocate a 512×512×256 dense world.
 * It plans/reserves chunks around an observer and exposes LOD/AMR metadata.
 */

export type Vec3i = { x: number; y: number; z: number };
export type ChunkState = "unloaded" | "cached" | "background" | "simulating" | "visible";

export interface ChunkKey {
  x: number; y: number; z: number; level: number;
}

export interface InfinityScaleConfigV2 {
  chunkSize: number;
  logicalExtentCells: Vec3i;
  activeWindowCells: Vec3i;
  activeRadiusChunks: Vec3i;
  backgroundRadiusChunks: Vec3i;
  visibleRadiusChunks: Vec3i;
  maxSimulatingChunks: number;
  maxResidentChunks: number;
  lodLevels: number;
  amrLevels: number;
  maxCoordinate: number;
}

export const DEFAULT_INFINITY_SCALE_V2: InfinityScaleConfigV2 = {
  chunkSize: 32,
  logicalExtentCells: { x: 512, y: 512, z: 256 },
  activeWindowCells: { x: 512, y: 512, z: 256 },
  activeRadiusChunks: { x: 2, y: 2, z: 1 },       // 5×5×3 = 75
  backgroundRadiusChunks: { x: 4, y: 4, z: 2 },   // 9×9×5 = 405
  visibleRadiusChunks: { x: 5, y: 5, z: 2 },      // 11×11×5 = 605
  maxSimulatingChunks: 75,
  maxResidentChunks: 512,
  lodLevels: 4,
  amrLevels: 3,
  maxCoordinate: Number.MAX_SAFE_INTEGER,
};

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}
function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

export function cellToChunk(g: number, chunkSize = 32): [number, number] {
  return [floorDiv(g, chunkSize), mod(g, chunkSize)];
}

export function chunkKeyString(k: ChunkKey): string {
  return `${k.level}:${k.x},${k.y},${k.z}`;
}

export function chunkCenter(k: ChunkKey, chunkSize = 32): Vec3i {
  const s = chunkSize * (2 ** k.level);
  return {
    x: k.x * s + Math.floor(s / 2),
    y: k.y * s + Math.floor(s / 2),
    z: k.z * s + Math.floor(s / 2),
  };
}

export class InfinityScaleV2 {
  readonly config: InfinityScaleConfigV2;
  private observer: Vec3i = { x: 0, y: 0, z: 0 };
  private states = new Map<string, ChunkState>();
  private pinned = new Set<string>();
  private touched = new Map<string, number>();

  constructor(config: Partial<InfinityScaleConfigV2> = {}) {
    this.config = { ...DEFAULT_INFINITY_SCALE_V2, ...config };
    if (this.config.chunkSize !== 32) {
      throw new Error("Infinity Scale v2 requires chunkSize=32 for the reference implementation.");
    }
    if (this.config.lodLevels < 1 || this.config.amrLevels < 1) {
      throw new Error("lodLevels and amrLevels must be >= 1.");
    }
  }

  setObserver(cell: Vec3i): void {
    this.assertCoordinate(cell);
    this.observer = { ...cell };
    this.replan();
  }

  getObserver(): Vec3i { return { ...this.observer }; }

  replan(): void {
    const [cx] = cellToChunk(this.observer.x, this.config.chunkSize);
    const [cy] = cellToChunk(this.observer.y, this.config.chunkSize);
    const [cz] = cellToChunk(this.observer.z, this.config.chunkSize);

    const visible = new Set<string>();
    const background = new Set<string>();
    const simulating = new Set<string>();

    for (let z = -this.config.visibleRadiusChunks.z; z <= this.config.visibleRadiusChunks.z; z++)
      for (let y = -this.config.visibleRadiusChunks.y; y <= this.config.visibleRadiusChunks.y; y++)
        for (let x = -this.config.visibleRadiusChunks.x; x <= this.config.visibleRadiusChunks.x; x++) {
          const k: ChunkKey = { x: cx + x, y: cy + y, z: cz + z, level: 0 };
          const key = chunkKeyString(k);
          visible.add(key);
          if (
            Math.abs(x) <= this.config.backgroundRadiusChunks.x &&
            Math.abs(y) <= this.config.backgroundRadiusChunks.y &&
            Math.abs(z) <= this.config.backgroundRadiusChunks.z
          ) background.add(key);
          if (
            Math.abs(x) <= this.config.activeRadiusChunks.x &&
            Math.abs(y) <= this.config.activeRadiusChunks.y &&
            Math.abs(z) <= this.config.activeRadiusChunks.z
          ) simulating.add(key);
        }

    // Establish semantic priority first: simulation > background > visible.
    // The visible radius can describe more chunks than the hard resident cap,
    // so only the nearest visible candidates are admitted when necessary.
    for (const key of visible) this.states.set(key, "visible");
    for (const key of background) this.states.set(key, "background");
    for (const key of simulating) this.states.set(key, "simulating");

    for (const key of [...this.states.keys()]) {
      if (!visible.has(key) && !this.pinned.has(key)) this.states.set(key, "cached");
    }
    this.enforceResidentBudget(cx, cy, cz, simulating, background, visible);
  }

  touch(k: ChunkKey): void {
    const key = chunkKeyString(k);
    this.touched.set(key, Date.now());
    if (!this.states.has(key)) this.states.set(key, "cached");
  }

  pin(k: ChunkKey): void {
    const key = chunkKeyString(k);
    this.pinned.add(key);
    this.states.set(key, "cached");
    this.touch(k);
  }

  unpin(k: ChunkKey): void {
    this.pinned.delete(chunkKeyString(k));
  }

  state(k: ChunkKey): ChunkState {
    return this.states.get(chunkKeyString(k)) ?? "unloaded";
  }

  selectLOD(distanceChunks: number): number {
    if (distanceChunks <= 1) return 0;
    if (distanceChunks <= 2) return Math.min(1, this.config.lodLevels - 1);
    if (distanceChunks <= 4) return Math.min(2, this.config.lodLevels - 1);
    return this.config.lodLevels - 1;
  }

  selectAMRFromGradient(gradientNorm: number): number {
    const score = Math.abs(gradientNorm);
    if (score > 1.0) return Math.min(2, this.config.amrLevels - 1);
    if (score > 0.1) return Math.min(1, this.config.amrLevels - 1);
    return 0;
  }

  selectAMR(gradientNorm: number, residual: number): number {
    const score = Math.max(Math.abs(gradientNorm), Math.abs(residual));
    if (score > 1.0) return Math.min(2, this.config.amrLevels - 1);
    if (score > 0.1) return Math.min(1, this.config.amrLevels - 1);
    return 0;
  }

  telemetry() {
    let visible = 0, background = 0, simulating = 0, cached = 0;
    for (const s of this.states.values()) {
      if (s === "visible") visible++;
      else if (s === "background") background++;
      else if (s === "simulating") simulating++;
      else if (s === "cached") cached++;
    }
    return {
      observer: this.getObserver(),
      residentChunks: this.states.size,
      visibleChunks: visible,
      backgroundChunks: background,
      simulatingChunks: simulating,
      cachedChunks: cached,
      logicalExtentCells: { ...this.config.logicalExtentCells },
      activeWindowCells: { ...this.config.activeWindowCells },
      chunkSize: this.config.chunkSize,
      lodLevels: this.config.lodLevels,
      amrLevels: this.config.amrLevels,
    };
  }

  private enforceResidentBudget(
    observerX: number,
    observerY: number,
    observerZ: number,
    simulating: Set<string>,
    background: Set<string>,
    visible: Set<string>,
  ): void {
    if (this.states.size <= this.config.maxResidentChunks) return;

    const mandatory = new Set<string>([
      ...simulating,
      ...background,
      ...[...this.pinned],
    ]);

    // A configuration with a resident cap below its simulation/background
    // envelope cannot satisfy both constraints. Keep mandatory chunks rather
    // than silently evicting active simulation state.
    const optionalVisible = [...visible]
      .filter(key => !mandatory.has(key))
      .map(key => {
        const coords = key.slice(key.indexOf(":") + 1);
        const [x, y, z] = coords.split(",").map(Number);
        const dx = x - observerX;
        const dy = y - observerY;
        const dz = z - observerZ;
        return { key, distance: dx * dx + dy * dy + dz * dz };
      })
      .sort((a, b) => a.distance - b.distance);

    const available = Math.max(0, this.config.maxResidentChunks - mandatory.size);
    const keepVisible = new Set(optionalVisible.slice(0, available).map(v => v.key));

    for (const key of [...this.states.keys()]) {
      if (mandatory.has(key)) continue;
      if (visible.has(key) && keepVisible.has(key)) continue;
      this.states.set(key, "cached");
    }

    const removable = [...this.states.entries()]
      .filter(([key]) =>
        !this.pinned.has(key) &&
        !mandatory.has(key) &&
        !keepVisible.has(key),
      )
      .sort((a, b) => (this.touched.get(a[0]) ?? 0) - (this.touched.get(b[0]) ?? 0));

    while (this.states.size > this.config.maxResidentChunks && removable.length) {
      const [key] = removable.shift()!;
      this.states.delete(key);
      this.touched.delete(key);
    }
  }

  private assertCoordinate(v: Vec3i): void {
    for (const n of [v.x, v.y, v.z]) {
      if (!Number.isSafeInteger(n) || Math.abs(n) > this.config.maxCoordinate) {
        throw new RangeError("Global coordinate must be a safe integer.");
      }
    }
  }
}
