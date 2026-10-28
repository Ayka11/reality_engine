export type MutableBufferSide = "front" | "back";
export const INTERNAL_MUTABLE_BUFFER = Symbol("reality-engine.internal-mutable-buffer");

export interface InternalMutableBufferOwner {
  [INTERNAL_MUTABLE_BUFFER](side?: MutableBufferSide): Float32Array;
}

/**
 * Return the live internal array for a synchronous, transaction-local hot path.
 *
 * SAFETY CONTRACT: the revision is advanced when the alias is acquired, not on
 * each subsequent typed-array write. Callers must not retain the returned array
 * across an await, worker/message handoff, callback boundary, or after the
 * synchronous owning operation returns. Use a tracked public view or a scoped
 * owner mutation API when a mutation can outlive the current call stack.
 */
export function getMutableBuffer(owner: InternalMutableBufferOwner, side: MutableBufferSide = "front"): Float32Array {
  return owner[INTERNAL_MUTABLE_BUFFER](side);
}

const MUTATING_METHODS = new Set<PropertyKey>(["set", "fill", "copyWithin", "reverse", "sort"]);
const CALLBACK_METHODS = new Set<PropertyKey>([
  "every", "filter", "find", "findIndex", "forEach", "map", "some", "reduce", "reduceRight",
]);

/** Public, revision-tracked Float32Array view. */
export function createTrackedFloat32Array(target: Float32Array, onMutation: () => void): Float32Array {
  let proxy: Float32Array;
  proxy = new Proxy(target, {
    get(array, property) {
      if (property === "buffer") return array.slice().buffer;
      if (property === "byteOffset") return 0;
      if (property === "subarray") {
        return (begin?: number, end?: number) => createTrackedFloat32Array(array.subarray(begin, end), onMutation);
      }
      if (property === "valueOf") return () => proxy;
      const value = Reflect.get(array, property, array) as unknown;
      if (typeof value !== "function") return value;
      if (MUTATING_METHODS.has(property)) {
        return (...args: unknown[]) => {
          const result = Reflect.apply(value, array, args);
          onMutation();
          return result === array ? proxy : result;
        };
      }
      if (CALLBACK_METHODS.has(property)) {
        return (...args: unknown[]) => {
          const callback = args[0];
          if (typeof callback !== "function") return Reflect.apply(value, array, args);
          const callbackThis = property === "reduce" || property === "reduceRight" ? undefined : args[1];
          args[0] = (...callbackArgs: unknown[]) => {
            if (callbackArgs.length > 0) callbackArgs[callbackArgs.length - 1] = proxy;
            return Reflect.apply(callback, callbackThis, callbackArgs);
          };
          return Reflect.apply(value, array, args);
        };
      }
      return value.bind(array);
    },
    set(array, property, value) {
      const success = Reflect.set(array, property, value, array);
      if (success && typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) onMutation();
      return success;
    },
    defineProperty(array, property, descriptor) {
      const success = Reflect.defineProperty(array, property, descriptor);
      if (success && typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) onMutation();
      return success;
    },
  });
  return proxy;
}
