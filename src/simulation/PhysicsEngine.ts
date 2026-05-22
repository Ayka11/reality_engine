import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS, F } from '../core/CellState';

export interface RigidBody {
    id: string;
    position: [number, number, number];
    velocity: [number, number, number];
    mass: number;
    radius: number;
}

/**
 * Lightweight physics engine for voxel-based collision.
 * Designed to be replaced by Ammo.js or Newton Physics WASM in the future.
 */
export class PhysicsEngine {
    private grid: VoxelGrid;
    private bodies: RigidBody[] = [];

    constructor(grid: VoxelGrid) {
        this.grid = grid;
    }

    addBody(body: RigidBody): void {
        this.bodies.push(body);
    }

    step(dt: number): void {
        for (const body of this.bodies) {
            // Apply gravity
            body.velocity[2] -= 9.8 * dt;

            // Euler integration
            body.position[0] += body.velocity[0] * dt;
            body.position[1] += body.velocity[1] * dt;
            body.position[2] += body.velocity[2] * dt;

            // Voxel collision
            this.handleGridCollision(body);
        }
    }

    private handleGridCollision(body: RigidBody): void {
        const gx = Math.floor(body.position[0]);
        const gy = Math.floor(body.position[1]);
        const gz = Math.floor(body.position[2]);

        if (this.grid.inBounds(gx, gy, gz)) {
            const cell = this.grid.cell(gx, gy, gz);
            // If cell is dense (solid), bounce
            if (cell.density > 0.5) {
                body.position[2] = gz + 1.001;
                body.velocity[2] *= -0.3; // bounce damping
                body.velocity[0] *= 0.9;  // friction
                body.velocity[1] *= 0.9;
            }
        } else if (body.position[2] < 0) {
            // Floor collision
            body.position[2] = 0;
            body.velocity[2] *= -0.2;
        }
    }

    getBodies(): RigidBody[] {
        return this.bodies;
    }
}
