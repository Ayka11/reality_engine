import type { EventType, KernelEvent, SimulationClockState } from './types';

export type EventHandler<TPayload = unknown> = (event: KernelEvent<TPayload>) => void;

export class EventBus {
  private readonly handlers = new Map<EventType, Set<EventHandler>>();
  private readonly pending: KernelEvent[] = [];
  private sequence = 0;

  on<TPayload>(type: EventType, handler: EventHandler<TPayload>): () => void {
    const bucket = this.handlers.get(type) ?? new Set<EventHandler>();
    bucket.add(handler as EventHandler);
    this.handlers.set(type, bucket);
    return () => this.off(type, handler);
  }

  off<TPayload>(type: EventType, handler: EventHandler<TPayload>): void {
    this.handlers.get(type)?.delete(handler as EventHandler);
  }

  emit<TPayload>(
    type: EventType,
    payload: TPayload,
    source: string,
    clock: SimulationClockState,
  ): KernelEvent<TPayload> {
    const event: KernelEvent<TPayload> = {
      type,
      payload,
      meta: {
        tick: clock.tick,
        time: clock.time,
        source,
        sequence: this.sequence,
      },
    };
    this.sequence += 1;
    this.pending.push(event);
    return event;
  }

  flush(): readonly KernelEvent[] {
    const events = this.pending.splice(0);
    for (const event of events) {
      const handlers = this.handlers.get(event.type);
      if (!handlers) continue;
      for (const handler of handlers) {
        handler(event);
      }
    }
    return events;
  }

  clear(): void {
    this.pending.length = 0;
    this.sequence = 0;
  }
}
