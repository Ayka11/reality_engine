import type { SimulationEngine } from "./SimulationEngine";
import type { EntityLayer } from "./EntityLayer";
import type { AgentSystem } from "./AgentSystem";

/**
 * Browser-facing diagnostics view. The simulation engine remains the owner of
 * its GPU backend; exposing that backend would let page code upload or dispatch
 * device state outside the engine's revision/readback transaction.
 */
export type EntityLayerDiagnosticsView = Readonly<Pick<
  EntityLayer,
  "snapshot" | "getEntities" | "extinctCount" | "totalSpawned" | "mutationStrength"
>>;

export type AgentSystemDiagnosticsView = Readonly<Pick<
  AgentSystem,
  "snapshot" | "getAgents" | "agentMarkers" | "snapshotRandomState"
>> & Readonly<{ maxAgents: number }>;

export type SimulationEngineDebugView = Omit<
  SimulationEngine,
  "gpu" | "entityLayer" | "agents" |
  "restoreEntityLayerSnapshot" | "restoreAgentSystemSnapshot"
> & {
  readonly gpu: Readonly<{ isAvailable: boolean }>;
  readonly entityLayer: EntityLayerDiagnosticsView;
  readonly agents: AgentSystemDiagnosticsView;
};

export function createSimulationEngineDebugView(
  engine: SimulationEngine,
): SimulationEngineDebugView {
  const gpuDiagnostics = Object.freeze({
    get isAvailable(): boolean {
      return engine.gpu.isAvailable;
    },
  });
  const entityLayerDiagnostics: EntityLayerDiagnosticsView = Object.freeze({
    get mutationStrength(): number {
      return engine.entityLayer.mutationStrength;
    },
    get extinctCount(): number {
      return engine.entityLayer.extinctCount;
    },
    get totalSpawned(): number {
      return engine.entityLayer.totalSpawned;
    },
    snapshot: () => engine.entityLayer.snapshot(),
    getEntities: () => engine.entityLayer.getEntities(),
  });
  const agentSystemDiagnostics: AgentSystemDiagnosticsView = Object.freeze({
    get maxAgents(): number {
      return engine.agents.maxAgents;
    },
    snapshot: () => engine.agents.snapshot(),
    getAgents: () => engine.agents.getAgents(),
    agentMarkers: () => engine.agents.agentMarkers(),
    snapshotRandomState: () => engine.agents.snapshotRandomState(),
  });

  return new Proxy(engine, {
    get(target, property) {
      if (property === "gpu") return gpuDiagnostics;
      if (property === "entityLayer") return entityLayerDiagnostics;
      if (property === "agents") return agentSystemDiagnostics;
      if (property === "restoreEntityLayerSnapshot" || property === "restoreAgentSystemSnapshot") return undefined;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, property, value) {
      if (property === "gpu" || property === "entityLayer" || property === "agents") return false;
      return Reflect.set(target, property, value, target);
    },
    defineProperty(target, property, descriptor) {
      if (property === "gpu" || property === "entityLayer") return false;
      return Reflect.defineProperty(target, property, descriptor);
    },
    deleteProperty(target, property) {
      if (property === "gpu" || property === "entityLayer") return false;
      return Reflect.deleteProperty(target, property);
    },
    getOwnPropertyDescriptor(target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
      if (property === "gpu" && descriptor && "value" in descriptor) {
        return { ...descriptor, value: gpuDiagnostics };
      }
      if (property === "entityLayer" && descriptor && "value" in descriptor) {
        return { ...descriptor, value: entityLayerDiagnostics };
      }
      if (property === "agents" && descriptor && "value" in descriptor) {
        return { ...descriptor, value: agentSystemDiagnostics };
      }
      return descriptor;
    },
  }) as SimulationEngineDebugView;
}
