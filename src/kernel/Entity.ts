import type { Component } from './Component';
import type { ComponentType, EntityId } from './types';

export interface EntitySnapshot {
  readonly id: EntityId;
  readonly components: readonly Component[];
}

export class Entity {
  private readonly components = new Map<ComponentType, Component>();

  constructor(readonly id: EntityId) {}

  add(component: Component): this {
    this.components.set(component.type, component);
    return this;
  }

  get<TState>(type: ComponentType): Component<TState> | undefined {
    return this.components.get(type) as Component<TState> | undefined;
  }

  has(type: ComponentType): boolean {
    return this.components.has(type);
  }

  remove(type: ComponentType): boolean {
    return this.components.delete(type);
  }

  componentTypes(): readonly ComponentType[] {
    return [...this.components.keys()].sort();
  }

  snapshot(): EntitySnapshot {
    return {
      id: this.id,
      components: [...this.components.values()].sort((a, b) => a.type.localeCompare(b.type)),
    };
  }
}
