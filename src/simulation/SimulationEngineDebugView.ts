import type { SimulationEngine } from "./SimulationEngine";
import type { EntityLayer } from "./EntityLayer";

/**
 * Browser-facing diagnostics view. The simulation engine remains the owner of
 * its GPU backend; exposing that backend would let page code upload or dispatch
 * device state outside the engine's revision/readback transaction.
 */
export type EntityLayerDiagnosticsView = Readonly<Pick<
  EntityLayer,
  "snapshot" | "getEntities" | "extinctCount" | "totalSpawned" | "mutationStrength"
>>;

export type SimulationEngineDebugView = Omit<
  SimulationEngine,
  "gpu" | "entityLayer" | "restoreEntityLayerSnapshot"
> & {
  readonly gpu: Readonly<{ isAvailable: boolean }>;
  readonly entityLayer: EntityLayerDiagnosticsView;
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

  return new Proxy(engine, {
    get(target, property) {
      if (property === "gpu") return gpuDiagnostics;
      if (property === "entityLayer") return entityLayerDiagnostics;
      if (property === "restoreEntityLayerSnapshot") return undefined;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, property, value) {
      if (property === "gpu" || property === "entityLayer") return false;
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
      return descriptor;
    },
  }) as SimulationEngineDebugView;
}
