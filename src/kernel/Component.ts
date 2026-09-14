import type { ComponentType, EntityId } from './types';

export interface Component<TState = unknown> {
  readonly type: ComponentType;
  readonly state: TState;
  readonly version: number;
}

export type ComponentFactory<TState> = (state: TState) => Component<TState>;

export function createComponent<TState>(
  type: ComponentType,
  state: TState,
  version = 0,
): Component<TState> {
  return { type, state, version };
}

export function cloneComponent<TState>(component: Component<TState>): Component<TState> {
  return {
    type: component.type,
    state: structuredClone(component.state),
    version: component.version,
  };
}

export class ComponentStore {
  private readonly components = new Map<ComponentType, Map<EntityId, Component>>();

  set(entityId: EntityId, component: Component): void {
    const bucket = this.components.get(component.type) ?? new Map<EntityId, Component>();
    bucket.set(entityId, component);
    this.components.set(component.type, bucket);
  }

  get<TState>(entityId: EntityId, type: ComponentType): Component<TState> | undefined {
    return this.components.get(type)?.get(entityId) as Component<TState> | undefined;
  }

  delete(entityId: EntityId, type: ComponentType): boolean {
    return this.components.get(type)?.delete(entityId) ?? false;
  }

  entitiesWith(type: ComponentType): readonly EntityId[] {
    return [...(this.components.get(type)?.keys() ?? [])].sort();
  }

  clearEntity(entityId: EntityId): void {
    for (const bucket of this.components.values()) {
      bucket.delete(entityId);
    }
  }

  snapshot(): ReadonlyMap<ComponentType, ReadonlyMap<EntityId, Component>> {
    const copy = new Map<ComponentType, ReadonlyMap<EntityId, Component>>();
    for (const [type, bucket] of this.components) {
      copy.set(type, new Map(bucket));
    }
    return copy;
  }
}
