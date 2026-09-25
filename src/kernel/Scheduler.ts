import type { World } from './World';
import { compareSystems, type System, type SystemContext } from './System';
import type { ExecutablePhase, KernelIssue, StepResult } from './types';

const EXECUTION_ORDER: readonly ExecutablePhase[] = [
  'PREPARE',
  'COMPUTE',
  'VALIDATE',
  'COMMIT',
] as const;

export class Scheduler {
  private readonly systems = new Map<ExecutablePhase, System[]>();

  add(system: System): void {
    const bucket = this.systems.get(system.phase) ?? [];
    bucket.push(system);
    bucket.sort(compareSystems);
    this.systems.set(system.phase, bucket);
  }

  remove(id: string): boolean {
    let removed = false;
    for (const [phase, bucket] of this.systems) {
      const next = bucket.filter(system => system.id !== id);
      removed = removed || next.length !== bucket.length;
      this.systems.set(phase, next);
    }
    return removed;
  }

  list(): readonly System[] {
    return EXECUTION_ORDER.flatMap(phase => this.systems.get(phase) ?? []);
  }

  step(world: World, dt = world.clock.dt): StepResult {
    world.beginStep(dt);
    const issues: KernelIssue[] = [];

    for (const phase of EXECUTION_ORDER) {
      world.enterPhase(phase);
      const context = this.createContext(world, dt);
      for (const system of this.systems.get(phase) ?? []) {
        if (phase === 'PREPARE') system.prepare?.(context);
        if (phase === 'COMPUTE') system.compute?.(context);
        if (phase === 'VALIDATE') issues.push(...(system.validate?.(context) ?? []));
        if (phase === 'COMMIT') system.commit?.(context);
      }
      if (phase === 'COMMIT') world.commit();
    }

    world.enterPhase('CAUSAL_EVENTS');
    const events = world.events.flush();
    const clock = world.endStep();
    return {
      tick: clock.tick,
      time: clock.time,
      dt: clock.dt,
      seed: clock.seed,
      events,
      issues,
    };
  }

  private createContext(world: World, dt: number): SystemContext {
    const clock = world.clock.state();
    return {
      world,
      dt,
      seed: clock.seed,
      tick: clock.tick,
      time: clock.time,
    };
  }
}
