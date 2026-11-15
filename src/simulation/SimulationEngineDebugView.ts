import type { SimulationEngine } from "./SimulationEngine";

/**
 * Browser-facing diagnostics view. The simulation engine remains the owner of
 * its GPU backend; exposing that backend would let page code upload or dispatch
 * device state outside the engine's revision/readback transaction.
 */
export type SimulationEngineDebugView = Omit<SimulationEngine, "gpu"> & {
  readonly gpu: Readonly<{ isAvailable: boolean }>;
};

export function createSimulationEngineDebugView(
  engine: SimulationEngine,
): SimulationEngineDebugView {
  const gpuDiagnostics = Object.freeze({
    get isAvailable(): boolean {
      return engine.gpu.isAvailable;
    },
  });

  return new Proxy(engine, {
    get(target, property) {
      if (property === "gpu") return gpuDiagnostics;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, property, value) {
      if (property === "gpu") return false;
      return Reflect.set(target, property, value, target);
    },
    defineProperty(target, property, descriptor) {
      if (property === "gpu") return false;
      return Reflect.defineProperty(target, property, descriptor);
    },
    deleteProperty(target, property) {
      if (property === "gpu") return false;
      return Reflect.deleteProperty(target, property);
    },
    getOwnPropertyDescriptor(target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
      if (property === "gpu" && descriptor && "value" in descriptor) {
        return { ...descriptor, value: gpuDiagnostics };
      }
      return descriptor;
    },
  }) as SimulationEngineDebugView;
}
