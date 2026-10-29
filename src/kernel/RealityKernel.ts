import { Scheduler } from './Scheduler';
import type { System } from './System';
import type { DeterministicStepInput, KernelParameters, StepResult } from './types';
import { World } from './World';

export interface RealityKernelOptions {
  readonly seed?: number;
  readonly dt?: number;
  readonly precisionEpsilon?: number;
}

export class RealityKernel {
  readonly world: World;
  readonly scheduler = new Scheduler();

  constructor(options: RealityKernelOptions = {}) {
    this.world = new World(
      options.seed ?? 1,
      options.dt ?? 1 / 60,
      options.precisionEpsilon ?? 1e-9,
    );
  }

  get parameters(): KernelParameters {
    return this.world.parameters;
  }

  register(system: System): this {
    this.scheduler.add(system);
    return this;
  }

  unregister(systemId: string): boolean {
    return this.scheduler.remove(systemId);
  }

  step(dt = this.world.clock.dt): StepResult {
    return this.scheduler.step(this.world, dt);
  }

  deterministicInput(dt = this.world.clock.dt): DeterministicStepInput {
    return {
      stateHash: this.world.stateHash(),
      parameters: {
        ...this.parameters,
        dt,
      },
    };
  }
}
