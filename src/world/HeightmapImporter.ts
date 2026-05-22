import { VoxelGrid } from '../core/VoxelGrid';
import { F } from '../core/CellState';
import { MAT } from '../materials/MaterialDef';

export interface ImportOptions {
    heightScale?: number;
    baseAltitude?: number;
    materialMapping?: Record<number, number>; // grayscale value range -> materialId
}

export class HeightmapImporter {
    /**
     * Imports a heightmap from a Float32Array (normalized 0-1 values).
     * The array should be of size W * H.
     */
    static importGrayscale(
        grid: VoxelGrid,
        data: Float32Array,
        width: number,
        height: number,
        options: ImportOptions = {}
    ): void {
        const { W, H, D } = grid;
        const hScale = options.heightScale ?? D;
        const baseAlt = options.baseAltitude ?? 0;

        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                // Resample heightmap data to grid size
                const sx = Math.floor((x / W) * width);
                const sy = Math.floor((y / H) * height);
                const hVal = data[sy * width + sx];

                const targetZ = Math.min(D - 1, Math.floor(hVal * hScale + baseAlt));

                for (let z = 0; z <= targetZ; z++) {
                    const cell = grid.cell(x, y, z);
                    cell.density = 0.8 + (targetZ - z) / targetZ * 0.2;
                    cell.materialId = z < targetZ * 0.8 ? MAT.STONE : MAT.SAND;
                    cell.temperature = 50 + (1 - z/D) * 100;
                    cell.energy = 20;
                }
            }
        }
    }

    /**
     * Imports a heightmap and a weightmap (for materials).
     */
    static importWithWeights(
        grid: VoxelGrid,
        heightData: Float32Array,
        weightData: Float32Array, // 0-1 values for material distribution
        width: number,
        height: number,
        options: ImportOptions = {}
    ): void {
        const { W, H, D } = grid;
        const hScale = options.heightScale ?? D;

        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const sx = Math.floor((x / W) * width);
                const sy = Math.floor((y / H) * height);
                const hVal = heightData[sy * width + sx];
                const wVal = weightData[sy * width + sx];

                const targetZ = Math.min(D - 1, Math.floor(hVal * hScale));

                for (let z = 0; z <= targetZ; z++) {
                    const cell = grid.cell(x, y, z);
                    cell.density = 0.9;

                    // Simple weight mapping: if weight > 0.5, use grass (biomass), else stone
                    if (z === targetZ) {
                        cell.materialId = wVal > 0.5 ? MAT.BIOMASS : MAT.STONE;
                        if (wVal > 0.5) cell.bioPotential = 0.8;
                    } else {
                        cell.materialId = MAT.STONE;
                    }
                }
            }
        }
    }
}
