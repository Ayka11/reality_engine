export type EntityId = string;
export type ComponentType = string;
export type SystemId = string;
export type EventType = string;

export type SimulationPhase =
  | 'CURRENT'
  | 'PREPARE'
  | 'COMPUTE'
  | 'VALIDATE'
  | 'COMMIT'
  | 'CAUSAL_EVENTS';

export const SIMULATION_PHASES: readonly SimulationPhase[] = [
  'CURRENT',
  'PREPARE',
  'COMPUTE',
  'VALIDATE',
  'COMMIT',
  'CAUSAL_EVENTS',
] as const;

export type ExecutablePhase = Exclude<SimulationPhase, 'CURRENT' | 'CAUSAL_EVENTS'>;

export interface KernelParameters {
  readonly dt: number;
  readonly seed: number;
  readonly precisionEpsilon: number;
}

export interface SimulationClockState {
  readonly tick: number;
  readonly time: number;
  readonly dt: number;
  readonly seed: number;
}

export interface CausalMetadata {
  readonly tick: number;
  readonly time: number;
  readonly source: string;
  readonly sequence: number;
}

export interface KernelEvent<TPayload = unknown> {
  readonly type: EventType;
  readonly payload: TPayload;
  readonly meta: CausalMetadata;
}

export interface KernelIssue {
  readonly system: SystemId;
  readonly phase: SimulationPhase;
  readonly message: string;
  readonly entityId?: EntityId;
  readonly componentType?: ComponentType;
}

export interface StepResult {
  readonly tick: number;
  readonly time: number;
  readonly dt: number;
  readonly seed: number;
  readonly events: readonly KernelEvent[];
  readonly issues: readonly KernelIssue[];
}

export interface DeterministicStepInput {
  readonly stateHash: string;
  readonly parameters: KernelParameters;
}
