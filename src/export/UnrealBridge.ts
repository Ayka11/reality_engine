import { VoxelGrid } from '../core/VoxelGrid';
import { F, CELL_FIELDS } from '../core/CellState';

export class UnrealBridge {
  constructor(private grid: VoxelGrid) {}

  exportUSD(threshold = 10): string {
    const { W, H, D, buffer: buf } = this.grid;
    const pts: string[] = [];
    const energies: number[] = [];

    for (let z = 0; z < D; z++)
    for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = (z * H * W + y * W + x) * CELL_FIELDS;
      const e = buf[o + F.ENERGY];
      if (e < threshold) continue;
      pts.push(`(${x * 100}, ${y * 100}, ${z * 100})`);
      energies.push(parseFloat(e.toFixed(2)));
    }

    const now = new Date().toISOString();
    return `#usda 1.0
(
    defaultPrim = "RealityEngine"
    upAxis = "Z"
    doc = "Reality Engine v3 Export — ${now}"
)

def Xform "RealityEngine"
{
    def Points "VoxelCloud"
    {
        point3f[] points = [${pts.join(', ')}]
        float[] primvars:energy = [${energies.join(', ')}]
            (
                interpolation = "vertex"
            )
    }
}
`;
  }

  exportLiveLink(): object {
    const { W, H, D, buffer: buf } = this.grid;
    let totalEnergy = 0, sumBio = 0, sumInfo = 0;
    const n = W * H * D;
    const hotspots: Array<{ x: number; y: number; z: number; energy: number }> = [];

    for (let z = 0; z < D; z++)
    for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = (z * H * W + y * W + x) * CELL_FIELDS;
      const e = buf[o + F.ENERGY];
      totalEnergy += e;
      sumBio  += buf[o + F.BIO_POTENTIAL];
      sumInfo += buf[o + F.INFORMATION];
      if (e > 500 && hotspots.length < 32) hotspots.push({ x, y, z, energy: Math.round(e) });
    }

    return {
      source: 'RealityEngine_v3',
      timestamp: Date.now(),
      grid: { W, H, D },
      metrics: {
        totalEnergy: Math.round(totalEnergy),
        avgBio:      parseFloat((sumBio / n).toFixed(4)),
        avgInfo:     parseFloat((sumInfo / n).toFixed(4)),
      },
      hotspots,
    };
  }

  downloadUSD(threshold = 10): void {
    const blob = new Blob([this.exportUSD(threshold)], { type: 'text/plain' });
    _dl(blob, `reality_world_${Date.now()}.usda`);
  }

  downloadLiveLink(): void {
    const blob = new Blob([JSON.stringify(this.exportLiveLink(), null, 2)], { type: 'application/json' });
    _dl(blob, `reality_livelink_${Date.now()}.json`);
  }

  static getInstructions(): string {
    return [
      'Unreal Engine Integration:',
      '1. USD  — File → Import → select .usda → import as Point Cloud or Static Mesh',
      '2. LiveLink JSON — place in Content folder, use Blueprint Parse JSON node to read fields',
      '3. For real-time bridge enable the UE LiveLink plugin and poll the exported JSON',
    ].join('\n');
  }
}

function _dl(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}
