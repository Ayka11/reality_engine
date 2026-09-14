import type { World } from './World';
import type { ExecutablePhase, KernelIssue, SystemId } from './types';

export interface SystemContext {
  readonly world: World;
  readonly dt: number;
  readonly seed: number;
  readonly tick: number;
  readonly time: number;
}

export interface System {
  readonly id: SystemId;
  readonly phase: ExecutablePhase;
  readonly order?: number;
  prepare?(context: SystemContext): void;
  compute?(context: SystemContext): void;
  validate?(context: SystemContext): readonly KernelIssue[];
  commit?(context: SystemContext): void;
}

export function compareSystems(a: System, b: System): number {
  const byOrder = (a.order ?? 0) - (b.order ?? 0);
  return byOrder === 0 ? a.id.localeCompare(b.id) : byOrder;
}
