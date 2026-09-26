import { ComponentStore, type Component } from './Component';
import { Entity } from './Entity';
import { EventBus } from './EventBus';
import { SimulationClock } from './SimulationClock';
import type { ComponentType, EntityId, KernelParameters, SimulationPhase } from './types';

interface ComponentMutation {
  readonly entityId: EntityId;
  readonly component: Component;
}

export class World {
  readonly clock: SimulationClock;
  readonly events = new EventBus();

  private readonly entities = new Map<EntityId, Entity>();
  private readonly componentStore = new ComponentStore();
  private readonly stagedComponents: ComponentMutation[] = [];
  private readonly stagedDeletes: Array<readonly [EntityId, ComponentType]> = [];
  private currentPhase: SimulationPhase = 'CURRENT';
  private entitySequence = 0;

  constructor(seed = 1, dt = 1 / 60, readonly precisionEpsilon = 1e-9) {
    this.clock = new SimulationClock(seed, dt);
  }

  get phase(): SimulationPhase {
    return this.currentPhase;
  }

  get parameters(): KernelParameters {
    return {
      dt: this.clock.dt,
      seed: this.clock.seed,
      precisionEpsilon: this.precisionEpsilon,
    };
  }

  createEntity(id = this.nextEntityId()): Entity {
    const existing = this.entities.get(id);
    if (existing) return existing;
    const entity = new Entity(id);
    this.entities.set(id, entity);
    return entity;
  }

  getEntity(id: EntityId): Entity | undefined {
    return this.entities.get(id);
  }

  removeEntity(id: EntityId): boolean {
    const deleted = this.entities.delete(id);
    this.componentStore.clearEntity(id);
    return deleted;
  }

  entitiesWith(componentType: ComponentType): readonly Entity[] {
    return this.componentStore
      .entitiesWith(componentType)
      .map(id => this.entities.get(id))
      .filter((entity): entity is Entity => entity !== undefined);
  }

  setComponent(entityId: EntityId, component: Component): void {
    const entity = this.createEntity(entityId);
    entity.add(component);
    this.componentStore.set(entityId, component);
  }

  stageComponent(entityId: EntityId, component: Component): void {
    this.stagedComponents.push({ entityId, component });
  }

  getComponent<TState>(entityId: EntityId, type: ComponentType): Component<TState> | undefined {
    for (let i = this.stagedComponents.length - 1; i >= 0; i -= 1) {
      const mutation = this.stagedComponents[i];
      if (mutation.entityId === entityId && mutation.component.type === type) {
        return mutation.component as Component<TState>;
      }
    }
    return this.componentStore.get<TState>(entityId, type);
  }

  stageRemoveComponent(entityId: EntityId, type: ComponentType): void {
    this.stagedDeletes.push([entityId, type]);
  }

  emit<TPayload>(type: string, payload: TPayload, source: string): void {
    this.events.emit(type, payload, source, this.clock.state());
  }

  beginStep(dt: number): void {
    this.clock.setDt(dt);
    this.stagedComponents.length = 0;
    this.stagedDeletes.length = 0;
    this.currentPhase = 'CURRENT';
  }

  enterPhase(phase: SimulationPhase): void {
    this.currentPhase = phase;
  }

  commit(): void {
    for (const [entityId, type] of this.stagedDeletes) {
      this.entities.get(entityId)?.remove(type);
      this.componentStore.delete(entityId, type);
    }
    for (const mutation of this.stagedComponents) {
      this.setComponent(mutation.entityId, mutation.component);
    }
    this.stagedDeletes.length = 0;
    this.stagedComponents.length = 0;
  }

  endStep(): ReturnType<SimulationClock['state']> {
    this.currentPhase = 'CURRENT';
    return this.clock.advance();
  }

  stateHash(): string {
    const rows = [...this.entities.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(entity => JSON.stringify(entity.snapshot()));
    return rows.join('|');
  }

  clear(): void {
    this.entities.clear();
    this.stagedComponents.length = 0;
    this.stagedDeletes.length = 0;
    this.events.clear();
    this.clock.reset();
    this.currentPhase = 'CURRENT';
  }

  private nextEntityId(): EntityId {
    this.entitySequence += 1;
    return `entity:${this.entitySequence}`;
  }
}
