import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS, F } from '../core/CellState';

// Information physics treats the INFORMATION field as a physical quantity with:
// - Coherence: information clusters resist entropy when signals align
// - Decay: information degrades toward max-entropy equilibrium
// - Memory (MEM_FIELD): long-lived imprint of peak information states
// - Resonance: neighboring cells with similar info amplify each other

export class InfoPhysics {
  tick(grid: VoxelGrid, dt: number): void {
    const { W, H, D, buffer: buf } = grid;
    const WH = W * H;
    const dtN = dt * 60; // normalized to 60 fps

    for (let z = 0; z < D; z++)
    for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i    = z * WH + y * W + x;
      const base = i * CELL_FIELDS;

      const info    = buf[base + F.INFORMATION];
      const entropy = buf[base + F.ENTROPY];
      const energy  = buf[base + F.ENERGY];
      const signal  = buf[base + F.SIGNAL];
      const mem     = buf[base + F.MEM_FIELD];

      if (info < 0.5 && mem < 0.001) continue;

      // ── Information decay toward entropy-driven equilibrium ───────────────
      const decayRate = 0.004 * entropy * dtN;
      buf[base + F.INFORMATION] = Math.max(0, info - decayRate * info);

      // ── Coherence: signal boosts information stability ────────────────────
      // When signal is present, information decays slower and amplifies
      if (signal > 5) {
        const coherence = Math.min(1, signal / 100);
        buf[base + F.INFORMATION] = Math.min(999,
          buf[base + F.INFORMATION] + coherence * 0.8 * dtN);
      }

      // ── Memory imprint: when info peaks, leave a trace in MEM_FIELD ──────
      if (info > 200) {
        const imprint = (info / 999) * 0.02 * dtN;
        buf[base + F.MEM_FIELD] = Math.min(1, mem + imprint);
      } else {
        // Memory fades slowly
        buf[base + F.MEM_FIELD] = Math.max(0, mem - 0.001 * dtN);
      }

      // ── Resonance: check neighbors for similar info levels ────────────────
      let resonanceSum = 0, resonanceCount = 0;
      const neighbors = [
        x > 0   ? (i-1)   : -1,
        x < W-1 ? (i+1)   : -1,
        y > 0   ? (i-W)   : -1,
        y < H-1 ? (i+W)   : -1,
        z > 0   ? (i-WH)  : -1,
        z < D-1 ? (i+WH)  : -1,
      ];
      for (const ni of neighbors) {
        if (ni < 0) continue;
        const nInfo = buf[ni * CELL_FIELDS + F.INFORMATION];
        if (Math.abs(nInfo - info) < info * 0.3) {
          resonanceSum += nInfo;
          resonanceCount++;
        }
      }

      if (resonanceCount >= 3) {
        // Resonance: information cluster amplifies itself
        const boost = (resonanceSum / resonanceCount / 999) * 1.5 * dtN;
        buf[base + F.INFORMATION] = Math.min(999, buf[base + F.INFORMATION] + boost);
        // Also slightly suppress entropy in resonating cells
        buf[base + F.ENTROPY] = Math.max(0, entropy - 0.001 * dtN);
      }

      // ── Information → energy pathway: very high info radiates energy ──────
      if (info > 700) {
        buf[base + F.ENERGY] = Math.min(9999, energy + (info - 700) / 999 * 2 * dtN);
        buf[base + F.INFORMATION] = Math.max(0, buf[base + F.INFORMATION] - 0.5 * dtN);
      }
    }
  }
}
